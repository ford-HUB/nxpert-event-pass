using EventRegistration.Api.Data;
using EventRegistration.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace EventRegistration.Api.Services;

public record AttendanceSummaryTotals(int CheckedIn, int Registered);

/// <summary>
/// Shared "checked in / registered" totals for an event's scanners. Counts distinct attendees,
/// not registrations: one person can hold several sub-event registrations.
/// </summary>
public class AttendanceSummaryService
{
    private readonly AppDbContext _db;

    public AttendanceSummaryService(AppDbContext db) => _db = db;

    // A normalized member ID (Senate No.) joins an attendee's rows across account/guest flows —
    // never a name or email. Older records without an ID fall back to their account or
    // registration ID. Soft-deleted rows are excluded by the global query filter.
    public IQueryable<AttendanceSummaryTotals> Query(int eventId) => _db.Registrations
        .Where(r => r.EventId == eventId)
        .Select(r => new { r.Id, r.UserId, r.CheckedInAt,
            MemberId = r.User != null ? r.User.SenateNo : r.GuestSenateNo })
        .GroupBy(r => r.MemberId != null && r.MemberId.Trim() != ""
            ? "member:" + r.MemberId.Trim().ToUpper()
            : r.UserId != null ? "user:" + r.UserId.Value.ToString() : "registration:" + r.Id.ToString())
        .Select(g => new { CheckedIn = g.Max(r => r.CheckedInAt != null ? 1 : 0) })
        .GroupBy(r => 1)
        .Select(g => new AttendanceSummaryTotals(g.Sum(r => r.CheckedIn), g.Count()));

    public async Task<EventAttendanceSummaryDto> GetAsync(int eventId)
    {
        // Both values come from one aggregate query, rather than adding device counters.
        var totals = await Query(eventId).SingleOrDefaultAsync();
        return new EventAttendanceSummaryDto(eventId, totals?.CheckedIn ?? 0,
            totals?.Registered ?? 0, DateTime.UtcNow);
    }
}
