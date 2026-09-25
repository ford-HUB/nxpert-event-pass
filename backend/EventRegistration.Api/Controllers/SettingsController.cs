using EventRegistration.Api.Models;
using EventRegistration.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace EventRegistration.Api.Controllers;

// Admin-configurable application settings.
[ApiController]
[Route("api/settings")]
[Authorize(Roles = Roles.Admin + "," + Roles.SuperAdmin)]
public class SettingsController : ControllerBase
{
    private readonly SettingsService _settings;
    public SettingsController(SettingsService settings) => _settings = settings;

    [HttpGet]
    public async Task<ActionResult<AppSettingsDto>> Get()
    {
        var cc = await _settings.GetEmailCcAsync();
        var provider = MobileProviders.Normalize(await _settings.GetAsync(SettingKeys.MobileProvider));
        return Ok(new AppSettingsDto(cc, provider));
    }

    [HttpPut]
    public async Task<ActionResult<AppSettingsDto>> Update(UpdateSettingsRequest req)
    {
        // Normalize + de-duplicate, and validate each address format.
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var cleaned = new List<string>();
        foreach (var raw in req.CcEmails ?? new())
        {
            var e = (raw ?? "").Trim();
            if (e.Length == 0) continue;
            if (!IsValidEmail(e))
                return BadRequest(new { message = $"'{e}' is not a valid email address." });
            if (seen.Add(e)) cleaned.Add(e);
        }

        if (req.MobileProvider is not null && !MobileProviders.IsValid(req.MobileProvider))
            return BadRequest(new { message = "Mobile provider must be 'Viber' or 'Sms'." });
        var provider = MobileProviders.Normalize(req.MobileProvider);

        await _settings.SetAsync(SettingKeys.EmailCc, string.Join(",", cleaned));
        await _settings.SetAsync(SettingKeys.MobileProvider, provider);
        return Ok(new AppSettingsDto(cleaned, provider));
    }

    private static bool IsValidEmail(string email) =>
        System.Text.RegularExpressions.Regex.IsMatch(email, @"^[^\s@]+@[^\s@]+\.[^\s@]+$");
}
