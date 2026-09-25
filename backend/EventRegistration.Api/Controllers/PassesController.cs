using System.Net;
using EventRegistration.Api.Data;
using EventRegistration.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace EventRegistration.Api.Controllers;

// Public, read-only pass artifacts. The QR endpoint exists so a Viber BSP (Infobip) can fetch
// the entry-pass image by its public HTTPS URL when delivering a picture message. The token is
// an unguessable GUID and the QR only encodes what the pass holder already has, so anonymous
// access here is equivalent to emailing the pass.
[ApiController]
[Route("api/passes")]
[AllowAnonymous]
public class PassesController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly QrService _qr;
    private readonly MealStubImageService _stubImages;

    public PassesController(AppDbContext db, QrService qr, MealStubImageService stubImages)
    {
        _db = db;
        _qr = qr;
        _stubImages = stubImages;
    }

    // GET /api/passes/{token} — a mobile-friendly HTML page showing the entry pass (event details
    // + QR image). Used as the clickable link in SMS confirmations; opens in the recipient's browser.
    [HttpGet("{token:guid}")]
    public async Task<IActionResult> View(Guid token)
    {
        var reg = await _db.Registrations
            .Include(r => r.Event).Include(r => r.Session).Include(r => r.User)
            .FirstOrDefaultAsync(r => r.Token == token);
        if (reg is null || reg.Event is null) return NotFound();

        var ev = reg.Event;
        var title = reg.Session is not null ? $"{ev.Title} — {reg.Session.Title}" : ev.Title;
        var startsAt = reg.Session?.StartsAt ?? ev.StartsAt;
        var venue = reg.Session?.Venue ?? ev.Venue;
        var name = reg.DisplayName;

        // Embed the QR as a data URI so the page is fully self-contained (no second request).
        var qrDataUri = "data:image/png;base64," + Convert.ToBase64String(_qr.GeneratePng($"REG:{token}"));

        static string E(string? s) => WebUtility.HtmlEncode(s ?? "");
        var html =
            "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">" +
            "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">" +
            $"<title>{E(title)} — Entry pass</title>" +
            "<style>" +
            ":root{color-scheme:light}" +
            "*{box-sizing:border-box}" +
            "body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;" +
            "background:#f4f5f7;color:#1f2937;display:flex;justify-content:center;padding:20px}" +
            ".card{background:#fff;border-radius:16px;overflow:hidden;max-width:420px;width:100%;" +
            "box-shadow:0 8px 30px rgba(0,0,0,.12)}" +
            ".head{background:linear-gradient(120deg,#0d9488,#22c55e);color:#fff;padding:22px 20px;text-align:center}" +
            ".head h1{margin:0;font-size:19px;font-weight:600}" +
            ".head p{margin:6px 0 0;font-size:13px;opacity:.95}" +
            ".body{padding:22px 20px;text-align:center}" +
            ".qr{width:260px;max-width:80%;height:auto;border:1px solid #e5e7eb;border-radius:12px;padding:10px;background:#fff}" +
            ".name{font-size:17px;font-weight:600;margin:16px 0 2px}" +
            ".meta{font-size:13px;color:#6b7280;margin:2px 0}" +
            ".hint{margin:18px 0 0;font-size:12px;color:#9ca3af}" +
            "</style></head><body><div class=\"card\">" +
            $"<div class=\"head\"><h1>{E(title)}</h1><p>Entry pass</p></div>" +
            "<div class=\"body\">" +
            $"<img class=\"qr\" src=\"{qrDataUri}\" alt=\"Entry pass QR code\" />" +
            $"<p class=\"name\">{E(name)}</p>" +
            $"<p class=\"meta\">{E(startsAt.ToString("dddd, MMM d yyyy, h:mm tt"))}</p>" +
            $"<p class=\"meta\">{E(venue)}</p>" +
            "<p class=\"hint\">Present this QR code at the entrance.</p>" +
            "</div></div></body></html>";

        return Content(html, "text/html");
    }

    // GET /api/passes/{token}/qr.png — the registration's QR entry pass as a PNG image.
    [HttpGet("{token:guid}/qr.png")]
    public async Task<IActionResult> Qr(Guid token)
    {
        var exists = await _db.Registrations.AnyAsync(r => r.Token == token);
        if (!exists) return NotFound();

        var png = _qr.GeneratePng($"REG:{token}");
        Response.Headers.CacheControl = "public, max-age=86400";
        return File(png, "image/png");
    }

    // GET /api/passes/meal-stub/{control}/qr.png — a meal stub's QR (its control number) as a PNG.
    [HttpGet("meal-stub/{control:guid}/qr.png")]
    public async Task<IActionResult> MealStubQr(Guid control)
    {
        var exists = await _db.MealStubs.AnyAsync(s => s.ControlNumber == control);
        if (!exists) return NotFound();

        var png = _qr.GeneratePng($"MEAL:{control}");
        Response.Headers.CacheControl = "public, max-age=86400";
        return File(png, "image/png");
    }

    // GET /api/passes/meal-stub/{control}/stub.png — the full composed meal-stub ticket image.
    [HttpGet("meal-stub/{control:guid}/stub.png")]
    public async Task<IActionResult> MealStubImage(Guid control)
    {
        var stub = await _db.MealStubs
            .Include(s => s.Registration).ThenInclude(r => r!.Event)
            .FirstOrDefaultAsync(s => s.ControlNumber == control);
        var ev = stub?.Registration?.Event;
        if (stub is null || ev is null) return NotFound();

        var validity = MealStubImageService.ValidityLabel(stub.ValidFrom, stub.ValidTo);
        var png = _stubImages.Render(
            stub.Color ?? "#0d9488", ev.Title, ev.BannerImage, validity, stub.Denomination, stub.ControlNumber);
        Response.Headers.CacheControl = "public, max-age=86400";
        return File(png, "image/png");
    }
}
