using EventRegistration.Api.Data;
using EventRegistration.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace EventRegistration.Api.Services;

/// <summary>
/// Generates the individual meal stubs a registrant is entitled to (one per denomination copy),
/// each with a unique control number. Stubs are created once (on first confirmation) and reused.
/// </summary>
public class MealStubService
{
    private readonly AppDbContext _db;
    public MealStubService(AppDbContext db) => _db = db;

    /// <summary>
    /// Ensures the registration's meal stubs exist and returns them (ordered by day, then name).
    /// Does not call SaveChanges beyond creating missing stubs. Safe to call repeatedly.
    /// </summary>
    public async Task<List<MealStub>> EnsureStubsAsync(Registration reg)
    {
        var existing = await _db.MealStubs
            .Where(s => s.RegistrationId == reg.Id)
            .ToListAsync();
        if (existing.Count > 0)
            return Ordered(existing);

        // Applicable meal definitions: the sub-event's stubs, or (event-level) all of the event's.
        var defsQuery = _db.Meals.Where(m => m.EventId == reg.EventId);
        defsQuery = reg.SessionId is int sid
            ? defsQuery.Where(m => m.SessionId == sid)
            : defsQuery.Where(m => m.SessionId == null);
        var defs = await defsQuery.OrderBy(m => m.Day).ThenBy(m => m.SortOrder).ThenBy(m => m.Id).ToListAsync();

        var stubs = new List<MealStub>();
        foreach (var d in defs)
        {
            var qty = d.Quantity > 0 ? d.Quantity : 1;
            for (var i = 1; i <= qty; i++)
            {
                stubs.Add(new MealStub
                {
                    RegistrationId = reg.Id,
                    MealId = d.Id,
                    ControlNumber = Guid.NewGuid(),
                    Day = d.Day,
                    Name = d.Name,
                    Denomination = d.Denomination,
                    Color = d.Color,
                    ValidFrom = d.ValidFrom,
                    ValidTo = d.ValidTo,
                    CopyIndex = i,
                });
            }
        }

        if (stubs.Count > 0)
        {
            _db.MealStubs.AddRange(stubs);
            await _db.SaveChangesAsync();
        }
        return Ordered(stubs);
    }

    private static List<MealStub> Ordered(List<MealStub> stubs) =>
        stubs.OrderBy(s => s.Day).ThenBy(s => s.Name).ThenBy(s => s.CopyIndex).ToList();
}
