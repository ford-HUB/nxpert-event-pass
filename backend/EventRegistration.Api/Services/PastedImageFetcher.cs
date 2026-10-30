using System.Net;
using System.Net.Sockets;

namespace EventRegistration.Api.Services;

// Downloads an image pasted into a message editor when the browser can't read it itself (the
// source site blocks cross-site reads). Every connection, redirects included, may only reach a
// public address on port 80 or 443, so the API can't be used to probe its own network.
public sealed class PastedImageFetcher : IDisposable
{
    public const int MaxBytes = 10 * 1024 * 1024;

    private readonly HttpClient _http;

    public PastedImageFetcher()
    {
        var handler = new SocketsHttpHandler
        {
            AllowAutoRedirect = true,
            MaxAutomaticRedirections = 3,
            UseCookies = false,
            // A proxy would make the connection, bypassing the address check below.
            UseProxy = false,
            ConnectTimeout = TimeSpan.FromSeconds(5),
            ConnectCallback = ConnectPublicAsync,
        };
        _http = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(15) };
        _http.DefaultRequestHeaders.UserAgent.ParseAdd("Mozilla/5.0 (compatible; NXPass image copy)");
        _http.DefaultRequestHeaders.Accept.ParseAdd("image/png,image/jpeg,image/webp,image/gif,image/bmp;q=0.9,*/*;q=0.1");
    }

    /// <summary>The image bytes and their sniffed type, or null when it can't be copied.</summary>
    public async Task<(byte[] Bytes, string ContentType)?> FetchAsync(Uri url, CancellationToken ct)
    {
        if (url.Scheme is not ("https" or "http")) return null;
        try
        {
            using var response = await _http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, ct);
            if (!response.IsSuccessStatusCode || response.Content.Headers.ContentLength > MaxBytes) return null;
            await using var stream = await response.Content.ReadAsStreamAsync(ct);
            using var buffer = new MemoryStream();
            var chunk = new byte[81920];
            int read;
            while ((read = await stream.ReadAsync(chunk, ct)) > 0)
            {
                if (buffer.Length + read > MaxBytes) return null;
                buffer.Write(chunk, 0, read);
            }
            var bytes = buffer.ToArray();
            // Trust the bytes, not the header: some sites send images as octet-stream, and
            // anything that isn't a plain raster image (SVG, HTML) is refused.
            return SniffImageType(bytes) is { } type ? (bytes, type) : null;
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException or SocketException or IOException)
        {
            return null;
        }
    }

    private static string? SniffImageType(byte[] b)
    {
        if (b.Length < 12) return null;
        if (b[0] == 0x89 && b[1] == 0x50 && b[2] == 0x4E && b[3] == 0x47) return "image/png";
        if (b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF) return "image/jpeg";
        if (b[0] == 0x47 && b[1] == 0x49 && b[2] == 0x46 && b[3] == 0x38) return "image/gif";
        if (b[0] == 0x52 && b[1] == 0x49 && b[2] == 0x46 && b[3] == 0x46 && b[8] == 0x57 && b[9] == 0x45 && b[10] == 0x42 && b[11] == 0x50) return "image/webp";
        if (b[0] == 0x42 && b[1] == 0x4D) return "image/bmp";
        return null;
    }

    private static async ValueTask<Stream> ConnectPublicAsync(SocketsHttpConnectionContext context, CancellationToken ct)
    {
        var endPoint = context.DnsEndPoint;
        if (endPoint.Port is not (80 or 443)) throw new HttpRequestException("Only ports 80 and 443 are allowed.");
        var addresses = await Dns.GetHostAddressesAsync(endPoint.Host, ct);
        // Connect to the checked addresses themselves, so a second DNS answer can't swap them.
        if (addresses.Length == 0 || !addresses.All(IsPublic)) throw new HttpRequestException("Only public addresses are allowed.");
        var socket = new Socket(SocketType.Stream, ProtocolType.Tcp) { NoDelay = true };
        try
        {
            await socket.ConnectAsync(addresses, endPoint.Port, ct);
            return new NetworkStream(socket, ownsSocket: true);
        }
        catch
        {
            socket.Dispose();
            throw;
        }
    }

    private static bool IsPublic(IPAddress ip)
    {
        if (ip.IsIPv4MappedToIPv6) ip = ip.MapToIPv4();
        if (IPAddress.IsLoopback(ip)) return false;
        var b = ip.GetAddressBytes();
        if (ip.AddressFamily == AddressFamily.InterNetwork)
            return !(b[0] is 0 or 10 or 127 || b[0] >= 224
                || (b[0] == 100 && b[1] is >= 64 and < 128)     // carrier-grade NAT
                || (b[0] == 169 && b[1] == 254)                  // link-local, cloud metadata
                || (b[0] == 172 && b[1] is >= 16 and < 32)
                || (b[0] == 192 && b[1] == 168)
                || (b[0] == 192 && b[1] == 0 && b[2] == 0)
                || (b[0] == 198 && b[1] is 18 or 19));
        if (ip.AddressFamily == AddressFamily.InterNetworkV6)
            return !(ip.Equals(IPAddress.IPv6Any) || ip.IsIPv6LinkLocal || ip.IsIPv6SiteLocal || ip.IsIPv6Multicast
                || ip.IsIPv6UniqueLocal || ip.IsIPv6Teredo
                || (b[0] == 0x20 && b[1] == 0x02)                // 6to4 wraps an IPv4 address
                || (b[0] == 0x00 && b[1] == 0x64 && b[2] == 0xFF && b[3] == 0x9B)); // NAT64
        return false;
    }

    public void Dispose() => _http.Dispose();
}
