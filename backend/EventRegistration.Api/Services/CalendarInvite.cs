using System.Text;
using EventRegistration.Api.Models;

namespace EventRegistration.Api.Services;

/// <summary>
/// Builds iCalendar (.ics, RFC 5545) requests for invitations and confirmations across all event formats.
///
/// Each event/sub-event gets a stable UID, so a later invite with a higher SEQUENCE replaces the
/// calendar entry (time/link change) and a CANCEL removes it (registration cancelled / event
/// deleted). Stored Philippine wall-clock times are converted to UTC independently of the server timezone.
/// </summary>
public static class CalendarInvite
{
    public const string FileName = "invite.ics";

    // The subset of meeting details an invite needs, resolved for one registration
    // (a sub-event's own time / link win over the event's).
    public sealed record Details(
        string Uid, int Sequence, string Title, DateTime StartsAt, DateTime EndsAt,
        string? Venue, string MeetingUrl, string? Description,
        string OrganizerName, string OrganizerEmail, string AttendeeName, string AttendeeEmail,
        IReadOnlyList<(string Email, bool Optional)>? Recipients = null);

    public static string EventUid(Event ev) => $"event-{ev.PublicSlug}@nxpass";

    public static EmailAttachment ForInvitation(Event ev, string organizerName, string organizerEmail,
        IReadOnlyCollection<string> to, IReadOnlyCollection<string> cc, string registerUrl, bool cancel = false)
    {
        if (ev.StartsAt == default || ev.EndsAt <= ev.StartsAt)
            throw new ArgumentException("Set a valid start and end date/time for this event before sending invitations.");
        var recipients = to.Select(e => (e, false)).Concat(cc.Select(e => (e, true))).ToList();
        var details = new Details(EventUid(ev), ev.InviteSequence, ev.Title, ev.StartsAt, ev.EndsAt,
            EventFormats.HasVenue(ev.Format) ? ev.Venue : null, registerUrl,
            ev.Description, organizerName, organizerEmail, "", "", recipients);
        return new EmailAttachment(FileName, cancel ? Cancel(details) : Request(details), ContentType(cancel));
    }

    /// <summary>
    /// Resolve a registration's calendar details using a confirmed meeting link or registration URL.
    /// Requires <c>reg.Session</c> to be loaded for sub-event registrations.
    /// </summary>
    public static Details? For(Event ev, Registration reg, string organizerName, string organizerEmail, string? registerUrl = null)
    {
        var url = EventFormats.HasOnline(ev.Format) ? MeetingUrlFor(ev, reg.Session) : null;
        url ??= registerUrl;
        var email = reg.DisplayEmail;
        if (url is null || string.IsNullOrWhiteSpace(email)) return null;

        var title = reg.Session is not null ? $"{ev.Title} — {reg.Session.Title}" : ev.Title;
        var starts = reg.Session?.StartsAt ?? ev.StartsAt;
        var ends = reg.Session?.EndsAt ?? ev.EndsAt;
        if (ends <= starts) ends = starts.AddHours(1);
        var venue = EventFormats.HasVenue(ev.Format) ? (reg.Session?.Venue ?? ev.Venue) : null;

        return new Details(
            reg.SessionId is int sid ? $"event-{ev.PublicSlug}-session-{sid}@nxpass" : EventUid(ev), ev.InviteSequence, title, starts, ends, venue, url,
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
        desc.Append("Event link: ").Append(d.MeetingUrl);
        if (d.Venue is not null) desc.Append("\n\nIn person: ").Append(d.Venue);
        if (!string.IsNullOrWhiteSpace(d.Description)) desc.Append("\n\n").Append(d.Description!.Trim());

        var location = d.Venue ?? "Online meeting";
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
            $"DTSTAMP:{Utc(DateTime.UtcNow)}",
            $"DTSTART:{Utc(d.StartsAt)}",
            $"DTEND:{Utc(d.EndsAt)}",
            $"SUMMARY:{Escape(d.Title)}",
            $"DESCRIPTION:{Escape(desc.ToString())}",
            $"LOCATION:{Escape(location)}",
            $"URL:{Escape(d.MeetingUrl)}",
            $"ORGANIZER;CN={Param(d.OrganizerName)}:mailto:{d.OrganizerEmail}",
            $"STATUS:{(cancel ? "CANCELLED" : "CONFIRMED")}",
            "TRANSP:OPAQUE",
        };
        if (d.Recipients is not null)
            foreach (var (email, optional) in d.Recipients)
                lines.Add($"ATTENDEE;ROLE={(optional ? "OPT" : "REQ")}-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:{email}");
        else lines.Add($"ATTENDEE;CN={Param(d.AttendeeName)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:{d.AttendeeEmail}");
        if (Uri.TryCreate(d.MeetingUrl, UriKind.Absolute, out var meeting) &&
            (meeting.Host.Equals("teams.microsoft.com", StringComparison.OrdinalIgnoreCase) || meeting.Host.Equals("teams.live.com", StringComparison.OrdinalIgnoreCase)))
            lines.Add($"X-MICROSOFT-SKYPETEAMSMEETINGURL:{Escape(d.MeetingUrl)}");
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

    // The event form stores Philippine wall-clock times without an offset. Never
    // interpret those using the web server's timezone (which can be UTC under IIS/cloud).
    private static string Utc(DateTime local) =>
        (local.Kind == DateTimeKind.Utc ? local : TimeZoneInfo.ConvertTimeToUtc(
            DateTime.SpecifyKind(local, DateTimeKind.Unspecified), TimeZoneInfo.FindSystemTimeZoneById("Asia/Manila")))
            .ToString("yyyyMMdd'T'HHmmss'Z'");

    // TEXT value escaping (RFC 5545 §3.3.11).
    private static string Escape(string s) => s
        .Replace("\\", "\\\\").Replace(";", "\\;").Replace(",", "\\,")
        .Replace("\r\n", "\n").Replace("\r", "\n").Replace("\n", "\\n");

    // Parameter values (CN=…) can't contain ; : , or quotes unless quoted.
    private static string Param(string s) => $"\"{s.Replace("\r", "").Replace("\n", "").Replace("\"", "'")}\"";

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
