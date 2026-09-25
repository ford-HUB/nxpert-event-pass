using EventRegistration.Api.Data;
using EventRegistration.Api.Models;
using EventRegistration.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace EventRegistration.Api.Controllers;

[ApiController]
[Route("api/dashboard")]
[Authorize(Roles = Roles.Admin + "," + Roles.SuperAdmin)]
public class DashboardController : ControllerBase
{
    private readonly AppDbContext _db;
    public DashboardController(AppDbContext db) => _db = db;

    [HttpGet("summary")]
    public async Task<ActionResult<DashboardSummary>> Summary()
    {
        var now = DateTime.UtcNow;

        // Aggregate totals in SQL rather than loading every registration row.
        var totalReg = await _db.Registrations.CountAsync();
        var totalIn = await _db.Registrations.CountAsync(r => r.CheckedInAt != null);
        var rate = totalReg == 0 ? 0 : Math.Round(100.0 * totalIn / totalReg, 1);

        var totalEvents = await _db.Events.CountAsync();
        var upcoming = await _db.Events.CountAsync(e => e.StartsAt >= now);

        // Recent events (no banner/registration blobs) with per-event counts.
        var recentLite = await _db.Events
            .OrderByDescending(e => e.StartsAt)
            .Take(5)
            .Select(e => new
            {
                e.Id, e.Title, e.Description, e.StartsAt, e.EndsAt, e.Venue, e.IsPublicLinkEnabled,
                e.PublicSlug, e.Status, e.Capacity, e.WelcomeMessage, e.RegistrationFees,
                Registered = e.Registrations.Count(),
                CheckedIn = e.Registrations.Count(r => r.CheckedInAt != null),
            })
            .ToListAsync();

        var recent = recentLite.Select(e => new EventDto(
            e.Id, e.Title, e.Description, e.StartsAt, e.EndsAt, e.Venue,
            e.IsPublicLinkEnabled, e.PublicSlug, e.Status,
            e.Registered, e.CheckedIn, e.Capacity,
            e.Capacity.HasValue && e.Registered >= e.Capacity.Value,
            new List<FormFieldDef>(), null, e.WelcomeMessage, new List<SessionDto>(),
            e.RegistrationFees, new List<ScheduleItem>(), false, new List<MealDto>())).ToList();

        return Ok(new DashboardSummary(
            TotalEvents: totalEvents,
            UpcomingEvents: upcoming,
            TotalRegistrations: totalReg,
            TotalCheckedIn: totalIn,
            CheckInRate: rate,
            RecentEvents: recent));
    }

    // Percentage of registrations per chapter for one event. "Chapter" is the registrant's
    // Organization. Account registrations use the linked user's chapter; public (guest)
    // registrations use the chapter they entered in the registration form (a form field named
    // "Chapter" or "Organization"). Every distinct chapter in the user master is listed —
    // including chapters with 0 registrants for this event — plus any extra chapter a guest
    // reported. Registrants with no resolvable chapter are grouped as "Unspecified" (shown only
    // when it actually has registrations).
    [HttpGet("chapter-breakdown")]
    public async Task<ActionResult<EventChapterBreakdown>> ChapterBreakdown([FromQuery] int eventId)
    {
        var ev = await _db.Events.FindAsync(eventId);
        if (ev is null) return NotFound(new { message = "Event not found." });

        const string unspecified = "Unspecified";

        // The registration form's "chapter" field key, so we can read a guest's chapter from
        // their form responses. Prefer a field named "Chapter", then one named "Organization".
        var schema = FormJson.ReadSchema(ev.FormSchema);
        var chapterKey =
            schema.FirstOrDefault(f => IsChapterField(f, "chapter"))?.Key
            ?? schema.FirstOrDefault(f => IsChapterField(f, "organization"))?.Key;

        // Registrations for this event: account chapter (if linked), the guest's form responses,
        // and whether the event kit has been claimed.
        var regs = await _db.Registrations
            .Where(r => r.EventId == eventId)
            .Select(r => new
            {
                Org = r.User != null ? r.User.Organization : null,
                IsGuest = r.UserId == null,
                Responses = r.FormResponses,
                KitClaimed = r.KitClaimedAt != null,
            })
            .ToListAsync();

        // Merge by normalized (trimmed, case-insensitive) chapter name. Guests take the chapter
        // from their registration-form answer. Track registrations and kit claims per chapter.
        var countMap = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        var claimMap = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        foreach (var r in regs)
        {
            var org = r.Org;
            if (string.IsNullOrWhiteSpace(org) && r.IsGuest && chapterKey is not null)
                FormJson.ReadResponses(r.Responses).TryGetValue(chapterKey, out org);

            var key = string.IsNullOrWhiteSpace(org) ? unspecified : org!.Trim();
            countMap[key] = countMap.GetValueOrDefault(key) + 1;
            if (r.KitClaimed) claimMap[key] = claimMap.GetValueOrDefault(key) + 1;
        }

        var total = countMap.Values.Sum();
        var totalClaimed = claimMap.Values.Sum();

        // All distinct chapters from the user master (zero-filled), any chapter a guest reported,
        // plus "Unspecified" when present.
        var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var masterChapters = await _db.Users
            .Where(u => u.Organization != null && u.Organization != "")
            .Select(u => u.Organization!)
            .ToListAsync();
        foreach (var c in masterChapters)
        {
            var n = c.Trim();
            if (n.Length > 0) names.Add(n);
        }
        foreach (var k in countMap.Keys) names.Add(k); // includes guest-reported chapters
        if (!countMap.ContainsKey(unspecified)) names.Remove(unspecified);

        var chapters = names
            .Select(name => new ChapterCount(
                name, countMap.GetValueOrDefault(name), claimMap.GetValueOrDefault(name)))
            .OrderByDescending(c => c.Count)
            .ThenBy(c => c.Chapter)
            .ToList();

        return Ok(new EventChapterBreakdown(ev.Id, ev.Title, ev.StartsAt, total, totalClaimed, chapters));
    }

    // True when a form field represents the given concept ("chapter"/"organization"), matched
    // case-insensitively against its key or label.
    private static bool IsChapterField(FormFieldDef f, string word) =>
        (f.Key ?? "").Trim().Contains(word, StringComparison.OrdinalIgnoreCase) ||
        (f.Label ?? "").Trim().Contains(word, StringComparison.OrdinalIgnoreCase);
}
