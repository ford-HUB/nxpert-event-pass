using EventRegistration.Api.Data;
using EventRegistration.Api.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace EventRegistration.Api.Controllers;

// My Reminders: mail-plan mails sent to the signed-in user's address, and the reminders they set.
[ApiController]
[Route("api/mail-inbox")]
[Authorize]
public class MailInboxController(AppDbContext db) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> List()
    {
        var email = await MyEmail();
        if (email is null) return Ok(Array.Empty<object>());
        return Ok(await Items(db.MailPlanDeliveries.Where(d => d.Email == email)));
    }

    [HttpGet("{id:int}/body")]
    public async Task<IActionResult> Body(int id)
    {
        var email = await MyEmail();
        var body = await db.MailPlanDeliveries.AsNoTracking().Where(d => d.Id == id && d.Email == email)
            .Select(d => d.Send!.BodyHtml).SingleOrDefaultAsync();
        return body is null ? NotFound() : Ok(new { bodyHtml = body });
    }

    // Plans (or clears, with null) the reminder for a mail.
    [HttpPut("{id:int}/reminder")]
    public async Task<IActionResult> SetReminder(int id, MailReminderRequest req)
    {
        var now = DateTimeOffset.UtcNow;
        if (req.RemindAt is { } at && (at <= now.AddMinutes(-1) || at > now.AddYears(1)))
            return BadRequest(new { message = "Pick a reminder time in the future, within a year." });
        return await Change(id, d =>
        {
            d.RemindAt = req.RemindAt?.ToUniversalTime();
            d.Snoozed = false;
            d.ReminderSentAt = null;
            d.DoneAt = null;
        });
    }

    [HttpPost("{id:int}/snooze")]
    public Task<IActionResult> Snooze(int id) => Change(id, d =>
    {
        var now = DateTimeOffset.UtcNow;
        d.RemindAt = (d.RemindAt > now ? d.RemindAt.Value : now).AddDays(1);
        d.Snoozed = true;
        d.ReminderSentAt = null;
        d.DoneAt = null;
    });

    [HttpPost("{id:int}/done")]
    public Task<IActionResult> Done(int id) => Change(id, d => d.DoneAt = DateTimeOffset.UtcNow);

    private async Task<IActionResult> Change(int id, Action<MailPlanDelivery> change)
    {
        var email = await MyEmail();
        var delivery = await db.MailPlanDeliveries.SingleOrDefaultAsync(d => d.Id == id && d.Email == email);
        if (delivery is null) return NotFound(new { message = "This mail is no longer available." });
        change(delivery);
        await db.SaveChangesAsync();
        return Ok((await Items(db.MailPlanDeliveries.Where(d => d.Id == id))).Single());
    }

    private async Task<string?> MyEmail()
    {
        var userId = this.UserId();
        var email = await db.Users.AsNoTracking().Where(u => u.Id == userId).Select(u => u.Email).SingleOrDefaultAsync();
        return string.IsNullOrWhiteSpace(email) ? null : email.Trim().ToLowerInvariant();
    }

    private async Task<List<object>> Items(IQueryable<MailPlanDelivery> query)
    {
        var rows = await query.AsNoTracking().Where(d => d.Send!.DispatchedAt != null)
            .OrderByDescending(d => d.Send!.DispatchedAt).Take(200)
            .Select(d => new {
                d.Id, d.Send!.Subject, d.Send.PreviewText, d.Send.ImageCount, ReceivedAt = d.Send.DispatchedAt,
                d.Send.Plan!.Kind, d.Send.Plan.EventName, d.Send.Plan.CreatedByUserId,
                EventAt = d.Send.Plan.Event != null ? (DateTime?)d.Send.Plan.Event.StartsAt : null,
                Venue = d.Send.Plan.Event != null ? d.Send.Plan.Event.Venue : null,
                d.RemindAt, d.Snoozed, d.DoneAt,
            }).ToListAsync();
        var senderIds = rows.Select(r => r.CreatedByUserId).Distinct().ToList();
        var senders = await db.Users.AsNoTracking().Where(u => senderIds.Contains(u.Id)).ToDictionaryAsync(u => u.Id, u => u.FullName);
        return rows.Select(r => (object)new {
            r.Id, from = senders.GetValueOrDefault(r.CreatedByUserId) ?? "Event organizer", r.Subject, r.PreviewText, r.ImageCount,
            r.ReceivedAt, r.Kind, @event = r.EventName, r.EventAt, r.Venue, r.RemindAt, r.Snoozed, done = r.DoneAt != null,
        }).ToList();
    }
}
