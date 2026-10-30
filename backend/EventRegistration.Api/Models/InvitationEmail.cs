using System.ComponentModel.DataAnnotations;

namespace EventRegistration.Api.Models;

public static class InvitationEmailStatus
{
    public const string Scheduled = "Scheduled";
    public const string Sending = "Sending";
    public const string Sent = "Sent";
    public const string Queued = "Queued";
    public const string Failed = "Failed";
    public const string Cancelled = "Cancelled";
    public static bool CanEdit(string status) => status is Scheduled or Queued or Failed;
}

// A message is separate from Invitation: resends must retain their own recipients,
// content and delivery timestamps instead of overwriting a recipient's history.
public class InvitationEmail
{
    public int Id { get; set; }
    public int EventId { get; set; }
    public Event? Event { get; set; }
    public string ToJson { get; set; } = "[]";
    public string CcJson { get; set; } = "[]";
    [MaxLength(200)] public string Subject { get; set; } = "";
    public string BodyHtml { get; set; } = "";
    [MaxLength(20)] public string Status { get; set; } = InvitationEmailStatus.Scheduled;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? ScheduledAt { get; set; }
    public DateTimeOffset? SentAt { get; set; }
    public DateTimeOffset? LastAttemptAt { get; set; }
    public DateTimeOffset NextAttemptAt { get; set; }
    public int Attempts { get; set; }
    [MaxLength(1000)] public string? LastError { get; set; }
    [Timestamp] public byte[] Version { get; set; } = [];
}
