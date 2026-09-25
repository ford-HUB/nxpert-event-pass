using System.Text;
using EventRegistration.Api.Models;

namespace EventRegistration.Api.Services;

// How a confirmation pass was delivered (or that there was no contact to send it to).
public enum PassDelivery { NotSent, Email, Viber, Both }

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

    // Public "edit your response" link for a registration — only meaningful when the event has
    // custom form fields to edit; null otherwise (so we don't offer a link to an empty form).
    public string? EditUrl(Event ev, Registration reg) =>
        FormJson.ReadSchema(ev.FormSchema).Count > 0 ? $"{FrontendBase}/r/{reg.Token}" : null;

    /// <summary>
    /// Sends the "registration confirmed" pass to the registrant over their preferred channel
    /// (an account's <see cref="User.NotificationChannel"/>; guests always use email), stamping
    /// <see cref="Registration.PassEmailSentAt"/>. Falls back to email when Viber is preferred
    /// but no phone is on file. Returns how it was delivered. Does not call SaveChanges.
    /// Requires <c>reg.User</c> and <c>reg.Session</c> to be loaded.
    /// </summary>
    public async Task<PassDelivery> SendConfirmationAsync(Event ev, Registration reg)
    {
        // For a sub-event registration, the pass shows the session's title/time/venue.
        var title = reg.Session is not null ? $"{ev.Title} — {reg.Session.Title}" : ev.Title;
        var startsAt = reg.Session?.StartsAt ?? ev.StartsAt;
        var venue = reg.Session?.Venue ?? ev.Venue;
        var name = reg.DisplayName;
        var qrPng = _qr.GeneratePng($"REG:{reg.Token}");

        // Generate (once) and deliver the registrant's individual meal stubs alongside the pass.
        var stubs = await _mealStubs.EnsureStubsAsync(reg);

        // A stub's validity label, from its explicit date range (e.g. "VALID ON OCTOBER 09, 2026"
        // or "VALID SEP 11 – 13, 2026").
        static string ValidityFor(MealStub s) => MealStubImageService.ValidityLabel(s.ValidFrom, s.ValidTo);

        var editUrl = EditUrl(ev, reg);
        var channel = reg.User?.NotificationChannel ?? reg.GuestNotificationChannel ?? NotificationChannels.Email;
        var phone = reg.DisplayPhone;
        var email = reg.DisplayEmail;
        var sentViber = false;
        var sentEmail = false;

        // Viber, when preferred (Viber or Both) and a phone is on file.
        if (NotificationChannels.UsesViber(channel) && !string.IsNullOrWhiteSpace(phone))
        {
            await _mobile.SendPassAsync(phone!, title, startsAt, venue, name, reg.Token.ToString(), qrPng, editUrl);
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
            var images = new Dictionary<string, byte[]> { ["qrcode"] = qrPng };
            var html = new StringBuilder(EmailTemplates.Confirmation(title, startsAt, venue, name, editUrl));
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
            await _email.SendAsync(email!, $"Registration confirmed — your pass for {title}",
                html.ToString(), inlineImages: images);
            sentEmail = true;
        }

        if (!sentViber && !sentEmail) return PassDelivery.NotSent;
        reg.PassEmailSentAt = DateTime.Now;
        return sentViber && sentEmail ? PassDelivery.Both
            : sentViber ? PassDelivery.Viber : PassDelivery.Email;
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
        if (url is null) return PassDelivery.NotSent; // event has no editable form fields
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
