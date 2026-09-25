using EventRegistration.Api.Data;
using EventRegistration.Api.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace EventRegistration.Api.Controllers;

[ApiController]
[Route("api/events/{eventId:int}/feedback")]
[Authorize]
public class FeedbackController : ControllerBase
{
    private readonly AppDbContext _db;
    public FeedbackController(AppDbContext db) => _db = db;

    // ---- Participant: submit or update my rating for an event ----
    [HttpPost]
    public async Task<ActionResult<FeedbackDto>> Submit(int eventId, FeedbackRequest req)
    {
        if (req.Rating < 1 || req.Rating > 5)
            return BadRequest(new { message = "Rating must be between 1 and 5." });

        var uid = this.UserId();
        var isRegistered = await _db.Registrations.AnyAsync(r => r.EventId == eventId && r.UserId == uid);
        if (!isRegistered)
            return StatusCode(403, new { message = "You can only rate events you registered for." });

        var fb = await _db.Feedbacks.FirstOrDefaultAsync(f => f.EventId == eventId && f.UserId == uid);
        if (fb is null)
        {
            fb = new Feedback { EventId = eventId, UserId = uid };
            _db.Feedbacks.Add(fb);
        }
        fb.Rating = req.Rating;
        fb.Comment = req.Comment;
        await _db.SaveChangesAsync();

        var user = await _db.Users.FindAsync(uid);
        return Ok(new FeedbackDto(fb.Id, eventId, user!.FullName, fb.Rating, fb.Comment, fb.CreatedAt));
    }

    // ---- Participant: my existing feedback (to prefill the form) ----
    [HttpGet("mine")]
    public async Task<ActionResult<FeedbackDto?>> Mine(int eventId)
    {
        var uid = this.UserId();
        var fb = await _db.Feedbacks.FirstOrDefaultAsync(f => f.EventId == eventId && f.UserId == uid);
        if (fb is null) return Ok((FeedbackDto?)null);
        var user = await _db.Users.FindAsync(uid);
        return Ok(new FeedbackDto(fb.Id, eventId, user!.FullName, fb.Rating, fb.Comment, fb.CreatedAt));
    }

    // ---- Admin: aggregated feedback for an event ----
    [HttpGet]
    [Authorize(Roles = Roles.Admin + "," + Roles.SuperAdmin)]
    public async Task<ActionResult<EventFeedbackSummary>> Summary(int eventId)
    {
        var items = await (
            from f in _db.Feedbacks
            join u in _db.Users on f.UserId equals u.Id
            where f.EventId == eventId
            orderby f.CreatedAt descending
            select new FeedbackDto(f.Id, f.EventId, u.FullName, f.Rating, f.Comment, f.CreatedAt)
        ).ToListAsync();

        var avg = items.Count == 0 ? 0 : Math.Round(items.Average(i => i.Rating), 2);
        return Ok(new EventFeedbackSummary(items.Count, avg, items));
    }
}
