using System.Net;
using EventRegistration.Api.Data;
using EventRegistration.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace EventRegistration.Api.Services;

// Updates the same event UID when its schedule changes; no calendar API credentials
// or direct access to attendees' Microsoft/Google accounts are implied by email delivery.
public class CalendarInvitationNotifier(AppDbContext db, EmailService email, IConfiguration config,
    ILogger<CalendarInvitationNotifier> log)
{
    public async Task<List<string>> RecipientsAsync(int eventId) => (await db.Invitations
        .Where(i => i.EventId == eventId).Select(i => i.Email).ToListAsync())
        .Select(InvitationMessageBuilder.Address).Where(e => e != null).Cast<string>()
        .Distinct(StringComparer.OrdinalIgnoreCase).ToList();

    public async Task NotifyAsync(Event ev, bool cancel = false, List<string>? recipients = null)
    {
        recipients ??= await RecipientsAsync(ev.Id);
        if (!cancel) {
            // Confirmed whole-event registrants receive their update through PassService,
            // which can include a private online join link. Avoid replacing it with a public URL.
            var confirmed = await db.Registrations.Where(r => r.EventId == ev.Id && r.SessionId == null &&
                r.ConfirmedAt != null && r.PassEmailSentAt != null)
                .Select(r => new { Email = r.User != null ? r.User.Email : r.GuestEmail,
                    Channel = r.User != null ? r.User.NotificationChannel : r.GuestNotificationChannel ?? NotificationChannels.Email,
                    Phone = r.User != null ? r.User.Phone : r.GuestPhone }).ToListAsync();
            var addresses = confirmed.Where(r => NotificationChannels.UsesEmail(r.Channel) || string.IsNullOrWhiteSpace(r.Phone))
                .Select(r => InvitationMessageBuilder.Address(r.Email)).Where(e => e != null).ToHashSet(StringComparer.OrdinalIgnoreCase);
            recipients = recipients.Where(e => !addresses.Contains(e)).ToList();
        }
        var frontend = config["App:FrontendBaseUrl"]?.TrimEnd('/') ?? "http://localhost:4200";
        var url = $"{frontend}/e/{Uri.EscapeDataString(ev.PublicSlug)}";
        foreach (var recipient in recipients)
        {
            try
            {
                var attachment = CalendarInvite.ForInvitation(ev, email.FromName, email.FromAddress,
                    new[] { recipient }, Array.Empty<string>(), url, cancel);
                var html = cancel ? $"<p>The event <strong>{WebUtility.HtmlEncode(ev.Title)}</strong> has been cancelled.</p>" :
                    "<p>The event details have changed. The attached calendar invitation updates your existing event.</p>" + EmailTemplates.Invitation(ev, WebUtility.HtmlEncode(url));
                await email.SendMessageAsync(new[] { recipient }, Array.Empty<string>(),
                    $"{(cancel ? "Cancelled" : "Updated")}: {ev.Title}", html, attachments: new[] { attachment });
            }
            catch (Exception ex) { log.LogError(ex, "Calendar notification failed for event {EventId}.", ev.Id); }
        }
    }
}
