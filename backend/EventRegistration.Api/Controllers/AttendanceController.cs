using System.Text;
using EventRegistration.Api.Data;
using EventRegistration.Api.Models;
using EventRegistration.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace EventRegistration.Api.Controllers;

[ApiController]
[Route("api/events/{eventId:int}/attendance")]
[Authorize(Policy = Permissions.ConfirmRegistrationsPolicy)]
public class AttendanceController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly PassService _pass;
    private readonly NotificationService _notify;
    public AttendanceController(AppDbContext db, PassService pass, NotificationService notify)
    {
        _db = db;
        _pass = pass;
        _notify = notify;
    }

    [HttpGet]
    public async Task<ActionResult<IEnumerable<AttendeeDto>>> List(int eventId)
    {
        return Ok(await LoadAsync(eventId));
    }

    // ---- Manual check-in: admin marks selected registrations as attended ----
    // Records attendance with method "Manual". A pending registration is auto-confirmed as part
    // of the check-in (a person being marked present is implicitly approved), but no pass email
    // is sent — issuing passes stays the job of the Confirm action.
    [HttpPost("checkin")]
    public async Task<ActionResult<ManualCheckInResult>> ManualCheckIn(int eventId, ManualCheckInRequest req)
    {
        var ev = await _db.Events.FindAsync(eventId);
        if (ev is null) return NotFound();

        var ids = (req.RegistrationIds ?? new()).Distinct().ToList();
        if (ids.Count == 0)
            return BadRequest(new { message = "Select at least one registration to check in." });

        var regs = await _db.Registrations
            .Where(r => r.EventId == eventId && ids.Contains(r.Id))
            .ToListAsync();

        int checkedIn = 0, already = 0, autoConfirmed = 0;
        var now = DateTime.Now;
        foreach (var reg in regs)
        {
            if (reg.CheckedInAt is not null) { already++; continue; }
            if (reg.ConfirmedAt is null) { reg.ConfirmedAt = now; autoConfirmed++; }
            reg.CheckedInAt = now;
            reg.CheckInMethod = CheckInMethods.Manual;
            checkedIn++;
        }

        await _db.SaveChangesAsync();
        return Ok(new ManualCheckInResult(checkedIn, already, autoConfirmed));
    }

    // ---- Kit claiming: admin marks selected registrations' kits as claimed ----
    [HttpPost("claim-kit")]
    public async Task<ActionResult<ClaimKitResult>> ClaimKit(int eventId, ClaimKitRequest req)
    {
        var ev = await _db.Events.FindAsync(eventId);
        if (ev is null) return NotFound();

        var ids = (req.RegistrationIds ?? new()).Distinct().ToList();
        if (ids.Count == 0)
            return BadRequest(new { message = "Select at least one registration." });

        var claimer = (req.ClaimedBy ?? "").Trim();
        if (!req.SelfClaimed && claimer.Length == 0)
            return BadRequest(new { message = "Enter who claimed the kit, or choose self-claimed." });

        // Include User so DisplayName resolves for self-claimed rows; Session for the notice title.
        var regs = await _db.Registrations
            .Include(r => r.User)
            .Include(r => r.Session)
            .Where(r => r.EventId == eventId && ids.Contains(r.Id))
            .ToListAsync();

        int claimed = 0, already = 0;
        var now = DateTime.Now;
        var toNotify = new List<Registration>();
        foreach (var reg in regs)
        {
            if (reg.KitClaimedAt is not null) { already++; continue; }
            reg.KitClaimedAt = now;
            reg.KitClaimedBy = req.SelfClaimed ? reg.DisplayName : claimer;
            claimed++;
            toNotify.Add(reg);
        }

        await _db.SaveChangesAsync();

        // Optional per-event notification: tell each registrant their kit was claimed. Self-claimed
        // sends a generic message (claimer name omitted). Delivery failures don't undo the claim.
        int notified = 0;
        if (ev.NotifyOnKitClaim)
        {
            foreach (var reg in toNotify)
            {
                var delivery = await _pass.SendKitClaimedAsync(ev, reg, req.SelfClaimed ? null : claimer);
                if (delivery != PassDelivery.NotSent) notified++;

                // Realtime: push an in-app notification to the registrant (account-based only).
                if (reg.UserId is int uid)
                    await _notify.KitClaimedAsync(uid, new KitClaimedNotice(
                        reg.Id, ev.Id, ev.Title, reg.Session?.Title,
                        req.SelfClaimed ? null : claimer, now));
            }
        }

        return Ok(new ClaimKitResult(claimed, already, notified));
    }

    // Clear the kit-claimed flag on selected registrations (correcting a mistaken claim).
    [HttpPost("unclaim-kit")]
    public async Task<ActionResult<UnclaimKitResult>> UnclaimKit(int eventId, UnclaimKitRequest req)
    {
        var ev = await _db.Events.FindAsync(eventId);
        if (ev is null) return NotFound();

        var ids = (req.RegistrationIds ?? new()).Distinct().ToList();
        if (ids.Count == 0)
            return BadRequest(new { message = "Select at least one registration." });

        var regs = await _db.Registrations
            .Where(r => r.EventId == eventId && ids.Contains(r.Id) && r.KitClaimedAt != null)
            .ToListAsync();

        foreach (var reg in regs)
        {
            reg.KitClaimedAt = null;
            reg.KitClaimedBy = null;
        }

        await _db.SaveChangesAsync();
        return Ok(new UnclaimKitResult(regs.Count));
    }

    // ---- Meal stubs: issue a sub-event's whole stub set to selected confirmed registrants ----
    [HttpPost("redeem-meals")]
    public async Task<ActionResult<RedeemMealsResult>> RedeemMeals(int eventId, RedeemMealsRequest req)
    {
        var ev = await _db.Events.FindAsync(eventId);
        if (ev is null) return NotFound();

        var ids = (req.RegistrationIds ?? new()).Distinct().ToList();
        if (ids.Count == 0)
            return BadRequest(new { message = "Select at least one registration." });

        var claimer = (req.RedeemedBy ?? "").Trim();
        if (!req.SelfClaimed && claimer.Length == 0)
            return BadRequest(new { message = "Enter who received the meal stubs, or choose self-claimed." });

        // Sub-events that actually have meal stubs defined.
        var sessionsWithMeals = await _db.Meals
            .Where(m => m.EventId == eventId && m.SessionId != null)
            .Select(m => m.SessionId!.Value)
            .Distinct()
            .ToListAsync();
        var mealSessions = sessionsWithMeals.ToHashSet();

        var regs = await _db.Registrations
            .Include(r => r.User)
            .Where(r => r.EventId == eventId && ids.Contains(r.Id))
            .ToListAsync();

        int redeemed = 0, already = 0, noMeals = 0, unconfirmed = 0;
        var now = DateTime.Now;
        foreach (var reg in regs)
        {
            if (reg.SessionId is not int sid || !mealSessions.Contains(sid)) { noMeals++; continue; }
            if (reg.ConfirmedAt is null) { unconfirmed++; continue; }
            if (reg.MealsRedeemedAt is not null) { already++; continue; }
            reg.MealsRedeemedAt = now;
            reg.MealsRedeemedBy = req.SelfClaimed ? reg.DisplayName : claimer;
            reg.MealsRedeemedMethod = CheckInMethods.Manual;
            redeemed++;
        }

        await _db.SaveChangesAsync();
        return Ok(new RedeemMealsResult(redeemed, already, noMeals, unconfirmed));
    }

    // Clear the meal-redeemed flag on selected registrations (correcting a mistake).
    [HttpPost("unredeem-meals")]
    public async Task<ActionResult<UnredeemMealsResult>> UnredeemMeals(int eventId, UnredeemMealsRequest req)
    {
        var ev = await _db.Events.FindAsync(eventId);
        if (ev is null) return NotFound();

        var ids = (req.RegistrationIds ?? new()).Distinct().ToList();
        if (ids.Count == 0)
            return BadRequest(new { message = "Select at least one registration." });

        var regs = await _db.Registrations
            .Where(r => r.EventId == eventId && ids.Contains(r.Id) && r.MealsRedeemedAt != null)
            .ToListAsync();

        foreach (var reg in regs)
        {
            reg.MealsRedeemedAt = null;
            reg.MealsRedeemedBy = null;
            reg.MealsRedeemedMethod = null;
        }

        await _db.SaveChangesAsync();
        return Ok(new UnredeemMealsResult(regs.Count));
    }

    // ---- Event-level (per-day) meal stubs: board + per-day redemption (no-sub-event events) ----
    [HttpGet("meal-board")]
    public async Task<ActionResult<MealBoardDto>> MealBoard(int eventId)
    {
        var ev = await _db.Events.FindAsync(eventId);
        if (ev is null) return NotFound();

        // Event-level stubs grouped into days.
        var stubs = await _db.Meals
            .Where(m => m.EventId == eventId && m.SessionId == null)
            .OrderBy(m => m.Day).ThenBy(m => m.SortOrder).ThenBy(m => m.Id)
            .ToListAsync();

        var days = stubs
            .GroupBy(m => m.Day)
            .OrderBy(g => g.Key)
            .Select(g => new MealDayDto(
                g.Key,
                g.Sum(m => m.Denomination * m.Quantity),
                g.Sum(m => m.Quantity),
                g.Select(m => new MealDto(m.Id, m.Name, m.Denomination, m.Quantity, m.Color, m.Day, m.ValidFrom, m.ValidTo)).ToList()))
            .ToList();

        // Registrations for this event (event-level events have SessionId null) + their redeemed days.
        var rows = await _db.Registrations
            .Where(r => r.EventId == eventId)
            .OrderBy(r => r.User != null ? r.User.FullName : r.GuestFullName)
            .Select(r => new
            {
                r.Id,
                FullName = r.User != null ? r.User.FullName : (r.GuestFullName ?? "Guest"),
                Email = r.User != null ? r.User.Email : (r.GuestEmail ?? r.GuestPhone ?? ""),
                Organization = r.User != null ? r.User.Organization : null,
                r.RegisteredAt,
                Confirmed = r.ConfirmedAt != null,
                RedeemedDays = r.MealRedemptions.Select(mr => mr.Day).ToList(),
            })
            .ToListAsync();

        var board = rows.Select(r => new MealBoardRow(
            r.Id, r.FullName, r.Organization, r.Email, r.RegisteredAt, r.Confirmed, r.RedeemedDays)).ToList();

        return Ok(new MealBoardDto(days, board));
    }

    // Redeem one day's stubs for selected confirmed registrants.
    [HttpPost("redeem-meal-day")]
    public async Task<ActionResult<RedeemMealDayResult>> RedeemMealDay(int eventId, RedeemMealDayRequest req)
    {
        var ev = await _db.Events.FindAsync(eventId);
        if (ev is null) return NotFound();

        var ids = (req.RegistrationIds ?? new()).Distinct().ToList();
        if (ids.Count == 0)
            return BadRequest(new { message = "Select at least one registration." });

        var claimer = (req.RedeemedBy ?? "").Trim();
        if (!req.SelfClaimed && claimer.Length == 0)
            return BadRequest(new { message = "Enter who received the meal stubs, or choose self-claimed." });

        var regs = await _db.Registrations
            .Include(r => r.User)
            .Include(r => r.MealRedemptions)
            .Where(r => r.EventId == eventId && ids.Contains(r.Id))
            .ToListAsync();

        int redeemed = 0, already = 0, unconfirmed = 0;
        var now = DateTime.Now;
        foreach (var reg in regs)
        {
            if (reg.ConfirmedAt is null) { unconfirmed++; continue; }
            if (reg.MealRedemptions.Any(mr => mr.Day == req.Day)) { already++; continue; }
            reg.MealRedemptions.Add(new MealRedemption
            {
                Day = req.Day,
                RedeemedAt = now,
                RedeemedBy = req.SelfClaimed ? reg.DisplayName : claimer,
                Method = CheckInMethods.Manual,
            });
            redeemed++;
        }

        await _db.SaveChangesAsync();
        return Ok(new RedeemMealDayResult(redeemed, already, unconfirmed));
    }

    // Clear one day's redemption for selected registrants.
    [HttpPost("unredeem-meal-day")]
    public async Task<ActionResult<UnredeemMealDayResult>> UnredeemMealDay(int eventId, UnredeemMealDayRequest req)
    {
        var ev = await _db.Events.FindAsync(eventId);
        if (ev is null) return NotFound();

        var ids = (req.RegistrationIds ?? new()).Distinct().ToList();
        if (ids.Count == 0)
            return BadRequest(new { message = "Select at least one registration." });

        var rows = await _db.MealRedemptions
            .Where(mr => mr.Day == req.Day && ids.Contains(mr.RegistrationId)
                && mr.Registration!.EventId == eventId)
            .ToListAsync();

        _db.MealRedemptions.RemoveRange(rows);
        await _db.SaveChangesAsync();
        return Ok(new UnredeemMealDayResult(rows.Count));
    }

    // ---- Individually-issued meal stubs: per-registrant board + manual redeem ----
    [HttpGet("meal-stubs")]
    public async Task<ActionResult<MealStubBoardDto>> MealStubBoard(int eventId)
    {
        var ev = await _db.Events.FindAsync(eventId);
        if (ev is null) return NotFound();

        var rows = await _db.Registrations
            .Where(r => r.EventId == eventId)
            .OrderBy(r => r.User != null ? r.User.FullName : r.GuestFullName)
            .Select(r => new
            {
                r.Id,
                FullName = r.User != null ? r.User.FullName : (r.GuestFullName ?? "Guest"),
                Email = r.User != null ? r.User.Email : (r.GuestEmail ?? r.GuestPhone ?? ""),
                Organization = r.User != null ? r.User.Organization : null,
                Confirmed = r.ConfirmedAt != null,
                StubCount = r.MealStubs.Count,
                RedeemedCount = r.MealStubs.Count(s => s.RedeemedAt != null),
                Value = r.MealStubs.Sum(s => (decimal?)s.Denomination) ?? 0m,
                ValueRedeemed = r.MealStubs.Where(s => s.RedeemedAt != null).Sum(s => (decimal?)s.Denomination) ?? 0m,
            })
            .ToListAsync();

        // Only registrants who actually have stubs are relevant to the board.
        var withStubs = rows.Where(r => r.StubCount > 0).ToList();
        var board = withStubs.Select(r => new MealStubRow(
            r.Id, r.FullName, r.Organization, r.Email, r.Confirmed,
            r.StubCount, r.RedeemedCount, r.Value, r.ValueRedeemed)).ToList();

        return Ok(new MealStubBoardDto(
            withStubs.Sum(r => r.StubCount),
            withStubs.Sum(r => r.RedeemedCount),
            withStubs.Sum(r => r.ValueRedeemed),
            board));
    }

    // Manually mark all of the selected registrants' unredeemed stubs as redeemed.
    [HttpPost("redeem-stubs")]
    public async Task<ActionResult<RedeemStubsResult>> RedeemStubs(int eventId, RedeemStubsRequest req)
    {
        var ev = await _db.Events.FindAsync(eventId);
        if (ev is null) return NotFound();

        var ids = (req.RegistrationIds ?? new()).Distinct().ToList();
        if (ids.Count == 0) return BadRequest(new { message = "Select at least one registration." });

        var claimer = (req.RedeemedBy ?? "").Trim();
        if (!req.SelfClaimed && claimer.Length == 0)
            return BadRequest(new { message = "Enter who received the stubs, or choose self-claimed." });

        var stubs = await _db.MealStubs
            .Include(s => s.Registration).ThenInclude(r => r!.User)
            .Where(s => ids.Contains(s.RegistrationId) && s.RedeemedAt == null
                && s.Registration!.EventId == eventId)
            .ToListAsync();

        var now = DateTime.Now;
        int noStubs = ids.Count - stubs.Select(s => s.RegistrationId).Distinct().Count();
        foreach (var s in stubs)
        {
            s.RedeemedAt = now;
            s.RedeemedBy = req.SelfClaimed ? s.Registration?.DisplayName : claimer;
            s.RedeemedByUserId = req.SelfClaimed ? null : this.UserId();
            s.RedeemedMethod = CheckInMethods.Manual;
        }
        await _db.SaveChangesAsync();
        return Ok(new RedeemStubsResult(stubs.Count, noStubs < 0 ? 0 : noStubs));
    }

    // Clear redemption on all of the selected registrants' stubs.
    [HttpPost("unredeem-stubs")]
    public async Task<ActionResult<UnredeemStubsResult>> UnredeemStubs(int eventId, UnredeemStubsRequest req)
    {
        var ev = await _db.Events.FindAsync(eventId);
        if (ev is null) return NotFound();

        var ids = (req.RegistrationIds ?? new()).Distinct().ToList();
        if (ids.Count == 0) return BadRequest(new { message = "Select at least one registration." });

        var stubs = await _db.MealStubs
            .Where(s => ids.Contains(s.RegistrationId) && s.RedeemedAt != null
                && s.Registration!.EventId == eventId)
            .ToListAsync();

        foreach (var s in stubs)
        {
            s.RedeemedAt = null;
            s.RedeemedBy = null;
            s.RedeemedByUserId = null;
            s.RedeemedMethod = null;
        }
        await _db.SaveChangesAsync();
        return Ok(new UnredeemStubsResult(stubs.Count));
    }

    // ---- Per-stub list (segregated): each issued stub with who redeemed it ----
    [HttpGet("meal-stub-list")]
    public async Task<ActionResult<IEnumerable<MealStubDetailDto>>> MealStubList(int eventId)
    {
        var ev = await _db.Events.FindAsync(eventId);
        if (ev is null) return NotFound();

        var stubs = await _db.MealStubs
            .Where(s => s.Registration!.EventId == eventId)
            .OrderBy(s => s.Registration!.User != null ? s.Registration.User.FullName : s.Registration.GuestFullName)
            .ThenBy(s => s.Day).ThenBy(s => s.Name).ThenBy(s => s.CopyIndex)
            .Select(s => new MealStubDetailDto(
                s.Id, s.RegistrationId,
                s.Registration!.User != null ? s.Registration.User.FullName : (s.Registration.GuestFullName ?? "Guest"),
                s.Registration.User != null ? s.Registration.User.Organization : null,
                s.Day, s.Name, s.Denomination, s.Color, s.ControlNumber.ToString(),
                s.RedeemedAt, s.RedeemedBy, s.RedeemedMethod))
            .ToListAsync();

        return Ok(stubs);
    }

    // Manually redeem specific stubs by id.
    [HttpPost("redeem-stub-ids")]
    public async Task<ActionResult<StubIdsResult>> RedeemStubIds(int eventId, StubIdsRequest req)
    {
        var ev = await _db.Events.FindAsync(eventId);
        if (ev is null) return NotFound();

        var ids = (req.StubIds ?? new()).Distinct().ToList();
        if (ids.Count == 0) return BadRequest(new { message = "Select at least one stub." });

        var claimer = (req.RedeemedBy ?? "").Trim();
        if (!req.SelfClaimed && claimer.Length == 0)
            return BadRequest(new { message = "Enter who received the stubs, or choose self-claimed." });

        var stubs = await _db.MealStubs
            .Include(s => s.Registration).ThenInclude(r => r!.User)
            .Where(s => ids.Contains(s.Id) && s.RedeemedAt == null && s.Registration!.EventId == eventId)
            .ToListAsync();

        var now = DateTime.Now;
        foreach (var s in stubs)
        {
            s.RedeemedAt = now;
            s.RedeemedBy = req.SelfClaimed ? s.Registration?.DisplayName : claimer;
            s.RedeemedByUserId = req.SelfClaimed ? null : this.UserId();
            s.RedeemedMethod = CheckInMethods.Manual;
        }
        await _db.SaveChangesAsync();
        return Ok(new StubIdsResult(stubs.Count));
    }

    // Clear redemption on specific stubs by id.
    [HttpPost("unredeem-stub-ids")]
    public async Task<ActionResult<StubIdsResult>> UnredeemStubIds(int eventId, StubIdsRequest req)
    {
        var ev = await _db.Events.FindAsync(eventId);
        if (ev is null) return NotFound();

        var ids = (req.StubIds ?? new()).Distinct().ToList();
        if (ids.Count == 0) return BadRequest(new { message = "Select at least one stub." });

        var stubs = await _db.MealStubs
            .Where(s => ids.Contains(s.Id) && s.RedeemedAt != null && s.Registration!.EventId == eventId)
            .ToListAsync();

        foreach (var s in stubs)
        {
            s.RedeemedAt = null;
            s.RedeemedBy = null;
            s.RedeemedByUserId = null;
            s.RedeemedMethod = null;
        }
        await _db.SaveChangesAsync();
        return Ok(new StubIdsResult(stubs.Count));
    }

    // ---- Bulk confirm: approve selected registrations and email each one its entry pass ----
    [HttpPost("confirm")]
    public async Task<ActionResult<ConfirmResult>> Confirm(int eventId, ConfirmRequest req)
    {
        var ev = await _db.Events.FindAsync(eventId);
        if (ev is null) return NotFound();

        var ids = (req.RegistrationIds ?? new()).Distinct().ToList();
        if (ids.Count == 0)
            return BadRequest(new { message = "Select at least one registration to confirm." });

        var regs = await _db.Registrations
            .Include(r => r.User)
            .Include(r => r.Session)
            .Where(r => r.EventId == eventId && ids.Contains(r.Id))
            .ToListAsync();

        int confirmed = 0, emailed = 0, already = 0, noEmail = 0;
        var approved = new List<(int UserId, RegistrationApprovedNotice Notice)>();
        foreach (var reg in regs)
        {
            if (reg.ConfirmedAt is not null) { already++; continue; }

            reg.ConfirmedAt = DateTime.Now;
            confirmed++;

            // Routes to the member's channel (Email or Viber); guests always email.
            var delivery = await _pass.SendConfirmationAsync(ev, reg);
            if (delivery == PassDelivery.NotSent) noEmail++;
            else emailed++;

            // Realtime: notify the registrant (account-based only; guests have no live session).
            if (reg.UserId is int uid)
                approved.Add((uid, new RegistrationApprovedNotice(
                    reg.Id, ev.Id, ev.Title, reg.Session?.Title, DateTime.Now)));
        }

        await _db.SaveChangesAsync();

        foreach (var (uid, notice) in approved)
            await _notify.RegistrationApprovedAsync(uid, notice);

        return Ok(new ConfirmResult(confirmed, emailed, already, noEmail));
    }

    // ---- Bulk cancel: remove selected PENDING registrations (the "reject" side of Confirm) ----
    // Confirmed or checked-in registrations are never touched here — a pass may already be out,
    // so they're skipped and reported back as NotPending.
    [HttpPost("cancel")]
    public async Task<ActionResult<CancelRegistrationsResult>> Cancel(int eventId, CancelRegistrationsRequest req)
    {
        var ev = await _db.Events.FindAsync(eventId);
        if (ev is null) return NotFound();

        var ids = (req.RegistrationIds ?? new()).Distinct().ToList();
        if (ids.Count == 0)
            return BadRequest(new { message = "Select at least one registration to cancel." });

        var regs = await _db.Registrations
            .Where(r => r.EventId == eventId && ids.Contains(r.Id))
            .ToListAsync();

        var pending = regs.Where(r => r.ConfirmedAt is null && r.CheckedInAt is null).ToList();
        if (pending.Count == 0)
            return BadRequest(new { message = "Only pending registrations can be cancelled." });

        _db.Registrations.RemoveRange(pending);
        await _db.SaveChangesAsync();
        return Ok(new CancelRegistrationsResult(pending.Count, regs.Count - pending.Count));
    }

    [HttpGet("export")]
    public async Task<IActionResult> Export(int eventId)
    {
        var ev = await _db.Events.FindAsync(eventId);
        if (ev is null) return NotFound();

        var fields = FormJson.ReadSchema(ev.FormSchema);
        var attendees = await LoadAsync(eventId);

        var sb = new StringBuilder();
        // Base columns + one column per custom form field.
        var header = new List<string> { "Full Name", "Email", "Organization", "Sub-event", "Registered At", "Checked In At", "Check-in Method", "Status", "Kit Claimed At", "Kit Claimed By", "Meal Value", "Meals Redeemed At", "Meals Redeemed By" };
        header.AddRange(fields.Select(f => f.Label));
        sb.AppendLine(string.Join(",", header.Select(Csv)));

        foreach (var a in attendees)
        {
            var row = new List<string>
            {
                a.FullName, a.Email, a.Organization ?? "", a.SessionTitle ?? "",
                a.RegisteredAt.ToString("u"),
                a.CheckedInAt?.ToString("u") ?? "",
                a.CheckInMethod ?? "",
                a.CheckedInAt is not null ? "Checked In" : (a.ConfirmedAt is not null ? "Confirmed" : "Pending"),
                a.KitClaimedAt?.ToString("u") ?? "",
                a.KitClaimedBy ?? "",
                a.MealValue.ToString("0.00"),
                a.MealsRedeemedAt?.ToString("u") ?? "",
                a.MealsRedeemedBy ?? "",
            };
            row.AddRange(fields.Select(f =>
            {
                if (a.Responses is null || !a.Responses.TryGetValue(f.Key, out var v) || string.IsNullOrEmpty(v))
                    return "";
                // Image answers are large data URLs — don't dump them into the CSV.
                return f.Type == "image" ? "[image uploaded]" : v;
            }));
            sb.AppendLine(string.Join(",", row.Select(Csv)));
        }

        var bytes = Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(sb.ToString())).ToArray();
        var fileName = $"attendance-{ev.PublicSlug}.csv";
        return File(bytes, "text/csv", fileName);
    }

    private async Task<List<AttendeeDto>> LoadAsync(int eventId)
    {
        // Project only the columns the grid needs — never the user photo or session poster blobs.
        var rows = await _db.Registrations
            .Where(r => r.EventId == eventId)
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
                mealValue, mealCount, r.MealsRedeemedAt, r.MealsRedeemedBy);
        }).ToList();
    }

    private static string Csv(string value)
    {
        if (value.Contains(',') || value.Contains('"') || value.Contains('\n'))
            return $"\"{value.Replace("\"", "\"\"")}\"";
        return value;
    }
}
