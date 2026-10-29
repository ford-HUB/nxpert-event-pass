using EventRegistration.Api.Data;
using EventRegistration.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace EventRegistration.Api.Services;

/// <summary>
/// Builds the Attendance grid rows (<see cref="AttendeeDto"/>). Shared by the attendance list /
/// CSV export and the realtime "attendeesChanged" push, so both always carry the same shape.
/// </summary>
public class AttendeeQuery
{
    private readonly AppDbContext _db;

    public AttendeeQuery(AppDbContext db) => _db = db;

    // All rows for an event, or only the given registrations when `registrationIds` is set
    // (used to push just the newly created rows to the Attendance grid in realtime).
    public async Task<List<AttendeeDto>> LoadAsync(int eventId, IReadOnlyCollection<int>? registrationIds = null)
    {
        // Project only the columns the grid needs — never the user photo or session poster blobs.
        var query = _db.Registrations.Where(r => r.EventId == eventId);
        if (registrationIds is not null)
            query = query.Where(r => registrationIds.Contains(r.Id));

        var rows = await query
            .OrderByDescending(r => r.CheckedInAt != null)
            .ThenBy(r => r.User != null ? r.User.FullName : r.GuestFullName)
            .Select(r => new
            {
                r.Id,
                FullName = r.User != null ? r.User.FullName : (r.GuestFullName ?? "Guest"),
                Email = r.User != null ? r.User.Email : (r.GuestEmail ?? r.GuestPhone ?? ""),
                Organization = r.User != null ? r.User.Organization : null,
                SenateNo = r.User != null ? r.User.SenateNo : r.GuestSenateNo,
                Phone = r.User != null ? r.User.Phone : r.GuestPhone,
                NotificationChannel = r.User != null ? r.User.NotificationChannel
                    : (r.GuestNotificationChannel ?? NotificationChannels.Email),
                r.Token,
                r.RegisteredAt, r.ConfirmedAt, r.CheckedInAt, r.CheckInMethod,
                r.KitClaimedAt, r.KitClaimedBy,
                r.MealsRedeemedAt, r.MealsRedeemedBy,
                r.FormResponses,
                r.SessionId,
                SessionTitle = r.Session != null ? r.Session.Title : null,
            })
            .ToListAsync();

        // Per-sub-event meal totals (value = Σ denomination×quantity, count = Σ quantity).
        // Event-level (per-day) stubs are handled by the meal board, not here.
        var mealTotals = await _db.Meals
            .Where(m => m.EventId == eventId && m.SessionId != null)
            .GroupBy(m => m.SessionId!.Value)
            .Select(g => new
            {
                SessionId = g.Key,
                Value = g.Sum(m => m.Denomination * m.Quantity),
                Count = g.Sum(m => m.Quantity),
            })
            .ToDictionaryAsync(x => x.SessionId, x => new { x.Value, x.Count });

        return rows.Select(r =>
        {
            decimal mealValue = 0;
            int mealCount = 0;
            if (r.SessionId is int sid && mealTotals.TryGetValue(sid, out var mt))
            {
                mealValue = mt.Value;
                mealCount = mt.Count;
            }
            return new AttendeeDto(
                r.Id, r.FullName, r.Email, r.Organization, r.SenateNo, r.Phone,
                r.RegisteredAt, r.ConfirmedAt, r.CheckedInAt,
                FormJson.ReadResponses(r.FormResponses),
                r.SessionId, r.SessionTitle, r.CheckInMethod,
                r.KitClaimedAt, r.KitClaimedBy,
                mealValue, mealCount, r.MealsRedeemedAt, r.MealsRedeemedBy, r.Token, r.NotificationChannel);
        }).ToList();
    }
}
