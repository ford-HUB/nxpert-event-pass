using System.Text.Json;
using EventRegistration.Api.Data;
using EventRegistration.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace EventRegistration.Api.Services;

public class InvitationEmailDispatcher(AppDbContext db, EmailService email, IConfiguration config,
    ILogger<InvitationEmailDispatcher> log)
{
    public const int MaxAttempts = 5;

    public async Task DispatchAsync(int id)
    {
        var now = DateTimeOffset.UtcNow;
        // Claim in SQL, shared by requests and every API instance. An edit changes
        // the rowversion; a claimed message can no longer be edited or cancelled.
        var claimed = await db.InvitationEmails.Where(m => m.Id == id &&
            (m.Status == InvitationEmailStatus.Scheduled || m.Status == InvitationEmailStatus.Queued) &&
            m.NextAttemptAt <= now && m.Attempts < MaxAttempts)
            .ExecuteUpdateAsync(s => s.SetProperty(m => m.Status, InvitationEmailStatus.Sending)
                .SetProperty(m => m.LastAttemptAt, now).SetProperty(m => m.UpdatedAt, now)
                .SetProperty(m => m.Attempts, m => m.Attempts + 1));
        if (claimed == 0) return;
        db.ChangeTracker.Clear();
        var item = await db.InvitationEmails.Include(m => m.Event).SingleOrDefaultAsync(m => m.Id == id);
        if (item is null) return; // The event may have been deleted after the claim.
        try
        {
            var ev = item.Event ?? throw new InvalidOperationException("The event no longer exists.");
            var message = await new InvitationMessageBuilder(db, config).BuildAsync(ev,
                new(JsonSerializer.Deserialize<List<string>>(item.ToJson),
                    JsonSerializer.Deserialize<List<string>>(item.CcJson), item.Subject, item.BodyHtml), enforceRecipientEntryLimit: false);
            if (ev.StartsAt == default || ev.EndsAt <= ev.StartsAt)
                throw new ArgumentException("Set a valid start and end date/time for this event.");
            await db.Events.Where(e => e.Id == ev.Id)
                .ExecuteUpdateAsync(s => s.SetProperty(e => e.InviteSequence, e => e.InviteSequence + 2));
            await db.Entry(ev).ReloadAsync();
            var calendar = CalendarInvite.ForInvitation(ev, email.FromName, email.FromAddress,
                message.To, message.Cc, message.RegisterUrl);
            var recipients = message.To.Concat(message.Cc).ToList();
            var invitations = await db.Invitations.Where(i => i.EventId == ev.Id && recipients.Contains(i.Email)).ToListAsync();
            var known = invitations.Select(i => i.Email).ToHashSet(StringComparer.OrdinalIgnoreCase);
            foreach (var address in recipients)
                if (known.Add(address))
                {
                    var invite = new Invitation { EventId = ev.Id, Email = address, Status = InvitationStatus.Queued };
                    db.Invitations.Add(invite);
                    invitations.Add(invite);
                }
            await db.SaveChangesAsync();
            var delivery = await email.SendMessageAsync(message.To, message.Cc, message.Subject,
                message.Html, inlineImages: message.Images, attachments: [calendar]);
            if (delivery == EmailDeliveryStatus.Sent)
            {
                item.Status = InvitationEmailStatus.Sent;
                item.SentAt = DateTimeOffset.UtcNow;
                item.LastError = null;
                foreach (var invite in invitations.Where(i => i.Status != InvitationStatus.Registered))
                {
                    invite.Status = InvitationStatus.Sent;
                    invite.SentAt = item.SentAt.Value.UtcDateTime;
                }
            }
            else
            {
                item.Status = item.Attempts >= MaxAttempts ? InvitationEmailStatus.Failed : InvitationEmailStatus.Queued;
                item.NextAttemptAt = DateTimeOffset.UtcNow.AddMinutes(5);
                item.LastError = item.Attempts >= MaxAttempts
                    ? "SMTP delivery was unavailable after five attempts. Saved to the server outbox. Open this email to retry."
                    : "SMTP delivery is unavailable. Saved to the server outbox; delivery will be retried in five minutes.";
            }
        }
        catch (Exception ex)
        {
            log.LogError(ex, "Invitation email {Id} failed.", id);
            item.Status = InvitationEmailStatus.Failed;
            // Do not disclose SMTP credentials, filesystem paths or database details.
            item.LastError = "Delivery could not be completed. Check the event and email settings, then open this email to retry.";
        }
        item.UpdatedAt = DateTimeOffset.UtcNow;
        // If persistence fails after SMTP accepted the message, leave it in Sending.
        // The worker flags it for manual review rather than automatically duplicating it.
        await db.SaveChangesAsync();
    }
}

public class InvitationEmailScheduler(IServiceScopeFactory scopes, ILogger<InvitationEmailScheduler> log) : BackgroundService
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
                // A restart or interrupted SMTP attempt has an uncertain outcome.
                await db.InvitationEmails.Where(m => m.Status == InvitationEmailStatus.Sending &&
                        m.LastAttemptAt < now.AddMinutes(-10))
                    .ExecuteUpdateAsync(s => s.SetProperty(m => m.Status, InvitationEmailStatus.Failed)
                        .SetProperty(m => m.UpdatedAt, now)
                        .SetProperty(m => m.LastError, "Delivery was interrupted. Check the recipient's inbox before retrying to avoid a duplicate."), stoppingToken);
                var ids = await db.InvitationEmails.AsNoTracking()
                    .Where(m => (m.Status == InvitationEmailStatus.Scheduled || m.Status == InvitationEmailStatus.Queued) &&
                        m.NextAttemptAt <= now && m.Attempts < InvitationEmailDispatcher.MaxAttempts)
                    .OrderBy(m => m.NextAttemptAt).Select(m => m.Id).Take(20).ToListAsync(stoppingToken);
                foreach (var id in ids)
                {
                    if (stoppingToken.IsCancellationRequested) break;
                    using var deliveryScope = scopes.CreateScope();
                    await deliveryScope.ServiceProvider.GetRequiredService<InvitationEmailDispatcher>().DispatchAsync(id);
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception ex) { log.LogError(ex, "Invitation email scheduler failed; retrying on the next poll."); }
        } while (await timer.WaitForNextTickAsync(stoppingToken));
    }
}
