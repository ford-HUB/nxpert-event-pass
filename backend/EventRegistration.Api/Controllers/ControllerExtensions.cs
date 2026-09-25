using System.Security.Claims;
using Microsoft.AspNetCore.Mvc;

namespace EventRegistration.Api.Controllers;

public static class ControllerExtensions
{
    public static int UserId(this ControllerBase c)
    {
        var id = c.User.FindFirstValue(ClaimTypes.NameIdentifier);
        return int.TryParse(id, out var v) ? v : 0;
    }

    private static readonly char[] SlugTrim = { '-' };

    /// <summary>Turns a title into a URL-friendly slug and appends a short suffix for uniqueness.</summary>
    public static string ToSlug(string title, string suffix)
    {
        var chars = title.ToLowerInvariant()
            .Select(ch => char.IsLetterOrDigit(ch) ? ch : '-')
            .ToArray();
        var slug = new string(chars);
        while (slug.Contains("--")) slug = slug.Replace("--", "-");
        slug = slug.Trim(SlugTrim);
        if (slug.Length > 60) slug = slug[..60].Trim(SlugTrim);
        if (string.IsNullOrEmpty(slug)) slug = "event";
        return $"{slug}-{suffix}";
    }
}
