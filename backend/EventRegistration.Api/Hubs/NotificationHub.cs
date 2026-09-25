using System.Security.Claims;
using EventRegistration.Api.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace EventRegistration.Api.Hubs;

/// <summary>
/// Realtime push channel. On connect, admins/confirmers join the "admins" group (they receive
/// a "newRegistration" event whenever someone registers) and every user joins their own
/// "user-{id}" group (they receive a "registrationApproved" event when their registration is
/// confirmed). The token is supplied on the query string (see the JwtBearer OnMessageReceived
/// handler) because browsers can't set Authorization headers on a WebSocket.
/// </summary>
[Authorize]
public class NotificationHub : Hub
{
    public const string AdminGroup = "admins";

    public static string UserGroup(int userId) => $"user-{userId}";

    public override async Task OnConnectedAsync()
    {
        var user = Context.User;
        if (user is not null)
        {
            if (user.IsInRole(Roles.Admin) || user.IsInRole(Roles.SuperAdmin) ||
                user.HasClaim(Permissions.ConfirmRegistrations, "true"))
            {
                await Groups.AddToGroupAsync(Context.ConnectionId, AdminGroup);
            }

            var uid = user.FindFirstValue(ClaimTypes.NameIdentifier);
            if (int.TryParse(uid, out var id))
                await Groups.AddToGroupAsync(Context.ConnectionId, UserGroup(id));
        }

        await base.OnConnectedAsync();
    }
}
