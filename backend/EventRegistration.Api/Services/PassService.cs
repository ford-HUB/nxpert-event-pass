using System.Text;
using EventRegistration.Api.Models;

namespace EventRegistration.Api.Services;

// How a confirmation pass was delivered (or that there was no contact to send it to).
public enum PassDelivery { NotSent, Email, Viber, Both }

// Why an online meeting invite is being withdrawn.
public enum MeetingCancelReason { RegistrationCancelled, EventCancelled, NowInPerson }

/// <summary>
/// Issues entry passes. The pass (a QR of the registration token) is only ever sent once a
/// registration has been confirmed by an admin, so this is the single place that builds the QR
/// and routes it to the member's chosen channel (Email or Viber). Callers save the DbContext.
/// </summary>
public class PassService
{
    private readonly EmailService _email;
    private readonly MobileMessenger _mobile;
    private readonly QrService _qr;
    private readonly MealStubService _mealStubs;
    private readonly MealStubImageService _stubImages;
    private readonly IConfiguration _config;

    public PassService(EmailService email, MobileMessenger mobile, QrService qr,
        MealStubService mealStubs, MealStubImageService stubImages, IConfiguration config)
    {
        _email = email;
        _mobile = mobile;
        _qr = qr;
        _mealStubs = mealStubs;
        _stubImages = stubImages;
        _config = config;
    }

    private string FrontendBase => _config["App:FrontendBaseUrl"]?.TrimEnd('/') ?? "http://localhost:4200";

    // Public "edit your response" link, including events with only the standard contact fields.
    public string EditUrl(Event ev, Registration reg) =>
        $"{FrontendBase}/r/{reg.Token}";

    /// <summary>
    /// Sends the "registration confirmed" pass to the registrant over their preferred channel
    /// (an account's <see cref="User.NotificationChannel"/>; guests always use email), stamping
    /// <see cref="Registration.PassEmailSentAt"/>. Falls back to email when Viber is preferred
    /// but no phone is on file. Returns how it was delivered. Does not call SaveChanges.
    /// Requires <c>reg.User</c> and <c>reg.Session</c> to be loaded.
    /// Set <c>emailOnly</c> for an explicit email resend instead of the preferred channel.
    /// </summary>
    public async Task<PassDelivery> SendConfirmationAsync(Event ev, Registration reg, bool emailOnly = false)
    {
        // For a sub-event registration, the pass shows the session's title/time/venue.
        var title = reg.Session is not null ? $"{ev.Title} — {reg.Session.Title}" : ev.Title;
        var startsAt = reg.Session?.StartsAt ?? ev.StartsAt;
        var venue = reg.Session?.Venue ?? ev.Venue;
        var name = reg.DisplayName;
        var qrPng = _qr.GeneratePng($"REG:{reg.Token}");

        // Online / hybrid: meeting link + calendar invite. Online-only events have no door, so no
        // QR pass or meal stubs — the join link is the "pass".
        var showPass = EventFormats.HasVenue(ev.Format);
        var meetingUrl = EventFormats.HasOnline(ev.Format) ? CalendarInvite.MeetingUrlFor(ev, reg.Session) : null;
        var invite = CalendarInvite.For(ev, reg, _email.FromName, _email.FromAddress);

        // Generate (once) and deliver the registrant's individual meal stubs alongside the pass.
        var stubs = showPass ? await _mealStubs.EnsureStubsAsync(reg) : new List<MealStub>();

        // A stub's validity label, from its explicit date range (e.g. "VALID ON OCTOBER 09, 2026"
        // or "VALID SEP 11 – 13, 2026").
        static string ValidityFor(MealStub s) => MealStubImageService.ValidityLabel(s.ValidFrom, s.ValidTo);

        var editUrl = EditUrl(ev, reg);
        var channel = emailOnly ? NotificationChannels.Email
            : reg.User?.NotificationChannel ?? reg.GuestNotificationChannel ?? NotificationChannels.Email;
        var phone = reg.DisplayPhone;
        var email = reg.DisplayEmail;
        var sentViber = false;
        var sentEmail = false;

        // Viber, when preferred (Viber or Both) and a phone is on file.
        if (NotificationChannels.UsesViber(channel) && !string.IsNullOrWhiteSpace(phone))
        {
            if (showPass)
                await _mobile.SendPassAsync(phone!, title, startsAt, venue, name, reg.Token.ToString(), qrPng, editUrl);
            if (meetingUrl is not null)
            {
                var text = showPass
                    ? $"You can also join \"{title}\" online: {meetingUrl}"
                    : $"Hi {name}, your registration for \"{title}\" is confirmed. " +
                      $"When: {startsAt:ddd, MMM d yyyy, h:mm tt}. Join online: {meetingUrl}" +
                      (editUrl is null ? "" : $" · Edit your response: {editUrl}");
                await _mobile.SendTextAsync(phone!, $"Registration confirmed — {title}", text);
            }
            if (stubs.Count > 0)
            {
                var items = stubs
                    .Select(s => (
                        Caption: $"{s.Name} ₱{s.Denomination:0.00} · {ValidityFor(s)}",
                        Control: s.ControlNumber))
                    .ToList();
                await _mobile.SendMealStubsAsync(phone!, ev.Title, items);
            }
            sentViber = true;
        }

        // Email, when preferred (Email or Both) — or as a fallback when Viber was preferred but no
        // phone is on file.
        var needEmail = NotificationChannels.UsesEmail(channel)
            || (!sentViber && channel == NotificationChannels.Viber);
        if (needEmail && !string.IsNullOrWhiteSpace(email))
        {
            // Pass QR + one fully-composed image per meal stub (banner, QR, MEAL STUB, validity,
            // vertical denomination — all baked into a single PNG so it renders identically anywhere).
            var images = showPass ? new Dictionary<string, byte[]> { ["qrcode"] = qrPng } : new();
            var html = new StringBuilder(
                EmailTemplates.Confirmation(title, startsAt, venue, name, editUrl, meetingUrl, showPass));
            if (stubs.Count > 0)
            {
                html.Append(
                    "<div style=\"max-width:560px;margin:16px auto 0;\">" +
                    "<h3 style=\"text-align:center;color:#333;margin:8px 0\">Your meal stubs</h3>" +
                    "<p style=\"text-align:center;color:#888;font-size:13px;margin:0 0 8px\">" +
                    "Present each stub at the meal counter. Each stub can be redeemed once.</p></div>");
                foreach (var s in stubs)
                {
                    var cid = "stub-" + s.ControlNumber.ToString("N");
                    images[cid] = _stubImages.Render(
                        s.Color ?? "#0d9488", ev.Title, ev.BannerImage, ValidityFor(s), s.Denomination, s.ControlNumber);
                    html.Append(
                        $"<div style=\"text-align:center;margin:6px 0\">" +
                        $"<img src=\"cid:{cid}\" alt=\"Meal stub\" width=\"400\" style=\"max-width:100%;display:block;margin:0 auto\" /></div>");
                }
            }
            var attachments = invite is null
                ? null
                : new[] { new EmailAttachment(CalendarInvite.FileName, CalendarInvite.Request(invite), CalendarInvite.ContentType(false)) };
            var subject = showPass
                ? $"Registration confirmed — your pass for {title}"
                : $"Registration confirmed — online meeting for {title}";
            await _email.SendAsync(email!, subject, html.ToString(),
                inlineImages: images, attachments: attachments);
            sentEmail = true;
        }

        if (!sentViber && !sentEmail) return PassDelivery.NotSent;
        reg.PassEmailSentAt = DateTime.Now;
        return sentViber && sentEmail ? PassDelivery.Both
            : sentViber ? PassDelivery.Viber : PassDelivery.Email;
    }

    /// <summary>
    /// Online meeting changed (time / title / link): sends the registrant an updated calendar
    /// invite (same UID, higher SEQUENCE) plus the new link over Viber when that's their channel.
    /// Only for confirmed registrations (they're the ones who received an invite). Requires
    /// <c>reg.User</c> and <c>reg.Session</c> to be loaded.
    /// </summary>
    public async Task SendMeetingUpdateAsync(Event ev, Registration reg)
    {
        var invite = CalendarInvite.For(ev, reg, _email.FromName, _email.FromAddress);
        var url = CalendarInvite.MeetingUrlFor(ev, reg.Session);
        if (url is null) return;
        var title = reg.Session is not null ? $"{ev.Title} — {reg.Session.Title}" : ev.Title;
        var startsAt = reg.Session?.StartsAt ?? ev.StartsAt;
        var subject = $"Updated: online meeting for {title}";

        var channel = reg.User?.NotificationChannel ?? reg.GuestNotificationChannel ?? NotificationChannels.Email;
        if (NotificationChannels.UsesViber(channel) && !string.IsNullOrWhiteSpace(reg.DisplayPhone))
            await _mobile.SendTextAsync(reg.DisplayPhone!, subject,
                $"Hi {reg.DisplayName}, the online meeting for \"{title}\" has changed. " +
                $"When: {startsAt:ddd, MMM d yyyy, h:mm tt}. Join: {url}");

        if (invite is not null && (NotificationChannels.UsesEmail(channel) || string.IsNullOrWhiteSpace(reg.DisplayPhone)))
            await _email.SendAsync(invite.AttendeeEmail, subject,
                EmailTemplates.MeetingUpdated(title, startsAt, reg.DisplayName, url),
                attachments: new[] { new EmailAttachment(CalendarInvite.FileName, CalendarInvite.Request(invite), CalendarInvite.ContentType(false)) });
    }

    /// <summary>
    /// Removes the online meeting from the registrant's calendar (CANCEL invite) — sent when a
    /// confirmed registration is cancelled or the whole event is deleted. No-op for in-person
    /// events or registrations that never received an invite. Requires <c>reg.Session</c> loaded.
    /// </summary>
    public async Task SendMeetingCancelAsync(Event ev, Registration reg, MeetingCancelReason reason)
    {
        if (reg.PassEmailSentAt is null) return; // never received an invite
        var invite = CalendarInvite.For(ev, reg, _email.FromName, _email.FromAddress);
        if (invite is null) return;
        var subject = reason switch
        {
            MeetingCancelReason.EventCancelled => $"Cancelled: {invite.Title}",
            MeetingCancelReason.NowInPerson => $"Online meeting removed — {invite.Title}",
            _ => $"Registration cancelled — {invite.Title}",
        };
        await _email.SendAsync(invite.AttendeeEmail, subject,
            EmailTemplates.MeetingCancelled(invite.Title, invite.StartsAt, reg.DisplayName, reason),
            attachments: new[] { new EmailAttachment(CalendarInvite.FileName, CalendarInvite.Cancel(invite), CalendarInvite.ContentType(true)) });
    }

    /// <summary>
    /// Notifies the registrant that their event kit has been claimed, over their preferred channel
    /// (account's <see cref="User.NotificationChannel"/>; guests always use email, falling back to
    /// email when Viber is preferred but no phone is on file). When <paramref name="claimedBy"/> is
    /// null the kit was self-claimed and a generic message is sent; otherwise it names the claimer.
    /// Returns how it was delivered. Does not call SaveChanges. Requires <c>reg.User</c> to be loaded.
    /// </summary>
    public async Task<PassDelivery> SendKitClaimedAsync(Event ev, Registration reg, string? claimedBy)
    {
        var name = reg.DisplayName;
        var text = string.IsNullOrWhiteSpace(claimedBy)
            ? $"Hi {name}, this confirms that your kit for \"{ev.Title}\" has already been claimed."
            : $"Hi {name}, your kit for \"{ev.Title}\" has been claimed by {claimedBy}.";
        var subject = $"Event kit claimed — {ev.Title}";

        var channel = reg.User?.NotificationChannel ?? reg.GuestNotificationChannel ?? NotificationChannels.Email;
        if (channel == NotificationChannels.Viber && !string.IsNullOrWhiteSpace(reg.DisplayPhone))
        {
            await _mobile.SendTextAsync(reg.DisplayPhone!, subject, text);
            return PassDelivery.Viber;
        }

        var email = reg.DisplayEmail;
        if (string.IsNullOrWhiteSpace(email)) return PassDelivery.NotSent;

        var html = EmailTemplates.KitClaimed(ev.Title, name, claimedBy);
        await _email.SendAsync(email, subject, html);
        return PassDelivery.Email;
    }

    /// <summary>
    /// Sends the registrant their "edit your response" link over their preferred channel — used by
    /// the public-page recovery flow ("lost my link"). Requires <c>reg.Event</c> and <c>reg.User</c>
    /// to be loaded. Returns how it was delivered.
    /// </summary>
    public async Task<PassDelivery> SendEditLinkAsync(Event ev, Registration reg)
    {
        var url = EditUrl(ev, reg);
        var name = reg.DisplayName;
        var subject = $"Edit your registration — {ev.Title}";

        var channel = reg.User?.NotificationChannel ?? reg.GuestNotificationChannel ?? NotificationChannels.Email;
        if (channel == NotificationChannels.Viber && !string.IsNullOrWhiteSpace(reg.DisplayPhone))
        {
            await _mobile.SendTextAsync(reg.DisplayPhone!, subject,
                $"Hi {name}, review or update your response for \"{ev.Title}\" here: {url}");
            return PassDelivery.Viber;
        }

        var email = reg.DisplayEmail;
        if (string.IsNullOrWhiteSpace(email)) return PassDelivery.NotSent;

        await _email.SendAsync(email, subject, EmailTemplates.EditLink(ev.Title, name, url));
        return PassDelivery.Email;
    }
}
