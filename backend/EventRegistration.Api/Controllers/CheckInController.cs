using EventRegistration.Api.Data;
using EventRegistration.Api.Models;
using EventRegistration.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace EventRegistration.Api.Controllers;

[ApiController]
[Route("api/checkin")]
[Authorize(Roles = Roles.Admin + "," + Roles.SuperAdmin)]
public class CheckInController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly NotificationService _notify;
    public CheckInController(AppDbContext db, NotificationService notify)
    {
        _db = db;
        _notify = notify;
    }

    /// <summary>
    /// Validates a scanned QR payload and marks attendance. Returns one of:
    /// valid | already | invalid | notstarted | ended, plus the participant name and an
    /// optional message for the result banner.
    ///
    /// Check-in is only permitted while the event is running — i.e. the scan date falls
    /// within the event's [start date, end date] window (inclusive). Scans before the event
    /// starts or after it ends are refused so attendance can't be recorded off-day.
    /// </summary>
    [HttpPost]
    public async Task<ActionResult<CheckInResult>> Post(CheckInRequest req)
    {
        var raw = (req.Token ?? "").Trim();
        if (raw.StartsWith("REG:", StringComparison.OrdinalIgnoreCase))
            raw = raw[4..];

        if (!Guid.TryParse(raw, out var token))
            return Ok(new CheckInResult("invalid", null, null, null));

        var reg = await _db.Registrations
            .Include(r => r.User).Include(r => r.Event).Include(r => r.Session)
            .FirstOrDefaultAsync(r => r.Token == token);

        if (reg is null)
            return Ok(new CheckInResult("invalid", null, null, null));

        // A pass for another event (or another sub-event than the one selected) is refused.
        if (req.EventId is int eventId && reg.EventId != eventId)
            return Ok(new CheckInResult("invalid", reg.DisplayName, reg.Event!.Title, null,
                "This pass is for a different event."));
        if (req.SessionId is int sessionId && reg.SessionId != sessionId)
            return Ok(new CheckInResult("invalid", reg.DisplayName, reg.Event!.Title, null,
                $"This pass is for {reg.Session?.Title ?? "the main event"}, not the selected sub-event.",
                SessionTitle: reg.Session?.Title));

        return Ok(await EvaluateAsync(reg, CheckInMethods.Scan, req.Verify));
    }

    /// <summary>
    /// Switch the event's verify-only mode. While it's on, every scan of this event (QR, barcode,
    /// face, Face TV) is answered with "verified" and no check-in is recorded — it's enforced here
    /// on the server, so it applies to every scanner device, not just the one that switched it.
    /// </summary>
    [HttpPut("events/{eventId:int}/verify-only")]
    public async Task<ActionResult<VerifyOnlyRequest>> SetVerifyOnly(int eventId, VerifyOnlyRequest req)
    {
        var ev = await _db.Events.FindAsync(eventId);
        if (ev is null) return NotFound();
        if (ev.VerifyOnly != req.Enabled)
        {
            ev.VerifyOnly = req.Enabled;
            await _db.SaveChangesAsync();
            await _notify.VerifyOnlyChangedAsync(eventId, req.Enabled);
        }
        return Ok(new VerifyOnlyRequest(ev.VerifyOnly));
    }

    /// <summary>
    /// Facial-recognition check-in: the client identified a registered user; check them in for
    /// the given event, choosing the sub-event whose date window includes today.
    /// </summary>
    [HttpPost("user")]
    public async Task<ActionResult<CheckInResult>> PostUser(UserCheckInRequest req)
    {
        var regs = await _db.Registrations
            .Include(r => r.User).Include(r => r.Event).Include(r => r.Session)
            .Where(r => r.EventId == req.EventId && r.UserId == req.UserId)
            .Where(r => req.SessionId == null || r.SessionId == req.SessionId)
            .ToListAsync();

        if (regs.Count == 0)
        {
            var user = await _db.Users.FindAsync(req.UserId);
            return Ok(new CheckInResult("invalid", user?.FullName, null, null,
                req.SessionId is null
                    ? "This person isn't registered for this event."
                    : "This person isn't registered for the selected sub-event."));
        }

        var today = DateTime.Now.Date;
        bool InWindow(Registration r)
        {
            var ws = (r.Session?.StartsAt ?? r.Event!.StartsAt).Date;
            var we = (r.Session?.EndsAt ?? r.Event!.EndsAt).Date;
            return today >= ws && today <= we;
        }

        // Prefer a not-yet-checked-in registration whose window includes today; else one that's
        // in-window (to report "already"); else the nearest (to report not-started / ended).
        var pick = regs.FirstOrDefault(r => r.CheckedInAt is null && InWindow(r))
                   ?? regs.FirstOrDefault(InWindow)
                   ?? regs.OrderBy(r => r.Session != null ? r.Session.StartsAt : r.Event!.StartsAt).First();

        return Ok(await EvaluateAsync(pick, CheckInMethods.Face, req.Verify));
    }

    /// <summary>
    /// Meal-stub redemption at a counter: scan the entry-pass QR and issue the member's stubs.
    /// For a sub-event registration the whole sub-event set is issued at once; for an event-level
    /// (no-sub-event) registration the given Day's stubs are issued. Rejects an unconfirmed
    /// registration or a second redemption.
    /// </summary>
    [HttpPost("redeem-meals")]
    public async Task<ActionResult<MealScanResult>> RedeemMeals(MealScanRequest req)
    {
        var raw = (req.Token ?? "").Trim();
        if (raw.StartsWith("REG:", StringComparison.OrdinalIgnoreCase))
            raw = raw[4..];

        if (!Guid.TryParse(raw, out var token))
            return Ok(new MealScanResult("invalid", null, null, 0, 0));

        var reg = await _db.Registrations
            .Include(r => r.User).Include(r => r.Session).Include(r => r.MealRedemptions)
            .FirstOrDefaultAsync(r => r.Token == token);
        if (reg is null)
            return Ok(new MealScanResult("invalid", null, null, 0, 0));

        var sessionTitle = reg.Session?.Title;

        // ---- Sub-event registration: redeem the whole sub-event set (flag on the registration) ----
        if (reg.SessionId is int sid)
        {
            var meals = await _db.Meals.Where(m => m.SessionId == sid).ToListAsync();
            if (meals.Count == 0)
                return Ok(new MealScanResult("nomeals", reg.DisplayName, sessionTitle, 0, 0,
                    "No meal stubs for this sub-event."));

            var v = meals.Sum(m => m.Denomination * m.Quantity);
            var c = meals.Sum(m => m.Quantity);

            if (reg.ConfirmedAt is null)
                return Ok(new MealScanResult("unconfirmed", reg.DisplayName, sessionTitle, v, c,
                    "This registration hasn't been confirmed yet."));
            if (reg.MealsRedeemedAt is not null)
                return Ok(new MealScanResult("already", reg.DisplayName, sessionTitle, v, c,
                    reg.MealsRedeemedBy is null ? "Meal stubs already redeemed."
                        : $"Meal stubs already redeemed by {reg.MealsRedeemedBy}."));

            reg.MealsRedeemedAt = DateTime.Now;
            reg.MealsRedeemedBy = reg.DisplayName;
            reg.MealsRedeemedMethod = CheckInMethods.Scan;
            await _db.SaveChangesAsync();
            return Ok(new MealScanResult("valid", reg.DisplayName, sessionTitle, v, c));
        }

        // ---- Event-level registration: redeem the selected Day's stubs (MealRedemption row) ----
        if (req.Day is not int day || day < 1)
            return Ok(new MealScanResult("nomeals", reg.DisplayName, null, 0, 0,
                "Select which day to redeem first."));

        var dayLabel = $"Day {day}";
        var dayMeals = await _db.Meals
            .Where(m => m.EventId == reg.EventId && m.SessionId == null && m.Day == day)
            .ToListAsync();
        if (dayMeals.Count == 0)
            return Ok(new MealScanResult("nomeals", reg.DisplayName, dayLabel, 0, 0,
                $"No meal stubs for {dayLabel}."));

        var value = dayMeals.Sum(m => m.Denomination * m.Quantity);
        var count = dayMeals.Sum(m => m.Quantity);

        if (reg.ConfirmedAt is null)
            return Ok(new MealScanResult("unconfirmed", reg.DisplayName, dayLabel, value, count,
                "This registration hasn't been confirmed yet."));
        if (reg.MealRedemptions.Any(mr => mr.Day == day))
            return Ok(new MealScanResult("already", reg.DisplayName, dayLabel, value, count,
                $"{dayLabel} stubs already redeemed."));

        reg.MealRedemptions.Add(new MealRedemption
        {
            Day = day,
            RedeemedAt = DateTime.Now,
            RedeemedBy = reg.DisplayName,
            Method = CheckInMethods.Scan,
        });
        await _db.SaveChangesAsync();
        return Ok(new MealScanResult("valid", reg.DisplayName, dayLabel, value, count));
    }

    // ---- Sync: upload check-ins that were recorded offline (always identified by token) ----
    [HttpPost("sync")]
    public async Task<ActionResult<SyncCheckInResult>> Sync(SyncCheckInRequest req)
    {
        int applied = 0, already = 0, notFound = 0;
        var changed = new List<Registration>();
        foreach (var item in req.Items ?? new())
        {
            if (!Guid.TryParse(item.Token, out var token))
            {
                notFound++;
                continue;
            }
            var reg = await _db.Registrations.FirstOrDefaultAsync(r => r.Token == token);
            if (reg is null || reg.ConfirmedAt is null)
            {
                notFound++;
                continue;
            }
            if (reg.CheckedInAt is not null)
            {
                already++;
                continue;
            }
            reg.CheckedInAt = item.CheckedInAt; // preserve the actual offline time
            reg.CheckInMethod ??= CheckInMethods.Scan; // offline check-ins are QR scans
            applied++;
            changed.Add(reg);
        }
        await _db.SaveChangesAsync();
        // A sync batch can span events — push one update per event.
        foreach (var g in changed.GroupBy(r => r.EventId))
            await _notify.AttendeesChangedAsync(g.Key, g.Select(r => r.Id));
        return Ok(new SyncCheckInResult(applied, already, notFound));
    }

    // Shared: validate a registration and record attendance (window / confirmed / already).
    // With verify (or the event in verify-only mode), a confirmed pass is reported as "verified"
    // and nothing is recorded.
    private async Task<CheckInResult> EvaluateAsync(Registration reg, string method, bool verify = false)
    {
        var ev = reg.Event!;
        verify |= ev.VerifyOnly;
        var sessionTitle = reg.Session?.Title;
        var windowStart = reg.Session?.StartsAt ?? ev.StartsAt;
        var windowEnd = reg.Session?.EndsAt ?? ev.EndsAt;

        // Already recorded — report it regardless of the date (informative for the scanner).
        if (reg.CheckedInAt is not null)
            return new CheckInResult("already", reg.DisplayName, ev.Title, reg.CheckedInAt,
                Level: reg.User?.Level, SenateNo: reg.DisplaySenateNo, Organization: reg.DisplayOrganization,
                WelcomeMessage: ev.WelcomeMessage, PhotoUrl: reg.DisplayPhoto, SessionTitle: sessionTitle);

        // Registration must be confirmed by an admin before it can check in.
        if (reg.ConfirmedAt is null)
            return new CheckInResult("unconfirmed", reg.DisplayName, ev.Title, null,
                "This registration hasn't been confirmed yet.", SessionTitle: sessionTitle);

        if (verify)
            return new CheckInResult("verified", reg.DisplayName, ev.Title, null,
                Level: reg.User?.Level, SenateNo: reg.DisplaySenateNo, Organization: reg.DisplayOrganization,
                WelcomeMessage: ev.WelcomeMessage, PhotoUrl: reg.DisplayPhoto, SessionTitle: sessionTitle);

        // Window check (session window when present). Times are wall-clock → compare local "today".
        var today = DateTime.Now.Date;
        if (today < windowStart.Date)
            return new CheckInResult("notstarted", reg.DisplayName, ev.Title, null,
                $"This {(sessionTitle is null ? "event" : "sub-event")} starts {windowStart:MMM d, yyyy}. Check-in isn't open yet.",
                SessionTitle: sessionTitle);
        if (today > windowEnd.Date)
            return new CheckInResult("ended", reg.DisplayName, ev.Title, null,
                $"This {(sessionTitle is null ? "event" : "sub-event")} ended {windowEnd:MMM d, yyyy}. Check-in is closed.",
                SessionTitle: sessionTitle);

        reg.CheckedInAt = DateTime.Now;
        reg.CheckInMethod = method;
        await _db.SaveChangesAsync();
        await _notify.AttendeesChangedAsync(reg.EventId, new[] { reg.Id });

        return new CheckInResult("valid", reg.DisplayName, ev.Title, reg.CheckedInAt,
            Level: reg.User?.Level, SenateNo: reg.DisplaySenateNo, Organization: reg.DisplayOrganization,
            WelcomeMessage: ev.WelcomeMessage, PhotoUrl: reg.DisplayPhoto, SessionTitle: sessionTitle);
    }
}
