using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace EventRegistration.Api.Services;

public class ViberSettings
{
    // When disabled (the default), messages are written to the on-disk outbox instead of being
    // sent — mirroring EmailService so the demo works without an Infobip account.
    public bool Enabled { get; set; } = false;
    // Infobip account base URL, e.g. "https://xxxxx.api.infobip.com" (personalised per account).
    public string BaseUrl { get; set; } = "";
    // Infobip API key — sent as "Authorization: App {ApiKey}".
    public string ApiKey { get; set; } = "";
    // The Viber sender/service id registered with Infobip (the "from").
    public string Sender { get; set; } = "";
    // Public HTTPS base URL where THIS API is reachable (e.g. "https://nxpert-eventpass.n-pax.com:8000").
    // Used to build the QR image URL that Infobip fetches, so it must be publicly reachable.
    // When empty, a text-only message is sent (no inline QR).
    public string PublicApiBaseUrl { get; set; } = "";
}

/// <summary>
/// Delivers entry passes / notifications over Viber Business Messages via Infobip (a Viber BSP).
/// Infobip sends straight to the recipient's phone number — no per-user opt-in. When Infobip
/// isn't configured, messages (and the QR PNG) are written to the on-disk outbox so the demo
/// still works offline; a send failure also falls back to the outbox.
/// </summary>
public class ViberService : IMobileSender
{
    private static readonly HttpClient Http = new();
    private readonly ViberSettings _s;
    private readonly ILogger<ViberService> _log;
    private readonly string _outboxDir;

    public ViberService(ViberSettings s, ILogger<ViberService> log, IWebHostEnvironment env)
    {
        _s = s;
        _log = log;
        _outboxDir = Path.Combine(env.ContentRootPath, "outbox");
    }

    private bool Configured =>
        _s.Enabled && !string.IsNullOrWhiteSpace(_s.BaseUrl) &&
        !string.IsNullOrWhiteSpace(_s.ApiKey) && !string.IsNullOrWhiteSpace(_s.Sender);

    /// <summary>
    /// Sends the entry-pass message to a phone number over Viber (Infobip). When a public API
    /// base URL is configured, the QR pass is delivered as an image message pointing at the
    /// public pass-QR endpoint; otherwise a text message is sent. Falls back to the outbox.
    /// </summary>
    public async Task SendPassAsync(string phone, string title, DateTime startsAt, string venue,
        string attendeeName, string passToken, byte[] qrPng, string? editUrl = null)
    {
        var text =
            $"Hi {attendeeName}, your registration for \"{title}\" is confirmed.\n" +
            $"When: {startsAt:dddd, MMM d yyyy, h:mm tt}\n" +
            $"Where: {venue}\n" +
            "Present the QR entry pass at the entrance." +
            (string.IsNullOrWhiteSpace(editUrl) ? "" : $"\n\nNeed to update your details? {editUrl}");

        var to = NormalizePhone(phone);

        if (!Configured)
        {
            await WriteToOutboxAsync(to, title, text, qrPng);
            _log.LogWarning("Viber/Infobip not configured. Wrote pass for {Phone} ('{Title}') to outbox.", to, title);
            return;
        }

        try
        {
            // Infobip Viber Business Messages v2: POST /viber/2/messages. Always send the details
            // as a text message (the confirmed-working shape); when we have a public HTTPS URL
            // Infobip can fetch, also send the QR as its own image message. Keeping them separate
            // means the text still arrives even if the image is rejected.
            var mediaUrl = BuildPassImageUrl(passToken);
            var messages = new List<object>
            {
                new { sender = _s.Sender, destinations = new[] { new { to } }, content = new { text, type = "TEXT" } },
            };
            if (mediaUrl is not null)
            {
                messages.Add(new
                {
                    sender = _s.Sender,
                    destinations = new[] { new { to } },
                    content = new { type = "IMAGE", url = mediaUrl },
                });
            }
            var payload = new { messages };

            using var req = new HttpRequestMessage(HttpMethod.Post, $"{_s.BaseUrl.TrimEnd('/')}/viber/2/messages")
            {
                Content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json"),
            };
            req.Headers.Authorization = new AuthenticationHeaderValue("App", _s.ApiKey);
            req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));

            var resp = await Http.SendAsync(req);
            var body = await resp.Content.ReadAsStringAsync();
            if (!resp.IsSuccessStatusCode || IsRejected(body))
                throw new InvalidOperationException($"Infobip responded {(int)resp.StatusCode}: {body}");

            _log.LogInformation("Sent Viber pass to {Phone} ('{Title}') via Infobip ({Kind}).",
                to, title, mediaUrl is null ? "text only" : "text + QR image");
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "Failed to send Viber message to {Phone}. Falling back to outbox.", to);
            await WriteToOutboxAsync(to, title, text, qrPng);
        }
    }

    /// <summary>
    /// Sends a plain text notification (no QR/image) to a phone number over Viber (Infobip).
    /// Falls back to the on-disk outbox when Infobip isn't configured or the send fails.
    /// <paramref name="subject"/> is only used to label the outbox entry.
    /// </summary>
    public async Task SendTextAsync(string phone, string subject, string text)
    {
        var to = NormalizePhone(phone);

        if (!Configured)
        {
            await WriteToOutboxAsync(to, subject, text, Array.Empty<byte>());
            _log.LogWarning("Viber/Infobip not configured. Wrote message for {Phone} ('{Subject}') to outbox.", to, subject);
            return;
        }

        try
        {
            var payload = new
            {
                messages = new[]
                {
                    new { sender = _s.Sender, destinations = new[] { new { to } }, content = new { text, type = "TEXT" } },
                },
            };

            using var req = new HttpRequestMessage(HttpMethod.Post, $"{_s.BaseUrl.TrimEnd('/')}/viber/2/messages")
            {
                Content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json"),
            };
            req.Headers.Authorization = new AuthenticationHeaderValue("App", _s.ApiKey);
            req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));

            var resp = await Http.SendAsync(req);
            var body = await resp.Content.ReadAsStringAsync();
            if (!resp.IsSuccessStatusCode || IsRejected(body))
                throw new InvalidOperationException($"Infobip responded {(int)resp.StatusCode}: {body}");

            _log.LogInformation("Sent Viber message to {Phone} ('{Subject}') via Infobip.", to, subject);
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "Failed to send Viber message to {Phone}. Falling back to outbox.", to);
            await WriteToOutboxAsync(to, subject, text, Array.Empty<byte>());
        }
    }

    // Absolute HTTPS URL Infobip fetches for the picture message, or null when no publicly
    // reachable HTTPS base is configured (e.g. localhost in dev) — the caller then sends text.
    // Infobip only accepts secured HTTPS media URLs it can reach, so a local/http URL is skipped.
    private string? BuildPassImageUrl(string passToken)
    {
        var baseUrl = _s.PublicApiBaseUrl?.Trim();
        if (string.IsNullOrWhiteSpace(baseUrl)) return null;
        if (!Uri.TryCreate(baseUrl, UriKind.Absolute, out var uri)) return null;
        if (uri.Scheme != Uri.UriSchemeHttps) return null;
        var host = uri.Host;
        if (host is "localhost" or "127.0.0.1" or "0.0.0.0" || host.EndsWith(".local", StringComparison.OrdinalIgnoreCase))
            return null;
        return $"{baseUrl.TrimEnd('/')}/api/passes/{passToken}/qr.png";
    }

    private string? BuildMealStubImageUrl(Guid control)
    {
        var baseUrl = _s.PublicApiBaseUrl?.Trim();
        if (string.IsNullOrWhiteSpace(baseUrl)) return null;
        if (!Uri.TryCreate(baseUrl, UriKind.Absolute, out var uri)) return null;
        if (uri.Scheme != Uri.UriSchemeHttps) return null;
        var host = uri.Host;
        if (host is "localhost" or "127.0.0.1" or "0.0.0.0" || host.EndsWith(".local", StringComparison.OrdinalIgnoreCase))
            return null;
        // The full composed stub ticket (banner + QR + denomination), not just the QR.
        return $"{baseUrl.TrimEnd('/')}/api/passes/meal-stub/{control}/stub.png";
    }

    /// <summary>
    /// Sends the registrant's meal stubs over Viber: an intro text plus one full stub image message
    /// per stub (when a public HTTPS base is configured). Falls back to a text summary / the outbox.
    /// </summary>
    public async Task SendMealStubsAsync(string phone, string eventTitle,
        IReadOnlyList<(string Caption, Guid Control)> stubs)
    {
        if (stubs.Count == 0) return;
        var to = NormalizePhone(phone);
        var intro = $"Your {stubs.Count} meal stub{(stubs.Count == 1 ? "" : "s")} for \"{eventTitle}\" — " +
                    "present each QR at the meal counter.";

        // Build image messages when we have a reachable public URL for each stub; else text lines.
        var messages = new List<object> { new { sender = _s.Sender, destinations = new[] { new { to } }, content = new { text = intro, type = "TEXT" } } };
        var haveImages = true;
        foreach (var s in stubs)
        {
            var url = BuildMealStubImageUrl(s.Control);
            if (url is null) { haveImages = false; break; }
            messages.Add(new { sender = _s.Sender, destinations = new[] { new { to } }, content = new { type = "IMAGE", url, text = s.Caption } });
        }

        if (!Configured || !haveImages)
        {
            var summary = intro + "\n" + string.Join("\n", stubs.Select(s => $"• {s.Caption} (No. {s.Control.ToString()[..8].ToUpperInvariant()})"));
            await WriteToOutboxAsync(to, $"meal-stubs_{eventTitle}", summary, Array.Empty<byte>());
            _log.LogWarning("Viber meal stubs for {Phone}: wrote summary to outbox (configured={Cfg}, images={Img}).", to, Configured, haveImages);
            return;
        }

        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Post, $"{_s.BaseUrl.TrimEnd('/')}/viber/2/messages")
            {
                Content = new StringContent(JsonSerializer.Serialize(new { messages }), Encoding.UTF8, "application/json"),
            };
            req.Headers.Authorization = new AuthenticationHeaderValue("App", _s.ApiKey);
            req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));

            var resp = await Http.SendAsync(req);
            var body = await resp.Content.ReadAsStringAsync();
            if (!resp.IsSuccessStatusCode || IsRejected(body))
                throw new InvalidOperationException($"Infobip responded {(int)resp.StatusCode}: {body}");
            _log.LogInformation("Sent {Count} Viber meal stub image(s) to {Phone}.", stubs.Count, to);
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "Failed to send Viber meal stubs to {Phone}. Falling back to outbox.", to);
            var summary = intro + "\n" + string.Join("\n", stubs.Select(s => $"• {s.Caption}"));
            await WriteToOutboxAsync(to, $"meal-stubs_{eventTitle}", summary, Array.Empty<byte>());
        }
    }

    // Infobip returns HTTP 200 with a per-message status; groupId 2/4/5 = UNDELIVERABLE/EXPIRED/REJECTED.
    private static bool IsRejected(string responseBody)
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
    public static string NormalizePhone(string phone)
    {
        var trimmed = phone.Trim();
        var plus = trimmed.StartsWith('+');
        var digits = new string(trimmed.Where(char.IsDigit).ToArray());
        return plus ? "+" + digits : digits;
    }

    private async Task WriteToOutboxAsync(string phone, string title, string text, byte[] qr)
    {
        Directory.CreateDirectory(_outboxDir);
        var safe = string.Join("_", $"viber_{title}".Split(Path.GetInvalidFileNameChars()));
        var baseName = $"{DateTime.UtcNow.Ticks}_{safe}";
        var qrNote = "";
        if (qr.Length > 0)
        {
            await File.WriteAllBytesAsync(Path.Combine(_outboxDir, $"{baseName}.qr.png"), qr);
            qrNote = $"\n\n[QR pass: {baseName}.qr.png]";
        }
        var body = $"To (Viber): {phone}\nRe: {title}\n\n{text}{qrNote}\n";
        await File.WriteAllTextAsync(Path.Combine(_outboxDir, $"{baseName}.txt"), body);
    }
}
