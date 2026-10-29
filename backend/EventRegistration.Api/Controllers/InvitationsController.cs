using EventRegistration.Api.Data;
using EventRegistration.Api.Models;
using EventRegistration.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace EventRegistration.Api.Controllers;

[ApiController]
[Route("api/events/{eventId:int}/invitations")]
[Authorize(Roles = Roles.Admin + "," + Roles.SuperAdmin)]
public class InvitationsController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly EmailService _email;
    private readonly IConfiguration _config;

    public InvitationsController(AppDbContext db, EmailService email, IConfiguration config)
    {
        _db = db;
        _email = email;
        _config = config;
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
        EmailAttachment calendar;
        try {
            message = await new InvitationMessageBuilder(_db, _config).BuildAsync(ev, req);
            if (ev.StartsAt == default || ev.EndsAt <= ev.StartsAt)
                throw new ArgumentException("Set a valid start and end date/time for this event before sending invitations.");
            // A resend must rank above a recipient's earlier cancellation (SEQUENCE+1).
            ev.InviteSequence += 2;
            calendar = CalendarInvite.ForInvitation(ev, _email.FromName, _email.FromAddress, message.To, message.Cc, message.RegisterUrl);
        }
        catch (ArgumentException ex) { return BadRequest(new { message = ex.Message }); }

        var recipients = message.To.Concat(message.Cc).ToList();
        var existing = await _db.Invitations.Where(i => i.EventId == eventId && recipients.Contains(i.Email)).ToListAsync();
        var known = existing.Select(i => i.Email).ToHashSet(StringComparer.OrdinalIgnoreCase);
        foreach (var address in recipients)
            if (known.Add(address))
            {
                var invite = new Invitation { EventId = eventId, Email = address, Status = InvitationStatus.Queued };
                _db.Invitations.Add(invite);
                existing.Add(invite);
            }
        await _db.SaveChangesAsync();
        var delivery = await _email.SendMessageAsync(message.To, message.Cc, message.Subject,
            message.Html, inlineImages: message.Images, attachments: new[] { calendar });
        foreach (var invite in existing.Where(i => i.Status != InvitationStatus.Registered))
        {
            invite.Status = delivery == EmailDeliveryStatus.Sent ? InvitationStatus.Sent : InvitationStatus.Queued;
            invite.SentAt = DateTime.UtcNow;
        }
        await _db.SaveChangesAsync();
        return Ok(new { sent = delivery == EmailDeliveryStatus.Sent ? recipients.Count : 0,
            queued = delivery == EmailDeliveryStatus.Queued ? recipients.Count : 0,
            recipientCount = recipients.Count, registerUrl = message.RegisterUrl,
            message = delivery == EmailDeliveryStatus.Sent
                ? $"Invitation sent to {recipients.Count} recipient(s)."
                : $"Invitation saved to the email outbox for {recipients.Count} recipient(s). SMTP delivery is unavailable." });
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
