using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace EventRegistration.Api.Models;

public static class Roles
{
    public const string Admin = "Admin";
    public const string Participant = "Participant";
    public const string SuperAdmin = "SuperAdmin";
    // A merchant/vendor account that can only scan and redeem meal stubs.
    public const string Merchant = "Merchant";
}

public static class Permissions
{
    // Custom claim type + authorization policy name for the "confirm registrations" grant.
    public const string ConfirmRegistrations = "perm:confirm-registrations";
    public const string ConfirmRegistrationsPolicy = "CanConfirmRegistrations";
}

// How an event is attended. Online / Hybrid events carry a meeting link and send calendar invites.
public static class EventFormats
{
    public const string InPerson = "InPerson";
    public const string Online = "Online";
    public const string Hybrid = "Hybrid";

    public static string Normalize(string? f) =>
        f == Online || f == Hybrid ? f : InPerson;

    // Has an online component (meeting link + calendar invite).
    public static bool HasOnline(string? f) => f == Online || f == Hybrid;

    // Has a physical venue (QR entry pass + check-in).
    public static bool HasVenue(string? f) => f != Online;
}

public static class EventStatus
{
    public const string Draft = "Draft";
    public const string Published = "Published";
    public const string Closed = "Closed";
}

public static class InvitationStatus
{
    public const string Sent = "Sent";
    public const string Registered = "Registered";
}

// How a member wants their entry pass + notifications delivered.
public static class NotificationChannels
{
    public const string Email = "Email";
    public const string Viber = "Viber";
    public const string Both = "Both"; // deliver via email AND Viber (needs both contacts)
    public static bool IsValid(string? c) => c is Email or Viber or Both;
    public static bool UsesEmail(string? c) => c is Email or Both;
    public static bool UsesViber(string? c) => c is Viber or Both;
}

// How an attendance was recorded.
public static class CheckInMethods
{
    public const string Scan = "Scan";     // QR code scan
    public const string Face = "Face";     // facial recognition
    public const string Manual = "Manual"; // admin marked it in the attendance list
}

public class User
{
    public int Id { get; set; }
    public int? CompanyId { get; set; }
    // FullName is the composed display name; the parts below are captured at sign-up.
    [MaxLength(200)] public string FullName { get; set; } = "";
    [MaxLength(100)] public string? FirstName { get; set; }
    [MaxLength(10)] public string? MiddleInitial { get; set; }
    [MaxLength(100)] public string? LastName { get; set; }
    [MaxLength(50)] public string? SenateNo { get; set; }
    // Membership level (e.g. Senator, Chairman Circle). Captured at sign-up.
    [MaxLength(100)] public string? Level { get; set; }
    // Optional profile photo as a data URL (data:image/...;base64,...). Shown on the TV
    // welcome display at check-in. Uploaded by the member at sign-up.
    public string? PhotoUrl { get; set; }
    // Optional 128-dimension face descriptor (JSON array of floats) captured during facial
    // registration, used later for facial-recognition check-in.
    public string? FaceDescriptor { get; set; }
    [MaxLength(256)] public string Email { get; set; } = "";
    // Unique login handle (stored lower-case). Members can sign in with username or email.
    [MaxLength(100)] public string Username { get; set; } = "";
    public string PasswordHash { get; set; } = "";
    [MaxLength(20)] public string Role { get; set; } = Roles.Participant;
    [MaxLength(40)] public string? Phone { get; set; }
    [MaxLength(200)] public string? Organization { get; set; }
    // Where to deliver the entry pass + notifications: "Email" (default) or "Viber".
    // Viber delivery uses Phone, so Phone is required whenever this is "Viber".
    [MaxLength(10)] public string NotificationChannel { get; set; } = NotificationChannels.Email;
    public DateTime CreatedAt { get; set; }

    public bool EmailVerified { get; set; }
    public Guid? EmailVerificationToken { get; set; }

    // Grant: may confirm event registrations (bulk-confirm) without being a full admin.
    // Admins/super-admins can always confirm regardless of this flag.
    public bool CanConfirmRegistrations { get; set; }

    public ICollection<Registration> Registrations { get; set; } = new List<Registration>();
}

public class Event
{
    public int Id { get; set; }
    public int? CompanyId { get; set; }
    [MaxLength(300)] public string Title { get; set; } = "";
    public string Description { get; set; } = "";
    public DateTime StartsAt { get; set; }
    public DateTime EndsAt { get; set; }
    [MaxLength(300)] public string Venue { get; set; } = "";
    public bool IsPublicLinkEnabled { get; set; } = true;
    [MaxLength(100)] public string PublicSlug { get; set; } = "";
    public int CreatedByUserId { get; set; }
    [MaxLength(20)] public string Status { get; set; } = EventStatus.Published;
    // Max participants. null = unlimited.
    public int? Capacity { get; set; }
    // Custom registration form: JSON array of FormFieldDef. null/empty = no extra fields.
    public string? FormSchema { get; set; }
    // Optional banner image stored as a data URL (data:image/...;base64,...).
    public string? BannerImage { get; set; }
    // Optional custom greeting shown on the scanner TV welcome screen (falls back to "Welcome").
    [MaxLength(200)] public string? WelcomeMessage { get; set; }
    // Optional free-text registration fees information shown on the registration page.
    public string? RegistrationFees { get; set; }
    // Optional schedule of activities: JSON array of { Day, Time, Activity } rows.
    public string? ScheduleJson { get; set; }
    // When true, notify each registrant (email/Viber) when their event kit is marked claimed.
    public bool NotifyOnKitClaim { get; set; } = false;
    // How attendees take part: in person (default), online, or hybrid. See EventFormats.
    [MaxLength(10)] public string Format { get; set; } = EventFormats.InPerson;
    // Online meeting join link (e.g. a Teams meeting URL) for Online / Hybrid events.
    [MaxLength(1000)] public string? MeetingUrl { get; set; }
    // Calendar-invite revision (iCalendar SEQUENCE). Bumped whenever an online event's time,
    // title or link changes, so re-sent invites replace the earlier calendar entry.
    public int InviteSequence { get; set; }
    public DateTime CreatedAt { get; set; }

    public ICollection<Invitation> Invitations { get; set; } = new List<Invitation>();
    public ICollection<Registration> Registrations { get; set; } = new List<Registration>();
    // Optional sub-events (sessions). When present, participants register per session.
    public ICollection<Session> Sessions { get; set; } = new List<Session>();
    // Meal stubs for this event (sub-event stubs have SessionId set; event-level per-day stubs don't).
    public ICollection<Meal> Meals { get; set; } = new List<Meal>();
}

// A sub-event within an Event (e.g. one per day, or several per day). Optional: an event
// with no sessions is registered for at the event level (original behaviour).
public class Session
{
    public int Id { get; set; }
    public int EventId { get; set; }
    public Event? Event { get; set; }
    [MaxLength(300)] public string Title { get; set; } = "";
    public string? Description { get; set; }
    public DateTime StartsAt { get; set; }
    public DateTime EndsAt { get; set; }
    // Falls back to the parent event's venue when null.
    [MaxLength(300)] public string? Venue { get; set; }
    // Max participants for this session. null = unlimited.
    public int? Capacity { get; set; }
    // Optional online meeting link for this sub-event; falls back to the event's MeetingUrl.
    [MaxLength(1000)] public string? MeetingUrl { get; set; }
    // Optional poster/image for this sub-event, stored as a data URL. Shown to participants
    // in Browse Events and My Events.
    public string? PosterImage { get; set; }

    public ICollection<Registration> Registrations { get; set; } = new List<Registration>();
    // Meal stubs offered at this sub-event.
    public ICollection<Meal> Meals { get; set; } = new List<Meal>();
}

// A meal stub: a face value (Denomination) and how many per member (Quantity), with an optional
// colour for at-a-glance identification. A stub belongs to a sub-event (SessionId set) OR, for an
// event with no sub-events, to a Day of the event (SessionId null, Day >= 1).
public class Meal
{
    public int Id { get; set; }
    public int EventId { get; set; }
    public Event? Event { get; set; }
    // Set for sub-event stubs; null for event-level (per-day) stubs.
    public int? SessionId { get; set; }
    public Session? Session { get; set; }
    // Day number for event-level stubs (1-based); ignored for sub-event stubs.
    public int Day { get; set; } = 1;
    [MaxLength(100)] public string Name { get; set; } = "";
    [Column(TypeName = "decimal(10,2)")] public decimal Denomination { get; set; }
    public int Quantity { get; set; } = 1;
    // Optional colour (hex like "#2196F3" or a name); shown as a swatch on the stub.
    [MaxLength(20)] public string? Color { get; set; }
    // Dates the stub is valid (inclusive), constrained to the event's date range.
    public DateTime ValidFrom { get; set; }
    public DateTime ValidTo { get; set; }
    public int SortOrder { get; set; }
}

// An individually-issued meal stub: one physical voucher for a registrant, with its own unique
// control number (encoded in its QR). Generated from a Meal definition (Quantity copies each) when
// the registration is confirmed, and delivered alongside the entry pass. Values are snapshotted so
// issued stubs keep their control number/denomination even if the definition later changes.
public class MealStub
{
    public int Id { get; set; }
    public int RegistrationId { get; set; }
    public Registration? Registration { get; set; }
    public int MealId { get; set; } // source definition (reference only)
    public Guid ControlNumber { get; set; } = Guid.NewGuid();
    public int Day { get; set; }
    [MaxLength(100)] public string Name { get; set; } = "";
    [Column(TypeName = "decimal(10,2)")] public decimal Denomination { get; set; }
    [MaxLength(20)] public string? Color { get; set; }
    // Snapshot of the validity range (inclusive) at issue time.
    public DateTime ValidFrom { get; set; }
    public DateTime ValidTo { get; set; }
    public int CopyIndex { get; set; } // 1..Quantity within its definition
    public DateTime? RedeemedAt { get; set; }
    [MaxLength(200)] public string? RedeemedBy { get; set; } // display name of who redeemed it
    // The merchant/admin user account that scanned this stub (null for manual admin actions
    // without a specific user, or self-service). Different stubs of one member may be scanned
    // by different merchants.
    public int? RedeemedByUserId { get; set; }
    [MaxLength(10)] public string? RedeemedMethod { get; set; }
}

// Records that a registrant redeemed a day's meal stubs (event-level, no-sub-event events).
// Keyed by (RegistrationId, Day) so each day is redeemed independently.
public class MealRedemption
{
    public int Id { get; set; }
    public int RegistrationId { get; set; }
    public Registration? Registration { get; set; }
    public int Day { get; set; }
    public DateTime RedeemedAt { get; set; }
    [MaxLength(200)] public string? RedeemedBy { get; set; }
    [MaxLength(10)] public string? Method { get; set; } // "Scan" or "Manual"
}

public class Invitation
{
    public int Id { get; set; }
    public int EventId { get; set; }
    public Event? Event { get; set; }
    [MaxLength(256)] public string Email { get; set; } = "";
    // Per-invitee magic-link token embedded in the emailed URL (?invite={Token}).
    public Guid Token { get; set; } = Guid.NewGuid();
    public DateTime SentAt { get; set; }
    [MaxLength(20)] public string Status { get; set; } = InvitationStatus.Sent;
}

public class Registration
{
    public int Id { get; set; }
    public int EventId { get; set; }
    public Event? Event { get; set; }
    // When the event has sub-events, the registration is for a specific session; null = the
    // whole event (events without sessions).
    public int? SessionId { get; set; }
    public Session? Session { get; set; }

    // A registration is either tied to a system User (account flow) OR is a standalone
    // guest (public flow) captured by the Guest* fields below — never requires an account.
    public int? UserId { get; set; }
    public User? User { get; set; }
    [MaxLength(200)] public string? GuestFullName { get; set; }
    [MaxLength(50)] public string? GuestSenateNo { get; set; }
    [MaxLength(256)] public string? GuestEmail { get; set; }
    [MaxLength(40)] public string? GuestPhone { get; set; }
    // Guest's chosen pass-delivery channel (Email or Viber). Null for account-based
    // registrations, which use the User's NotificationChannel instead.
    [MaxLength(10)] public string? GuestNotificationChannel { get; set; }

    public Guid Token { get; set; } = Guid.NewGuid();
    public DateTime RegisteredAt { get; set; }
    // Set when an admin confirms the registration; null = still pending approval.
    // The entry pass is only issued (emailed) once confirmed.
    public DateTime? ConfirmedAt { get; set; }
    public DateTime? CheckedInAt { get; set; }
    // How the attendance was recorded: "Scan" (QR), "Face" (facial recognition), or "Manual"
    // (admin marked it in the attendance list). Null when not yet checked in.
    [MaxLength(10)] public string? CheckInMethod { get; set; }
    // Kit claiming (event giveaway/collateral): set when an admin marks the kit as claimed.
    // KitClaimedBy is the name of the person who physically collected it — the registrant
    // themselves (self-claimed) or someone claiming on their behalf. Null = not yet claimed.
    public DateTime? KitClaimedAt { get; set; }
    [MaxLength(200)] public string? KitClaimedBy { get; set; }
    // Meal stubs (sub-event events): the registration is for one sub-event, so a single redemption
    // issues that sub-event's entire stub set. Null = not yet redeemed. Event-level (per-day) meal
    // redemptions are tracked in MealRedemptions instead.
    public DateTime? MealsRedeemedAt { get; set; }
    [MaxLength(200)] public string? MealsRedeemedBy { get; set; }
    [MaxLength(10)] public string? MealsRedeemedMethod { get; set; } // "Scan" or "Manual"
    public ICollection<MealRedemption> MealRedemptions { get; set; } = new List<MealRedemption>();
    public ICollection<MealStub> MealStubs { get; set; } = new List<MealStub>();
    public DateTime? PassEmailSentAt { get; set; }
    // Answers to the event's custom form: JSON object keyed by field key.
    public string? FormResponses { get; set; }
    // Optional 128-dimension face descriptor (JSON array of floats) captured by a GUEST during
    // public registration, used for facial-recognition check-in. Account registrations use the
    // linked User's FaceDescriptor instead.
    public string? FaceDescriptor { get; set; }
    // Optional display picture (a data URL) uploaded by a GUEST during public registration, shown
    // to staff on the check-in screen to confirm identity. Account registrations use User.PhotoUrl.
    public string? GuestPhoto { get; set; }

    // Convenience accessors that fall back to the guest fields. Require User to be
    // Include()'d when the registration is account-based.
    [NotMapped] public string DisplayName => User?.FullName ?? GuestFullName ?? "Guest";
    [NotMapped] public string? DisplayEmail => User?.Email ?? GuestEmail;
    [NotMapped] public string? DisplayPhone => User?.Phone ?? GuestPhone;
    [NotMapped] public string? DisplayOrganization => User?.Organization;
    [NotMapped] public string? DisplaySenateNo => User?.SenateNo ?? GuestSenateNo;
    [NotMapped] public string? DisplayPhoto => User?.PhotoUrl ?? GuestPhoto;
}

// Generic key/value store for admin-configurable application settings (e.g. Email:Cc).
public class AppSetting
{
    [MaxLength(100)] public string Key { get; set; } = "";
    public string? Value { get; set; }
}

// Well-known application setting keys.
public static class SettingKeys
{
    // Comma-separated list of email addresses CC'd on every outgoing email.
    public const string EmailCc = "Email:Cc";
    // Which transport delivers phone notifications: "Viber" (default) or "Sms".
    public const string MobileProvider = "Notifications:MobileProvider";
}

// Transport for phone-based notifications, selectable in admin Settings.
public static class MobileProviders
{
    public const string Viber = "Viber";
    public const string Sms = "Sms";
    public static bool IsValid(string? p) => p is Viber or Sms;
    public static string Normalize(string? p) =>
        string.Equals(p, Sms, System.StringComparison.OrdinalIgnoreCase) ? Sms : Viber;
}

public class Feedback
{
    public int Id { get; set; }
    public int EventId { get; set; }
    public int UserId { get; set; }
    public int Rating { get; set; }
    public string? Comment { get; set; }
    public DateTime CreatedAt { get; set; }
}
