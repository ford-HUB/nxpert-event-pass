using EventRegistration.Api.Data;
using EventRegistration.Api.Models;
using EventRegistration.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace EventRegistration.Api.Controllers;

[ApiController]
[Route("api/events")]
public class EventsController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly ViberService _viber;
    public EventsController(AppDbContext db, ViberService viber)
    {
        _db = db;
        _viber = viber;
    }

    private record Counts(int Total, int CheckedIn);

    // Registration counts computed in SQL (GROUP BY) rather than loading every row. Returns
    // per-event totals and per-session totals. Pass an eventId to scope to a single event.
    private async Task<(Dictionary<int, Counts> Ev, Dictionary<int, Counts> Ses)> LoadCountsAsync(int? eventId = null)
    {
        var q = _db.Registrations.AsQueryable();
        if (eventId is int id) q = q.Where(r => r.EventId == id);

        var rows = await q
            .GroupBy(r => new { r.EventId, r.SessionId })
            .Select(g => new { g.Key.EventId, g.Key.SessionId, Total = g.Count(), In = g.Count(x => x.CheckedInAt != null) })
            .ToListAsync();

        var ev = new Dictionary<int, Counts>();
        var ses = new Dictionary<int, Counts>();
        foreach (var r in rows)
        {
            var cur = ev.TryGetValue(r.EventId, out var c) ? c : new Counts(0, 0);
            ev[r.EventId] = new Counts(cur.Total + r.Total, cur.CheckedIn + r.In);
            if (r.SessionId is int sid) ses[sid] = new Counts(r.Total, r.In);
        }
        return (ev, ses);
    }

    // includeBanner is false for list/dashboard responses so those stay light — the banner
    // (a base64 data URL) is only sent for single-event detail/public/upsert responses.
    private static EventDto ToDto(Event e, bool includeBanner,
        IReadOnlyDictionary<int, Counts> evCounts, IReadOnlyDictionary<int, Counts> sesCounts)
    {
        var ec = evCounts.TryGetValue(e.Id, out var c) ? c : new Counts(0, 0);
        var sessions = e.Sessions
            .OrderBy(s => s.StartsAt)
            .Select(s =>
            {
                var sc = sesCounts.TryGetValue(s.Id, out var v) ? v : new Counts(0, 0);
                return new SessionDto(
                    s.Id, s.Title, s.Description, s.StartsAt, s.EndsAt, s.Venue, s.Capacity,
                    sc.Total, sc.CheckedIn, s.Capacity.HasValue && sc.Total >= s.Capacity.Value,
                    includeBanner ? s.PosterImage : null,
                    e.Meals.Where(m => m.SessionId == s.Id)
                        .OrderBy(m => m.SortOrder).ThenBy(m => m.Id).Select(ToMealDto).ToList());
            })
            .ToList();

        // Event-level (per-day) meal stubs — used when the event has no sub-events.
        var eventMeals = e.Meals.Where(m => m.SessionId == null)
            .OrderBy(m => m.Day).ThenBy(m => m.SortOrder).ThenBy(m => m.Id)
            .Select(ToMealDto).ToList();

        return new EventDto(
            e.Id, e.Title, e.Description, e.StartsAt, e.EndsAt, e.Venue,
            e.IsPublicLinkEnabled, e.PublicSlug, e.Status,
            ec.Total, ec.CheckedIn, e.Capacity,
            e.Capacity.HasValue && ec.Total >= e.Capacity.Value,
            FormJson.ReadSchema(e.FormSchema),
            includeBanner ? e.BannerImage : null,
            e.WelcomeMessage,
            sessions,
            e.RegistrationFees,
            FormJson.ReadSchedule(e.ScheduleJson),
            e.NotifyOnKitClaim,
            eventMeals);
    }

    private static MealDto ToMealDto(Meal m) =>
        new(m.Id, m.Name, m.Denomination, m.Quantity, m.Color, m.Day, m.ValidFrom, m.ValidTo);

    // Lightweight projections for the list (skips the heavy BannerImage / PosterImage blobs).
    private sealed record SesLite(int Id, string Title, string? Description, DateTime StartsAt,
        DateTime EndsAt, string? Venue, int? Capacity);
    private sealed record EvtLite(int Id, string Title, string Description, DateTime StartsAt,
        DateTime EndsAt, string Venue, bool IsPublicLinkEnabled, string PublicSlug, string Status,
        int? Capacity, string? FormSchema, string? WelcomeMessage, string? RegistrationFees,
        string? ScheduleJson, bool NotifyOnKitClaim, List<SesLite> Sessions);

    private static EventDto BuildLite(EvtLite e,
        IReadOnlyDictionary<int, Counts> evCounts, IReadOnlyDictionary<int, Counts> sesCounts)
    {
        var ec = evCounts.TryGetValue(e.Id, out var c) ? c : new Counts(0, 0);
        var sessions = e.Sessions.Select(s =>
        {
            var sc = sesCounts.TryGetValue(s.Id, out var v) ? v : new Counts(0, 0);
            return new SessionDto(s.Id, s.Title, s.Description, s.StartsAt, s.EndsAt, s.Venue, s.Capacity,
                sc.Total, sc.CheckedIn, s.Capacity.HasValue && sc.Total >= s.Capacity.Value, null,
                new List<MealDto>());
        }).ToList();

        return new EventDto(
            e.Id, e.Title, e.Description, e.StartsAt, e.EndsAt, e.Venue,
            e.IsPublicLinkEnabled, e.PublicSlug, e.Status,
            ec.Total, ec.CheckedIn, e.Capacity,
            e.Capacity.HasValue && ec.Total >= e.Capacity.Value,
            FormJson.ReadSchema(e.FormSchema), null, e.WelcomeMessage, sessions,
            e.RegistrationFees, FormJson.ReadSchedule(e.ScheduleJson), e.NotifyOnKitClaim,
            new List<MealDto>());
    }

    // Images (banner / sub-event poster) must be an image data URL within a sane size cap.
    private static string? ValidateImage(string? value, string label)
    {
        if (string.IsNullOrEmpty(value)) return null;
        if (!value.StartsWith("data:image/", StringComparison.OrdinalIgnoreCase))
            return $"The {label} must be an image.";
        if (value.Length > 3_000_000) return $"The {label} image is too large (about 2 MB max).";
        return null;
    }

    private static string? ValidateBanner(string? banner) => ValidateImage(banner, "banner");

    // Validates every sub-event poster in the request; returns the first error, or null.
    private static string? ValidateSessionPosters(List<SessionUpsertRequest>? sessions)
    {
        foreach (var s in sessions ?? new())
        {
            var err = ValidateImage(s.PosterImage, "sub-event poster");
            if (err is not null) return err;
        }
        return null;
    }

    private static Session BuildSession(SessionUpsertRequest s) => new()
    {
        Title = s.Title.Trim(),
        Description = string.IsNullOrWhiteSpace(s.Description) ? null : s.Description,
        StartsAt = s.StartsAt,
        EndsAt = s.EndsAt,
        Venue = string.IsNullOrWhiteSpace(s.Venue) ? null : s.Venue.Trim(),
        Capacity = s.Capacity is > 0 ? s.Capacity : null,
        PosterImage = string.IsNullOrEmpty(s.PosterImage) ? null : s.PosterImage,
    };

    // Builds a Meal. session set → sub-event stub; session null → event-level (per-day) stub.
    // The validity range is clamped into the event's [evFrom, evTo] dates.
    private static Meal BuildMeal(MealUpsertRequest m, int order, Session? session, int day,
        DateTime evFrom, DateTime evTo)
    {
        DateTime Clamp(DateTime d) => d < evFrom ? evFrom : (d > evTo ? evTo : d);
        var from = Clamp((m.ValidFrom?.Date) ?? evFrom);
        var to = Clamp((m.ValidTo?.Date) ?? evTo);
        if (to < from) to = from;
        return new Meal
        {
            Session = session,
            Day = session is null ? (day > 0 ? day : 1) : 0,
            Name = m.Name.Trim(),
            Denomination = m.Denomination,
            Quantity = m.Quantity > 0 ? m.Quantity : 1,
            Color = string.IsNullOrWhiteSpace(m.Color) ? null : m.Color.Trim(),
            ValidFrom = from,
            ValidTo = to,
            SortOrder = order,
        };
    }

    // Rebuilds every meal on the event from the request. Meals are wiped and recreated (safe:
    // per-day redemptions are keyed by registration+day, not by meal id). sessionMap links each
    // sub-event request to its (reconciled) Session so sub-event stubs get the right SessionId.
    private void RebuildMeals(Event e, EventUpsertRequest req,
        IReadOnlyDictionary<SessionUpsertRequest, Session> sessionMap)
    {
        if (e.Meals.Count > 0)
        {
            _db.Meals.RemoveRange(e.Meals);
            e.Meals.Clear();
        }
        var evFrom = e.StartsAt.Date;
        var evTo = e.EndsAt.Date;
        // Sub-event stubs.
        foreach (var s in req.Sessions ?? new())
        {
            if (!sessionMap.TryGetValue(s, out var session)) continue;
            var order = 0;
            foreach (var m in s.Meals ?? new())
                if (!string.IsNullOrWhiteSpace(m.Name))
                    e.Meals.Add(BuildMeal(m, order++, session, 0, evFrom, evTo));
        }
        // Event-level (per-day) stubs.
        var eOrder = 0;
        foreach (var m in req.Meals ?? new())
            if (!string.IsNullOrWhiteSpace(m.Name))
                e.Meals.Add(BuildMeal(m, eOrder++, null, m.Day, evFrom, evTo));
    }

    // Validates meal stubs (sub-event and event-level); returns the first error, or null.
    private static string? ValidateMeals(EventUpsertRequest req)
    {
        var all = (req.Sessions ?? new()).SelectMany(s => s.Meals ?? new()).Concat(req.Meals ?? new());
        foreach (var m in all)
        {
            if (string.IsNullOrWhiteSpace(m.Name)) continue;
            if (m.Denomination < 0) return "A meal stub denomination can't be negative.";
            if (m.Quantity < 1) return "A meal stub quantity must be at least 1.";
        }
        return null;
    }

    // Create path: attach new sub-events to a new event, mapping each request to its Session
    // (so meals can be linked afterwards).
    private static Dictionary<SessionUpsertRequest, Session> AddSessions(Event e, List<SessionUpsertRequest>? sessions)
    {
        var map = new Dictionary<SessionUpsertRequest, Session>();
        foreach (var s in sessions ?? new())
            if (!string.IsNullOrWhiteSpace(s.Title))
            {
                var session = BuildSession(s);
                e.Sessions.Add(session);
                map[s] = session;
            }
        return map;
    }

    // Update path: match existing by Id (update), add new (Id <= 0), remove the rest — refusing to
    // remove a sub-event that already has registrations. Returns the request→Session map via
    // `map`; an error message is returned when a removal is blocked.
    private async Task<string?> ReconcileSessions(
        Event e, List<SessionUpsertRequest>? sessions, Dictionary<SessionUpsertRequest, Session> map)
    {
        var incoming = sessions ?? new();
        var byId = e.Sessions.Where(s => s.Id > 0).ToDictionary(s => s.Id);
        var keep = new HashSet<int>();

        foreach (var s in incoming)
        {
            if (string.IsNullOrWhiteSpace(s.Title)) continue;
            if (s.Id > 0 && byId.TryGetValue(s.Id, out var es))
            {
                es.Title = s.Title.Trim();
                es.Description = string.IsNullOrWhiteSpace(s.Description) ? null : s.Description;
                es.StartsAt = s.StartsAt;
                es.EndsAt = s.EndsAt;
                es.Venue = string.IsNullOrWhiteSpace(s.Venue) ? null : s.Venue.Trim();
                es.Capacity = s.Capacity is > 0 ? s.Capacity : null;
                es.PosterImage = string.IsNullOrEmpty(s.PosterImage) ? null : s.PosterImage;
                map[s] = es;
                keep.Add(s.Id);
            }
            else
            {
                var session = BuildSession(s);
                e.Sessions.Add(session);
                map[s] = session;
            }
        }

        foreach (var s in e.Sessions.Where(s => s.Id > 0 && !keep.Contains(s.Id)).ToList())
        {
            if (await _db.Registrations.AnyAsync(r => r.SessionId == s.Id))
                return $"Can't remove sub-event '{s.Title}' — it already has registrations.";
            // Meal→Session is NoAction, so remove the session's stubs first.
            _db.Meals.RemoveRange(e.Meals.Where(m => m.SessionId == s.Id));
            _db.Sessions.Remove(s);
        }
        return null;
    }

    // ---- Admin / registration confirmers: list all events ----
    [HttpGet, Authorize(Policy = Permissions.ConfirmRegistrationsPolicy)]
    public async Task<ActionResult<IEnumerable<EventDto>>> List()
    {
        // Lightweight projection — never fetches the banner/poster blobs or registration rows.
        var events = await _db.Events
            .OrderByDescending(e => e.StartsAt)
            .Select(e => new EvtLite(
                e.Id, e.Title, e.Description, e.StartsAt, e.EndsAt, e.Venue, e.IsPublicLinkEnabled,
                e.PublicSlug, e.Status, e.Capacity, e.FormSchema, e.WelcomeMessage, e.RegistrationFees,
                e.ScheduleJson, e.NotifyOnKitClaim,
                e.Sessions.OrderBy(s => s.StartsAt)
                    .Select(s => new SesLite(s.Id, s.Title, s.Description, s.StartsAt, s.EndsAt, s.Venue, s.Capacity))
                    .ToList()))
            .ToListAsync();
        var (ev, ses) = await LoadCountsAsync();
        return Ok(events.Select(e => BuildLite(e, ev, ses)));
    }

    // ---- Offline bundle: full snapshot for offline scanning + registration of one event ----
    [HttpGet("{id:int}/offline-bundle"), Authorize(Policy = Permissions.ConfirmRegistrationsPolicy)]
    public async Task<ActionResult<OfflineBundleDto>> OfflineBundle(int id)
    {
        var e = await _db.Events.Include(x => x.Sessions).FirstOrDefaultAsync(x => x.Id == id);
        if (e is null) return NotFound();

        var regs = await _db.Registrations.Include(r => r.User)
            .Where(r => r.EventId == id).ToListAsync();

        var members = regs
            .Where(r => r.User != null)
            .Select(r => r.User!)
            .DistinctBy(u => u.Id)
            .Select(u => new OfflineMemberDto(
                u.Id, u.FullName, u.Level, u.SenateNo, u.Organization, u.PhotoUrl,
                ParseFace(u.FaceDescriptor)))
            .ToList();

        var registrations = regs.Select(r => new OfflineRegDto(
            r.Token.ToString(), r.UserId,
            r.UserId == null ? r.GuestFullName : null,
            r.SessionId, r.ConfirmedAt != null, r.CheckedInAt,
            r.UserId == null ? ParseFace(r.FaceDescriptor) : null)).ToList();

        var sessions = e.Sessions.OrderBy(s => s.StartsAt)
            .Select(s => new OfflineSessionDto(s.Id, s.Title, s.StartsAt, s.EndsAt, s.Venue, s.Capacity))
            .ToList();

        var ev = new OfflineEventDto(e.Id, e.Title, e.PublicSlug, e.WelcomeMessage, e.StartsAt,
            e.EndsAt, e.Venue, e.Status, e.IsPublicLinkEnabled, e.BannerImage);

        return Ok(new OfflineBundleDto(ev, sessions, members, registrations,
            FormJson.ReadSchema(e.FormSchema), DateTime.UtcNow));
    }

    // Guest-registration faces for the event (token-based), for facial-recognition check-in of
    // guests. Account members are matched separately against the user master (→ userId).
    [HttpGet("{id:int}/guest-face-descriptors"), Authorize(Policy = Permissions.ConfirmRegistrationsPolicy)]
    public async Task<ActionResult<IEnumerable<RegistrationFaceDto>>> GuestFaceDescriptors(int id)
    {
        var rows = await _db.Registrations
            .Where(r => r.EventId == id && r.UserId == null && r.FaceDescriptor != null)
            .Select(r => new { r.Token, r.GuestFullName, r.FaceDescriptor })
            .ToListAsync();

        var list = new List<RegistrationFaceDto>();
        foreach (var r in rows)
        {
            var d = ParseFace(r.FaceDescriptor);
            if (d is not null) list.Add(new RegistrationFaceDto(r.Token.ToString(), r.GuestFullName ?? "Guest", d));
        }
        return Ok(list);
    }

    private static float[]? ParseFace(string? json)
    {
        if (string.IsNullOrEmpty(json)) return null;
        try
        {
            var d = System.Text.Json.JsonSerializer.Deserialize<float[]>(json);
            return d is { Length: 128 } ? d : null;
        }
        catch { return null; }
    }

    // ---- Participants: browse all published events (with full info + banner) ----
    [HttpGet("browse"), Authorize]
    public async Task<ActionResult<IEnumerable<EventDto>>> Browse()
    {
        // Only self-serve events: published and with the public registration link enabled.
        var events = await _db.Events.Include(e => e.Sessions).Include(e => e.Meals)
            .Where(e => e.Status == EventStatus.Published && e.IsPublicLinkEnabled)
            .OrderByDescending(e => e.StartsAt)
            .ToListAsync();
        var (ev, ses) = await LoadCountsAsync();
        return Ok(events.Select(e => ToDto(e, includeBanner: true, ev, ses)));
    }

    // ---- Admin / registration confirmers: single event with counts ----
    [HttpGet("{id:int}"), Authorize(Policy = Permissions.ConfirmRegistrationsPolicy)]
    public async Task<ActionResult<EventDto>> Get(int id)
    {
        var e = await _db.Events.Include(x => x.Sessions).Include(x => x.Meals)
            .FirstOrDefaultAsync(x => x.Id == id);
        if (e is null) return NotFound();
        var (ev, ses) = await LoadCountsAsync(id);
        return Ok(ToDto(e, includeBanner: true, ev, ses));
    }

    // ---- Public: event by slug (the landing page for both invite links and public links) ----
    // Always returns the event details when the slug resolves — an invited person reaches this
    // page from their email even for invite-only events. Whether they may actually register is
    // decided at registration time (see RegistrationsController): public link on = anyone,
    // public link off = invited emails only.
    [HttpGet("public/{slug}"), AllowAnonymous]
    public async Task<ActionResult<EventDto>> GetPublic(string slug)
    {
        var e = await _db.Events.Include(x => x.Sessions).Include(x => x.Meals)
            .FirstOrDefaultAsync(x => x.PublicSlug == slug);
        if (e is null) return NotFound();
        var (ev, ses) = await LoadCountsAsync(e.Id);
        return Ok(ToDto(e, includeBanner: true, ev, ses));
    }

    [HttpPost, Authorize(Roles = Roles.Admin + "," + Roles.SuperAdmin)]
    public async Task<ActionResult<EventDto>> Create(EventUpsertRequest req)
    {
        var bannerError = ValidateBanner(req.BannerImage) ?? ValidateSessionPosters(req.Sessions)
            ?? ValidateMeals(req);
        if (bannerError is not null) return BadRequest(new { message = bannerError });

        var e = new Event
        {
            Title = req.Title.Trim(),
            Description = req.Description,
            StartsAt = req.StartsAt,
            EndsAt = req.EndsAt,
            Venue = req.Venue,
            IsPublicLinkEnabled = req.IsPublicLinkEnabled,
            Status = string.IsNullOrWhiteSpace(req.Status) ? EventStatus.Published : req.Status,
            Capacity = req.Capacity is > 0 ? req.Capacity : null,
            FormSchema = FormJson.WriteSchema(req.FormFields),
            BannerImage = string.IsNullOrEmpty(req.BannerImage) ? null : req.BannerImage,
            WelcomeMessage = string.IsNullOrWhiteSpace(req.WelcomeMessage) ? null : req.WelcomeMessage.Trim(),
            RegistrationFees = string.IsNullOrWhiteSpace(req.RegistrationFees) ? null : req.RegistrationFees.Trim(),
            ScheduleJson = FormJson.WriteSchedule(req.Schedule),
            NotifyOnKitClaim = req.NotifyOnKitClaim,
            CreatedByUserId = this.UserId(),
            CompanyId = 1,
            PublicSlug = ControllerExtensions.ToSlug(req.Title, Guid.NewGuid().ToString("N")[..6]),
        };
        var sessionMap = AddSessions(e, req.Sessions);
        RebuildMeals(e, req, sessionMap);
        _db.Events.Add(e);
        await _db.SaveChangesAsync();
        var (ev, ses) = await LoadCountsAsync(e.Id);
        return Ok(ToDto(e, includeBanner: true, ev, ses));
    }

    [HttpPut("{id:int}"), Authorize(Roles = Roles.Admin + "," + Roles.SuperAdmin)]
    public async Task<ActionResult<EventDto>> Update(int id, EventUpsertRequest req)
    {
        var e = await _db.Events.Include(x => x.Sessions).Include(x => x.Meals)
            .FirstOrDefaultAsync(x => x.Id == id);
        if (e is null) return NotFound();

        var bannerError = ValidateBanner(req.BannerImage) ?? ValidateSessionPosters(req.Sessions)
            ?? ValidateMeals(req);
        if (bannerError is not null) return BadRequest(new { message = bannerError });

        e.Title = req.Title.Trim();
        e.Description = req.Description;
        e.StartsAt = req.StartsAt;
        e.EndsAt = req.EndsAt;
        e.Venue = req.Venue;
        e.IsPublicLinkEnabled = req.IsPublicLinkEnabled;
        e.Status = req.Status;
        e.Capacity = req.Capacity is > 0 ? req.Capacity : null;
        e.FormSchema = FormJson.WriteSchema(req.FormFields);
        e.BannerImage = string.IsNullOrEmpty(req.BannerImage) ? null : req.BannerImage;
        e.WelcomeMessage = string.IsNullOrWhiteSpace(req.WelcomeMessage) ? null : req.WelcomeMessage.Trim();
        e.RegistrationFees = string.IsNullOrWhiteSpace(req.RegistrationFees) ? null : req.RegistrationFees.Trim();
        e.ScheduleJson = FormJson.WriteSchedule(req.Schedule);
        e.NotifyOnKitClaim = req.NotifyOnKitClaim;

        var sessionMap = new Dictionary<SessionUpsertRequest, Session>();
        var sessionError = await ReconcileSessions(e, req.Sessions, sessionMap);
        if (sessionError is not null) return BadRequest(new { message = sessionError });
        RebuildMeals(e, req, sessionMap);

        await _db.SaveChangesAsync();
        var (ev, ses) = await LoadCountsAsync(id);
        return Ok(ToDto(e, includeBanner: true, ev, ses));
    }

    // ---- Admin: close / reopen registration ----
    [HttpPost("{id:int}/close"), Authorize(Roles = Roles.Admin + "," + Roles.SuperAdmin)]
    public async Task<ActionResult<EventDto>> Close(int id) => await SetStatus(id, EventStatus.Closed);

    [HttpPost("{id:int}/reopen"), Authorize(Roles = Roles.Admin + "," + Roles.SuperAdmin)]
    public async Task<ActionResult<EventDto>> Reopen(int id) => await SetStatus(id, EventStatus.Published);

    private async Task<ActionResult<EventDto>> SetStatus(int id, string status)
    {
        var e = await _db.Events.Include(x => x.Sessions).Include(x => x.Meals)
            .FirstOrDefaultAsync(x => x.Id == id);
        if (e is null) return NotFound();
        e.Status = status;
        await _db.SaveChangesAsync();
        var (ev, ses) = await LoadCountsAsync(id);
        return Ok(ToDto(e, includeBanner: true, ev, ses));
    }

    [HttpDelete("{id:int}"), Authorize(Roles = Roles.Admin + "," + Roles.SuperAdmin)]
    public async Task<IActionResult> Delete(int id)
    {
        var e = await _db.Events.FindAsync(id);
        if (e is null) return NotFound();
        _db.Events.Remove(e);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    // ---- Manual Viber broadcast (organizer-typed announcement to all registered Viber numbers) ----

    // How many distinct Viber numbers a broadcast would reach — shown before the organizer sends.
    [HttpGet("{id:int}/viber-recipients"), Authorize(Policy = Permissions.ConfirmRegistrationsPolicy)]
    public async Task<IActionResult> ViberRecipients(int id)
    {
        if (!await _db.Events.AnyAsync(e => e.Id == id)) return NotFound();
        var phones = await LoadViberRecipientsAsync(id);
        return Ok(new { count = phones.Count });
    }

    // Sends the organizer's typed message as a plain Viber text to every registered Viber number
    // (registrants whose channel is Viber or Both and who have a phone on file), de-duplicated.
    [HttpPost("{id:int}/viber-broadcast"), Authorize(Policy = Permissions.ConfirmRegistrationsPolicy)]
    public async Task<IActionResult> ViberBroadcast(int id, [FromBody] ViberBroadcastRequest req)
    {
        var ev = await _db.Events.FindAsync(id);
        if (ev is null) return NotFound();

        var message = (req.Message ?? "").Trim();
        if (message.Length == 0) return BadRequest(new { message = "Type a message to send." });
        if (message.Length > 1000) return BadRequest(new { message = "Message is too long (max 1000 characters)." });

        var phones = await LoadViberRecipientsAsync(id);
        if (phones.Count == 0)
            return BadRequest(new { message = "No registrations with a Viber number were found for this event." });

        var subject = $"broadcast_{ev.Title}";
        var sent = 0;
        foreach (var phone in phones)
        {
            await _viber.SendTextAsync(phone, subject, message);
            sent++;
        }

        return Ok(new { sent, message = $"Message sent to {sent} Viber number{(sent == 1 ? "" : "s")}." });
    }

    // Distinct, normalized phone numbers of registrants who opted into Viber (Viber or Both) for
    // this event. Account registrations use the linked User's phone/channel; guests use theirs.
    private async Task<List<string>> LoadViberRecipientsAsync(int eventId)
    {
        var rows = await _db.Registrations
            .Where(r => r.EventId == eventId)
            .Select(r => new
            {
                Phone = r.User != null ? r.User.Phone : r.GuestPhone,
                Channel = r.User != null ? r.User.NotificationChannel : r.GuestNotificationChannel,
            })
            .ToListAsync();

        return rows
            .Where(x => !string.IsNullOrWhiteSpace(x.Phone) && NotificationChannels.UsesViber(x.Channel))
            .Select(x => ViberService.NormalizePhone(x.Phone!))
            .Where(p => p.Length > 0)
            .Distinct()
            .ToList();
    }
}

public record ViberBroadcastRequest(string? Message);
