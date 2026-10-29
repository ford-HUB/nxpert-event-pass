using EventRegistration.Api.Data;
using EventRegistration.Api.Hubs;
using EventRegistration.Api.Models;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace EventRegistration.Api.Services;

/// <summary>
/// Pushes realtime notifications through the <see cref="NotificationHub"/>. Sends are best-effort:
/// a failure to notify never blocks the underlying registration/confirmation.
/// </summary>
public class NotificationService
{
    private readonly IHubContext<NotificationHub> _hub;
    private readonly AttendeeQuery _attendees;
    private readonly AppDbContext _db;
    private readonly ILogger<NotificationService> _log;

    public NotificationService(IHubContext<NotificationHub> hub, AttendeeQuery attendees, AppDbContext db,
        ILogger<NotificationService> log)
    {
        _hub = hub;
        _attendees = attendees;
        _db = db;
        _log = log;
    }

    // Notify admins/confirmers that a registration came in.
    public async Task NewRegistrationAsync(NewRegistrationNotice notice)
    {
        try
        {
            await _hub.Clients.Group(NotificationHub.AdminGroup).SendAsync("newRegistration", notice);
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Failed to push newRegistration notification.");
        }
    }

    // Push the current Attendance rows for registrations that were just created/updated (and the
    // ids of any removed) to admins/confirmers — the same audience as the Attendance grid. Call
    // after SaveChanges so the rows reflect the committed state.
    public async Task AttendeesChangedAsync(int eventId, IEnumerable<int> changedIds, IEnumerable<int>? removedIds = null)
    {
        var changed = changedIds.Distinct().ToList();
        var removed = removedIds?.Distinct().ToList() ?? new List<int>();
        if (changed.Count == 0 && removed.Count == 0) return;
        try
        {
            var rows = changed.Count == 0 ? new List<AttendeeDto>() : await _attendees.LoadAsync(eventId, changed);
            await _hub.Clients.Group(NotificationHub.AdminGroup).SendAsync(
                "attendeesChanged", new AttendeesChangedNotice(eventId, rows, removed));
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Failed to push attendeesChanged for event {EventId}.", eventId);
        }
    }

    // Tell open door TVs (admins only) that an event's face gallery changed — someone registered,
    // a registration was removed, or a registrant's photo changed — so they re-sync the face
    // engine right away instead of waiting for their periodic reload.
    public async Task FaceGalleryChangedAsync(int eventId)
    {
        try
        {
            await _hub.Clients.Group(NotificationHub.AdminGroup).SendAsync(
                "faceGalleryChanged", new FaceGalleryChangedNotice(eventId));
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Failed to push faceGalleryChanged for event {EventId}.", eventId);
        }
    }

    // Tell open scanners / TVs (admins only) that the event's verify-only mode was switched.
    public async Task VerifyOnlyChangedAsync(int eventId, bool enabled)
    {
        try
        {
            await _hub.Clients.Group(NotificationHub.AdminGroup).SendAsync(
                "verifyOnlyChanged", new VerifyOnlyChangedNotice(eventId, enabled));
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Failed to push verifyOnlyChanged for event {EventId}.", eventId);
        }
    }

    // A user's photo changed: every event they're registered for has a stale gallery entry.
    public async Task UserPhotoChangedAsync(int userId)
    {
        var eventIds = await _db.Registrations
            .Where(r => r.UserId == userId)
            .Select(r => r.EventId)
            .Distinct()
            .ToListAsync();
        foreach (var eventId in eventIds)
            await FaceGalleryChangedAsync(eventId);
    }

    // Notify a specific registrant that their registration was approved.
    public async Task RegistrationApprovedAsync(int userId, RegistrationApprovedNotice notice)
    {
        try
        {
            await _hub.Clients.Group(NotificationHub.UserGroup(userId)).SendAsync("registrationApproved", notice);
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Failed to push registrationApproved notification to user {UserId}.", userId);
        }
    }

    // Notify a specific registrant that their event kit was claimed.
    public async Task KitClaimedAsync(int userId, KitClaimedNotice notice)
    {
        try
        {
            await _hub.Clients.Group(NotificationHub.UserGroup(userId)).SendAsync("kitClaimed", notice);
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Failed to push kitClaimed notification to user {UserId}.", userId);
        }
    }
}
