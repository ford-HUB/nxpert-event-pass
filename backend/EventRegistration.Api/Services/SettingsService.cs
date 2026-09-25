using EventRegistration.Api.Data;
using EventRegistration.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace EventRegistration.Api.Services;

/// <summary>
/// Reads/writes admin-configurable application settings from the AppSettings key/value table.
/// </summary>
public class SettingsService
{
    private readonly AppDbContext _db;
    public SettingsService(AppDbContext db) => _db = db;

    public async Task<string?> GetAsync(string key)
    {
        var row = await _db.AppSettings.AsNoTracking().FirstOrDefaultAsync(s => s.Key == key);
        return row?.Value;
    }

    public async Task SetAsync(string key, string? value)
    {
        var row = await _db.AppSettings.FirstOrDefaultAsync(s => s.Key == key);
        if (row is null)
            _db.AppSettings.Add(new AppSetting { Key = key, Value = value });
        else
            row.Value = value;
        await _db.SaveChangesAsync();
    }

    /// <summary>Email addresses CC'd on every outgoing email (empty when none configured).</summary>
    public async Task<List<string>> GetEmailCcAsync() => SplitEmails(await GetAsync(SettingKeys.EmailCc));

    /// <summary>Splits a stored CC value (comma/semicolon/whitespace separated) into addresses.</summary>
    public static List<string> SplitEmails(string? value) =>
        string.IsNullOrWhiteSpace(value)
            ? new List<string>()
            : value.Split(new[] { ',', ';', ' ', '\n', '\r', '\t' }, StringSplitOptions.RemoveEmptyEntries)
                   .Select(e => e.Trim())
                   .Where(e => e.Length > 0)
                   .ToList();
}
