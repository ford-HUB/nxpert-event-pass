using System.Net;
using System.Text.Json;
using EventRegistration.Api.Data;
using EventRegistration.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace EventRegistration.Api.Services;

/// <summary>
/// Delivers mail-plan days and the reminders receivers set on them. The first attempt freezes the
/// receiver list (one MailPlanDelivery each), which also puts the mail in their My Reminders inbox.
/// Email goes out in BCC batches; per-receiver progress makes retries skip anyone already reached.
/// </summary>
public class MailPlanDispatcher(AppDbContext db, EmailService email, MobileMessenger mobile, MailPlanAudience audience,
    ILogger<MailPlanDispatcher> log)
{
    public const int MaxAttempts = 5;
    private const int BatchSize = 50;

    private sealed class DeliveryException(string message) : Exception(message);

    public async Task DispatchAsync(int sendId)
    {
        var now = DateTimeOffset.UtcNow;
        // Claimed in SQL like invitation emails: an edit changes the rowversion, and a claimed
        // day can no longer be edited or removed.
        var claimed = await db.MailPlanSends.Where(s => s.Id == sendId && !s.Plan!.Draft &&
                (s.Status == MailSendStatus.Scheduled || s.Status == MailSendStatus.Queued) &&
                s.NextAttemptAt <= now && s.Attempts < MaxAttempts)
            .ExecuteUpdateAsync(u => u.SetProperty(s => s.Status, MailSendStatus.Sending)
                .SetProperty(s => s.LastAttemptAt, now).SetProperty(s => s.UpdatedAt, now)
                .SetProperty(s => s.Attempts, s => s.Attempts + 1));
        if (claimed == 0) return;
        db.ChangeTracker.Clear();
        var send = await db.MailPlanSends.Include(s => s.Plan).ThenInclude(p => p!.Event).SingleOrDefaultAsync(s => s.Id == sendId);
        if (send is null) return; // The plan was deleted after the claim.
        var plan = send.Plan!;
        try
        {
            if (send.DispatchedAt is null)
            {
                var recipients = await audience.ResolveAsync(
                    JsonSerializer.Deserialize<List<string>>(plan.GroupIdsJson) ?? [],
                    JsonSerializer.Deserialize<List<string>>(plan.EmailsJson) ?? []);
                if (recipients.Count == 0)
                    throw new DeliveryException("This plan has no receivers. Edit the plan's receivers, then retry.");
                // A receiver who is also on CC gets one copy, as a receiver.
                var reached = recipients.Select(r => r.Email).ToHashSet(StringComparer.OrdinalIgnoreCase);
                var cc = (await audience.ResolveAsync([], JsonSerializer.Deserialize<List<string>>(plan.CcJson) ?? []))
                    .Where(c => !reached.Contains(c.Email)).ToList();
                foreach (var r in recipients)
                    db.MailPlanDeliveries.Add(new MailPlanDelivery { SendId = send.Id, Email = r.Email, UserId = r.UserId, Phone = r.Phone });
                foreach (var c in cc)
                    db.MailPlanDeliveries.Add(new MailPlanDelivery { SendId = send.Id, Email = c.Email, UserId = c.UserId, IsCc = true });
                send.RecipientCount = recipients.Count + cc.Count;
                send.DispatchedAt = DateTimeOffset.UtcNow;
                await db.SaveChangesAsync();
            }
            var deliveries = await db.MailPlanDeliveries.Where(d => d.SendId == send.Id).OrderBy(d => d.Id).ToListAsync();
            var (body, images) = InvitationMessageBuilder.RenderBody(send.BodyHtml);
            var html = Template(plan, body, email.FromName);

            // Viber-only plans email the receivers who have no phone number. CC addresses are shown on
            // every batch but get their single copy with the first batch that goes out.
            var queued = false;
            var ccRows = deliveries.Where(d => d.IsCc).ToList();
            var ccList = ccRows.Select(d => d.Email).ToList();
            var byEmail = deliveries.Where(d => !d.IsCc && d.EmailSentAt is null &&
                (plan.Channel != MailPlanChannels.Viber || d.Phone is null)).ToList();
            var batches = byEmail.Chunk(BatchSize).ToList();
            if (batches.Count == 0 && ccRows.Any(d => d.EmailSentAt is null)) batches.Add([]);
            foreach (var batch in batches)
            {
                var ccPending = ccRows.Where(d => d.EmailSentAt is null).ToList();
                if (await email.SendBccAsync(batch.Select(d => d.Email).ToList(), send.Subject, html, images,
                        ccList, deliverCc: ccPending.Count > 0) != EmailDeliveryStatus.Sent)
                {
                    queued = true;
                    break;
                }
                foreach (var d in batch.Concat(ccPending)) d.EmailSentAt = DateTimeOffset.UtcNow;
                await db.SaveChangesAsync();
            }

            var viberFailed = 0;
            if (plan.Channel != MailPlanChannels.Email)
            {
                var text = InvitationMessageBuilder.PlainText(send.BodyHtml);
                foreach (var d in deliveries.Where(d => !d.IsCc && d.Phone is not null && d.ViberSentAt is null))
                {
                    try
                    {
                        await mobile.SendTextAsync(d.Phone!, send.Subject, text);
                        d.ViberSentAt = DateTimeOffset.UtcNow;
                    }
                    catch (Exception ex)
                    {
                        viberFailed++;
                        log.LogWarning(ex, "Mail plan send {Id}: Viber message to a receiver failed.", send.Id);
                    }
                }
                await db.SaveChangesAsync();
            }

            if (!queued && viberFailed == 0)
            {
                send.Status = MailSendStatus.Sent;
                send.SentAt = DateTimeOffset.UtcNow;
                send.LastError = null;
            }
            else
            {
                var last = send.Attempts >= MaxAttempts;
                send.Status = last ? MailSendStatus.Failed : MailSendStatus.Queued;
                send.NextAttemptAt = DateTimeOffset.UtcNow.AddMinutes(5);
                var problem = queued
                    ? "SMTP delivery is unavailable; the email was saved to the server outbox."
                    : $"{viberFailed} Viber message{(viberFailed == 1 ? "" : "s")} could not be sent.";
                send.LastError = last
                    ? $"{problem} Gave up after five attempts. Retry to try again; receivers already reached are skipped."
                    : $"{problem} Retrying in five minutes; receivers already reached are skipped.";
            }
        }
        catch (DeliveryException ex)
        {
            send.Status = MailSendStatus.Failed;
            send.LastError = ex.Message;
        }
        catch (Exception ex)
        {
            log.LogError(ex, "Mail plan send {Id} failed.", sendId);
            send.Status = MailSendStatus.Failed;
            // Do not disclose SMTP credentials, filesystem paths or database details.
            send.LastError = "Delivery could not be completed. Check the plan and email settings, then retry.";
        }
        send.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync();
    }

    /// <summary>Sends a receiver the reminder they set, by their preferred channel. Best effort, once.</summary>
    public async Task RemindAsync(int deliveryId)
    {
        var now = DateTimeOffset.UtcNow;
        var claimed = await db.MailPlanDeliveries.Where(d => d.Id == deliveryId && d.ReminderSentAt == null &&
                d.DoneAt == null && d.RemindAt <= now)
            .ExecuteUpdateAsync(u => u.SetProperty(d => d.ReminderSentAt, now));
        if (claimed == 0) return;
        var delivery = await db.MailPlanDeliveries.AsNoTracking().Include(d => d.Send).ThenInclude(s => s!.Plan)
            .SingleOrDefaultAsync(d => d.Id == deliveryId);
        if (delivery?.Send?.Plan is not { } plan) return;
        var send = delivery.Send;
        try
        {
            var user = await db.Users.AsNoTracking().Where(u => u.Email == delivery.Email)
                .Select(u => new { u.NotificationChannel, u.Phone }).FirstOrDefaultAsync();
            var channel = user?.NotificationChannel ?? NotificationChannels.Email;
            var phone = string.IsNullOrWhiteSpace(user?.Phone) ? delivery.Phone : user.Phone;
            var subject = "Reminder: " + send.Subject;
            if (subject.Length > 200) subject = subject[..200];
            if (NotificationChannels.UsesViber(channel) && phone is not null)
                await mobile.SendTextAsync(phone, subject, "You asked to be reminded about this mail.\n\n" +
                    InvitationMessageBuilder.PlainText(send.BodyHtml));
            if (NotificationChannels.UsesEmail(channel) || phone is null)
            {
                var (body, images) = InvitationMessageBuilder.RenderBody(send.BodyHtml);
                var intro = "<p style=\"margin:0 0 16px;padding:10px 14px;border-radius:8px;background:#e6f6f3;color:#0f766e\">" +
                    "You asked to be reminded about this mail.</p>";
                await email.SendMessageAsync([delivery.Email], [], subject, Template(plan, intro + body, email.FromName), inlineImages: images);
            }
        }
        catch (Exception ex) { log.LogError(ex, "Mail reminder {Id} could not be sent.", deliveryId); }
    }

    // Message, then the related event (when linked to one) and a short footer. The body is
    // already sanitized and encoded by RenderBody.
    private static string Template(MailPlan plan, string body, string fromName)
    {
        var ev = plan.Event;
        var eventBlock = ev is null ? "" :
            "<div style=\"margin-top:24px;padding:12px 16px;border:1px solid #e0e0e0;border-radius:8px\">" +
            $"<div style=\"font-weight:700\">{WebUtility.HtmlEncode(ev.Title)}</div>" +
            $"<div style=\"color:#5f6368\">{WebUtility.HtmlEncode(ev.StartsAt.ToString("dddd, MMMM d, yyyy · h:mm tt", System.Globalization.CultureInfo.InvariantCulture))}" +
            (string.IsNullOrWhiteSpace(ev.Venue) ? "" : " · " + WebUtility.HtmlEncode(ev.Venue)) + "</div></div>";
        return "<!doctype html><html><body style=\"font-family:Segoe UI,Arial,sans-serif;color:#202124\">" +
            "<div style=\"max-width:800px;margin:0 auto;font-size:15px;line-height:1.6\">" + body + eventBlock +
            $"<p style=\"margin-top:28px;font-size:12px;color:#5f6368\">Sent by {WebUtility.HtmlEncode(fromName)}. " +
            "Open My Reminders in the app to be reminded about this mail.</p></div></body></html>";
    }
}

public class MailPlanScheduler(IServiceScopeFactory scopes, ILogger<MailPlanScheduler> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(15));
        do
        {
            try
            {
                using var scope = scopes.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var now = DateTimeOffset.UtcNow;
                // A restart or interrupted attempt has an uncertain outcome; retrying skips receivers already reached.
                await db.MailPlanSends.Where(s => s.Status == MailSendStatus.Sending && s.LastAttemptAt < now.AddMinutes(-10))
                    .ExecuteUpdateAsync(u => u.SetProperty(s => s.Status, MailSendStatus.Failed).SetProperty(s => s.UpdatedAt, now)
                        .SetProperty(s => s.LastError, "Delivery was interrupted. Retry to reach the remaining receivers."), stoppingToken);
                var sendIds = await db.MailPlanSends.AsNoTracking()
                    .Where(s => !s.Plan!.Draft && (s.Status == MailSendStatus.Scheduled || s.Status == MailSendStatus.Queued) &&
                        s.NextAttemptAt <= now && s.Attempts < MailPlanDispatcher.MaxAttempts)
                    .OrderBy(s => s.NextAttemptAt).Select(s => s.Id).Take(10).ToListAsync(stoppingToken);
                var reminderIds = await db.MailPlanDeliveries.AsNoTracking()
                    .Where(d => d.RemindAt != null && d.ReminderSentAt == null && d.DoneAt == null && d.RemindAt <= now)
                    .OrderBy(d => d.RemindAt).Select(d => d.Id).Take(50).ToListAsync(stoppingToken);
                foreach (var id in sendIds)
                {
                    if (stoppingToken.IsCancellationRequested) break;
                    using var deliveryScope = scopes.CreateScope();
                    await deliveryScope.ServiceProvider.GetRequiredService<MailPlanDispatcher>().DispatchAsync(id);
                }
                foreach (var id in reminderIds)
                {
                    if (stoppingToken.IsCancellationRequested) break;
                    using var reminderScope = scopes.CreateScope();
                    await reminderScope.ServiceProvider.GetRequiredService<MailPlanDispatcher>().RemindAsync(id);
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception ex) { log.LogError(ex, "Mail plan scheduler failed; retrying on the next poll."); }
        } while (await timer.WaitForNextTickAsync(stoppingToken));
    }
}
