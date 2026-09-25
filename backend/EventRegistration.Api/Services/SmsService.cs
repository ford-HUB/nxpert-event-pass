using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace EventRegistration.Api.Services;

public class SmsSettings
{
    // When disabled (the default), messages are written to the on-disk outbox instead of being
    // sent — mirroring EmailService/ViberService so the demo works without an SMS sender.
    public bool Enabled { get; set; } = false;
    // Which SMS gateway to use: "Infobip" (default), "UniSMS", or "Movider".
    public string Provider { get; set; } = "Infobip";
    // Gateway base URL. Infobip: "https://xxxxx.api.infobip.com". UniSMS: "https://unismsapi.com/api".
    // Movider: "https://api.movider.co/v1".
    public string BaseUrl { get; set; } = "";
    // API credential. Infobip: API key ("Authorization: App {ApiKey}").
    // UniSMS: secret key (HTTP Basic username, empty password). Movider: api_key.
    public string ApiKey { get; set; } = "";
    // Second credential, used by Movider only (api_secret). Ignored by Infobip/UniSMS.
    public string ApiSecret { get; set; } = "";
    // The registered SMS sender ID / sender name (Infobip "from" / UniSMS "sender_id" / Movider "from").
    // Optional for Movider (a registered sender), required for Infobip/UniSMS.
    public string Sender { get; set; } = "";
    // Public base URL where THIS API is reachable (e.g. "https://nxpert-eventpass.n-pax.com:8000").
    // Used to build the clickable entry-pass link in the SMS. When empty, no pass link is included.
    public string PublicApiBaseUrl { get; set; } = "";
}

/// <summary>
/// Delivers text notifications over SMS via Infobip. SMS carries no images, so the entry-pass and
/// meal-stub messages are sent as plain text (the QR itself still reaches the registrant by email
/// when they use it). When Infobip isn't configured, messages are written to the on-disk outbox so
/// the demo still works; a send failure also falls back to the outbox. Mirrors <see cref="ViberService"/>.
/// </summary>
public class SmsService : IMobileSender
{
    private static readonly HttpClient Http = new();
    private readonly SmsSettings _s;
    private readonly ILogger<SmsService> _log;
    private readonly string _outboxDir;

    public SmsService(SmsSettings s, ILogger<SmsService> log, IWebHostEnvironment env)
    {
        _s = s;
        _log = log;
        _outboxDir = Path.Combine(env.ContentRootPath, "outbox");
    }

    private bool Configured =>
        _s.Enabled && !string.IsNullOrWhiteSpace(_s.BaseUrl) && !string.IsNullOrWhiteSpace(_s.ApiKey) &&
        // Movider needs api_secret (sender is optional); the others need a registered sender.
        (IsMovider ? !string.IsNullOrWhiteSpace(_s.ApiSecret) : !string.IsNullOrWhiteSpace(_s.Sender));

    /// <summary>
    /// Sends the entry-pass details to a phone over SMS (text only — no QR image). Falls back to the outbox.
    /// </summary>
    public async Task SendPassAsync(string phone, string title, DateTime startsAt, string venue,
        string attendeeName, string passToken, byte[] qrPng, string? editUrl = null)
    {
        // Clickable link to the entry-pass page (opens in the recipient's browser and shows the QR).
        var passUrl = BuildPassUrl(passToken);
        var text =
            $"Hi {attendeeName}, your registration for \"{title}\" is confirmed.\n" +
            $"When: {startsAt:MMM d yyyy, h:mm tt}\n" +
            $"Where: {venue}\n" +
            (passUrl is null
                ? "Please present your QR entry pass at the entrance."
                : $"View your QR entry pass: {passUrl}") +
            (string.IsNullOrWhiteSpace(editUrl) ? "" : $"\nUpdate details: {editUrl}");

        await SendAsync(NormalizePhone(phone), title, text);
    }

    // Absolute URL to the entry-pass view page, or null when no public base URL is configured.
    private string? BuildPassUrl(string passToken)
    {
        var baseUrl = _s.PublicApiBaseUrl?.Trim();
        if (string.IsNullOrWhiteSpace(baseUrl)) return null;
        return $"{baseUrl.TrimEnd('/')}/api/passes/{passToken}";
    }

    /// <summary>Sends a plain text SMS. <paramref name="subject"/> only labels the outbox entry.</summary>
    public async Task SendTextAsync(string phone, string subject, string text) =>
        await SendAsync(NormalizePhone(phone), subject, text);

    /// <summary>
    /// Sends a text summary of the registrant's meal stubs over SMS (no images). Falls back to the outbox.
    /// </summary>
    public async Task SendMealStubsAsync(string phone, string eventTitle,
        IReadOnlyList<(string Caption, Guid Control)> stubs)
    {
        if (stubs.Count == 0) return;
        var text = $"Your {stubs.Count} meal stub{(stubs.Count == 1 ? "" : "s")} for \"{eventTitle}\" — " +
                   "present each at the meal counter:\n" +
                   string.Join("\n", stubs.Select(s => $"• {s.Caption} (No. {s.Control.ToString()[..8].ToUpperInvariant()})"));
        await SendAsync(NormalizePhone(phone), $"meal-stubs_{eventTitle}", text);
    }

    private bool IsUniSms => string.Equals(_s.Provider, "UniSMS", StringComparison.OrdinalIgnoreCase);
    private bool IsMovider => string.Equals(_s.Provider, "Movider", StringComparison.OrdinalIgnoreCase);
    private string ProviderName => IsUniSms ? "UniSMS" : IsMovider ? "Movider" : "Infobip";

    // Core send: dispatch to the configured gateway, or fall back to the on-disk outbox.
    private async Task SendAsync(string to, string subject, string text)
    {
        var provider = ProviderName;
        if (!Configured)
        {
            await WriteToOutboxAsync(to, subject, text);
            _log.LogWarning("SMS/{Provider} not configured. Wrote message for {Phone} ('{Subject}') to outbox.", provider, to, subject);
            return;
        }

        try
        {
            var (ok, status, body) =
                IsUniSms ? await SendUniSmsAsync(to, text) :
                IsMovider ? await SendMoviderAsync(to, text) :
                await SendInfobipAsync(to, text);
            if (!ok)
                throw new InvalidOperationException($"{provider} responded {status}: {body}");

            _log.LogInformation("Sent SMS to {Phone} ('{Subject}') via {Provider}.", to, subject, provider);
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "Failed to send SMS to {Phone} via {Provider}. Falling back to outbox.", to, provider);
            await WriteToOutboxAsync(to, subject, text);
        }
    }

    // Movider (movider.co): POST {base}/sms as application/x-www-form-urlencoded with api_key +
    // api_secret in the body. Returns (ok, httpStatus, responseBody).
    private async Task<(bool Ok, int Status, string Body)> SendMoviderAsync(string to, string text)
    {
        var form = new List<KeyValuePair<string, string>>
        {
            new("api_key", _s.ApiKey),
            new("api_secret", _s.ApiSecret),
            new("to", to),
            new("text", text),
        };
        if (!string.IsNullOrWhiteSpace(_s.Sender)) form.Add(new("from", _s.Sender));

        using var req = new HttpRequestMessage(HttpMethod.Post, $"{_s.BaseUrl.TrimEnd('/')}/sms")
        {
            Content = new FormUrlEncodedContent(form),
        };
        req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));

        var resp = await Http.SendAsync(req);
        var body = await resp.Content.ReadAsStringAsync();
        return (resp.IsSuccessStatusCode && !IsMoviderRejected(body), (int)resp.StatusCode, body);
    }

    // Movider replies 200 with { phone_number_list:[...accepted...], bad_phone_number_list:[...rejected...] }.
    // Treat the send as failed when nothing was accepted or a recipient was rejected.
    private static bool IsMoviderRejected(string responseBody)
    {
        try
        {
            using var doc = JsonDocument.Parse(responseBody);
            var root = doc.RootElement;
            var accepted = root.TryGetProperty("phone_number_list", out var ok) &&
                           ok.ValueKind == JsonValueKind.Array && ok.GetArrayLength() > 0;
            var badCount = root.TryGetProperty("bad_phone_number_list", out var bad) &&
                           bad.ValueKind == JsonValueKind.Array ? bad.GetArrayLength() : 0;
            return !accepted || badCount > 0;
        }
        catch { /* unparseable body — treat as not-rejected; HTTP status already checked */ }
        return false;
    }

    // Infobip SMS (v3 API: POST /sms/3/messages). Returns (ok, httpStatus, responseBody).
    private async Task<(bool Ok, int Status, string Body)> SendInfobipAsync(string to, string text)
    {
        var payload = new
        {
            messages = new[]
            {
                new { sender = _s.Sender, destinations = new[] { new { to } }, content = new { text } },
            },
        };

        using var req = new HttpRequestMessage(HttpMethod.Post, $"{_s.BaseUrl.TrimEnd('/')}/sms/3/messages")
        {
            Content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json"),
        };
        req.Headers.Authorization = new AuthenticationHeaderValue("App", _s.ApiKey);
        req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));

        var resp = await Http.SendAsync(req);
        var body = await resp.Content.ReadAsStringAsync();
        return (resp.IsSuccessStatusCode && !IsInfobipRejected(body), (int)resp.StatusCode, body);
    }

    // UniSMS (unismsapi.com): POST {base}/sms with free-form content; HTTP Basic auth
    // (secret key as username, empty password). Returns (ok, httpStatus, responseBody).
    private async Task<(bool Ok, int Status, string Body)> SendUniSmsAsync(string to, string text)
    {
        var payload = new { recipient = to, content = text, sender_id = _s.Sender };

        using var req = new HttpRequestMessage(HttpMethod.Post, $"{_s.BaseUrl.TrimEnd('/')}/sms")
        {
            Content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json"),
        };
        var basic = Convert.ToBase64String(Encoding.ASCII.GetBytes(_s.ApiKey + ":"));
        req.Headers.Authorization = new AuthenticationHeaderValue("Basic", basic);
        req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));

        var resp = await Http.SendAsync(req);
        var body = await resp.Content.ReadAsStringAsync();
        return (resp.IsSuccessStatusCode && !IsUniSmsRejected(body), (int)resp.StatusCode, body);
    }

    // UniSMS returns { "message": { "status": ..., "fail_reason": ... } }; a non-null fail_reason
    // (or an explicit failed/rejected status) means the message was not accepted.
    private static bool IsUniSmsRejected(string responseBody)
    {
        try
        {
            using var doc = JsonDocument.Parse(responseBody);
            if (!doc.RootElement.TryGetProperty("message", out var msg)) return false;
            if (msg.TryGetProperty("fail_reason", out var fr) &&
                fr.ValueKind is not (JsonValueKind.Null or JsonValueKind.Undefined))
                return true;
            if (msg.TryGetProperty("status", out var st) && st.ValueKind == JsonValueKind.String)
            {
                var s = st.GetString();
                if (s is "failed" or "rejected" or "undelivered") return true;
            }
        }
        catch { /* unparseable body — treat as not-rejected; HTTP status already checked */ }
        return false;
    }

    // Infobip returns HTTP 200 with a per-message status; groupId 2/4/5 = UNDELIVERABLE/EXPIRED/REJECTED.
    private static bool IsInfobipRejected(string responseBody)
    {
        try
        {
            using var doc = JsonDocument.Parse(responseBody);
            if (!doc.RootElement.TryGetProperty("messages", out var messages)) return false;
            foreach (var m in messages.EnumerateArray())
            {
                if (m.TryGetProperty("status", out var status) &&
                    status.TryGetProperty("groupId", out var groupId) &&
                    groupId.ValueKind == JsonValueKind.Number)
                {
                    var g = groupId.GetInt32();
                    if (g is 2 or 4 or 5) return true;
                }
            }
        }
        catch { /* unparseable body — treat as not-rejected; HTTP status already checked */ }
        return false;
    }

    // Keep a leading '+' and digits; strip spaces, dashes, and parentheses.
    private static string NormalizePhone(string phone)
    {
        var trimmed = phone.Trim();
        var plus = trimmed.StartsWith('+');
        var digits = new string(trimmed.Where(char.IsDigit).ToArray());
        return plus ? "+" + digits : digits;
    }

    private async Task WriteToOutboxAsync(string phone, string title, string text)
    {
        Directory.CreateDirectory(_outboxDir);
        var safe = string.Join("_", $"sms_{title}".Split(Path.GetInvalidFileNameChars()));
        var baseName = $"{DateTime.UtcNow.Ticks}_{safe}";
        var body = $"To (SMS): {phone}\nRe: {title}\n\n{text}\n";
        await File.WriteAllTextAsync(Path.Combine(_outboxDir, $"{baseName}.txt"), body);
    }
}
