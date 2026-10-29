using EventRegistration.Api.Data;
using EventRegistration.Api.Models;
using EventRegistration.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace EventRegistration.Api.Controllers;

[ApiController]
[Route("api/registrations")]
[Authorize]
public class RegistrationsController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly PassService _pass;
    private readonly IConfiguration _config;
    private readonly NotificationService _notify;

    public RegistrationsController(AppDbContext db, PassService pass, IConfiguration config, NotificationService notify)
    {
        _db = db;
        _pass = pass;
        _config = config;
        _notify = notify;
    }

    // ---- Participant: my registrations (drives "My Events") ----
    [HttpGet("mine")]
    public async Task<ActionResult<IEnumerable<RegistrationDto>>> Mine()
    {
        var uid = this.UserId();
        var regs = await _db.Registrations
            .Include(r => r.Event)
            .Include(r => r.Session)
            .Where(r => r.UserId == uid)
            .OrderByDescending(r => r.Session != null ? r.Session.StartsAt : r.Event!.StartsAt)
            .ToListAsync();

        return Ok(regs.Select(r => new RegistrationDto(
            r.Id, r.EventId, r.Event!.Title,
            r.Session != null ? r.Session.StartsAt : r.Event.StartsAt,
            r.Session != null ? (r.Session.Venue ?? r.Event.Venue) : r.Event.Venue,
            r.Token, r.RegisteredAt, r.ConfirmedAt, r.CheckedInAt,
            r.SessionId, r.Session != null ? r.Session.Title : null,
            r.Session != null ? r.Session.PosterImage : null,
            FormJson.ReadSchema(r.Event.FormSchema).Count > 0,
            EventFormats.Normalize(r.Event.Format),
            // Join link only once confirmed (same rule as the emailed invite).
            r.ConfirmedAt != null && EventFormats.HasOnline(r.Event.Format)
                ? CalendarInvite.MeetingUrlFor(r.Event, r.Session) : null)));
    }

    // ---- Participant/Admin: view a registration's form (fields + current answers) ----
    [HttpGet("{id:int}/form")]
    public async Task<ActionResult<RegistrationFormDto>> GetForm(int id)
    {
        var reg = await _db.Registrations.Include(r => r.Event).Include(r => r.Session)
            .FirstOrDefaultAsync(r => r.Id == id);
        if (reg is null) return NotFound();
        if (!User.IsInRole(Roles.Admin) && reg.UserId != this.UserId()) return Forbid();

        return Ok(new RegistrationFormDto(
            reg.Event!.Title, reg.Session?.Title,
            FormJson.ReadSchema(reg.Event.FormSchema),
            FormJson.ReadResponses(reg.FormResponses)));
    }

    // ---- Participant/Admin: update a registration's form answers ----
    [HttpPut("{id:int}/responses")]
    public async Task<IActionResult> UpdateResponses(int id, UpdateResponsesRequest req)
    {
        var reg = await _db.Registrations.Include(r => r.Event)
            .FirstOrDefaultAsync(r => r.Id == id);
        if (reg is null) return NotFound();
        if (!User.IsInRole(Roles.Admin) && reg.UserId != this.UserId()) return Forbid();

        var missing = FormJson.FirstMissingRequired(FormJson.ReadSchema(reg.Event!.FormSchema), req.Responses);
        if (missing is not null)
            return BadRequest(new { message = $"'{missing}' is required." });

        reg.FormResponses = FormJson.WriteResponses(req.Responses);
        await _db.SaveChangesAsync();
        await _notify.AttendeesChangedAsync(reg.EventId, new[] { reg.Id });
        return Ok(new { message = "Your responses were updated." });
    }

    // Editing is open until the registrant checks in or the (sub-)event ends.
    private static (bool Editable, string? Reason) EditState(Registration reg)
    {
        if (reg.CheckedInAt is not null)
            return (false, "You've already checked in, so your response can no longer be edited.");
        var endDate = (reg.Session?.EndsAt ?? reg.Event!.EndsAt).Date;
        if (DateTime.Now.Date > endDate)
            return (false, "This event has ended, so your response can no longer be edited.");
        return (true, null);
    }

    // ---- Public (token magic-link) edit: no account needed — the registration token authorizes it ----
    [HttpGet("public/{token:guid}")]
    [AllowAnonymous]
    public async Task<ActionResult<PublicRegistrationFormDto>> PublicForm(Guid token)
    {
        var reg = await _db.Registrations
            .Include(r => r.Event).Include(r => r.Session).Include(r => r.User)
            .FirstOrDefaultAsync(r => r.Token == token);
        if (reg is null) return NotFound();

        var (editable, reason) = EditState(reg);
        return Ok(new PublicRegistrationFormDto(
            reg.Event!.Title, reg.Session?.Title, reg.Event.PublicSlug, reg.DisplayName,
            FormJson.ReadSchema(reg.Event.FormSchema),
            FormJson.ReadResponses(reg.FormResponses), editable, reason));
    }

    [HttpPut("public/{token:guid}/responses")]
    [AllowAnonymous]
    public async Task<IActionResult> PublicUpdateResponses(Guid token, UpdateResponsesRequest req)
    {
        var reg = await _db.Registrations
            .Include(r => r.Event).Include(r => r.Session)
            .FirstOrDefaultAsync(r => r.Token == token);
        if (reg is null) return NotFound();

        var (editable, reason) = EditState(reg);
        if (!editable) return BadRequest(new { message = reason });

        var missing = FormJson.FirstMissingRequired(FormJson.ReadSchema(reg.Event!.FormSchema), req.Responses);
        if (missing is not null)
            return BadRequest(new { message = $"'{missing}' is required." });

        var json = FormJson.WriteResponses(req.Responses);

        // Apply to all of this registrant's registrations for the event (same account, or same
        // guest member by Senate No.), so their answers stay consistent across sub-events — and so
        // editing one member never touches other members who share the same email/phone.
        var siblings = await _db.Registrations
            .Where(r => r.EventId == reg.EventId && (
                (reg.UserId != null && r.UserId == reg.UserId) ||
                (reg.UserId == null && r.UserId == null &&
                    reg.GuestSenateNo != null && r.GuestSenateNo == reg.GuestSenateNo)))
            .ToListAsync();
        if (siblings.Count == 0) siblings.Add(reg);
        foreach (var s in siblings) s.FormResponses = json;

        await _db.SaveChangesAsync();
        await _notify.AttendeesChangedAsync(reg.EventId, siblings.Select(s => s.Id));
        return Ok(new { message = "Your response was updated." });
    }

    // ---- Public recovery: email/Viber the registrant their edit link ("lost my link") ----
    [HttpPost("public/{slug}/edit-link")]
    [AllowAnonymous]
    public async Task<IActionResult> SendEditLink(string slug, EditLinkRequest req)
    {
        // Always return the same generic response so an email/phone can't be probed for existence.
        var generic = Ok(new { message = "If a matching registration was found, we've sent the edit link." });

        var contact = (req.Contact ?? "").Trim();
        var ev = await _db.Events.FirstOrDefaultAsync(e => e.PublicSlug == slug);
        if (ev is null || contact.Length == 0 || FormJson.ReadSchema(ev.FormSchema).Count == 0)
            return generic;

        var baseQuery = _db.Registrations
            .Include(r => r.Event).Include(r => r.Session).Include(r => r.User)
            .Where(r => r.EventId == ev.Id);

        List<Registration> matches;
        if (IsValidEmail(contact))
        {
            var email = contact.ToLowerInvariant();
            matches = await baseQuery.Where(r => r.GuestEmail == email || (r.User != null && r.User.Email == email)).ToListAsync();
        }
        else
        {
            var phone = NormalizePhMobile(contact);
            matches = phone is null ? new List<Registration>()
                : await baseQuery.Where(r => r.GuestPhone == phone || (r.User != null && r.User.Phone == phone)).ToListAsync();
        }

        // One contact can hold several members (distinct Senate No.); send each member one link.
        var perMember = matches
            .GroupBy(r => r.UserId != null ? $"u{r.UserId}" : $"s{r.GuestSenateNo}")
            .Select(g => g.OrderBy(r => r.Id).First())
            .Take(20);
        foreach (var reg in perMember) await _pass.SendEditLinkAsync(ev, reg);
        return generic;
    }

    // ---- Public recovery (Option A): Senate No. + registered name → edit token ----
    // Verifies the member key (Senate No.) AND the name on file, then hands back the edit token so
    // the public page can redirect straight to the edit form — no email/Viber round-trip. Requiring
    // two matching fields keeps a bare Senate No. from being enough to open someone's response.
    [HttpPost("public/{slug}/edit-token")]
    [AllowAnonymous]
    public async Task<IActionResult> EditTokenBySenate(string slug, SenateEditRequest req)
    {
        var senate = (req.SenateNo ?? "").Trim();
        var name = CollapseSpaces(req.Name ?? "");
        if (senate.Length == 0 || name.Length == 0)
            return BadRequest(new { message = "Please enter your ID No. and the name you registered with." });

        var ev = await _db.Events.FirstOrDefaultAsync(e => e.PublicSlug == slug);
        if (ev is null) return NotFound(new { message = "Event not found." });

        // Match the member by Senate No. for this event (guest registrations or account members).
        var matches = await _db.Registrations
            .Include(r => r.Event).Include(r => r.Session).Include(r => r.User)
            .Where(r => r.EventId == ev.Id && (
                (r.UserId == null && r.GuestSenateNo == senate) ||
                (r.User != null && r.User.SenateNo == senate)))
            .ToListAsync();

        // Also require the registered name to match (case-insensitive, whitespace-normalized).
        var reg = matches
            .Where(r => string.Equals(CollapseSpaces(r.DisplayName), name, StringComparison.OrdinalIgnoreCase))
            .OrderBy(r => r.Id)
            .FirstOrDefault();

        // Generic failure so a wrong Senate No. and a wrong name are indistinguishable — no probing.
        if (reg is null)
            return NotFound(new { message = "No matching registration was found. Please check your ID No. and the name you registered with." });

        return Ok(new { token = reg.Token.ToString() });
    }

    // Trim and collapse internal runs of whitespace to a single space (for lenient name matching).
    private static string CollapseSpaces(string s) =>
        System.Text.RegularExpressions.Regex.Replace(s.Trim(), @"\s+", " ");

    // ---- Participant: register for an event (auto-fills from the logged-in user) ----
    // For events with sub-events, req.SessionIds selects which ones — a separate registration
    // (and, once confirmed, a separate pass) is created for each.
    [HttpPost]
    public async Task<ActionResult<RegisterResult>> Register(RegisterForEventRequest req)
    {
        var uid = this.UserId();
        var user = await _db.Users.FindAsync(uid);
        var ev = await _db.Events.Include(e => e.Sessions).FirstOrDefaultAsync(e => e.Id == req.EventId);
        if (user is null || ev is null) return NotFound(new { message = "Event not found." });

        if (_config.GetValue("App:RequireEmailVerification", false) && !user.EmailVerified)
            return StatusCode(403, new { message = "Please verify your email address before registering." });

        var invite = await _db.Invitations
            .FirstOrDefaultAsync(i => i.EventId == ev.Id && i.Email == user.Email);

        // Invite-only event: the public link is off, so only invited emails may register.
        if (!ev.IsPublicLinkEnabled && invite is null)
            return StatusCode(403, new
            {
                message = "This event is invite-only. Your email address isn't on the invitation list — "
                        + "please contact the organizer.",
            });

        var missing = FormJson.FirstMissingRequired(FormJson.ReadSchema(ev.FormSchema), req.Responses);
        if (missing is not null)
            return BadRequest(new { message = $"'{missing}' is required." });

        var targets = ResolveTargets(ev, req.SessionIds, out var targetError);
        if (targetError is not null) return BadRequest(new { message = targetError });

        var responsesJson = FormJson.WriteResponses(req.Responses);
        int created = 0, already = 0;
        var added = new List<Registration>();
        foreach (var sid in targets)
        {
            if (await _db.Registrations.AnyAsync(r => r.EventId == ev.Id && r.SessionId == sid && r.UserId == uid))
            {
                already++;
                continue;
            }
            var blocked = await RegistrationBlockedReason(ev, sid);
            if (blocked is not null) return StatusCode(403, new { message = blocked });

            var reg = new Registration
            {
                EventId = ev.Id,
                SessionId = sid,
                UserId = uid,
                Token = Guid.NewGuid(),
                RegisteredAt = DateTime.Now,
                FormResponses = responsesJson,
            };
            _db.Registrations.Add(reg);
            added.Add(reg);
            created++;
        }

        if (invite is not null) invite.Status = InvitationStatus.Registered;
        await _db.SaveChangesAsync();

        // Realtime: let admins/confirmers know a registration came in.
        if (created > 0)
            await _notify.NewRegistrationAsync(new NewRegistrationNotice(
                ev.Id, ev.Title, user.FullName, SingleSessionTitle(ev, targets), created, false, DateTime.Now));
        // Realtime: push the new rows so an open Attendance tab appends them in place.
        await _notify.AttendeesChangedAsync(ev.Id, added.Select(r => r.Id));
        if (created > 0) await _notify.FaceGalleryChangedAsync(ev.Id);

        // No pass is issued here — registrations stay pending until an admin confirms them.
        var editToken = await EditTokenForAsync(ev, uid, null);
        return Ok(new RegisterResult(created, already, ev.Title, user.FullName, editToken));
    }

    // The registration token the caller can use to build a public "edit your response" link —
    // only when the event has editable form fields; null otherwise. Guests are keyed by Senate No.
    private async Task<string?> EditTokenForAsync(Event ev, int? userId, string? guestSenate)
    {
        if (FormJson.ReadSchema(ev.FormSchema).Count == 0) return null;
        var q = _db.Registrations.Where(r => r.EventId == ev.Id);
        q = userId is int uid
            ? q.Where(r => r.UserId == uid)
            : q.Where(r => r.UserId == null && guestSenate != null && r.GuestSenateNo == guestSenate);
        var token = await q.OrderBy(r => r.Id).Select(r => (Guid?)r.Token).FirstOrDefaultAsync();
        return token?.ToString();
    }

    // ---- Public/guest: register for an event without an account ----
    // Name required; email and/or phone optional. If an email is given we also email the
    // QR pass; either way the caller receives the token so it can render/download the pass.
    [HttpPost("guest/{slug}")]
    [AllowAnonymous]
    public async Task<ActionResult<RegisterResult>> GuestRegister(string slug, GuestRegisterRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.FullName))
            return BadRequest(new { message = "Please enter your name." });
        // Senate No. is required and is the member key — one email may register several members,
        // each identified by a distinct Senate No.
        if (string.IsNullOrWhiteSpace(req.SenateNo))
            return BadRequest(new { message = "Please enter your ID No." });

        var ev = await _db.Events.Include(e => e.Sessions).FirstOrDefaultAsync(e => e.PublicSlug == slug);
        if (ev is null) return NotFound(new { message = "Event not found." });

        var email = string.IsNullOrWhiteSpace(req.Email) ? null : req.Email.Trim().ToLowerInvariant();
        var phoneRaw = string.IsNullOrWhiteSpace(req.Phone) ? null : req.Phone.Trim();

        // Pass-delivery channel: default Email. The channel only decides where the pass is sent —
        // both an email address AND a mobile number are always required and must be well-formed.
        var channel = string.IsNullOrWhiteSpace(req.NotificationChannel)
            ? NotificationChannels.Email : req.NotificationChannel.Trim();
        if (!NotificationChannels.IsValid(channel))
            return BadRequest(new { message = "Please choose Email, Viber, or Both for your pass." });

        if (email is null)
            return BadRequest(new { message = "An email address is required." });
        if (!IsValidEmail(email))
            return BadRequest(new { message = "Please enter a valid email address." });

        if (phoneRaw is null)
            return BadRequest(new { message = "A mobile number is required." });
        var phone = NormalizePhMobile(phoneRaw);
        if (phone is null)
            return BadRequest(new { message = "Please enter a valid Philippine mobile number (+63 9XX XXX XXXX)." });

        // Invite-only events: a guest must have been invited (matched by email).
        if (!ev.IsPublicLinkEnabled)
        {
            var invited = email is not null &&
                await _db.Invitations.AnyAsync(i => i.EventId == ev.Id && i.Email == email);
            if (!invited)
                return StatusCode(403, new
                {
                    message = "This event is invite-only. Please register with the email address your "
                            + "invitation was sent to.",
                });
        }

        var missing = FormJson.FirstMissingRequired(FormJson.ReadSchema(ev.FormSchema), req.Responses);
        if (missing is not null)
            return BadRequest(new { message = $"'{missing}' is required." });

        var targets = ResolveTargets(ev, req.SessionIds, out var targetError);
        if (targetError is not null) return BadRequest(new { message = targetError });

        var senate = string.IsNullOrWhiteSpace(req.SenateNo) ? null : req.SenateNo.Trim();

        // Optional facial registration (the guest opted in + consented on the form). Validate the
        // descriptor and block a face that's already enrolled (an account member, or another member
        // for this event) so one person can't register as two different members.
        var face = string.IsNullOrWhiteSpace(req.Face) ? null : req.Face;
        if (face is not null)
        {
            if (FaceMatcher.Parse(face) is null)
                return BadRequest(new { message = "The captured face data is invalid. Please re-capture." });
            var dupOwner = await FaceMatcher.FindDuplicateForGuestAsync(_db, face, ev.Id, senate);
            if (dupOwner is not null)
                return Conflict(new { message = $"This face is already registered ({dupOwner}). If that's you, use your existing registration or sign in." });
        }

        // Optional display picture (a data URL) shown to staff on the check-in screen.
        var displayPicture = string.IsNullOrWhiteSpace(req.DisplayPicture) ? null : req.DisplayPicture;

        var responsesJson = FormJson.WriteResponses(req.Responses);
        int created = 0, already = 0;
        var added = new List<Registration>();
        foreach (var sid in targets)
        {
            // The member (Senate No.) is the key: a repeat submission for the same member + sub-event
            // is a duplicate, but the same email/phone with a different Senate No. is a new member.
            var existing = await _db.Registrations.FirstOrDefaultAsync(
                r => r.EventId == ev.Id && r.SessionId == sid && r.GuestSenateNo == senate);
            if (existing is not null) { already++; continue; }

            var blocked = await RegistrationBlockedReason(ev, sid);
            if (blocked is not null) return StatusCode(403, new { message = blocked });

            var reg = new Registration
            {
                EventId = ev.Id,
                SessionId = sid,
                UserId = null,
                GuestFullName = req.FullName.Trim(),
                GuestSenateNo = senate,
                GuestEmail = email,
                GuestPhone = phone,
                GuestNotificationChannel = channel,
                RegisteredAt = DateTime.Now,
                Token = Guid.NewGuid(),
                FormResponses = responsesJson,
                FaceDescriptor = face,
                GuestPhoto = displayPicture,
            };
            _db.Registrations.Add(reg);
            added.Add(reg);
            created++;
        }

        if (email is not null)
        {
            var invite = await _db.Invitations.FirstOrDefaultAsync(i => i.EventId == ev.Id && i.Email == email);
            if (invite is not null) invite.Status = InvitationStatus.Registered;
        }
        await _db.SaveChangesAsync();

        // Realtime: let admins/confirmers know a registration came in.
        if (created > 0)
            await _notify.NewRegistrationAsync(new NewRegistrationNotice(
                ev.Id, ev.Title, req.FullName.Trim(), SingleSessionTitle(ev, targets), created, true, DateTime.Now));
        await _notify.AttendeesChangedAsync(ev.Id, added.Select(r => r.Id));
        if (created > 0) await _notify.FaceGalleryChangedAsync(ev.Id);

        // Registrations are pending confirmation — the pass is emailed only after an admin confirms.
        var editToken = await EditTokenForAsync(ev, null, senate);
        return Ok(new RegisterResult(created, already, ev.Title, req.FullName.Trim(), editToken));
    }

    // When a registration targets exactly one sub-event, its title (for a friendlier notice);
    // null for whole-event registrations or multi-session batches.
    private static string? SingleSessionTitle(Event ev, List<int?> targets) =>
        targets.Count == 1 ? ev.Sessions.FirstOrDefault(s => s.Id == targets[0])?.Title : null;

    // ---- Participant/Admin: resend the pass email ----
    [HttpPost("{id:int}/resend-pass")]
    public async Task<IActionResult> ResendPass(int id)
    {
        var reg = await _db.Registrations.Include(r => r.Event).Include(r => r.User).Include(r => r.Session)
            .FirstOrDefaultAsync(r => r.Id == id);
        if (reg is null) return NotFound();
        if (!User.IsInRole(Roles.Admin) && reg.UserId != this.UserId()) return Forbid();

        if (reg.ConfirmedAt is null)
            return BadRequest(new { message = "This registration hasn't been confirmed yet, so no pass has been issued." });

        var delivery = await _pass.SendConfirmationAsync(reg.Event!, reg);
        if (delivery == PassDelivery.NotSent)
            return BadRequest(new { message = "This registration has no email or phone on file to send the pass to." });

        await _db.SaveChangesAsync();
        return Ok(new
        {
            message = delivery switch
            {
                PassDelivery.Both => "Pass sent via email and Viber.",
                PassDelivery.Viber => "Pass sent via Viber.",
                _ => "Pass email sent.",
            },
        });
    }

    // ---- Participant/Admin: cancel a registration ----
    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Cancel(int id)
    {
        var reg = await _db.Registrations
            .Include(r => r.Event).Include(r => r.Session).Include(r => r.User)
            .FirstOrDefaultAsync(r => r.Id == id);
        if (reg is null) return NotFound();
        var own = reg.UserId == this.UserId();
        if (!own && !User.IsInRole(Roles.Admin)) return Forbid();
        // Admins cancelling someone else's registration: pending ones only (see the bulk
        // AttendanceController.Cancel) — a confirmed registration may already have a pass out.
        if (!own && (reg.ConfirmedAt is not null || reg.CheckedInAt is not null))
            return BadRequest(new { message = "Only pending registrations can be cancelled." });

        _db.Registrations.Remove(reg);
        await _db.SaveChangesAsync();
        await _notify.AttendeesChangedAsync(reg.EventId, Array.Empty<int>(), new[] { reg.Id });
        await _notify.FaceGalleryChangedAsync(reg.EventId);

        // A confirmed online / hybrid registration had a calendar invite — withdraw it.
        if (reg.Event is not null && EventFormats.HasOnline(reg.Event.Format))
        {
            try { await _pass.SendMeetingCancelAsync(reg.Event, reg, MeetingCancelReason.RegistrationCancelled); }
            catch { /* the cancellation itself succeeded; the calendar update is best-effort */ }
        }
        return NoContent();
    }

    // ---- Sync: upload guest registrations that were captured offline (pending confirmation) ----
    [HttpPost("offline-sync")]
    [AllowAnonymous]
    public async Task<ActionResult<OfflineRegSyncResult>> OfflineSync(OfflineRegSyncRequest req)
    {
        var ev = await _db.Events.Include(e => e.Sessions)
            .FirstOrDefaultAsync(e => e.PublicSlug == req.Slug);
        if (ev is null) return NotFound(new { message = "Event not found." });

        int created = 0, skipped = 0;
        var added = new List<Registration>();
        foreach (var item in req.Items ?? new())
        {
            if (string.IsNullOrWhiteSpace(item.FullName)) { skipped++; continue; }

            var email = string.IsNullOrWhiteSpace(item.Email) ? null : item.Email.Trim().ToLowerInvariant();
            // Normalize to canonical PH mobile when possible; keep the raw value otherwise.
            var phone = string.IsNullOrWhiteSpace(item.Phone)
                ? null : (NormalizePhMobile(item.Phone) ?? item.Phone.Trim());
            var channel = NotificationChannels.IsValid(item.NotificationChannel)
                ? item.NotificationChannel!.Trim() : NotificationChannels.Email;

            var targets = ResolveTargets(ev, item.SessionIds, out var targetError);
            if (targetError is not null) { skipped++; continue; }

            var responsesJson = FormJson.WriteResponses(item.Responses);
            var senate = string.IsNullOrWhiteSpace(item.SenateNo) ? null : item.SenateNo.Trim();
            // Keep a valid face only; a duplicate synced late just gets dropped (not blocked).
            var face = FaceMatcher.Parse(item.Face) is null ? null : item.Face;
            foreach (var sid in targets)
            {
                // De-dup on the member (Senate No.) — one email may cover several members.
                var existing = senate is null ? null : await _db.Registrations.FirstOrDefaultAsync(
                    r => r.EventId == ev.Id && r.SessionId == sid && r.GuestSenateNo == senate);
                if (existing is not null) { skipped++; continue; }

                var reg = new Registration
                {
                    EventId = ev.Id,
                    SessionId = sid,
                    UserId = null,
                    GuestFullName = item.FullName.Trim(),
                    GuestSenateNo = senate,
                    GuestEmail = email,
                    GuestPhone = phone,
                    GuestNotificationChannel = channel,
                    RegisteredAt = item.RegisteredAt ?? DateTime.Now,
                    Token = Guid.NewGuid(),
                    FormResponses = responsesJson,
                    FaceDescriptor = face,
                    GuestPhoto = string.IsNullOrWhiteSpace(item.DisplayPicture) ? null : item.DisplayPicture,
                };
                _db.Registrations.Add(reg);
                added.Add(reg);
                created++;
            }
        }
        await _db.SaveChangesAsync();
        await _notify.AttendeesChangedAsync(ev.Id, added.Select(r => r.Id));
        if (created > 0) await _notify.FaceGalleryChangedAsync(ev.Id);
        return Ok(new OfflineRegSyncResult(created, skipped));
    }

    private static bool IsValidEmail(string email) =>
        System.Text.RegularExpressions.Regex.IsMatch(email, @"^[^\s@]+@[^\s@]+\.[^\s@]+$");

    // Validates + normalizes a Philippine mobile number to canonical "+639XXXXXXXXX".
    // Accepts 09XXXXXXXXX, +63/63 9XXXXXXXXX, or 9XXXXXXXXX (spaces/dashes ignored).
    // Returns null when it isn't a valid PH mobile number (10 digits after +63, starting with 9).
    private static string? NormalizePhMobile(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        var digits = new string(raw.Where(char.IsDigit).ToArray());
        if (digits.StartsWith("63")) digits = digits[2..];
        else if (digits.StartsWith("0")) digits = digits[1..];
        if (digits.Length != 10 || digits[0] != '9') return null;
        return "+63" + digits;
    }

    // Resolves which registrations to create: one per selected sub-event, or a single
    // event-level registration (null) when the event has no sub-events. Sets `error` when
    // the selection is invalid.
    private static List<int?> ResolveTargets(Event ev, List<int>? sessionIds, out string? error)
    {
        error = null;
        if (ev.Sessions.Count > 0)
        {
            var ids = (sessionIds ?? new()).Distinct().ToList();
            if (ids.Count == 0)
            {
                error = "Please select at least one sub-event to register for.";
                return new();
            }
            var valid = ev.Sessions.Select(s => s.Id).ToHashSet();
            if (ids.Any(i => !valid.Contains(i)))
            {
                error = "One of the selected sub-events is not part of this event.";
                return new();
            }
            return ids.Select(i => (int?)i).ToList();
        }
        // No sub-events → a single event-level registration.
        return new List<int?> { null };
    }

    // Returns a reason a NEW registration should be refused (closed / full), or null if allowed.
    private async Task<string?> RegistrationBlockedReason(Event ev, int? sessionId)
    {
        if (ev.Status == EventStatus.Closed)
            return "Registration for this event is closed.";

        if (sessionId is int sid)
        {
            var s = ev.Sessions.FirstOrDefault(x => x.Id == sid);
            if (s is null) return "That sub-event no longer exists.";
            if (s.Capacity.HasValue)
            {
                var count = await _db.Registrations.CountAsync(r => r.SessionId == sid);
                if (count >= s.Capacity.Value) return $"'{s.Title}' is already full.";
            }
        }
        else if (ev.Capacity.HasValue)
        {
            var count = await _db.Registrations.CountAsync(r => r.EventId == ev.Id && r.SessionId == null);
            if (count >= ev.Capacity.Value) return "This event is already full.";
        }
        return null;
    }
}
