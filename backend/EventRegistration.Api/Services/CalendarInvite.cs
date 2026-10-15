using System.Text;
using EventRegistration.Api.Models;

namespace EventRegistration.Api.Services;

/// <summary>
/// Builds iCalendar (.ics, RFC 5545) meeting invites for Online / Hybrid events, attached to the
/// confirmation email so the meeting lands in the registrant's calendar (Outlook, Gmail, phones).
///
/// Each registration gets one stable UID, so a later invite with a higher SEQUENCE replaces the
/// calendar entry (time/link change) and a CANCEL removes it (registration cancelled / event
/// deleted). Event times are stored as server-local time and converted to UTC here.
/// </summary>
public static class CalendarInvite
{
    public const string FileName = "invite.ics";

    // The subset of meeting details an invite needs, resolved for one registration
    // (a sub-event's own time / link win over the event's).
    public sealed record Details(
        string Uid, int Sequence, string Title, DateTime StartsAt, DateTime EndsAt,
        string? Venue, string MeetingUrl, string? Description,
        string OrganizerName, string OrganizerEmail, string AttendeeName, string AttendeeEmail);

    /// <summary>
    /// Resolve invite details for a registration, or null when the event has no online part or
    /// no usable meeting link. Requires <c>reg.Session</c> to be loaded for sub-event registrations.
    /// </summary>
    public static Details? For(Event ev, Registration reg, string organizerName, string organizerEmail)
    {
        if (!EventFormats.HasOnline(ev.Format)) return null;
        var url = MeetingUrlFor(ev, reg.Session);
        var email = reg.DisplayEmail;
        if (url is null || string.IsNullOrWhiteSpace(email)) return null;

        var title = reg.Session is not null ? $"{ev.Title} — {reg.Session.Title}" : ev.Title;
        var starts = reg.Session?.StartsAt ?? ev.StartsAt;
        var ends = reg.Session?.EndsAt ?? ev.EndsAt;
        if (ends <= starts) ends = starts.AddHours(1);
        var venue = EventFormats.HasVenue(ev.Format) ? (reg.Session?.Venue ?? ev.Venue) : null;

        return new Details(
            $"reg-{reg.Token:N}@nxpass", ev.InviteSequence, title, starts, ends, venue, url,
            reg.Session?.Description ?? (string.IsNullOrWhiteSpace(ev.Description) ? null : ev.Description),
            organizerName, organizerEmail, reg.DisplayName, email!);
    }

    /// <summary>A sub-event's own link, else the event's; null when neither is a valid http(s) URL.</summary>
    public static string? MeetingUrlFor(Event ev, Session? session)
    {
        var url = !string.IsNullOrWhiteSpace(session?.MeetingUrl) ? session!.MeetingUrl : ev.MeetingUrl;
        return IsValidUrl(url) ? url!.Trim() : null;
    }

    public static bool IsValidUrl(string? url) =>
        Uri.TryCreate(url?.Trim(), UriKind.Absolute, out var u) && (u.Scheme == "https" || u.Scheme == "http");

    /// <summary>METHOD:REQUEST invite (new or updated meeting).</summary>
    public static byte[] Request(Details d) => Build(d, cancel: false);

    /// <summary>METHOD:CANCEL — removes the meeting from the attendee's calendar.</summary>
    public static byte[] Cancel(Details d) => Build(d, cancel: true);

    /// <summary>The MIME content type for the attachment (method must match the body).</summary>
    public static string ContentType(bool cancel) =>
        $"text/calendar; method={(cancel ? "CANCEL" : "REQUEST")}; charset=utf-8";

    private static byte[] Build(Details d, bool cancel)
    {
        var desc = new StringBuilder();
        desc.Append("Join the online meeting: ").Append(d.MeetingUrl);
        if (d.Venue is not null) desc.Append("\n\nIn person: ").Append(d.Venue);
        if (!string.IsNullOrWhiteSpace(d.Description)) desc.Append("\n\n").Append(d.Description!.Trim());

        var location = d.Venue is not null ? $"{d.Venue} / Online meeting" : "Online meeting";
        // Cancellations must carry a higher SEQUENCE than the invite they remove.
        var seq = cancel ? d.Sequence + 1 : d.Sequence;

        var lines = new List<string>
        {
            "BEGIN:VCALENDAR",
            "PRODID:-//NXPass//Event Registration//EN",
            "VERSION:2.0",
            "CALSCALE:GREGORIAN",
            $"METHOD:{(cancel ? "CANCEL" : "REQUEST")}",
            "BEGIN:VEVENT",
            $"UID:{d.Uid}",
            $"SEQUENCE:{seq}",
            $"DTSTAMP:{Utc(DateTime.Now)}",
            $"DTSTART:{Utc(d.StartsAt)}",
            $"DTEND:{Utc(d.EndsAt)}",
            $"SUMMARY:{Escape(d.Title)}",
            $"DESCRIPTION:{Escape(desc.ToString())}",
            $"LOCATION:{Escape(location)}",
            $"URL:{d.MeetingUrl}",
            $"ORGANIZER;CN={Param(d.OrganizerName)}:mailto:{d.OrganizerEmail}",
            $"ATTENDEE;CN={Param(d.AttendeeName)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=FALSE:mailto:{d.AttendeeEmail}",
            // Outlook shows its "Join" button for Teams links carried in this property.
            $"X-MICROSOFT-SKYPETEAMSMEETINGURL:{d.MeetingUrl}",
            $"STATUS:{(cancel ? "CANCELLED" : "CONFIRMED")}",
            "TRANSP:OPAQUE",
        };
        if (!cancel)
        {
            // 15-minute reminder.
            lines.AddRange(new[]
            {
                "BEGIN:VALARM", "ACTION:DISPLAY", $"DESCRIPTION:{Escape(d.Title)}",
                "TRIGGER:-PT15M", "END:VALARM",
            });
        }
        lines.Add("END:VEVENT");
        lines.Add("END:VCALENDAR");

        var sb = new StringBuilder();
        foreach (var l in lines) sb.Append(Fold(l)).Append("\r\n");
        return Encoding.UTF8.GetBytes(sb.ToString());
    }

    // Event times are server-local; iCalendar gets UTC ("Z") so every client shows the right time.
    private static string Utc(DateTime local) =>
        DateTime.SpecifyKind(local, local.Kind == DateTimeKind.Utc ? DateTimeKind.Utc : DateTimeKind.Local)
            .ToUniversalTime().ToString("yyyyMMdd'T'HHmmss'Z'");

    // TEXT value escaping (RFC 5545 §3.3.11).
    private static string Escape(string s) => s
        .Replace("\\", "\\\\").Replace(";", "\\;").Replace(",", "\\,")
        .Replace("\r\n", "\n").Replace("\r", "\n").Replace("\n", "\\n");

    // Parameter values (CN=…) can't contain ; : , or quotes unless quoted.
    private static string Param(string s) => $"\"{s.Replace("\"", "'")}\"";

    // Fold lines longer than 75 octets (RFC 5545 §3.1), without splitting a UTF-8 sequence.
    private static string Fold(string line)
    {
        if (Encoding.UTF8.GetByteCount(line) <= 75) return line;
        var sb = new StringBuilder();
        var count = 0;
        var first = true;
        foreach (var rune in line.EnumerateRunes())
        {
            var n = rune.Utf8SequenceLength;
            var limit = first ? 75 : 74; // continuation lines start with a space
            if (count + n > limit)
            {
                sb.Append("\r\n ");
                count = 0;
                first = false;
            }
            sb.Append(rune.ToString());
            count += n;
        }
        return sb.ToString();
    }
}
