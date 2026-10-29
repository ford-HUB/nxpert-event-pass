using EventRegistration.Api.Data;
using EventRegistration.Api.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace EventRegistration.Api.Controllers;

[ApiController, Route("api/calendar"), Authorize]
public class CalendarController(AppDbContext db) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> List([FromQuery] DateTime from, [FromQuery] DateTime to)
    {
        if (User.IsInRole(Roles.Merchant)) return Forbid();
        if (from == default || to <= from || (to - from).TotalDays > 93)
            return BadRequest(new { message = "Choose a calendar range of up to 93 days." });
        var uid = this.UserId();
        var email = await db.Users.Where(u => u.Id == uid).Select(u => u.Email).FirstOrDefaultAsync();
        if (email is null) return Unauthorized();
        email = email.ToLower();
        var manage = User.IsInRole(Roles.Admin) || User.IsInRole(Roles.SuperAdmin) ||
            User.HasClaim(Permissions.ConfirmRegistrations, "true");
        var events = db.Events.AsNoTracking().Where(e => e.StartsAt < to && e.EndsAt > from);
        if (!manage) events = events.Where(e =>
            (e.IsPublicLinkEnabled && e.Status == EventStatus.Published) ||
            db.Registrations.Any(r => r.EventId == e.Id && r.UserId == uid) ||
            (e.Status != EventStatus.Draft && db.Invitations.Any(i => i.EventId == e.Id && i.Email.ToLower() == email)));
        var rows = await events.OrderBy(e => e.StartsAt).Select(e => new {
            e.Id, e.Title, e.Description, e.StartsAt, e.EndsAt, e.Venue, e.PublicSlug, e.Status, e.Format,
            IsRegistered = db.Registrations.Any(r => r.EventId == e.Id && r.UserId == uid),
            IsInvited = db.Invitations.Any(i => i.EventId == e.Id && i.Email.ToLower() == email),
            CanManage = manage,
        }).ToListAsync();
        // Meeting links and registrant information are deliberately absent from this projection.
        return Ok(new { timeZone = "Asia/Manila", events = rows });
    }
}
