using System.Buffers.Binary;
using System.Net;
using System.Text;
using System.Xml;
using System.Xml.Linq;
using EventRegistration.Api.Data;
using EventRegistration.Api.Models;
using Microsoft.EntityFrameworkCore;
using MimeKit;

namespace EventRegistration.Api.Services;

public record InvitationMessage(List<string> To, List<string> Cc, string Subject,
    string Html, Dictionary<string, byte[]> Images, string RegisterUrl, string EditableBody);

public class InvitationMessageBuilder(AppDbContext db, IConfiguration config)
{
    public const int MaxImageBytes = 2 * 1024 * 1024;
    public const int MaxTotalImageBytes = 5 * 1024 * 1024;

    public static string? Address(string? input)
    {
        var value = (input ?? "").Trim();
        if (value.Length > 256 || value.Contains('\r') || value.Contains('\n')) return null;
        if (!System.Text.RegularExpressions.Regex.IsMatch(value, @"^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$")) return null;
        return MailboxAddress.TryParse(value, out var mailbox) &&
            string.Equals(mailbox.Address, value, StringComparison.OrdinalIgnoreCase) && value.Contains('@')
            ? mailbox.Address.ToLowerInvariant() : null;
    }

    public async Task<InvitationMessage> BuildAsync(Event ev, InvitationComposeRequest req, bool enforceRecipientEntryLimit = true)
    {
        if (enforceRecipientEntryLimit && (req.To?.Count ?? 0) + (req.Cc?.Count ?? 0) > 500)
            throw new ArgumentException("Use @n-pax for all users, or add at most 500 individual recipient entries.");
        var directory = (await db.Users.AsNoTracking().Select(u => u.Email).ToListAsync())
            .Select(Address).Where(e => e != null).Cast<string>().Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        List<string> Expand(List<string>? values)
        {
            var result = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var raw in values ?? new())
            {
                if (string.Equals(raw?.Trim(), "@n-pax", StringComparison.OrdinalIgnoreCase)) result.UnionWith(directory);
                else result.Add(Address(raw) ?? throw new ArgumentException($"Invalid recipient: {raw}"));
            }
            return result.ToList();
        }
        var to = Expand(req.To);
        var cc = Expand(req.Cc).Except(to, StringComparer.OrdinalIgnoreCase).ToList();
        if (to.Count == 0) throw new ArgumentException("Add at least one To recipient.");
        var subject = (req.Subject ?? "").Trim();
        if (subject.Length == 0 || subject.Length > 200 || subject.Contains('\r') || subject.Contains('\n'))
            throw new ArgumentException("Enter a subject of up to 200 characters, without line breaks.");
        var (body, images) = RenderBody(req.BodyHtml);
        var frontend = config["App:FrontendBaseUrl"]?.TrimEnd('/') ?? "http://localhost:4200";
        var url = $"{frontend}/e/{Uri.EscapeDataString(ev.PublicSlug)}";
        // A composed message can have CC recipients: do not share personal magic-login tokens.
        var html = "<!doctype html><html><body style=\"font-family:Segoe UI,Arial,sans-serif;color:#202124\">" +
            "<div style=\"max-width:800px;margin:0 auto;font-size:15px;line-height:1.6\">" + body + "</div>" +
            "<div style=\"margin-top:28px\">" + EmailTemplates.Invitation(ev, WebUtility.HtmlEncode(url)) + "</div></body></html>";
        // Persist only allowlisted markup. Reinsert PNG data so a draft can be opened
        // and edited without exposing CID paths or trusting the submitted XHTML.
        var editableBody = body;
        foreach (var image in images)
            editableBody = editableBody.Replace($"cid:{image.Key}\"", $"data:image/png;base64,{Convert.ToBase64String(image.Value)}\"");
        return new InvitationMessage(to, cc, subject, html, images, url, "<div>" + editableBody + "</div>");
    }

    // The editor sends serialized XHTML, not trusted HTML. Parse without DTDs or
    // external resources and rebuild only supported formatting, safe links and PNGs.
    public static (string Html, Dictionary<string, byte[]> Images) RenderBody(string? xhtml)
    {
        if (string.IsNullOrWhiteSpace(xhtml)) return ("", new());
        if (xhtml.Length > 8_000_000) throw new ArgumentException("The message is too large. Use smaller images.");
        XDocument document;
        try
        {
            using var reader = XmlReader.Create(new StringReader(xhtml), new XmlReaderSettings {
                DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null, MaxCharactersInDocument = 8_000_000,
            });
            document = XDocument.Load(reader, LoadOptions.PreserveWhitespace);
        }
        catch (XmlException) { throw new ArgumentException("The message formatting is invalid. Please paste the text again."); }
        if (document.Root is null || document.Descendants().Take(5001).Count() > 5000)
            throw new ArgumentException("The message has too much formatting.");
        var images = new Dictionary<string, byte[]>();
        var total = 0;
        var allowed = new HashSet<string> { "p", "div", "br", "b", "strong", "i", "em", "u", "s", "ul", "ol", "li", "blockquote", "span", "h1", "h2", "h3", "a" };
        string Render(XNode node, int depth)
        {
            if (depth > 30) throw new ArgumentException("The message formatting is nested too deeply.");
            if (node is XText text) return WebUtility.HtmlEncode(text.Value);
            if (node is not XElement el) return "";
            var tag = el.Name.LocalName.ToLowerInvariant();
            if (tag is "script" or "style" or "iframe" or "object" or "svg" or "form" or "input") return "";
            if (tag == "img")
            {
                var source = el.Attribute("src")?.Value ?? "";
                const string prefix = "data:image/png;base64,";
                if (!source.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                    throw new ArgumentException("Insert images using the image button or paste an image file.");
                if (images.Count >= 5) throw new ArgumentException("Use at most five inline images.");
                byte[] bytes;
                try { bytes = Convert.FromBase64String(source[prefix.Length..]); }
                catch (FormatException) { throw new ArgumentException("An inline image could not be read."); }
                if (bytes.Length > MaxImageBytes || (total += bytes.Length) > MaxTotalImageBytes)
                    throw new ArgumentException("Each image must be at most 2 MB, and all images together at most 5 MB.");
                ReadOnlySpan<byte> signature = new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 };
                if (bytes.Length < 33 || !bytes.AsSpan(0, 8).SequenceEqual(signature) ||
                    Encoding.ASCII.GetString(bytes, 12, 4) != "IHDR")
                    throw new ArgumentException("Only PNG inline images are supported.");
                var width = BinaryPrimitives.ReadUInt32BigEndian(bytes.AsSpan(16, 4));
                var height = BinaryPrimitives.ReadUInt32BigEndian(bytes.AsSpan(20, 4));
                if (width is 0 or > 4096 || height is 0 or > 4096 || (long)width * height > 16_000_000)
                    throw new ArgumentException("An inline image has unsupported dimensions.");
                var cid = "invitation-image-" + (images.Count + 1);
                images[cid] = bytes;
                return $"<img src=\"cid:{cid}\" width=\"{Math.Min(width, 800u)}\" alt=\"{WebUtility.HtmlEncode(el.Attribute("alt")?.Value ?? "Invitation image")}\" style=\"max-width:100%;height:auto;display:block;margin:12px 0\" />";
            }
            var inner = string.Concat(el.Nodes().Select(n => Render(n, depth + 1)));
            if (!allowed.Contains(tag)) return inner;
            var attrs = "";
            if (tag == "a")
            {
                var href = el.Attribute("href")?.Value ?? "";
                if (!Uri.TryCreate(href, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https" or "mailto")) return inner;
                attrs += $" href=\"{WebUtility.HtmlEncode(uri.AbsoluteUri)}\"";
            }
            var styles = new List<string>();
            foreach (var style in (el.Attribute("style")?.Value ?? "").Split(';'))
            {
                var parts = style.Split(':', 2);
                if (parts.Length != 2) continue;
                var property = parts[0].Trim().ToLowerInvariant(); var value = parts[1].Trim().ToLowerInvariant();
                if ((property == "text-align" && value is "left" or "center" or "right") ||
                    (property == "font-weight" && value is "bold" or "400" or "600" or "700") ||
                    (property == "font-style" && value is "italic" or "normal") ||
                    (property == "text-decoration" && value is "underline" or "line-through") ||
                    (property == "color" && System.Text.RegularExpressions.Regex.IsMatch(value, "^#[0-9a-f]{3}([0-9a-f]{3})?$")))
                    styles.Add(property + ":" + value);
            }
            if (styles.Count > 0) attrs += " style=\"" + string.Join(';', styles) + "\"";
            return tag == "br" ? "<br />" : $"<{tag}{attrs}>{inner}</{tag}>";
        }
        var rendered = string.Concat(document.Root.Nodes().Select(n => Render(n, 0)));
        return (rendered, images);
    }
}
