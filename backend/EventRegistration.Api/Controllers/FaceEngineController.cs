using System.Security.Cryptography;
using System.Text;
using EventRegistration.Api.Data;
using EventRegistration.Api.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace EventRegistration.Api.Controllers;

/// <summary>
/// Service-to-service endpoints for the face recognition engine (facerog-engine). The engine has no
/// user session, so it authenticates with a shared key in the X-Face-Engine-Key header
/// (FaceEngine:ApiKey). The endpoints are disabled (404) while no key is configured.
/// </summary>
[ApiController]
[Route("api/face-engine")]
[AllowAnonymous]
public class FaceEngineController : ControllerBase
{
    public const string KeyHeader = "X-Face-Engine-Key";

    private readonly AppDbContext _db;
    private readonly IConfiguration _config;

    public FaceEngineController(AppDbContext db, IConfiguration config)
    {
        _db = db;
        _config = config;
    }

    /// <summary>
    /// The event's registrants who have a photo, for the engine to build its recognition gallery.
    /// PersonId is "u{userId}" for account registrations (checked in via /api/checkin/user) and
    /// "g{token}" for guest registrations (checked in via /api/checkin by token). A member registered
    /// for several sub-events appears once.
    /// </summary>
    [HttpGet("events/{id:int}/gallery")]
    public async Task<ActionResult<IEnumerable<FaceEngineGalleryItem>>> Gallery(int id)
    {
        var configuredKey = _config["FaceEngine:ApiKey"];
        if (string.IsNullOrEmpty(configuredKey)) return NotFound();
        if (!KeyMatches(Request.Headers[KeyHeader].ToString(), configuredKey)) return Unauthorized();

        if (!await _db.Events.AnyAsync(e => e.Id == id)) return NotFound();

        var regs = await _db.Registrations
            .Where(r => r.EventId == id && (r.User != null ? r.User.PhotoUrl != null : r.GuestPhoto != null))
            .Select(r => new
            {
                r.UserId,
                r.Token,
                Name = r.User != null ? r.User.FullName : r.GuestFullName,
                Photo = r.User != null ? r.User.PhotoUrl : r.GuestPhoto,
            })
            .ToListAsync();

        var items = regs
            .Select(r => new FaceEngineGalleryItem(
                r.UserId is int uid ? $"u{uid}" : $"g{r.Token}",
                r.Name ?? "Guest",
                r.Photo!))
            .DistinctBy(i => i.PersonId)
            .ToList();
        return Ok(items);
    }

    private static bool KeyMatches(string provided, string expected) =>
        CryptographicOperations.FixedTimeEquals(
            SHA256.HashData(Encoding.UTF8.GetBytes(provided)),
            SHA256.HashData(Encoding.UTF8.GetBytes(expected)));
}
