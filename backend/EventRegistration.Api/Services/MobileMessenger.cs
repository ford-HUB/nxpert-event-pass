using EventRegistration.Api.Models;

namespace EventRegistration.Api.Services;

/// <summary>
/// A transport for phone-based notifications (entry pass, kit-claim, edit link, broadcasts).
/// Implemented by <see cref="ViberService"/> and <see cref="SmsService"/> so the two are
/// interchangeable behind <see cref="MobileMessenger"/>.
/// </summary>
public interface IMobileSender
{
    Task SendPassAsync(string phone, string title, DateTime startsAt, string venue,
        string attendeeName, string passToken, byte[] qrPng, string? editUrl = null);
    Task SendTextAsync(string phone, string subject, string text);
    Task SendMealStubsAsync(string phone, string eventTitle,
        IReadOnlyList<(string Caption, Guid Control)> stubs);
}

/// <summary>
/// Routes phone notifications to Viber or SMS based on the admin-configured provider
/// (<see cref="SettingKeys.MobileProvider"/>, default Viber). The choice is read per-send so an
/// admin can switch providers in Settings without a restart.
/// </summary>
public class MobileMessenger
{
    private readonly ViberService _viber;
    private readonly SmsService _sms;
    private readonly SettingsService _settings;

    public MobileMessenger(ViberService viber, SmsService sms, SettingsService settings)
    {
        _viber = viber;
        _sms = sms;
        _settings = settings;
    }

    private async Task<IMobileSender> ResolveAsync()
    {
        var provider = await _settings.GetAsync(SettingKeys.MobileProvider);
        return string.Equals(provider, MobileProviders.Sms, StringComparison.OrdinalIgnoreCase)
            ? _sms
            : _viber;
    }

    public async Task SendPassAsync(string phone, string title, DateTime startsAt, string venue,
        string attendeeName, string passToken, byte[] qrPng, string? editUrl = null) =>
        await (await ResolveAsync()).SendPassAsync(phone, title, startsAt, venue, attendeeName, passToken, qrPng, editUrl);

    public async Task SendTextAsync(string phone, string subject, string text) =>
        await (await ResolveAsync()).SendTextAsync(phone, subject, text);

    public async Task SendMealStubsAsync(string phone, string eventTitle,
        IReadOnlyList<(string Caption, Guid Control)> stubs) =>
        await (await ResolveAsync()).SendMealStubsAsync(phone, eventTitle, stubs);
}
