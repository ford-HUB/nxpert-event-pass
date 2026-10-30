using System.Collections.Concurrent;
using System.Text.Json;
using EventRegistration.Api.Controllers;
using EventRegistration.Api.Data;
using EventRegistration.Api.Models;
using EventRegistration.Api.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using MimeKit;

// Run with: dotnet run --project backend/EventRegistration.EmailTests
// Uses an isolated disposable LocalDB database and an in-process mail transport.
// No real recipients are contacted; MIME is built by the production EmailService.
var database = "NxPassInvitationEmailTests_" + Guid.NewGuid().ToString("N");
var connection = $@"Server=(localdb)\MSSQLLocalDB;Database={database};Trusted_Connection=True;TrustServerCertificate=True";
var transport = new TestTransport();
var services = new ServiceCollection();
services.AddLogging();
services.AddDbContext<AppDbContext>(o => o.UseSqlServer(connection));
services.AddSingleton<IConfiguration>(new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> {
    ["App:FrontendBaseUrl"] = "https://events.example.test",
}).Build());
services.AddSingleton(new EmailSettings { FromAddress = "sender@example.test", FromName = "Email Tests" });
services.AddSingleton<IWebHostEnvironment>(new TestEnvironment());
services.AddScoped<SettingsService>();
services.AddSingleton(transport);
services.AddScoped<EmailService, TestEmailService>();
services.AddScoped<InvitationEmailDispatcher>();
services.AddScoped<InvitationsController>();
using var provider = services.BuildServiceProvider();
var checks = 0;
void Check(bool condition, string description)
{
    if (!condition) throw new Exception("FAIL: " + description);
    checks++;
    Console.WriteLine("PASS: " + description);
}
JsonElement Json(IActionResult result) => JsonSerializer.SerializeToElement(((OkObjectResult)result).Value,
    new JsonSerializerOptions(JsonSerializerDefaults.Web));
InvitationEmailUpdateRequest Edit(InvitationEmail row, DateTimeOffset? date) => new(
    ["primary@gmail.com"], ["copy@n-pax.com", "PRIMARY@gmail.com"], "Updated subject", "<div><b>Updated body</b></div>", date,
    Convert.ToBase64String(row.Version));
async Task Dispatch(int id)
{
    using var scope = provider.CreateScope();
    await scope.ServiceProvider.GetRequiredService<InvitationEmailDispatcher>().DispatchAsync(id);
}

try
{
    using var scope = provider.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    await db.Database.MigrateAsync();
    Check(!db.Database.HasPendingModelChanges(), "Migration snapshot matches the current model");
    var ev = new Event { Title = "Scheduler test", PublicSlug = "scheduler-test", Venue = "Cebu",
        StartsAt = DateTime.Today.AddDays(2).AddHours(9), EndsAt = DateTime.Today.AddDays(2).AddHours(11) };
    var other = new Event { Title = "Other event", PublicSlug = "other-event" };
    db.Events.AddRange(ev, other);
    db.Users.Add(new User { Username = "directory", Email = "directory@n-pax.com", FullName = "Directory contact" });
    await db.SaveChangesAsync();
    var controller = scope.ServiceProvider.GetRequiredService<InvitationsController>();
    var tomorrowPh = DateTimeOffset.UtcNow.ToOffset(TimeSpan.FromHours(8)).AddDays(1);
    const string image = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/L9sAAAAASUVORK5CYII=";
    var request = new InvitationComposeRequest(["PRIMARY@gmail.com"], ["copy@n-pax.com", "primary@gmail.com"],
        "Schedule test", "<div><script>alert(1)</script><b>Welcome</b><img src=\"data:image/png;base64," + image + "\" /></div>", tomorrowPh);
    Check(await controller.Compose(ev.Id, request with { ScheduledAt = DateTimeOffset.UtcNow.AddMinutes(-1) }) is BadRequestObjectResult,
        "Past schedules are rejected");
    Check(await controller.Compose(ev.Id, request with { To = ["invalid"] }) is BadRequestObjectResult,
        "Invalid recipient is rejected");
    var result = Json(await controller.Compose(ev.Id, request));
    var id = result.GetProperty("id").GetInt32();
    db.ChangeTracker.Clear();
    var row = await db.InvitationEmails.SingleAsync(m => m.Id == id);
    Check(row.Status == "Scheduled" && row.ScheduledAt == tomorrowPh.ToUniversalTime() && row.SentAt is null && transport.Messages.IsEmpty,
        "Future schedule persists in UTC without sending early");
    Check(!row.BodyHtml.Contains("script") && row.BodyHtml.Contains("data:image/png;base64,"),
        "Stored body is sanitized and inline images remain editable");
    var list = Json(await controller.EmailHistory(ev.Id));
    Check(list.GetArrayLength() == 1 && !list[0].TryGetProperty("bodyHtml", out _), "History lists saved messages without large bodies");
    Check(await controller.OpenEmail(other.Id, id) is NotFoundResult, "History detail is scoped to its event");
    Check(Json(await controller.OpenEmail(ev.Id, id)).GetProperty("bodyHtml").GetString() == row.BodyHtml,
        "Opening email returns the saved message");
    var firstEdit = Edit(row, tomorrowPh.AddHours(2));
    Check(await controller.UpdateEmail(ev.Id, id, firstEdit) is OkObjectResult, "Scheduled recipients, subject, body and date can be edited");
    Check(await controller.UpdateEmail(ev.Id, id, firstEdit) is ConflictObjectResult, "Stale edits cannot overwrite a newer version");
    db.ChangeTracker.Clear();
    row = await db.InvitationEmails.SingleAsync(m => m.Id == id);
    Check(row.Subject == "Updated subject" && row.BodyHtml.Contains("Updated body") && row.ScheduledAt == tomorrowPh.AddHours(2),
        "Edited values persist in the database");
    await Dispatch(id);
    Check(transport.Messages.IsEmpty, "Worker refuses to send future messages");
    await db.InvitationEmails.Where(m => m.Id == id).ExecuteUpdateAsync(s => s.SetProperty(m => m.NextAttemptAt, DateTimeOffset.UtcNow.AddSeconds(-1)));
    await Task.WhenAll(Dispatch(id), Dispatch(id));
    db.ChangeTracker.Clear();
    row = await db.InvitationEmails.SingleAsync(m => m.Id == id);
    Check(row.Status == "Sent" && row.SentAt != null && transport.Messages.Count == 1,
        "Concurrent dispatchers deliver a due message once and record the sent timestamp");
    var mime = transport.Messages.Single();
    Check(mime.To.Mailboxes.Single().Address == "primary@gmail.com" && mime.Cc.Mailboxes.Single().Address == "copy@n-pax.com",
        "Gmail and company addresses appear in the actual MIME To/CC headers, with duplicates removed");
    Check(mime.BodyParts.Any(p => p.ContentType.MimeType == "text/calendar" && p.ContentType.Parameters["method"] == "REQUEST"),
        "Delivered MIME includes the calendar invitation");
    Check(await controller.UpdateEmail(ev.Id, id, Edit(row, tomorrowPh)) is ConflictObjectResult,
        "Sent emails cannot be overwritten");

    var cancelledId = Json(await controller.Compose(ev.Id, request)).GetProperty("id").GetInt32();
    db.ChangeTracker.Clear();
    var cancelled = await db.InvitationEmails.SingleAsync(m => m.Id == cancelledId);
    Check(await controller.CancelEmail(ev.Id, cancelledId, new(Convert.ToBase64String(cancelled.Version))) is NoContentResult,
        "Scheduled emails can be cancelled");
    await db.InvitationEmails.Where(m => m.Id == cancelledId).ExecuteUpdateAsync(s => s.SetProperty(m => m.NextAttemptAt, DateTimeOffset.UtcNow.AddSeconds(-1)));
    await Dispatch(cancelledId);
    Check(transport.Messages.Count == 1, "Cancelled email is never sent");

    transport.Delivery = EmailDeliveryStatus.Queued;
    var queuedId = Json(await controller.Compose(ev.Id, request with { ScheduledAt = null })).GetProperty("id").GetInt32();
    db.ChangeTracker.Clear();
    var queued = await db.InvitationEmails.SingleAsync(m => m.Id == queuedId);
    Check(queued.Status == "Queued" && queued.SentAt == null && queued.LastError != null && queued.NextAttemptAt > DateTimeOffset.UtcNow,
        "SMTP unavailability is recorded as queued, not sent, with a retry time");
    transport.Delivery = EmailDeliveryStatus.Sent;
    await db.InvitationEmails.Where(m => m.Id == queuedId).ExecuteUpdateAsync(s => s.SetProperty(m => m.NextAttemptAt, DateTimeOffset.UtcNow.AddSeconds(-1)));
    await Dispatch(queuedId);
    db.ChangeTracker.Clear();
    queued = await db.InvitationEmails.SingleAsync(m => m.Id == queuedId);
    Check(queued.Status == "Sent" && queued.Attempts == 2 && queued.LastError is null, "Queued email is delivered when SMTP recovers");

    var imageId = Json(await controller.Compose(ev.Id, request with { ScheduledAt = null })).GetProperty("id").GetInt32();
    Check(transport.Messages.Last().BodyParts.Any(p => p.ContentId == "invitation-image-1"), "Inline image survives storage and dispatch as a MIME CID part");
    var groupId = Json(await controller.Compose(ev.Id, request with { To = ["@n-pax"], Cc = [], ScheduledAt = tomorrowPh })).GetProperty("id").GetInt32();
    db.Users.Add(new User { Username = "later", Email = "later@n-pax.com", FullName = "Later contact" });
    await db.SaveChangesAsync();
    var group = await db.InvitationEmails.AsNoTracking().SingleAsync(m => m.Id == groupId);
    Check(group.ToJson.Contains("directory@n-pax.com") && !group.ToJson.Contains("later@n-pax.com"),
        "Group recipients are frozen at schedule time");

    var retryId = Json(await controller.Compose(ev.Id, request)).GetProperty("id").GetInt32();
    await db.InvitationEmails.Where(m => m.Id == retryId).ExecuteUpdateAsync(s => s
        .SetProperty(m => m.Status, "Queued").SetProperty(m => m.Attempts, 4)
        .SetProperty(m => m.NextAttemptAt, DateTimeOffset.UtcNow.AddSeconds(-1)));
    transport.Delivery = EmailDeliveryStatus.Queued;
    await Dispatch(retryId);
    Check((await db.InvitationEmails.AsNoTracking().SingleAsync(m => m.Id == retryId)).Status == "Failed",
        "Repeated SMTP failures stop after five attempts and remain visible for editing");
    transport.Delivery = EmailDeliveryStatus.Sent;

    db.Users.AddRange(Enumerable.Range(0, 501).Select(n => new User {
        Username = $"bulk-{n}", Email = $"bulk-{n}@n-pax.com", FullName = $"Bulk contact {n}",
    }));
    await db.SaveChangesAsync();
    var bulkId = Json(await controller.Compose(ev.Id, request with { To = ["@n-pax"], Cc = [], ScheduledAt = tomorrowPh }))
        .GetProperty("id").GetInt32();
    db.ChangeTracker.Clear();
    var bulk = await db.InvitationEmails.SingleAsync(m => m.Id == bulkId);
    var bulkRecipients = JsonSerializer.Deserialize<List<string>>(bulk.ToJson)!;
    Check(bulkRecipients.Count > 500 && await controller.UpdateEmail(ev.Id, bulkId, new(bulkRecipients, [],
        "Large directory", "<div>Updated group message</div>", tomorrowPh, Convert.ToBase64String(bulk.Version))) is OkObjectResult,
        "Expanded directory groups with over 500 recipients remain editable");
    await db.InvitationEmails.Where(m => m.Id == bulkId).ExecuteUpdateAsync(s => s.SetProperty(m => m.NextAttemptAt, DateTimeOffset.UtcNow.AddSeconds(-1)));
    await Dispatch(bulkId);
    Check(transport.Messages.Last().To.Count == bulkRecipients.Count &&
        (await db.InvitationEmails.AsNoTracking().SingleAsync(m => m.Id == bulkId)).Status == "Sent",
        "Large frozen directory groups are dispatched without the composer entry limit");

    var backgroundId = Json(await controller.Compose(ev.Id, request)).GetProperty("id").GetInt32();
    await db.InvitationEmails.Where(m => m.Id == backgroundId).ExecuteUpdateAsync(s => s.SetProperty(m => m.NextAttemptAt, DateTimeOffset.UtcNow.AddSeconds(-1)));
    var interrupted = new InvitationEmail { EventId = ev.Id, Subject = "Interrupted", Status = "Sending",
        LastAttemptAt = DateTimeOffset.UtcNow.AddMinutes(-20), NextAttemptAt = DateTimeOffset.UtcNow };
    db.InvitationEmails.Add(interrupted);
    await db.SaveChangesAsync();
    using var scheduler = new InvitationEmailScheduler(provider.GetRequiredService<IServiceScopeFactory>(), NullLogger<InvitationEmailScheduler>.Instance);
    await scheduler.StartAsync(CancellationToken.None);
    var deadline = DateTime.UtcNow.AddSeconds(10);
    while (DateTime.UtcNow < deadline)
    {
        if ((await db.InvitationEmails.AsNoTracking().SingleAsync(m => m.Id == backgroundId)).Status == "Sent") break;
        await Task.Delay(100);
    }
    await scheduler.StopAsync(CancellationToken.None);
    Check((await db.InvitationEmails.AsNoTracking().SingleAsync(m => m.Id == backgroundId)).Status == "Sent",
        "Hosted scheduler automatically delivers persisted due mail without an open browser");
    Check((await db.InvitationEmails.AsNoTracking().SingleAsync(m => m.Id == interrupted.Id)).Status == "Failed",
        "Interrupted deliveries require manual review instead of risking automatic duplicates");
    Console.WriteLine($"All {checks} checks passed.");
}
finally
{
    using var cleanup = provider.CreateScope();
    await cleanup.ServiceProvider.GetRequiredService<AppDbContext>().Database.EnsureDeletedAsync();
}

sealed class TestTransport
{
    public ConcurrentQueue<MimeMessage> Messages { get; } = new();
    public EmailDeliveryStatus Delivery { get; set; } = EmailDeliveryStatus.Sent;
}
sealed class TestEmailService(EmailSettings settings, SettingsService appSettings, IWebHostEnvironment environment, TestTransport transport)
    : EmailService(settings, NullLogger<EmailService>.Instance, appSettings, environment)
{
    public override async Task<EmailDeliveryStatus> SendMessageAsync(IReadOnlyCollection<string> to, IReadOnlyCollection<string> cc,
        string subject, string htmlBody, byte[]? inlineQrPng = null, string cid = "qrcode",
        IReadOnlyDictionary<string, byte[]>? inlineImages = null, IReadOnlyList<EmailAttachment>? attachments = null, bool includeDefaultCc = false)
    {
        transport.Messages.Enqueue(await BuildMessageAsync(to, cc, subject, htmlBody, inlineQrPng, cid, inlineImages, attachments, includeDefaultCc));
        return transport.Delivery;
    }
}
sealed class TestEnvironment : IWebHostEnvironment
{
    public string EnvironmentName { get; set; } = "Test";
    public string ApplicationName { get; set; } = "EmailTests";
    public string ContentRootPath { get; set; } = Path.GetTempPath();
    public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    public string WebRootPath { get; set; } = Path.GetTempPath();
    public IFileProvider WebRootFileProvider { get; set; } = new NullFileProvider();
}
