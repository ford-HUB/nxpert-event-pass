using EventRegistration.Api.Data;
using EventRegistration.Api.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace EventRegistration.Api.Controllers;

// Meal-stub scanning. Open to merchants (who can do nothing else) as well as admins, so a stub
// counter can be staffed by a vendor account. Redemption is by the stub's control number, so no
// event context is needed — a merchant simply scans whatever stub is presented.
[ApiController]
[Route("api/meal-scan")]
[Authorize(Roles = Roles.Admin + "," + Roles.SuperAdmin + "," + Roles.Merchant)]
public class MealScanController : ControllerBase
{
    private readonly AppDbContext _db;
    public MealScanController(AppDbContext db) => _db = db;

    /// <summary>
    /// Redeem an individual meal stub by its control number (QR payload "MEAL:{guid}" or a bare
    /// guid). Each stub is one-time; a second scan reports "already". Records the scanning user so
    /// different merchants redeeming different stubs of the same member are distinguishable.
    /// </summary>
    /// <summary>
    /// The signed-in user's all-time redemption tally (count + total value). Lets the merchant
    /// scanner show a running total that survives logout/login, not just the current session.
    /// </summary>
    [HttpGet("my-tally")]
    public async Task<ActionResult<MealScanTallyDto>> MyTally()
    {
        var userId = this.UserId();
        var mine = _db.MealStubs.Where(s => s.RedeemedByUserId == userId && s.RedeemedAt != null);
        var count = await mine.CountAsync();
        var value = count == 0 ? 0m : await mine.SumAsync(s => s.Denomination);
        return Ok(new MealScanTallyDto(count, value));
    }

    [HttpPost("redeem")]
    public async Task<ActionResult<MealStubScanResult>> Redeem(MealStubScanRequest req)
    {
        var raw = (req.Code ?? "").Trim();
        if (raw.StartsWith("MEAL:", StringComparison.OrdinalIgnoreCase))
            raw = raw[5..];

        if (!Guid.TryParse(raw, out var control))
            return Ok(new MealStubScanResult("invalid", null, null, 0, null));

        var stub = await _db.MealStubs
            .Include(s => s.Registration).ThenInclude(r => r!.User)
            .FirstOrDefaultAsync(s => s.ControlNumber == control);
        if (stub is null)
            return Ok(new MealStubScanResult("invalid", null, null, 0, null));

        var member = stub.Registration?.DisplayName;
        var label = stub.Day > 0 ? $"{stub.Name} · Day {stub.Day}" : stub.Name;

        if (stub.RedeemedAt is not null)
            return Ok(new MealStubScanResult("already", member, label, stub.Denomination, stub.Color,
                stub.RedeemedBy is null ? "This stub was already redeemed."
                    : $"Already redeemed by {stub.RedeemedBy}."));

        // Enforce the stub's validity dates — reject a stub scanned outside its valid range.
        var today = DateTime.Now.Date;
        if (today < stub.ValidFrom.Date || today > stub.ValidTo.Date)
        {
            var range = stub.ValidFrom.Date == stub.ValidTo.Date
                ? stub.ValidFrom.ToString("MMM d, yyyy")
                : $"{stub.ValidFrom:MMM d} – {stub.ValidTo:MMM d, yyyy}";
            return Ok(new MealStubScanResult("notvalid", member, label, stub.Denomination, stub.Color,
                $"Not valid today. This stub is valid {range}."));
        }

        // Record the scanning user (the merchant/admin) as who redeemed it.
        var scanner = await _db.Users.FindAsync(this.UserId());
        stub.RedeemedAt = DateTime.Now;
        stub.RedeemedByUserId = scanner?.Id;
        stub.RedeemedBy = scanner?.FullName;
        stub.RedeemedMethod = CheckInMethods.Scan;
        await _db.SaveChangesAsync();

        return Ok(new MealStubScanResult("valid", member, label, stub.Denomination, stub.Color));
    }
}
