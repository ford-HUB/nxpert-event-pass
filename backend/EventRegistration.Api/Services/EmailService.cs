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

// A file attached to an email (e.g. a calendar invite: "invite.ics", "text/calendar; method=REQUEST").
public sealed record EmailAttachment(string FileName, byte[] Content, string ContentType);

public enum EmailDeliveryStatus { Sent, Queued }

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

    // Sender identity — also used as the ORGANIZER of calendar invites.
    public string FromName => _s.FromName;
    public string FromAddress => string.IsNullOrWhiteSpace(_s.FromAddress) ? _s.User : _s.FromAddress;

    /// <summary>
    /// Sends an HTML email. Optionally embeds a PNG as an inline (CID) image referenced
    /// in the HTML as &lt;img src="cid:qrcode"&gt;. When SMTP is disabled, writes the
    /// message (and any QR) to an on-disk outbox so the demo still "works" offline.
    /// </summary>
    public async Task SendAsync(string toEmail, string subject, string htmlBody,
        byte[]? inlineQrPng = null, string cid = "qrcode",
        IReadOnlyDictionary<string, byte[]>? inlineImages = null,
        IReadOnlyList<EmailAttachment>? attachments = null)
    {
        await SendMessageAsync(new[] { toEmail }, Array.Empty<string>(), subject, htmlBody,
            inlineQrPng, cid, inlineImages, attachments, includeDefaultCc: true);
    }

    public async Task<MimeMessage> BuildMessageAsync(IReadOnlyCollection<string> to,
        IReadOnlyCollection<string> cc, string subject, string htmlBody,
        byte[]? inlineQrPng = null, string cid = "qrcode",
        IReadOnlyDictionary<string, byte[]>? inlineImages = null,
        IReadOnlyList<EmailAttachment>? attachments = null, bool includeDefaultCc = false,
        IReadOnlyCollection<string>? bcc = null)
    {
        var msg = new MimeMessage();
        msg.From.Add(new MailboxAddress(_s.FromName, FromAddress));
        var recipients = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var address in to)
        {
            var mailbox = MailboxAddress.Parse(address);
            if (recipients.Add(mailbox.Address)) msg.To.Add(mailbox);
        }
        foreach (var address in bcc ?? Array.Empty<string>())
        {
            var mailbox = MailboxAddress.Parse(address);
            if (recipients.Add(mailbox.Address)) msg.Bcc.Add(mailbox);
        }
        // Bulk mail: receivers only see that it went to a list, not each other's addresses.
        if (msg.To.Count == 0 && (msg.Bcc.Count > 0 || (bcc is not null && cc.Count > 0)))
            msg.To.Add(new GroupAddress("Undisclosed recipients"));
        if (msg.To.Count == 0) throw new ArgumentException("Add at least one To recipient.");
        var copies = includeDefaultCc ? cc.Concat(await _settings.GetEmailCcAsync()) : cc;
        foreach (var address in copies)
            if (MailboxAddress.TryParse(address, out var mailbox) && recipients.Add(mailbox.Address))
                msg.Cc.Add(mailbox);
        msg.Subject = subject;
        var builder = new BodyBuilder { HtmlBody = htmlBody };
        void AddInline(string contentId, byte[] png)
        {
            var image = builder.LinkedResources.Add(contentId + ".png", png);
            image.ContentId = contentId;
            image.ContentType.MediaType = "image";
            image.ContentType.MediaSubtype = "png";
            image.ContentDisposition = new ContentDisposition(ContentDisposition.Inline);
        }
        if (inlineQrPng is not null) AddInline(cid, inlineQrPng);
        if (inlineImages is not null) foreach (var image in inlineImages) AddInline(image.Key, image.Value);
        var calendarParts = new List<MimePart>();
        foreach (var attachment in attachments ?? Array.Empty<EmailAttachment>())
        {
            var type = ContentType.Parse(attachment.ContentType);
            if (type.MimeType.Equals("text/calendar", StringComparison.OrdinalIgnoreCase))
            {
                calendarParts.Add(new MimePart(type) {
                    Content = new MimeContent(new MemoryStream(attachment.Content)),
                    ContentTransferEncoding = ContentEncoding.Base64,
                    ContentDisposition = new ContentDisposition(ContentDisposition.Inline) { FileName = attachment.FileName },
                });
                continue;
            }
            builder.Attachments.Add(attachment.FileName, attachment.Content, ContentType.Parse(attachment.ContentType));
        }
        var body = builder.ToMessageBody();
        if (calendarParts.Count > 0)
        {
            // iMIP clients must see text/calendar with a METHOD parameter as an
            // alternative representation, alongside the HTML/related inline images.
            var alternative = new MultipartAlternative();
            if (body is Multipart mixed && mixed.ContentType.MediaSubtype == "mixed")
            {
                alternative.Add(mixed[0]);
                foreach (var calendar in calendarParts) alternative.Add(calendar);
                mixed[0] = alternative;
            }
            else
            {
                alternative.Add(body);
                foreach (var calendar in calendarParts) alternative.Add(calendar);
                body = alternative;
            }
        }
        msg.Body = body;
        return msg;
    }

    public virtual async Task<EmailDeliveryStatus> SendMessageAsync(IReadOnlyCollection<string> to,
        IReadOnlyCollection<string> cc, string subject, string htmlBody,
        byte[]? inlineQrPng = null, string cid = "qrcode",
        IReadOnlyDictionary<string, byte[]>? inlineImages = null,
        IReadOnlyList<EmailAttachment>? attachments = null, bool includeDefaultCc = false)
    {
        var msg = await BuildMessageAsync(to, cc, subject, htmlBody,
            inlineQrPng, cid, inlineImages, attachments, includeDefaultCc);
        return await TransmitAsync(msg, subject, htmlBody, inlineQrPng, inlineImages, attachments);
    }

    /// <summary>
    /// One message to many receivers, each hidden from the others (BCC). CC addresses appear in the
    /// Cc header; with deliverCc false they are shown but not sent a copy (already sent one).
    /// </summary>
    public virtual async Task<EmailDeliveryStatus> SendBccAsync(IReadOnlyCollection<string> bcc, string subject,
        string htmlBody, IReadOnlyDictionary<string, byte[]>? inlineImages = null,
        IReadOnlyCollection<string>? cc = null, bool deliverCc = true)
    {
        var msg = await BuildMessageAsync(Array.Empty<string>(), cc ?? Array.Empty<string>(), subject, htmlBody,
            inlineImages: inlineImages, bcc: bcc);
        var envelope = deliverCc ? null : msg.Bcc.Mailboxes.ToList();
        return await TransmitAsync(msg, subject, htmlBody, null, inlineImages, null, envelope);
    }

    // envelope: the addresses SMTP delivers to, when not everyone in the headers should get a copy.
    private async Task<EmailDeliveryStatus> TransmitAsync(MimeMessage msg, string subject, string htmlBody,
        byte[]? inlineQrPng, IReadOnlyDictionary<string, byte[]>? inlineImages, IReadOnlyList<EmailAttachment>? attachments,
        IReadOnlyList<MailboxAddress>? envelope = null)
    {
        var toHeader = string.Join(", ", msg.To.Mailboxes.Select(m => m.Address)
            .Concat(msg.Bcc.Mailboxes.Select(m => "bcc:" + m.Address)));
        var ccHeader = msg.Cc.Mailboxes.Select(m => m.Address).ToList();
        if (_s.Enabled)
        {
            try
            {
                using var client = new SmtpClient { Timeout = 60_000 };
                await client.ConnectAsync(_s.Host, _s.Port, SecureSocketOptions.StartTls);
                await client.AuthenticateAsync(_s.User, _s.Password);
                if (envelope is null) await client.SendAsync(msg);
                else await client.SendAsync(msg, msg.From.Mailboxes.First(), envelope);
                // A failed QUIT does not undo a message already accepted by SMTP.
                try { await client.DisconnectAsync(true); }
                catch (Exception ex) { _log.LogWarning(ex, "SMTP disconnect failed after delivery was accepted."); }
                _log.LogInformation("Sent email to {Count} recipient(s) ('{Subject}').", msg.To.Mailboxes.Count() + msg.Cc.Count + msg.Bcc.Count, subject);
                return EmailDeliveryStatus.Sent;
            }
            catch (Exception ex)
            {
                _log.LogError(ex, "Email delivery failed; saving message to outbox.");
            }
        }
        await WriteToOutboxAsync(toHeader, ccHeader, subject, htmlBody, inlineQrPng, inlineImages, attachments);
        // Preserve the complete MIME message (including actual To/CC and CID images)
        // for administrator inspection or later delivery when SMTP is unavailable.
        await msg.WriteToAsync(Path.Combine(_outboxDir, Guid.NewGuid().ToString("N") + ".eml"));
        _log.LogWarning("Saved queued email for {Count} recipient(s) to outbox.", msg.To.Mailboxes.Count() + msg.Cc.Count + msg.Bcc.Count);
        return EmailDeliveryStatus.Queued;
    }

    private async Task WriteToOutboxAsync(string toEmail, List<string> cc, string subject, string htmlBody,
        byte[]? qr, IReadOnlyDictionary<string, byte[]>? inlineImages = null,
        IReadOnlyList<EmailAttachment>? attachments = null)
    {
        Directory.CreateDirectory(_outboxDir);
        var safe = string.Join("_", subject.Split(Path.GetInvalidFileNameChars()));
        if (safe.Length > 80) safe = safe[..80];
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
        foreach (var a in attachments ?? Array.Empty<EmailAttachment>())
            await File.WriteAllBytesAsync(Path.Combine(_outboxDir, $"{baseName}.{a.FileName}"), a.Content);
        var ccPart = cc.Count > 0 ? $" | Cc: {string.Join(", ", cc)}" : "";
        var header = $"<!-- To: {System.Net.WebUtility.HtmlEncode(toEmail + ccPart)} | Subject: {System.Net.WebUtility.HtmlEncode(subject)} -->\n";
        await File.WriteAllTextAsync(Path.Combine(_outboxDir, $"{baseName}.html"), header + html);
    }
}
