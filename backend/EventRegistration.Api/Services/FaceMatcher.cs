using System.Text.Json;
using EventRegistration.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace EventRegistration.Api.Services;

/// <summary>
/// Helpers for comparing 128-d face descriptors and detecting duplicate face registrations.
/// </summary>
public static class FaceMatcher
{
    // Max Euclidean distance for two descriptors to be considered the same person. Matches the
    // scanner's recognition threshold, so a face that would be recognized as an existing member
    // is treated as a duplicate at registration time.
    public const double MatchThreshold = 0.5;

    public static float[]? Parse(string? json)
    {
        if (string.IsNullOrEmpty(json)) return null;
        try
        {
            var arr = JsonSerializer.Deserialize<float[]>(json);
            return arr is { Length: 128 } ? arr : null;
        }
        catch
        {
            return null;
        }
    }

    public static double Distance(float[] a, float[] b)
    {
        double sum = 0;
        for (var i = 0; i < a.Length; i++)
        {
            double d = a[i] - b[i];
            sum += d * d;
        }
        return Math.Sqrt(sum);
    }

    /// <summary>
    /// Returns the full name of an existing user (other than <paramref name="excludeUserId"/>)
    /// whose registered face matches the given descriptor, or null if none does.
    /// </summary>
    public static async Task<string?> FindDuplicateOwnerAsync(AppDbContext db, string? faceJson, int excludeUserId)
    {
        var desc = Parse(faceJson);
        if (desc is null) return null;

        var others = await db.Users
            .Where(u => u.FaceDescriptor != null && u.Id != excludeUserId)
            .Select(u => new { u.FullName, u.FaceDescriptor })
            .ToListAsync();

        foreach (var o in others)
        {
            var d = Parse(o.FaceDescriptor);
            if (d is not null && Distance(desc, d) <= MatchThreshold) return o.FullName;
        }
        return null;
    }

    /// <summary>
    /// Block-on-duplicate for public/guest face capture: returns the name of an existing enrolled
    /// face that matches — any account member (master), or another guest registration for the same
    /// event (a different email/phone) — or null when the face is new. The registrant's own rows
    /// (same email or phone) are ignored so re-submitting doesn't self-collide.
    /// </summary>
    public static async Task<string?> FindDuplicateForGuestAsync(
        AppDbContext db, string? faceJson, int eventId, string? guestSenate)
    {
        var desc = Parse(faceJson);
        if (desc is null) return null;

        var owner = await FindDuplicateOwnerAsync(db, faceJson, 0);
        if (owner is not null) return owner;

        var guests = await db.Registrations
            .Where(r => r.EventId == eventId && r.UserId == null && r.FaceDescriptor != null)
            .Select(r => new { r.GuestFullName, r.GuestSenateNo, r.FaceDescriptor })
            .ToListAsync();
        foreach (var g in guests)
        {
            // Skip the same member's own rows (same Senate No.).
            if (guestSenate != null && g.GuestSenateNo == guestSenate) continue;
            var d = Parse(g.FaceDescriptor);
            if (d is not null && Distance(desc, d) <= MatchThreshold) return g.GuestFullName ?? "another guest";
        }
        return null;
    }
}
