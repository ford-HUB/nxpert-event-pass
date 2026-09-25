using EventRegistration.Api.Hubs;
using EventRegistration.Api.Models;
using Microsoft.AspNetCore.SignalR;

namespace EventRegistration.Api.Services;

/// <summary>
/// Pushes realtime notifications through the <see cref="NotificationHub"/>. Sends are best-effort:
/// a failure to notify never blocks the underlying registration/confirmation.
/// </summary>
public class NotificationService
{
    private readonly IHubContext<NotificationHub> _hub;
    private readonly ILogger<NotificationService> _log;

    public NotificationService(IHubContext<NotificationHub> hub, ILogger<NotificationService> log)
    {
        _hub = hub;
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
