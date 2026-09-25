using QRCoder;

namespace EventRegistration.Api.Services;

public class QrService
{
    /// <summary>Generates a PNG QR code for the given payload. Returns raw PNG bytes.</summary>
    public byte[] GeneratePng(string payload, int pixelsPerModule = 10)
    {
        using var generator = new QRCodeGenerator();
        using var data = generator.CreateQrCode(payload, QRCodeGenerator.ECCLevel.Q);
        var png = new PngByteQRCode(data);
        return png.GetGraphic(pixelsPerModule);
    }
}
