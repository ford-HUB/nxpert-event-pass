using EventRegistration.Api.Data;
using EventRegistration.Api.Models;
using EventRegistration.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace EventRegistration.Api.Controllers;

[ApiController]
[Route("api/auth")]
public class AuthController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly JwtService _jwt;
    private readonly EmailService _email;
    private readonly IConfiguration _config;

    public AuthController(AppDbContext db, JwtService jwt, EmailService email, IConfiguration config)
    {
        _db = db;
        _jwt = jwt;
        _email = email;
        _config = config;
    }

    private bool RequireVerification => _config.GetValue("App:RequireEmailVerification", false);

    [HttpPost("login")]
    public async Task<ActionResult<AuthResponse>> Login(LoginRequest req)
    {
        // The identifier may be an email address or a username.
        var id = req.Email.Trim().ToLowerInvariant();
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Email == id || u.Username == id);
        if (user is null || !PasswordHasher.Verify(req.Password, user.PasswordHash))
            return Unauthorized(new { message = "Invalid username/email or password." });

        return Ok(AuthFor(user));
    }

    [HttpPost("register")]
    public async Task<ActionResult<AuthResponse>> Register(RegisterRequest req)
    {
        var email = req.Email.Trim().ToLowerInvariant();
        if (string.IsNullOrWhiteSpace(req.FirstName) || string.IsNullOrWhiteSpace(req.LastName))
            return BadRequest(new { message = "First and last name are required." });
        if (string.IsNullOrWhiteSpace(req.SenateNo))
            return BadRequest(new { message = "Senate No. is required." });
        if (string.IsNullOrWhiteSpace(req.Level))
            return BadRequest(new { message = "Level is required." });
        if (string.IsNullOrWhiteSpace(email) || string.IsNullOrWhiteSpace(req.Password))
            return BadRequest(new { message = "Email and password are required." });

        if (await _db.Users.AnyAsync(u => u.Email == email))
            return Conflict(new { message = "An account with that email already exists." });

        var photoError = ValidatePhoto(req.Photo);
        if (photoError is not null) return BadRequest(new { message = photoError });

        // Compose the display name: "First M. Last" (middle initial optional).
        var firstName = req.FirstName.Trim();
        var lastName = req.LastName.Trim();
        var middleInitial = (req.MiddleInitial ?? "").Trim().TrimEnd('.');
        var nameParts = new List<string> { firstName };
        if (middleInitial.Length > 0) nameParts.Add(middleInitial + ".");
        nameParts.Add(lastName);

        var user = new User
        {
            FirstName = firstName,
            MiddleInitial = middleInitial.Length > 0 ? middleInitial : null,
            LastName = lastName,
            SenateNo = req.SenateNo.Trim(),
            Level = req.Level!.Trim(),
            PhotoUrl = string.IsNullOrEmpty(req.Photo) ? null : req.Photo,
            FullName = string.Join(" ", nameParts),
            Email = email,
            Username = await UsernameHelper.UniqueAsync(_db, UsernameHelper.Base(firstName, lastName, null)),
            PasswordHash = PasswordHasher.Hash(req.Password),
            Role = Roles.Participant,
            Phone = req.Phone,
            Organization = req.Organization,
            CompanyId = 1,
            EmailVerified = !RequireVerification,
            EmailVerificationToken = RequireVerification ? Guid.NewGuid() : null,
        };
        _db.Users.Add(user);
        await _db.SaveChangesAsync();

        if (RequireVerification)
            await SendVerificationEmailAsync(user);

        return Ok(AuthFor(user));
    }

    // ---- Self-service profile: any signed-in user views/edits their own account ----
    [HttpGet("me")]
    [Authorize]
    public async Task<ActionResult<ProfileDto>> Me()
    {
        var u = await _db.Users.FindAsync(this.UserId());
        if (u is null) return NotFound();
        return Ok(new ProfileDto(
            u.Id, u.FirstName, u.MiddleInitial, u.LastName, u.SenateNo, u.Level,
            u.Email, u.Organization, u.Phone, u.NotificationChannel, u.PhotoUrl, u.Role,
            !string.IsNullOrEmpty(u.FaceDescriptor)));
    }

    [HttpPut("me")]
    [Authorize]
    public async Task<ActionResult<AuthResponse>> UpdateMe(ProfileUpdateRequest req)
    {
        var u = await _db.Users.FindAsync(this.UserId());
        if (u is null) return NotFound();

        if (string.IsNullOrWhiteSpace(req.FirstName) || string.IsNullOrWhiteSpace(req.LastName))
            return BadRequest(new { message = "First and last name are required." });

        var photoError = ValidatePhoto(req.Photo) ?? ValidateFace(req.Face);
        if (photoError is not null) return BadRequest(new { message = photoError });

        if (!string.IsNullOrEmpty(req.Face))
        {
            var owner = await FaceMatcher.FindDuplicateOwnerAsync(_db, req.Face, u.Id);
            if (owner is not null)
                return Conflict(new { message = $"This face is already registered to another member ({owner})." });
        }

        // Notification channel: Viber delivery uses the phone number, so it's required for Viber.
        var phone = string.IsNullOrWhiteSpace(req.Phone) ? null : req.Phone.Trim();
        var channel = string.IsNullOrWhiteSpace(req.NotificationChannel)
            ? NotificationChannels.Email : req.NotificationChannel.Trim();
        if (!NotificationChannels.IsValid(channel))
            return BadRequest(new { message = "Notification channel must be Email or Viber." });
        if (channel == NotificationChannels.Viber && phone is null)
            return BadRequest(new { message = "A phone number is required when notifications are sent via Viber." });

        // Optional password change — requires the correct current password.
        if (!string.IsNullOrWhiteSpace(req.NewPassword))
        {
            if (req.NewPassword.Length < 8)
                return BadRequest(new { message = "New password must be at least 8 characters." });
            if (string.IsNullOrEmpty(req.CurrentPassword) ||
                !PasswordHasher.Verify(req.CurrentPassword, u.PasswordHash))
                return BadRequest(new { message = "Your current password is incorrect." });
            u.PasswordHash = PasswordHasher.Hash(req.NewPassword);
        }

        var first = req.FirstName.Trim();
        var last = req.LastName.Trim();
        var mi = (req.MiddleInitial ?? "").Trim().TrimEnd('.');
        var parts = new List<string> { first };
        if (mi.Length > 0) parts.Add(mi + ".");
        parts.Add(last);

        u.FirstName = first;
        u.MiddleInitial = mi.Length > 0 ? mi : null;
        u.LastName = last;
        u.FullName = string.Join(" ", parts);
        u.SenateNo = string.IsNullOrWhiteSpace(req.SenateNo) ? null : req.SenateNo.Trim();
        u.Level = string.IsNullOrWhiteSpace(req.Level) ? null : req.Level.Trim();
        u.Organization = string.IsNullOrWhiteSpace(req.Organization) ? null : req.Organization.Trim();
        u.Phone = phone;
        u.NotificationChannel = channel;
        if (req.Photo is not null) // null = leave unchanged; "" = clear
            u.PhotoUrl = req.Photo.Length == 0 ? null : req.Photo;
        if (req.Face is not null) // null = leave unchanged; "" = clear the face registration
            u.FaceDescriptor = req.Face.Length == 0 ? null : req.Face;

        await _db.SaveChangesAsync();
        // Return a fresh auth response so the client updates its stored session (name/photo).
        return Ok(AuthFor(u));
    }

    // ---- Invite magic-link: resolve who an invitation is for and auto-login if they have an account ----
    [HttpPost("invite/{token}")]
    public async Task<ActionResult<InviteResolveResult>> ResolveInvite(string token)
    {
        if (!Guid.TryParse(token, out var t))
            return NotFound(new { message = "Invitation not found." });

        var invite = await _db.Invitations.Include(i => i.Event).FirstOrDefaultAsync(i => i.Token == t);
        if (invite is null) return NotFound(new { message = "Invitation not found." });

        var slug = invite.Event?.PublicSlug ?? "";
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Email == invite.Email);

        // Registered invitee → hand back a token so the client can auto-login and auto-fill.
        return user is not null
            ? Ok(new InviteResolveResult(true, invite.Email, slug, AuthFor(user)))
            : Ok(new InviteResolveResult(false, invite.Email, slug, null));
    }

    // ---- Email verification (only active when App:RequireEmailVerification = true) ----
    [HttpPost("verify")]
    public async Task<ActionResult<VerifyEmailResult>> Verify([FromBody] TokenBody body)
    {
        if (!Guid.TryParse(body.Token, out var token))
            return Ok(new VerifyEmailResult(false, "Invalid verification link."));

        var user = await _db.Users.FirstOrDefaultAsync(u => u.EmailVerificationToken == token);
        if (user is null)
        {
            // Token already consumed (or bogus). Treat an already-verified state as success.
            return Ok(new VerifyEmailResult(true, "Your email is already verified. You can sign in."));
        }

        user.EmailVerified = true;
        user.EmailVerificationToken = null;
        await _db.SaveChangesAsync();
        return Ok(new VerifyEmailResult(true, "Email verified — you're all set!"));
    }

    [HttpPost("resend-verification")]
    [Authorize]
    public async Task<IActionResult> ResendVerification()
    {
        var user = await _db.Users.FindAsync(this.UserId());
        if (user is null) return NotFound();
        if (user.EmailVerified) return Ok(new { message = "Your email is already verified." });

        user.EmailVerificationToken ??= Guid.NewGuid();
        await _db.SaveChangesAsync();
        await SendVerificationEmailAsync(user);
        return Ok(new { message = "Verification email sent." });
    }

    private async Task SendVerificationEmailAsync(User user)
    {
        var frontendBase = _config["App:FrontendBaseUrl"]?.TrimEnd('/') ?? "http://localhost:4200";
        var link = $"{frontendBase}/verify/{user.EmailVerificationToken}";
        await _email.SendAsync(user.Email, "Confirm your email", EmailTemplates.Verification(user, link));
    }

    private AuthResponse AuthFor(User user) => new(
        _jwt.CreateToken(user), user.Id, user.FullName, user.Email, user.Role,
        user.EmailVerified, RequireVerification, user.SenateNo,
        user.FirstName, user.MiddleInitial, user.LastName, user.Level, user.PhotoUrl,
        user.CanConfirmRegistrations, user.Username);

    // Profile photo must be an image data URL within a sane size cap (matches the client downscale).
    private static string? ValidatePhoto(string? photo)
    {
        if (string.IsNullOrEmpty(photo)) return null;
        if (!photo.StartsWith("data:image/", StringComparison.OrdinalIgnoreCase))
            return "The photo must be an image.";
        if (photo.Length > 2_000_000) return "The photo is too large (about 1.5 MB max).";
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

    public record TokenBody(string Token);
}
