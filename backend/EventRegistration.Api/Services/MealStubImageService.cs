using SkiaSharp;

namespace EventRegistration.Api.Services;

/// <summary>
/// Renders a complete meal-stub ticket as a single PNG. The layout is intentionally a printable
/// ticket: a white information panel, dashed cut guides, and a coloured tear-off claim tab.
/// Being one image, it renders identically in every email client and Viber.
/// </summary>
public class MealStubImageService
{
    private readonly QrService _qr;
    public MealStubImageService(QrService qr) => _qr = qr;

    // Design canvas (logical px); rendered at 2x for crisp QR modules and type.
    // Its 2.44:1 ratio matches the landscape meal-stub artwork used in notifications.
    private const int W = 1000, H = 410, Scale = 2;

    public byte[] Render(string colorHex, string eventTitle, string? bannerDataUrl,
        string validityText, decimal denomination, Guid controlNumber)
    {
        var color = ParseColor(colorHex);
        var controlShort = controlNumber.ToString("N")[..8].ToUpperInvariant();
        var qrPng = _qr.GeneratePng($"MEAL:{controlNumber}");

        using var bmp = new SKBitmap(W * Scale, H * Scale);
        using var canvas = new SKCanvas(bmp);
        canvas.Clear(SKColors.Transparent);
        canvas.Scale(Scale);

        const int tabW = 280;
        const float outerInset = 16;
        const float guideInset = 30;
        var bodyRight = W - tabW;
        var white = SKColors.White;
        var ink = SKColors.Black;

        using var colorFill = new SKPaint { Color = color, IsAntialias = true, Style = SKPaintStyle.Fill };
        using var whiteFill = new SKPaint { Color = white, IsAntialias = true, Style = SKPaintStyle.Fill };

        // Solid coloured stock, with a white information panel at the left.
        canvas.DrawRect(new SKRect(0, 0, W, H), colorFill);
        var card = new SKRect(outerInset, outerInset, bodyRight, H - outerInset);
        canvas.DrawRect(card, whiteFill);

        // Dashed cut guide around the information panel and detachable tab.
        using (var guide = new SKPaint
        {
            Color = color, IsAntialias = true, StrokeWidth = 2, Style = SKPaintStyle.Stroke,
            PathEffect = SKPathEffect.CreateDash(new[] { 9f, 7f }, 0),
        })
        {
            canvas.DrawRoundRect(new SKRect(guideInset, guideInset, bodyRight - guideInset, H - guideInset), 26, 26, guide);
        }
        using (var tabGuide = new SKPaint
        {
            Color = white, IsAntialias = true, StrokeWidth = 2, Style = SKPaintStyle.Stroke,
            PathEffect = SKPathEffect.CreateDash(new[] { 9f, 7f }, 0),
        })
        {
            canvas.DrawRoundRect(new SKRect(bodyRight + 34, guideInset, W - guideInset, H - guideInset), 22, 22, tabGuide);
        }

        // Event mark at the upper left, preserving the supplied artwork's aspect ratio.
        var banner = DecodeDataUrl(bannerDataUrl);
        const float contentLeft = 58f;
        if (banner is not null)
        {
            const float maxH = 220, maxW = 300;
            var s = Math.Min(maxH / banner.Height, maxW / banner.Width);
            var bw = banner.Width * s;
            var bh = banner.Height * s;
            var dest = new SKRect(contentLeft, 48, contentLeft + bw, 48 + bh);
            using var imgPaint = new SKPaint { IsAntialias = true, FilterQuality = SKFilterQuality.High };
            canvas.DrawBitmap(banner, dest, imgPaint);
            banner.Dispose();
        }
        else
        {
            DrawTextFit(canvas, eventTitle, contentLeft, 125, 30, color, 275, bold: true);
        }

        // QR and compact control number in the upper centre.
        using (var qrBmp = SKBitmap.Decode(qrPng))
        {
            // Keep the enlarged QR high enough that its control number clears the title below.
            const float qrSize = 160, qrX = 450, qrY = 40;
            using var imgPaint = new SKPaint { IsAntialias = false, FilterQuality = SKFilterQuality.None };
            canvas.DrawBitmap(qrBmp, new SKRect(qrX, qrY, qrX + qrSize, qrY + qrSize), imgPaint);
            DrawTextCentered(canvas, controlShort, qrX + qrSize / 2, qrY + qrSize + 21, 16,
                new SKColor(0x33, 0x33, 0x33), bold: false);
        }

        DrawText(canvas, "MEAL STUB", 320, 270, 54, ink, bold: true);

        // Validity bar across the bottom of the information panel.
        var bar = new SKRect(58, 309, bodyRight - 58, 362);
        canvas.DrawRect(bar, colorFill);
        DrawTextFit(canvas, validityText, bar.Left + 12, bar.MidY, 28,
            white, bar.Width - 24, bold: true);

        // Perforation separating the claim tab from the body.
        using (var dash = new SKPaint
        {
            Color = white, IsAntialias = true, StrokeWidth = 2, Style = SKPaintStyle.Stroke,
            PathEffect = SKPathEffect.CreateDash(new[] { 10f, 8f }, 0),
        })
        {
            canvas.DrawLine(bodyRight, outerInset, bodyRight, H - outerInset, dash);
        }

        // Claim value is deliberately black and vertical, as on a physical meal coupon.
        var tabCx = bodyRight + tabW / 2f;
        var tabCy = H / 2f;
        canvas.Save();
        canvas.Translate(tabCx, tabCy);
        canvas.RotateDegrees(-90);
        using (var peso = PesoType())
            DrawTextCentered(canvas, $"₱ {denomination:0.00}", 0, 0, 42, ink, bold: true, vCenter: true, face: peso);
        canvas.Restore();

        using var image = SKImage.FromBitmap(bmp);
        using var data = image.Encode(SKEncodedImageFormat.Png, 100);
        return data.ToArray();
    }

    // The "VALID ON …" phrase for a stub's date range (inclusive), shown on the stub.
    public static string ValidityLabel(DateTime from, DateTime to)
    {
        var f = from.Date;
        var t = to.Date;
        string label = f == t
            ? $"VALID ON {f:MMMM d, yyyy}"
            : f.Year == t.Year
                ? $"VALID {f:MMM d} – {t:MMM d, yyyy}"
                : $"VALID {f:MMM d, yyyy} – {t:MMM d, yyyy}";
        return label.ToUpperInvariant();
    }

    private static SKColor ParseColor(string? hex)
    {
        if (!string.IsNullOrWhiteSpace(hex) && SKColor.TryParse(hex, out var c)) return c;
        return new SKColor(0x3f, 0x51, 0xb5);
    }

    private static SKBitmap? DecodeDataUrl(string? dataUrl)
    {
        if (string.IsNullOrEmpty(dataUrl)) return null;
        var idx = dataUrl.IndexOf("base64,", StringComparison.OrdinalIgnoreCase);
        if (idx < 0) return null;
        try { return SKBitmap.Decode(Convert.FromBase64String(dataUrl[(idx + 7)..])); }
        catch { return null; }
    }

    private static SKTypeface Type(bool bold) =>
        SKTypeface.FromFamilyName("Arial",
            bold ? SKFontStyleWeight.ExtraBold : SKFontStyleWeight.Normal,
            SKFontStyleWidth.Normal, SKFontStyleSlant.Upright) ?? SKTypeface.Default;

    private static SKTypeface PesoType() =>
        SKFontManager.Default.MatchCharacter("Arial", SKFontStyleWeight.ExtraBold,
            SKFontStyleWidth.Normal, SKFontStyleSlant.Upright, null, 0x20B1) ?? Type(true);

    private static void DrawText(SKCanvas c, string text, float x, float baseline, float size, SKColor color, bool bold)
    {
        using var p = new SKPaint { Color = color, IsAntialias = true, TextSize = size, Typeface = Type(bold), TextAlign = SKTextAlign.Left };
        c.DrawText(text, x, baseline, p);
    }

    private static void DrawTextCentered(SKCanvas c, string text, float cx, float cy, float size, SKColor color, bool bold, bool vCenter = false, SKTypeface? face = null)
    {
        using var p = new SKPaint { Color = color, IsAntialias = true, TextSize = size, Typeface = face ?? Type(bold), TextAlign = SKTextAlign.Center };
        var baseline = cy;
        if (vCenter) { var m = p.FontMetrics; baseline = cy - (m.Ascent + m.Descent) / 2; }
        c.DrawText(text, cx, baseline, p);
    }

    // Draws left-aligned text vertically centred at midY, shrinking the font to fit one line.
    private static void DrawTextFit(SKCanvas c, string text, float x, float midY, float size, SKColor color, float maxWidth, bool bold)
    {
        using var p = new SKPaint { Color = color, IsAntialias = true, TextSize = size, Typeface = Type(bold), TextAlign = SKTextAlign.Left };
        while (p.TextSize > 9 && p.MeasureText(text) > maxWidth) p.TextSize -= 1;
        var m = p.FontMetrics;
        c.DrawText(text, x, midY - (m.Ascent + m.Descent) / 2, p);
    }
}
