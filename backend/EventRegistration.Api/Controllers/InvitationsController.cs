using EventRegistration.Api.Data;
using EventRegistration.Api.Models;
using EventRegistration.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Text.Json;

namespace EventRegistration.Api.Controllers;

[ApiController]
[Route("api/events/{eventId:int}/invitations")]
[Authorize(Roles = Roles.Admin + "," + Roles.SuperAdmin)]
public class InvitationsController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly EmailService _email;
    private readonly IConfiguration _config;
    private readonly InvitationEmailDispatcher _dispatcher;

    public InvitationsController(AppDbContext db, EmailService email, IConfiguration config, InvitationEmailDispatcher dispatcher)
    {
        _db = db;
        _email = email;
        _config = config;
        _dispatcher = dispatcher;
    }

    [HttpGet]
    public async Task<ActionResult<IEnumerable<Invitation>>> List(int eventId)
    {
        var items = await _db.Invitations.Where(i => i.EventId == eventId)
            .OrderByDescending(i => i.SentAt).ToListAsync();
        return Ok(items);
    }

    [HttpPost("compose")]
    [RequestSizeLimit(10_000_000)]
    public async Task<IActionResult> Compose(int eventId, InvitationComposeRequest req)
    {
        var ev = await _db.Events.FindAsync(eventId);
        if (ev is null) return NotFound(new { message = "This event no longer exists. Reload the event list before sending invitations." });
        InvitationMessage message;
        try {
            ValidateSchedule(req.ScheduledAt);
            message = await new InvitationMessageBuilder(_db, _config).BuildAsync(ev, req);
            if (ev.StartsAt == default || ev.EndsAt <= ev.StartsAt)
                throw new ArgumentException("Set a valid start and end date/time for this event before sending invitations.");
        }
        catch (ArgumentException ex) { return BadRequest(new { message = ex.Message }); }

        var item = new InvitationEmail { EventId = eventId };
        ApplyMessage(item, message, req.ScheduledAt);
        _db.InvitationEmails.Add(item);
        await _db.SaveChangesAsync();
        if (req.ScheduledAt is null) await _dispatcher.DispatchAsync(item.Id);
        var saved = await _db.InvitationEmails.AsNoTracking().SingleAsync(m => m.Id == item.Id);
        return Ok(DeliveryResult(saved, message.RegisterUrl));
    }

    [HttpGet("emails")]
    public async Task<IActionResult> EmailHistory(int eventId)
    {
        if (!await _db.Events.AnyAsync(e => e.Id == eventId)) return NotFound();
        // Keep large editor bodies (including inline images) out of the history list.
        var items = await _db.InvitationEmails.AsNoTracking().Where(m => m.EventId == eventId)
            .OrderByDescending(m => m.CreatedAt).ThenByDescending(m => m.Id)
            .Select(m => new { m.Id, m.EventId, m.ToJson, m.CcJson, m.Subject, m.Status,
                m.CreatedAt, m.UpdatedAt, m.ScheduledAt, m.SentAt, m.LastAttemptAt, m.NextAttemptAt,
                m.Attempts, m.LastError, m.Version }).ToListAsync();
        return Ok(items.Select(m => new { m.Id, m.EventId,
            to = JsonSerializer.Deserialize<List<string>>(m.ToJson), cc = JsonSerializer.Deserialize<List<string>>(m.CcJson),
            m.Subject, m.Status, m.CreatedAt, m.UpdatedAt, m.ScheduledAt, m.SentAt, m.LastAttemptAt,
            m.NextAttemptAt, m.Attempts, m.LastError, m.Version }));
    }

    [HttpGet("emails/{id:int}")]
    public async Task<IActionResult> OpenEmail(int eventId, int id)
    {
        var item = await _db.InvitationEmails.AsNoTracking().SingleOrDefaultAsync(m => m.EventId == eventId && m.Id == id);
        return item is null ? NotFound() : Ok(EmailDetails(item));
    }

    [HttpPut("emails/{id:int}")]
    [RequestSizeLimit(10_000_000)]
    public async Task<IActionResult> UpdateEmail(int eventId, int id, InvitationEmailUpdateRequest req)
    {
        var item = await _db.InvitationEmails.Include(m => m.Event).SingleOrDefaultAsync(m => m.EventId == eventId && m.Id == id);
        if (item is null) return NotFound();
        if (!InvitationEmailStatus.CanEdit(item.Status))
            return Conflict(new { message = "This email is already being sent, sent or cancelled. Open it again to see its current status." });
        if (Convert.ToBase64String(item.Version) != req.Version)
            return Conflict(new { message = "This email has changed. Open it again before editing." });
        try
        {
            ValidateSchedule(req.ScheduledAt);
            var ev = item.Event!;
            if (ev.StartsAt == default || ev.EndsAt <= ev.StartsAt)
                throw new ArgumentException("Set a valid start and end date/time for this event before sending invitations.");
            var savedRecipientCount = JsonSerializer.Deserialize<List<string>>(item.ToJson)!.Count +
                JsonSerializer.Deserialize<List<string>>(item.CcJson)!.Count;
            // Expanded directory groups may exceed the composer entry limit.
            // Allow their saved recipient list to be edited without re-expanding it.
            var maxEntries = Math.Max(500, savedRecipientCount);
            if ((req.To?.Count ?? 0) + (req.Cc?.Count ?? 0) > maxEntries)
                throw new ArgumentException($"Add at most {maxEntries} recipient entries, or use @n-pax for all users.");
            var message = await new InvitationMessageBuilder(_db, _config).BuildAsync(ev,
                new(req.To, req.Cc, req.Subject, req.BodyHtml), enforceRecipientEntryLimit: false);
            ApplyMessage(item, message, req.ScheduledAt);
            await _db.SaveChangesAsync();
            if (req.ScheduledAt is null) await _dispatcher.DispatchAsync(id);
            var saved = await _db.InvitationEmails.AsNoTracking().SingleAsync(m => m.Id == id);
            return Ok(DeliveryResult(saved, message.RegisterUrl));
        }
        catch (ArgumentException ex) { return BadRequest(new { message = ex.Message }); }
        catch (DbUpdateConcurrencyException) { return Conflict(new { message = "This email changed or started sending. Open it again before editing." }); }
    }

    [HttpPost("emails/{id:int}/cancel")]
    public async Task<IActionResult> CancelEmail(int eventId, int id, InvitationEmailVersionRequest req)
    {
        var item = await _db.InvitationEmails.SingleOrDefaultAsync(m => m.EventId == eventId && m.Id == id);
        if (item is null) return NotFound();
        if (!InvitationEmailStatus.CanEdit(item.Status) || Convert.ToBase64String(item.Version) != req.Version)
            return Conflict(new { message = "This email changed or started sending. Refresh the history before cancelling." });
        item.Status = InvitationEmailStatus.Cancelled;
        item.UpdatedAt = DateTimeOffset.UtcNow;
        try { await _db.SaveChangesAsync(); }
        catch (DbUpdateConcurrencyException) { return Conflict(new { message = "This email changed or started sending. Refresh the history before cancelling." }); }
        return NoContent();
    }

    private static void ValidateSchedule(DateTimeOffset? scheduledAt)
    {
        if (scheduledAt is not null && scheduledAt <= DateTimeOffset.UtcNow)
            throw new ArgumentException("Choose a future date and time for the scheduled email.");
    }

    private static void ApplyMessage(InvitationEmail item, InvitationMessage message, DateTimeOffset? scheduledAt)
    {
        // Freeze group membership at save time so the reviewed recipient list is
        // exactly the list delivered later, even if the directory changes.
        item.ToJson = JsonSerializer.Serialize(message.To);
        item.CcJson = JsonSerializer.Serialize(message.Cc);
        item.Subject = message.Subject;
        item.BodyHtml = message.EditableBody;
        item.ScheduledAt = scheduledAt?.ToUniversalTime();
        item.NextAttemptAt = item.ScheduledAt ?? DateTimeOffset.UtcNow;
        item.Status = InvitationEmailStatus.Scheduled;
        item.Attempts = 0;
        item.LastError = null;
        item.LastAttemptAt = null;
        item.UpdatedAt = DateTimeOffset.UtcNow;
    }

    private static object EmailDetails(InvitationEmail m) => new {
        m.Id, m.EventId, to = JsonSerializer.Deserialize<List<string>>(m.ToJson),
        cc = JsonSerializer.Deserialize<List<string>>(m.CcJson), m.Subject, m.BodyHtml,
        m.Status, m.CreatedAt, m.UpdatedAt, m.ScheduledAt, m.SentAt, m.LastAttemptAt,
        m.NextAttemptAt, m.Attempts, m.LastError, m.Version,
    };

    private static object DeliveryResult(InvitationEmail m, string registerUrl)
    {
        var count = JsonSerializer.Deserialize<List<string>>(m.ToJson)!.Count + JsonSerializer.Deserialize<List<string>>(m.CcJson)!.Count;
        return new { id = m.Id, status = m.Status, sent = m.Status == InvitationEmailStatus.Sent ? count : 0,
            queued = m.Status == InvitationEmailStatus.Queued ? count : 0, recipientCount = count, registerUrl,
            message = m.Status switch {
                InvitationEmailStatus.Sent => $"Invitation sent to {count} recipient(s).",
                InvitationEmailStatus.Scheduled when m.ScheduledAt != null => $"Invitation scheduled for {count} recipient(s).",
                InvitationEmailStatus.Queued or InvitationEmailStatus.Failed => m.LastError,
                _ => "Invitation saved and waiting for delivery.",
            } };
    }

    [HttpPost]
    public async Task<IActionResult> Send(int eventId, InviteRequest req)
    {
        var ev = await _db.Events.FindAsync(eventId);
        if (ev is null) return NotFound();

        var frontendBase = _config["App:FrontendBaseUrl"]?.TrimEnd('/') ?? "http://localhost:4200";

        var emails = req.Emails
            .Select(e => e.Trim().ToLowerInvariant())
            .Where(e => !string.IsNullOrWhiteSpace(e))
            .Distinct()
            .ToList();

        var sent = 0;
        ev.InviteSequence += 2;
        foreach (var email in emails)
        {
            // Reuse the existing invitation token for this email if we've invited them before,
            // so the same magic-link keeps working; otherwise mint a new one.
            var invite = await _db.Invitations.FirstOrDefaultAsync(i => i.EventId == eventId && i.Email == email);
            if (invite is null)
            {
                invite = new Invitation { EventId = eventId, Email = email, Status = InvitationStatus.Sent };
                _db.Invitations.Add(invite);
            }

            // Each invitee gets their own link carrying their invite token (?invite=...),
            // which the landing page uses to auto-login/auto-fill.
            var registerUrl = $"{frontendBase}/e/{ev.PublicSlug}?invite={invite.Token}";
            var html = EmailTemplates.Invitation(ev, registerUrl);
            await _email.SendAsync(email, $"You're invited: {ev.Title}", html, attachments: new[] {
                CalendarInvite.ForInvitation(ev, _email.FromName, _email.FromAddress, new[] { email }, Array.Empty<string>(), registerUrl) });
            sent++;
            await Task.Delay(200); // gentle throttle to stay under Gmail burst limits
        }
        await _db.SaveChangesAsync();

        return Ok(new { sent });
    }
}
