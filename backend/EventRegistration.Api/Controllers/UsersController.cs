using EventRegistration.Api.Data;
using EventRegistration.Api.Models;
using EventRegistration.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace EventRegistration.Api.Controllers;

// User master: admins create/manage accounts and grant the "confirm registrations" permission.
[ApiController]
[Route("api/users")]
[Authorize(Roles = Roles.Admin + "," + Roles.SuperAdmin)]
public class UsersController : ControllerBase
{
    private readonly AppDbContext _db;
    public UsersController(AppDbContext db) => _db = db;

    private static readonly string[] AssignableRoles = { Roles.Admin, Roles.Participant, Roles.Merchant };

    // includePhoto is false for the list so the payload stays light — the photo (a base64
    // data URL) is only sent for single-user fetch/create/update responses.
    private static UserDto ToDto(User u, bool includePhoto = false) => new(
        u.Id, u.FullName, u.FirstName, u.MiddleInitial, u.LastName, u.SenateNo, u.Level,
        u.Email, u.Username, u.Role, u.Organization, u.Phone, u.NotificationChannel,
        u.CanConfirmRegistrations, u.EmailVerified, u.CreatedAt,
        includePhoto ? u.PhotoUrl : null, !string.IsNullOrEmpty(u.FaceDescriptor));

    // Resolve the username: use the admin-supplied one (normalized, must be unique) or auto-generate
    // "<first-initial><lastname>" made unique. Returns an error message when a supplied name is taken.
    private async Task<(string? Username, string? Error)> ResolveUsername(
        string? requested, string firstName, string lastName, int? excludeUserId)
    {
        if (!string.IsNullOrWhiteSpace(requested))
        {
            var norm = UsernameHelper.Normalize(requested);
            if (norm.Length < 2)
                return (null, "Username must be at least 2 letters/digits.");
            if (await _db.Users.AnyAsync(u => u.Username == norm && (excludeUserId == null || u.Id != excludeUserId)))
                return (null, "That username is already taken.");
            return (norm, null);
        }
        var baseName = UsernameHelper.Base(firstName, lastName, null);
        return (await UsernameHelper.UniqueAsync(_db, baseName, excludeUserId), null);
    }

    // Resolve + validate the notification channel. Viber delivery uses the phone number, so a
    // phone is required when Viber is chosen. Returns an error message, or null when valid.
    private static string? ResolveChannel(string? requested, string? phone, out string channel)
    {
        channel = string.IsNullOrWhiteSpace(requested) ? NotificationChannels.Email : requested.Trim();
        if (!NotificationChannels.IsValid(channel))
            return "Notification channel must be Email, Viber, or Both.";
        if (NotificationChannels.UsesViber(channel) && string.IsNullOrWhiteSpace(phone))
            return "A phone number is required when notifications are sent via Viber.";
        return null;
    }

    // A face descriptor is a JSON array of exactly 128 finite floats.
    private static string? ValidateFace(string? face)
    {
        if (string.IsNullOrEmpty(face)) return null; // null/"" handled by caller (unchanged/clear)
        try
        {
            var arr = System.Text.Json.JsonSerializer.Deserialize<float[]>(face);
            if (arr is null || arr.Length != 128 || arr.Any(f => float.IsNaN(f) || float.IsInfinity(f)))
                return "The captured face data is invalid. Please re-capture.";
        }
        catch
        {
            return "The captured face data is invalid. Please re-capture.";
        }
        return null;
    }

    // Compose "First M. Last" from the captured parts (middle initial optional).
    private static string ComposeFullName(string first, string? middle, string last)
    {
        var mi = (middle ?? "").Trim().TrimEnd('.');
        var parts = new List<string> { first.Trim() };
        if (mi.Length > 0) parts.Add(mi + ".");
        parts.Add(last.Trim());
        return string.Join(" ", parts);
    }

    private static string? ValidatePhoto(string? photo)
    {
        if (string.IsNullOrEmpty(photo)) return null;
        if (!photo.StartsWith("data:image/", StringComparison.OrdinalIgnoreCase))
            return "The photo must be an image.";
        if (photo.Length > 2_000_000) return "The photo is too large (about 1.5 MB max).";
        return null;
    }

    [HttpGet]
    public async Task<ActionResult<IEnumerable<UserDto>>> List()
    {
        var users = await _db.Users.OrderBy(u => u.FullName).ToListAsync();
        return Ok(users.Select(u => ToDto(u)));
    }

    [HttpGet("{id:int}")]
    public async Task<ActionResult<UserDto>> Get(int id)
    {
        var u = await _db.Users.FindAsync(id);
        return u is null ? NotFound() : Ok(ToDto(u, includePhoto: true));
    }

    [HttpPost]
    public async Task<ActionResult<UserDto>> Create(AdminUserUpsertRequest req)
    {
        var email = req.Email.Trim().ToLowerInvariant();
        if (string.IsNullOrWhiteSpace(req.FirstName) || string.IsNullOrWhiteSpace(req.LastName))
            return BadRequest(new { message = "First and last name are required." });
        if (string.IsNullOrWhiteSpace(email))
            return BadRequest(new { message = "Email is required." });
        if (string.IsNullOrWhiteSpace(req.Password) || req.Password.Length < 8)
            return BadRequest(new { message = "A password of at least 8 characters is required." });
        if (!AssignableRoles.Contains(req.Role))
            return BadRequest(new { message = "Invalid role." });
        if (await _db.Users.AnyAsync(u => u.Email == email))
            return Conflict(new { message = "An account with that email already exists." });

        var photoError = ValidatePhoto(req.Photo) ?? ValidateFace(req.Face);
        if (photoError is not null) return BadRequest(new { message = photoError });

        var phone = string.IsNullOrWhiteSpace(req.Phone) ? null : req.Phone.Trim();
        var channelError = ResolveChannel(req.NotificationChannel, phone, out var channel);
        if (channelError is not null) return BadRequest(new { message = channelError });

        if (!string.IsNullOrEmpty(req.Face))
        {
            var owner = await FaceMatcher.FindDuplicateOwnerAsync(_db, req.Face, 0);
            if (owner is not null)
                return Conflict(new { message = $"This face is already registered to {owner}." });
        }

        var (username, usernameError) = await ResolveUsername(req.Username, req.FirstName, req.LastName, null);
        if (usernameError is not null) return Conflict(new { message = usernameError });

        var user = new User
        {
            FirstName = req.FirstName.Trim(),
            MiddleInitial = string.IsNullOrWhiteSpace(req.MiddleInitial) ? null : req.MiddleInitial.Trim().TrimEnd('.'),
            LastName = req.LastName.Trim(),
            FullName = ComposeFullName(req.FirstName, req.MiddleInitial, req.LastName),
            SenateNo = string.IsNullOrWhiteSpace(req.SenateNo) ? null : req.SenateNo.Trim(),
            Level = string.IsNullOrWhiteSpace(req.Level) ? null : req.Level.Trim(),
            Email = email,
            Username = username!,
            PasswordHash = PasswordHasher.Hash(req.Password),
            Role = req.Role,
            Organization = string.IsNullOrWhiteSpace(req.Organization) ? null : req.Organization.Trim(),
            Phone = phone,
            NotificationChannel = channel,
            PhotoUrl = string.IsNullOrEmpty(req.Photo) ? null : req.Photo,
            FaceDescriptor = string.IsNullOrEmpty(req.Face) ? null : req.Face,
            CanConfirmRegistrations = req.CanConfirmRegistrations,
            CompanyId = 1,
            EmailVerified = true, // admin-created accounts are pre-verified
        };
        _db.Users.Add(user);
        await _db.SaveChangesAsync();
        return Ok(ToDto(user, includePhoto: true));
    }

    // Default password for bulk-imported accounts. Users are expected to change it on first login.
    private const string DefaultImportPassword = "12345";

    private static bool IsValidEmail(string email) =>
        System.Text.RegularExpressions.Regex.IsMatch(email, @"^[^\s@]+@[^\s@]+\.[^\s@]+$");

    // Blank role → Participant; otherwise match an assignable role case-insensitively (null = invalid).
    private static string? ResolveImportRole(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return Roles.Participant;
        var r = raw.Trim();
        return AssignableRoles.FirstOrDefault(role => string.Equals(role, r, StringComparison.OrdinalIgnoreCase));
    }

    // ---- Bulk import: create many accounts from an uploaded spreadsheet, each with the default
    // password. Existing emails are skipped; malformed rows are reported without aborting the run. ----
    [HttpPost("import")]
    public async Task<ActionResult<UserImportResult>> Import(UserImportRequest req)
    {
        var rows = req.Rows ?? new List<UserImportRow>();
        if (rows.Count == 0) return BadRequest(new { message = "No rows to import." });
        if (rows.Count > 5000) return BadRequest(new { message = "Too many rows — import at most 5000 at a time." });

        // Hash the default password once and reuse it: every imported account shares the same
        // (weak, meant-to-be-changed) password, so per-row salting adds cost without real benefit.
        var passwordHash = PasswordHasher.Hash(DefaultImportPassword);

        int created = 0, skipped = 0, failed = 0;
        var errors = new List<UserImportError>();

        for (var i = 0; i < rows.Count; i++)
        {
            var row = rows[i];
            var line = i + 1; // 1-based data row (the client maps this back to the file)
            var first = (row.FirstName ?? "").Trim();
            var last = (row.LastName ?? "").Trim();
            var email = (row.Email ?? "").Trim().ToLowerInvariant();
            var label = string.Join(" ", new[] { first, last }.Where(s => s.Length > 0));
            if (label.Length == 0) label = email.Length > 0 ? email : $"Row {line}";

            if (first.Length == 0 || last.Length == 0)
            {
                errors.Add(new UserImportError(line, label, "First and last name are required."));
                failed++;
                continue;
            }
            if (email.Length == 0 || !IsValidEmail(email))
            {
                errors.Add(new UserImportError(line, label, "A valid email is required."));
                failed++;
                continue;
            }
            if (await _db.Users.AnyAsync(u => u.Email == email))
            {
                skipped++; // already exists — leave it untouched
                continue;
            }

            var role = ResolveImportRole(row.Role);
            if (role is null)
            {
                errors.Add(new UserImportError(line, label, $"Invalid role '{row.Role}'."));
                failed++;
                continue;
            }

            var phone = string.IsNullOrWhiteSpace(row.Phone) ? null : row.Phone.Trim();
            var channelError = ResolveChannel(row.NotificationChannel, phone, out var channel);
            if (channelError is not null)
            {
                errors.Add(new UserImportError(line, label, channelError));
                failed++;
                continue;
            }

            var (username, usernameError) = await ResolveUsername(row.Username, first, last, null);
            if (usernameError is not null)
            {
                errors.Add(new UserImportError(line, label, usernameError));
                failed++;
                continue;
            }

            var user = new User
            {
                FirstName = first,
                MiddleInitial = string.IsNullOrWhiteSpace(row.MiddleInitial) ? null : row.MiddleInitial.Trim().TrimEnd('.'),
                LastName = last,
                FullName = ComposeFullName(first, row.MiddleInitial, last),
                SenateNo = string.IsNullOrWhiteSpace(row.SenateNo) ? null : row.SenateNo.Trim(),
                Level = string.IsNullOrWhiteSpace(row.Level) ? null : row.Level.Trim(),
                Email = email,
                Username = username!,
                PasswordHash = passwordHash,
                Role = role,
                Organization = string.IsNullOrWhiteSpace(row.Organization) ? null : row.Organization.Trim(),
                Phone = phone,
                NotificationChannel = channel,
                CanConfirmRegistrations = false,
                CompanyId = 1,
                EmailVerified = true, // admin-created accounts are pre-verified
            };

            _db.Users.Add(user);
            try
            {
                // Save per row so email/username uniqueness checks see prior inserts in this batch.
                await _db.SaveChangesAsync();
                created++;
            }
            catch
            {
                _db.Entry(user).State = EntityState.Detached;
                errors.Add(new UserImportError(line, label, "Could not save this row (possible duplicate)."));
                failed++;
            }
        }

        return Ok(new UserImportResult(created, skipped, failed, errors));
    }

    [HttpPut("{id:int}")]
    public async Task<ActionResult<UserDto>> Update(int id, AdminUserUpsertRequest req)
    {
        var user = await _db.Users.FindAsync(id);
        if (user is null) return NotFound();

        if (string.IsNullOrWhiteSpace(req.FirstName) || string.IsNullOrWhiteSpace(req.LastName))
            return BadRequest(new { message = "First and last name are required." });
        if (!AssignableRoles.Contains(req.Role) && req.Role != user.Role)
            return BadRequest(new { message = "Invalid role." });

        var email = req.Email.Trim().ToLowerInvariant();
        if (email != user.Email && await _db.Users.AnyAsync(u => u.Email == email && u.Id != id))
            return Conflict(new { message = "An account with that email already exists." });

        var photoError = ValidatePhoto(req.Photo) ?? ValidateFace(req.Face);
        if (photoError is not null) return BadRequest(new { message = photoError });

        if (!string.IsNullOrEmpty(req.Face))
        {
            var owner = await FaceMatcher.FindDuplicateOwnerAsync(_db, req.Face, id);
            if (owner is not null)
                return Conflict(new { message = $"This face is already registered to {owner}." });
        }

        var phone = string.IsNullOrWhiteSpace(req.Phone) ? null : req.Phone.Trim();
        var channelError = ResolveChannel(req.NotificationChannel, phone, out var channel);
        if (channelError is not null) return BadRequest(new { message = channelError });

        // Username: a supplied value replaces it (validated unique); blank keeps the current one.
        if (!string.IsNullOrWhiteSpace(req.Username))
        {
            var (uname, uerr) = await ResolveUsername(req.Username, req.FirstName, req.LastName, id);
            if (uerr is not null) return Conflict(new { message = uerr });
            user.Username = uname!;
        }

        if (!string.IsNullOrWhiteSpace(req.Password))
        {
            if (req.Password.Length < 8)
                return BadRequest(new { message = "A password of at least 8 characters is required." });
            user.PasswordHash = PasswordHasher.Hash(req.Password);
        }

        user.FirstName = req.FirstName.Trim();
        user.MiddleInitial = string.IsNullOrWhiteSpace(req.MiddleInitial) ? null : req.MiddleInitial.Trim().TrimEnd('.');
        user.LastName = req.LastName.Trim();
        user.FullName = ComposeFullName(req.FirstName, req.MiddleInitial, req.LastName);
        user.SenateNo = string.IsNullOrWhiteSpace(req.SenateNo) ? null : req.SenateNo.Trim();
        user.Level = string.IsNullOrWhiteSpace(req.Level) ? null : req.Level.Trim();
        user.Email = email;
        user.Role = req.Role;
        user.Organization = string.IsNullOrWhiteSpace(req.Organization) ? null : req.Organization.Trim();
        user.Phone = phone;
        user.NotificationChannel = channel;
        if (req.Photo is not null) // null = leave unchanged; "" = clear
            user.PhotoUrl = req.Photo.Length == 0 ? null : req.Photo;
        if (req.Face is not null) // null = leave unchanged; "" = clear the face registration
            user.FaceDescriptor = req.Face.Length == 0 ? null : req.Face;
        user.CanConfirmRegistrations = req.CanConfirmRegistrations;
        await _db.SaveChangesAsync();
        return Ok(ToDto(user, includePhoto: true));
    }

    // ---- Registered face descriptors (for facial-recognition check-in) ----
    [HttpGet("face-descriptors")]
    public async Task<ActionResult<IEnumerable<FaceDescriptorDto>>> FaceDescriptors()
    {
        var rows = await _db.Users
            .Where(u => u.FaceDescriptor != null)
            .Select(u => new { u.Id, u.FullName, u.FaceDescriptor })
            .ToListAsync();

        var list = new List<FaceDescriptorDto>();
        foreach (var r in rows)
        {
            try
            {
                var d = System.Text.Json.JsonSerializer.Deserialize<float[]>(r.FaceDescriptor!);
                if (d is { Length: 128 }) list.Add(new FaceDescriptorDto(r.Id, r.FullName, d));
            }
            catch { /* skip malformed */ }
        }
        return Ok(list);
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        if (id == this.UserId())
            return BadRequest(new { message = "You can't delete your own account." });

        var user = await _db.Users.FindAsync(id);
        if (user is null) return NotFound();

        // Registrations reference the user with a restrict delete — block rather than cascade.
        if (await _db.Registrations.AnyAsync(r => r.UserId == id))
            return BadRequest(new { message = "This user has event registrations and can't be deleted." });

        _db.Users.Remove(user);
        await _db.SaveChangesAsync();
        return NoContent();
    }
}
