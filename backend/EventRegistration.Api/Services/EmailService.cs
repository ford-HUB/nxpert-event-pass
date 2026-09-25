using MailKit.Net.Smtp;
using MailKit.Security;
using MimeKit;
using MimeKit.Utils;

namespace EventRegistration.Api.Services;

public class EmailSettings
{
    public bool Enabled { get; set; } = false;
    public string Host { get; set; } = "smtp.gmail.com";
    public int Port { get; set; } = 587;
    public string User { get; set; } = "";
    public string Password { get; set; } = "";
    public string FromName { get; set; } = "Event Registration";
    public string FromAddress { get; set; } = "";
}

public class EmailService
{
    private readonly EmailSettings _s;
    private readonly ILogger<EmailService> _log;
    private readonly SettingsService _settings;
    private readonly string _outboxDir;

    public EmailService(EmailSettings s, ILogger<EmailService> log, SettingsService settings, IWebHostEnvironment env)
    {
        _s = s;
        _log = log;
        _settings = settings;
        _outboxDir = Path.Combine(env.ContentRootPath, "outbox");
    }

    /// <summary>
    /// Sends an HTML email. Optionally embeds a PNG as an inline (CID) image referenced
    /// in the HTML as &lt;img src="cid:qrcode"&gt;. When SMTP is disabled, writes the
    /// message (and any QR) to an on-disk outbox so the demo still "works" offline.
    /// </summary>
    public async Task SendAsync(string toEmail, string subject, string htmlBody,
        byte[]? inlineQrPng = null, string cid = "qrcode",
        IReadOnlyDictionary<string, byte[]>? inlineImages = null)
    {
        var msg = new MimeMessage();
        msg.From.Add(new MailboxAddress(_s.FromName,
            string.IsNullOrWhiteSpace(_s.FromAddress) ? _s.User : _s.FromAddress));
        msg.To.Add(MailboxAddress.Parse(toEmail));

        // Admin-configurable CC recipients, applied to every outgoing email. Skip any that fail
        // to parse (and never CC the primary recipient again).
        var ccList = await _settings.GetEmailCcAsync();
        foreach (var cc in ccList)
        {
            if (string.Equals(cc, toEmail, StringComparison.OrdinalIgnoreCase)) continue;
            if (MailboxAddress.TryParse(cc, out var addr)) msg.Cc.Add(addr);
        }

        msg.Subject = subject;

        var builder = new BodyBuilder { HtmlBody = htmlBody };
        void AddInline(string contentId, byte[] png)
        {
            var image = builder.LinkedResources.Add($"{contentId}.png", png);
            image.ContentId = contentId;
            image.ContentType.MediaType = "image";
            image.ContentType.MediaSubtype = "png";
        }
        if (inlineQrPng is not null) AddInline(cid, inlineQrPng);
        if (inlineImages is not null)
            foreach (var kv in inlineImages)
                AddInline(kv.Key, kv.Value);
        msg.Body = builder.ToMessageBody();

        var ccHeader = msg.Cc.Mailboxes.Select(m => m.Address).ToList();

        if (!_s.Enabled)
        {
            await WriteToOutboxAsync(toEmail, ccHeader, subject, htmlBody, inlineQrPng, inlineImages);
            _log.LogWarning("Email SMTP disabled. Wrote message for {To} ('{Subject}') to outbox.", toEmail, subject);
            return;
        }

        try
        {
            using var client = new SmtpClient();
            await client.ConnectAsync(_s.Host, _s.Port, SecureSocketOptions.StartTls);
            await client.AuthenticateAsync(_s.User, _s.Password);
            await client.SendAsync(msg);
            await client.DisconnectAsync(true);
            _log.LogInformation("Sent email to {To} (cc: {Cc}) ('{Subject}').",
                toEmail, string.Join(", ", ccHeader), subject);
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "Failed to send email to {To}. Falling back to outbox.", toEmail);
            await WriteToOutboxAsync(toEmail, ccHeader, subject, htmlBody, inlineQrPng, inlineImages);
        }
    }

    private async Task WriteToOutboxAsync(string toEmail, List<string> cc, string subject, string htmlBody,
        byte[]? qr, IReadOnlyDictionary<string, byte[]>? inlineImages = null)
    {
        Directory.CreateDirectory(_outboxDir);
        var safe = string.Join("_", subject.Split(Path.GetInvalidFileNameChars()));
        var stamp = DateTime.UtcNow.Ticks;
        var baseName = $"{stamp}_{safe}";
        var html = htmlBody;
        if (qr is not null)
        {
            var qrFile = $"{baseName}.qr.png";
            await File.WriteAllBytesAsync(Path.Combine(_outboxDir, qrFile), qr);
            html = html.Replace("cid:qrcode", qrFile);
        }
        if (inlineImages is not null)
        {
            foreach (var kv in inlineImages)
            {
                var file = $"{baseName}.{kv.Key}.png";
                await File.WriteAllBytesAsync(Path.Combine(_outboxDir, file), kv.Value);
                html = html.Replace($"cid:{kv.Key}", file);
            }
        }
        var ccPart = cc.Count > 0 ? $" | Cc: {string.Join(", ", cc)}" : "";
        var header = $"<!-- To: {toEmail}{ccPart} | Subject: {subject} -->\n";
        await File.WriteAllTextAsync(Path.Combine(_outboxDir, $"{baseName}.html"), header + html);
    }
}
