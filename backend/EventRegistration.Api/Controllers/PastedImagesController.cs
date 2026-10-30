using System.ComponentModel.DataAnnotations;
using EventRegistration.Api.Models;
using EventRegistration.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace EventRegistration.Api.Controllers;

// Copies an image pasted into a message editor when its site blocks the browser from reading it.
// The editor re-encodes the result as PNG like any other image.
[ApiController]
[Route("api/pasted-images")]
[Authorize(Roles = Roles.Admin + "," + Roles.SuperAdmin)]
public class PastedImagesController(PastedImageFetcher fetcher) : ControllerBase
{
    [HttpPost]
    public async Task<IActionResult> Fetch(PastedImageRequest req, CancellationToken ct)
    {
        if (!Uri.TryCreate(req.Url.Trim(), UriKind.Absolute, out var url) || url.Scheme is not ("https" or "http"))
            return BadRequest(new { message = "Only http and https image links can be copied." });
        var image = await fetcher.FetchAsync(url, ct);
        if (image is null) return UnprocessableEntity(new { message = "This image couldn't be copied from its site." });
        Response.Headers.XContentTypeOptions = "nosniff";
        return File(image.Value.Bytes, image.Value.ContentType);
    }
}

public record PastedImageRequest([Required, MaxLength(4096)] string Url);
