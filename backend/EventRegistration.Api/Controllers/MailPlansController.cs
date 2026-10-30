using System.Text.Json;
using System.Text.RegularExpressions;
using EventRegistration.Api.Data;
using EventRegistration.Api.Models;
using EventRegistration.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace EventRegistration.Api.Controllers;

// Mail planner (organizers): plans with target days, each with its own mail, sent to receiver lists.
[ApiController]
[Route("api/mail-plans")]
[Authorize(Roles = Roles.Admin + "," + Roles.SuperAdmin)]
public class MailPlansController(AppDbContext db, MailPlanAudience audience, MailPlanDispatcher dispatcher) : ControllerBase
{
    private const int MaxDays = 60;
    private const int MaxEmails = 200;
    private const int MaxCc = 50;
    private const int MaxGroups = 50;
    private const int MaxBodyText = 4000;
    private static readonly TimeSpan PhOffset = TimeSpan.FromHours(8);

    // Plans with their days; bodies stay out of the list (they can carry several MB of images).
    [HttpGet]
    public async Task<IActionResult> List()
    {
        var plans = await db.MailPlans.AsNoTracking()
            .OrderByDescending(p => p.UpdatedAt)
            .Select(p => new MailPlan {
                Id = p.Id, Kind = p.Kind, EventId = p.EventId, EventName = p.EventName, Channel = p.Channel, Draft = p.Draft,
                GroupIdsJson = p.GroupIdsJson, EmailsJson = p.EmailsJson, CcJson = p.CcJson, CreatedByUserId = p.CreatedByUserId,
                CreatedAt = p.CreatedAt, UpdatedAt = p.UpdatedAt, Version = p.Version,
                Sends = p.Sends.OrderBy(s => s.SendAt).Select(s => new MailPlanSend {
                    Id = s.Id, PlanId = s.PlanId, SendAt = s.SendAt, Subject = s.Subject, PreviewText = s.PreviewText,
                    ImageCount = s.ImageCount, Status = s.Status, SentAt = s.SentAt, RecipientCount = s.RecipientCount,
                    LastError = s.LastError, Attempts = s.Attempts, NextAttemptAt = s.NextAttemptAt,
                }).ToList(),
            }).ToListAsync();
        return Ok(plans.Select(p => PlanDto(p, withBodies: false)));
    }

    // One plan with every day's full message, for editing.
    [HttpGet("{id:int}")]
    public async Task<IActionResult> Get(int id)
    {
        var plan = await db.MailPlans.AsNoTracking().Include(p => p.Sends).SingleOrDefaultAsync(p => p.Id == id);
        return plan is null ? NotFound() : Ok(PlanDto(plan, withBodies: true));
    }

    [HttpGet("sends/{sendId:int}/body")]
    public async Task<IActionResult> Body(int sendId)
    {
        var body = await db.MailPlanSends.AsNoTracking().Where(s => s.Id == sendId).Select(s => s.BodyHtml).SingleOrDefaultAsync();
        return body is null ? NotFound() : Ok(new { bodyHtml = body });
    }

    // Event names and receiver lists for the plan form.
    [HttpGet("options")]
    public async Task<IActionResult> Options()
    {
        var since = DateTime.Now.AddDays(-30);
        var events = await db.Events.AsNoTracking().Where(e => e.EndsAt >= since).OrderBy(e => e.StartsAt)
            .Select(e => e.Title).Take(100).ToListAsync();
        var saved = await db.MailPlanEventNames.AsNoTracking().Select(n => n.Name).ToListAsync();
        var used = await db.MailPlans.AsNoTracking().Where(p => p.EventName != null).Select(p => p.EventName!).Distinct().ToListAsync();
        var known = events.ToHashSet(StringComparer.OrdinalIgnoreCase);
        return Ok(new {
            events = events.Distinct(StringComparer.OrdinalIgnoreCase),
            savedEvents = saved.Concat(used).Where(known.Add).Order(StringComparer.OrdinalIgnoreCase),
            groups = await audience.GroupsAsync(),
            savedCc = await db.MailPlanSavedCcs.AsNoTracking().OrderBy(c => c.Email).Select(c => c.Email).ToListAsync(),
        });
    }

    // Saved CC addresses: offered in the CC dropdown; typing a new address still works.
    [HttpPost("saved-cc")]
    public async Task<IActionResult> SaveCc(MailSavedCcRequest req)
    {
        var email = InvitationMessageBuilder.Address(req.Email);
        if (email is null) return BadRequest(new { message = "Enter a valid email address." });
        if (!await db.MailPlanSavedCcs.AnyAsync(c => c.Email == email))
        {
            if (await db.MailPlanSavedCcs.CountAsync() >= 500)
                return BadRequest(new { message = "The saved CC list is full (500). Remove addresses you no longer use." });
            db.MailPlanSavedCcs.Add(new MailPlanSavedCc { Email = email });
            try { await db.SaveChangesAsync(); }
            catch (DbUpdateException) { /* Saved at the same time by someone else. */ }
        }
        return Ok(new { email });
    }

    [HttpDelete("saved-cc")]
    public async Task<IActionResult> RemoveSavedCc([FromQuery] string? email)
    {
        var address = InvitationMessageBuilder.Address(email);
        if (address is not null) await db.MailPlanSavedCcs.Where(c => c.Email == address).ExecuteDeleteAsync();
        return NoContent();
    }

    [HttpPost("event-names")]
    public async Task<IActionResult> SaveEventName(MailEventNameRequest req)
    {
        var name = CleanEventName(req.Name);
        if (name is null) return BadRequest(new { message = "Enter an event name of up to 200 characters." });
        if (!await db.MailPlanEventNames.AnyAsync(n => n.Name == name))
        {
            db.MailPlanEventNames.Add(new MailPlanEventName { Name = name });
            try { await db.SaveChangesAsync(); }
            catch (DbUpdateException) { /* Saved at the same time by someone else. */ }
        }
        return Ok(new { name });
    }

    [HttpPost]
    [RequestSizeLimit(40_000_000)]
    public async Task<IActionResult> Create(MailPlanRequest req)
    {
        var plan = new MailPlan { CreatedByUserId = this.UserId() };
        string? error;
        try { error = await Apply(plan, req); }
        catch (InvalidOperationException ex) { return Conflict(new { message = ex.Message }); }
        if (error is not null) return BadRequest(new { message = error });
        db.MailPlans.Add(plan);
        await db.SaveChangesAsync();
        return Ok(PlanDto(plan, withBodies: false));
    }

    [HttpPut("{id:int}")]
    [RequestSizeLimit(40_000_000)]
    public async Task<IActionResult> Update(int id, MailPlanRequest req)
    {
        var plan = await db.MailPlans.Include(p => p.Sends).SingleOrDefaultAsync(p => p.Id == id);
        if (plan is null) return NotFound(new { message = "This plan no longer exists." });
        if (Convert.ToBase64String(plan.Version) != req.Version)
            return Conflict(new { message = "This plan was changed by someone else. Reopen it before editing." });
        string? error;
        try { error = await Apply(plan, req); }
        catch (InvalidOperationException ex) { return Conflict(new { message = ex.Message }); }
        if (error is not null) return BadRequest(new { message = error });
        try { await db.SaveChangesAsync(); }
        catch (DbUpdateConcurrencyException)
        {
            return Conflict(new { message = "A day of this plan started sending or was changed. Reopen the plan before editing." });
        }
        return Ok(PlanDto(plan, withBodies: false));
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        var plan = await db.MailPlans.Include(p => p.Sends).SingleOrDefaultAsync(p => p.Id == id);
        if (plan is null) return NoContent();
        if (plan.Sends.Any(s => s.Status == MailSendStatus.Sending))
            return Conflict(new { message = "A day of this plan is being sent right now. Try again in a minute." });
        db.MailPlans.Remove(plan);
        try { await db.SaveChangesAsync(); }
        catch (DbUpdateConcurrencyException) { return Conflict(new { message = "This plan started sending. Try again in a minute." }); }
        return NoContent();
    }

    // Removes a day that hasn't gone out; removing a plan's only day removes the plan.
    [HttpDelete("sends/{sendId:int}")]
    public async Task<IActionResult> DeleteSend(int sendId)
    {
        var send = await db.MailPlanSends.Include(s => s.Plan).ThenInclude(p => p!.Sends).SingleOrDefaultAsync(s => s.Id == sendId);
        if (send is null) return NoContent();
        if (send.Status is MailSendStatus.Sending or MailSendStatus.Sent)
            return Conflict(new { message = "This day has already gone out and stays in the plan's history." });
        var plan = send.Plan!;
        var planDeleted = plan.Sends.Count == 1;
        if (planDeleted) db.MailPlans.Remove(plan);
        else
        {
            db.MailPlanSends.Remove(send);
            plan.UpdatedAt = DateTimeOffset.UtcNow;
        }
        try { await db.SaveChangesAsync(); }
        catch (DbUpdateConcurrencyException) { return Conflict(new { message = "This day started sending. Refresh the planner." }); }
        return Ok(new { planDeleted });
    }

    [HttpPost("sends/{sendId:int}/send-now")]
    public async Task<IActionResult> SendNow(int sendId)
    {
        var send = await db.MailPlanSends.Include(s => s.Plan).SingleOrDefaultAsync(s => s.Id == sendId);
        if (send is null) return NotFound(new { message = "This day no longer exists. Refresh the planner." });
        if (send.Plan!.Draft) return BadRequest(new { message = "Finish this draft plan before sending it." });
        if (send.Status != MailSendStatus.Scheduled) return Conflict(new { message = "This day is already being sent or was sent." });
        send.SendAt = send.NextAttemptAt = DateTimeOffset.UtcNow;
        send.UpdatedAt = DateTimeOffset.UtcNow;
        return await SaveAndDispatch(send);
    }

    // Tries a failed or queued day again now; receivers it already reached are skipped.
    [HttpPost("sends/{sendId:int}/retry")]
    public async Task<IActionResult> Retry(int sendId)
    {
        var send = await db.MailPlanSends.Include(s => s.Plan).SingleOrDefaultAsync(s => s.Id == sendId);
        if (send is null) return NotFound(new { message = "This day no longer exists. Refresh the planner." });
        if (send.Status is not (MailSendStatus.Failed or MailSendStatus.Queued))
            return Conflict(new { message = "Only failed or queued days can be retried." });
        if (send.Plan!.Draft) return BadRequest(new { message = "Finish this draft plan before sending it." });
        send.Status = MailSendStatus.Queued;
        send.Attempts = 0;
        send.NextAttemptAt = send.UpdatedAt = DateTimeOffset.UtcNow;
        send.LastError = null;
        return await SaveAndDispatch(send);
    }

    private async Task<IActionResult> SaveAndDispatch(MailPlanSend send)
    {
        try { await db.SaveChangesAsync(); }
        catch (DbUpdateConcurrencyException) { return Conflict(new { message = "This day started sending. Refresh the planner." }); }
        await dispatcher.DispatchAsync(send.Id);
        var saved = await db.MailPlanSends.AsNoTracking().SingleAsync(s => s.Id == send.Id);
        return Ok(SendDto(saved, withBody: false));
    }

    // Validates the request and applies it to the plan. Days that have gone out (anything not
    // Scheduled) are kept as they are; Scheduled days are updated, added or removed to match.
    private async Task<string?> Apply(MailPlan plan, MailPlanRequest req)
    {
        if (!MailPlanKinds.IsValid(req.Kind)) return "Choose a mail type.";
        if (!MailPlanChannels.IsValid(req.Channel)) return "Choose Email, Viber or Both.";
        string? eventName = null;
        if (!string.IsNullOrWhiteSpace(req.EventName) && (eventName = CleanEventName(req.EventName)) is null)
            return "Enter an event name of up to 200 characters.";

        var emails = new List<string>();
        foreach (var raw in req.Emails ?? [])
            emails.Add(InvitationMessageBuilder.Address(raw) ?? $"!{raw}");
        if (emails.FirstOrDefault(e => e.StartsWith('!')) is { } invalid) return $"Check this address: {invalid[1..]}";
        emails = emails.Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        if (emails.Count > MaxEmails) return $"Add at most {MaxEmails} email addresses per plan.";

        var cc = new List<string>();
        foreach (var raw in req.Cc ?? [])
        {
            if (InvitationMessageBuilder.Address(raw) is not { } address) return $"Check this CC address: {raw}";
            cc.Add(address);
        }
        cc = cc.Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        if (cc.Count > MaxCc) return $"Add at most {MaxCc} CC addresses per plan.";

        var groupIds = (req.GroupIds ?? []).Where(g => !string.IsNullOrWhiteSpace(g)).Distinct().ToList();
        if (groupIds.Count > MaxGroups) return $"Pick at most {MaxGroups} saved lists.";
        var previous = JsonSerializer.Deserialize<List<string>>(plan.GroupIdsJson) ?? [];
        var known = (await audience.GroupsAsync()).Select(g => g.Id).Concat(previous).ToHashSet();
        if (groupIds.Any(g => !known.Contains(g))) return "A saved list no longer exists. Reload the planner and pick the lists again.";

        var locked = plan.Sends.Where(s => s.Status != MailSendStatus.Scheduled).ToList();
        var editable = plan.Sends.Where(s => s.Status == MailSendStatus.Scheduled).ToDictionary(s => s.Id);
        var inputs = req.Sends ?? [];
        if (inputs.Count > MaxDays) return $"A plan can have at most {MaxDays} days.";
        if (locked.Count + inputs.Count == 0) return "Pick at least one target day.";
        var days = locked.Select(s => s.SendAt.ToOffset(PhOffset).Date).ToHashSet();
        var prepared = new List<(MailPlanSendInput Input, string Subject, string Body, string Text, int Images)>();
        var now = DateTimeOffset.UtcNow;
        for (var i = 0; i < inputs.Count; i++)
        {
            var input = inputs[i];
            var label = $"Day {locked.Count + i + 1}";
            if (input.Id is { } existingId && !editable.ContainsKey(existingId))
                throw new InvalidOperationException($"{label} has already gone out or was removed. Reopen the plan before editing.");
            var subject = (input.Subject ?? "").Trim();
            if (subject.Length is 0 or > 200 || subject.Contains('\r') || subject.Contains('\n'))
                return $"{label}: enter a subject of up to 200 characters.";
            string body;
            int images;
            try
            {
                var rendered = InvitationMessageBuilder.RenderBody(input.BodyHtml);
                body = InvitationMessageBuilder.EditableBody(rendered.Html, rendered.Images);
                images = rendered.Images.Count;
            }
            catch (ArgumentException ex) { return $"{label}: {ex.Message}"; }
            var text = InvitationMessageBuilder.PlainText(body);
            if (text.Length == 0 && images == 0) return $"{label}: write the message.";
            if (text.Length > MaxBodyText) return $"{label}: keep the message under {MaxBodyText} characters.";
            if (!req.Draft && input.SendAt <= now) return $"{label}: pick a send time that has not passed.";
            if (!days.Add(input.SendAt.ToOffset(PhOffset).Date)) return $"{label}: another day of this plan is already on that date.";
            prepared.Add((input, subject, body, text, images));
        }
        if (!req.Draft && (await audience.ResolveAsync(groupIds, emails)).Count == 0)
            return "Add at least one receiver email.";

        plan.Kind = req.Kind!;
        plan.Channel = req.Channel!;
        plan.Draft = req.Draft;
        plan.EventName = eventName;
        var today = DateTime.Now;
        plan.EventId = eventName is null ? null : await db.Events.Where(e => e.Title == eventName)
            .OrderByDescending(e => e.EndsAt >= today).ThenBy(e => e.StartsAt).Select(e => (int?)e.Id).FirstOrDefaultAsync();
        plan.GroupIdsJson = JsonSerializer.Serialize(groupIds);
        plan.EmailsJson = JsonSerializer.Serialize(emails);
        plan.CcJson = JsonSerializer.Serialize(cc);
        plan.UpdatedAt = now;

        var kept = prepared.Where(p => p.Input.Id is not null).Select(p => p.Input.Id!.Value).ToHashSet();
        foreach (var removed in editable.Values.Where(s => !kept.Contains(s.Id))) db.MailPlanSends.Remove(removed);
        foreach (var (input, subject, body, text, images) in prepared)
        {
            var send = input.Id is { } existingId ? editable[existingId] : new MailPlanSend();
            send.SendAt = input.SendAt.ToUniversalTime();
            send.NextAttemptAt = send.SendAt;
            send.Subject = subject;
            send.BodyHtml = body;
            var preview = Regex.Replace(text, @"\s+", " ");
            send.PreviewText = preview.Length > 300 ? preview[..300] : preview;
            send.ImageCount = images;
            send.Attempts = 0;
            send.LastError = null;
            send.UpdatedAt = now;
            if (input.Id is null) plan.Sends.Add(send);
        }
        return null;
    }

    private static string? CleanEventName(string? value)
    {
        var name = Regex.Replace(value ?? "", @"\s+", " ").Trim();
        return name.Length is 0 or > 200 || name.Any(char.IsControl) ? null : name;
    }

    private static object PlanDto(MailPlan p, bool withBodies) => new {
        p.Id, p.Kind, p.EventId, p.EventName, p.Channel, p.Draft,
        groupIds = JsonSerializer.Deserialize<List<string>>(p.GroupIdsJson),
        emails = JsonSerializer.Deserialize<List<string>>(p.EmailsJson),
        cc = JsonSerializer.Deserialize<List<string>>(p.CcJson),
        p.CreatedAt, p.UpdatedAt, p.Version,
        sends = p.Sends.OrderBy(s => s.SendAt).Select(s => SendDto(s, withBodies)),
    };

    private static object SendDto(MailPlanSend s, bool withBody) => new {
        s.Id, s.SendAt, s.Subject, s.PreviewText, s.ImageCount, bodyHtml = withBody ? s.BodyHtml : null,
        s.Status, s.SentAt, s.RecipientCount, s.LastError, s.Attempts, s.NextAttemptAt,
    };
}
