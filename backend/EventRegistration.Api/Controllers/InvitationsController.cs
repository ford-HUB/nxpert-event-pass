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
            await _email.SendAsync(email, $"You're invited: {ev.Title}", html);
            sent++;
            await Task.Delay(200); // gentle throttle to stay under Gmail burst limits
        }
        await _db.SaveChangesAsync();

        return Ok(new { sent });
    }
}
