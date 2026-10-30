using System.ComponentModel.DataAnnotations;

namespace EventRegistration.Api.Models;

public static class MailPlanKinds
{
    public const string Reminder = "Reminder";
    public const string Announcement = "Announcement";
    public const string FollowUp = "Follow-up";
    public static bool IsValid(string? k) => k is Reminder or Announcement or FollowUp;
}

public static class MailPlanChannels
{
    public const string Email = "Email";
    public const string Viber = "Viber";
    public const string Both = "Both";
    public static bool IsValid(string? c) => c is Email or Viber or Both;
}

public static class MailSendStatus
{
    public const string Scheduled = "Scheduled";
    public const string Sending = "Sending";
    public const string Sent = "Sent";
    // SMTP was unavailable (saved to the outbox); delivery is retried.
    public const string Queued = "Queued";
    public const string Failed = "Failed";
}

// A mail plan: one receiver list and one or more target days, each with its own mail.
public class MailPlan
{
    public int Id { get; set; }
    [MaxLength(20)] public string Kind { get; set; } = MailPlanKinds.Announcement;
    // Set when EventName matches a real event, so mails can show its date and venue.
    public int? EventId { get; set; }
    public Event? Event { get; set; }
    [MaxLength(200)] public string? EventName { get; set; }
    [MaxLength(10)] public string Channel { get; set; } = MailPlanChannels.Email;
    // Drafts are never sent.
    public bool Draft { get; set; }
    // Saved receiver lists (resolved when each day goes out) and typed-in addresses.
    public string GroupIdsJson { get; set; } = "[]";
    public string EmailsJson { get; set; } = "[]";
    // Copied openly (Cc header) on each day's email; receivers themselves stay hidden (BCC).
    public string CcJson { get; set; } = "[]";
    public int CreatedByUserId { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
    [Timestamp] public byte[] Version { get; set; } = [];
    public ICollection<MailPlanSend> Sends { get; set; } = new List<MailPlanSend>();
}

// One target day of a plan. Only Scheduled days can be edited; the rest are history.
public class MailPlanSend
{
    public int Id { get; set; }
    public int PlanId { get; set; }
    public MailPlan? Plan { get; set; }
    public DateTimeOffset SendAt { get; set; }
    [MaxLength(200)] public string Subject { get; set; } = "";
    // Sanitized editor markup with inline PNGs as data URLs (InvitationMessageBuilder.RenderBody).
    public string BodyHtml { get; set; } = "";
    // Plain-text start of the message, so lists don't carry the full body and images.
    [MaxLength(500)] public string PreviewText { get; set; } = "";
    public int ImageCount { get; set; }
    [MaxLength(20)] public string Status { get; set; } = MailSendStatus.Scheduled;
    public DateTimeOffset NextAttemptAt { get; set; }
    public DateTimeOffset? LastAttemptAt { get; set; }
    public int Attempts { get; set; }
    // First delivery attempt: receivers are frozen and the mail appears in their inbox.
    public DateTimeOffset? DispatchedAt { get; set; }
    public DateTimeOffset? SentAt { get; set; }
    public int RecipientCount { get; set; }
    [MaxLength(1000)] public string? LastError { get; set; }
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
    [Timestamp] public byte[] Version { get; set; } = [];
    public ICollection<MailPlanDelivery> Deliveries { get; set; } = new List<MailPlanDelivery>();
}

// One receiver of one sent day, plus the reminder they planned for it in My Reminders.
public class MailPlanDelivery
{
    public int Id { get; set; }
    public int SendId { get; set; }
    public MailPlanSend? Send { get; set; }
    [MaxLength(256)] public string Email { get; set; } = "";
    public int? UserId { get; set; }
    [MaxLength(40)] public string? Phone { get; set; }
    // A CC address: gets the email with the Cc header, never Viber.
    public bool IsCc { get; set; }
    // Per-channel progress, so a retry never sends a receiver the same mail twice.
    public DateTimeOffset? EmailSentAt { get; set; }
    public DateTimeOffset? ViberSentAt { get; set; }
    public DateTimeOffset? RemindAt { get; set; }
    public bool Snoozed { get; set; }
    public DateTimeOffset? ReminderSentAt { get; set; }
    public DateTimeOffset? DoneAt { get; set; }
}

// CC addresses saved from the plan form; offered in the CC dropdown of later plans.
public class MailPlanSavedCc
{
    public int Id { get; set; }
    [MaxLength(256)] public string Email { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

// Event names typed into the plan form and saved for later plans.
public class MailPlanEventName
{
    public int Id { get; set; }
    [MaxLength(200)] public string Name { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public record MailPlanSendInput(int? Id, DateTimeOffset SendAt, string? Subject, string? BodyHtml);
public record MailPlanRequest(string? Kind, string? EventName, string? Channel, bool Draft,
    List<string>? GroupIds, List<string>? Emails, List<MailPlanSendInput>? Sends, string? Version,
    List<string>? Cc = null);
public record MailEventNameRequest(string? Name);
public record MailSavedCcRequest(string? Email);
public record MailReminderRequest(DateTimeOffset? RemindAt);
