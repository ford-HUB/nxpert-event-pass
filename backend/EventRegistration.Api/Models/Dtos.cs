namespace EventRegistration.Api.Models;

// Email holds the login identifier — an email address OR a username.
public record LoginRequest(string Email, string Password);
public record RegisterRequest(
    string FirstName, string? MiddleInitial, string LastName, string SenateNo,
    string Email, string Password, string? Phone, string? Organization, string? Level,
    string? Photo);
public record AuthResponse(string Token, int UserId, string FullName, string Email, string Role,
    bool EmailVerified, bool VerificationRequired, string? SenateNo,
    string? FirstName, string? MiddleInitial, string? LastName, string? Level, string? PhotoUrl,
    bool CanConfirmRegistrations, string Username);

// ---- User master (admin) ----
public record UserDto(
    int Id, string FullName, string? FirstName, string? MiddleInitial, string? LastName,
    string? SenateNo, string? Level, string Email, string Username, string Role, string? Organization, string? Phone,
    string NotificationChannel,
    bool CanConfirmRegistrations, bool EmailVerified, DateTime CreatedAt, string? PhotoUrl, bool HasFace);

// Password is required on create, optional on update (blank = keep current).
// Face: a JSON array of 128 floats (the face descriptor) captured during facial registration;
// null = leave unchanged, "" = clear.
// NotificationChannel: "Email" (default) or "Viber". When "Viber", Phone is required.
public record AdminUserUpsertRequest(
    string FirstName, string? MiddleInitial, string LastName, string? SenateNo, string? Level,
    string Email, string? Password, string Role, string? Organization, string? Phone,
    bool CanConfirmRegistrations, string? Photo, string? Face, string? NotificationChannel,
    string? Username);

// ---- Bulk user import (spreadsheet upload). Each created account gets the default password. ----
public record UserImportRow(
    string? FirstName, string? MiddleInitial, string? LastName, string? SenateNo, string? Level,
    string? Email, string? Username, string? Organization, string? Phone, string? Role,
    string? NotificationChannel);
public record UserImportRequest(List<UserImportRow>? Rows);
public record UserImportError(int Row, string Name, string Message);
public record UserImportResult(int Created, int Skipped, int Failed, List<UserImportError> Errors);

// Registered face descriptors for facial-recognition check-in.
public record FaceDescriptorDto(int UserId, string FullName, float[] Descriptor);
// A guest registration's face for an event, matched by the scanner and checked in by Token.
public record RegistrationFaceDto(string Token, string Name, float[] Descriptor);

// ---- Realtime notifications (pushed over the SignalR hub) ----
// Sent to admins/confirmers when a registration is created.
public record NewRegistrationNotice(
    int EventId, string EventTitle, string AttendeeName, string? SessionTitle,
    int Count, bool IsGuest, DateTime At);
// Sent to a registrant when their registration is confirmed by an admin.
public record RegistrationApprovedNotice(
    int RegistrationId, int EventId, string EventTitle, string? SessionTitle, DateTime At);
// Sent to a registrant when their event kit is marked claimed.
public record KitClaimedNotice(
    int RegistrationId, int EventId, string EventTitle, string? SessionTitle, string? ClaimedBy, DateTime At);

// ---- Offline bundle: everything the scanner/registration screens need with no network ----
public record OfflineEventDto(
    int Id, string Title, string PublicSlug, string? WelcomeMessage, DateTime StartsAt,
    DateTime EndsAt, string Venue, string Status, bool IsPublicLinkEnabled, string? BannerImage);
public record OfflineSessionDto(
    int Id, string Title, DateTime StartsAt, DateTime EndsAt, string? Venue, int? Capacity);
public record OfflineMemberDto(
    int UserId, string FullName, string? Level, string? SenateNo, string? Organization,
    string? PhotoUrl, float[]? Face);
public record OfflineRegDto(
    string Token, int? UserId, string? GuestName, int? SessionId, bool Confirmed, DateTime? CheckedInAt,
    float[]? Face);
public record OfflineBundleDto(
    OfflineEventDto Event, List<OfflineSessionDto> Sessions, List<OfflineMemberDto> Members,
    List<OfflineRegDto> Registrations, List<FormFieldDef> FormFields, DateTime GeneratedAt);

// ---- Sync (upload actions captured while offline) ----
public record SyncCheckInItem(string Token, DateTime CheckedInAt);
public record SyncCheckInRequest(List<SyncCheckInItem> Items);
public record SyncCheckInResult(int Applied, int AlreadyChecked, int NotFound);

public record OfflineRegItem(
    string FullName, string? Email, string? Phone, List<int>? SessionIds,
    Dictionary<string, string>? Responses, DateTime? RegisteredAt, string? NotificationChannel = null,
    string? Face = null, string? SenateNo = null, string? DisplayPicture = null);
public record OfflineRegSyncRequest(string Slug, List<OfflineRegItem> Items);
public record OfflineRegSyncResult(int Created, int Skipped);
public record VerifyEmailResult(bool Success, string Message);

// ---- Self-service profile (any signed-in user) ----
public record ProfileDto(
    int Id, string? FirstName, string? MiddleInitial, string? LastName, string? SenateNo,
    string? Level, string Email, string? Organization, string? Phone, string NotificationChannel,
    string? PhotoUrl, string Role, bool HasFace);

// Password change is optional: supply CurrentPassword + NewPassword to change it.
// NotificationChannel: "Email" (default) or "Viber". When "Viber", Phone is required.
// Face: JSON array of 128 floats (face descriptor); null = unchanged, "" = clear.
public record ProfileUpdateRequest(
    string FirstName, string? MiddleInitial, string LastName, string? SenateNo, string? Level,
    string? Organization, string? Phone, string? Photo, string? CurrentPassword, string? NewPassword,
    string? NotificationChannel, string? Face);
// Result of opening an invite magic-link: if the invited email has an account, Auth is
// populated for auto-login; otherwise the caller prefills the guest form with Email.
public record InviteResolveResult(bool Registered, string Email, string EventSlug, AuthResponse? Auth);

// A single custom registration-form field.
// Type: text|textarea|number|date|time|select|multiselect|radio|checkbox|image.
// image responses are stored as a data URL (data:image/...;base64,...).
public class FormFieldDef
{
    public string Key { get; set; } = "";
    public string Label { get; set; } = "";
    public string Type { get; set; } = "text";
    public bool Required { get; set; }
    public List<string>? Options { get; set; }
    public string? Placeholder { get; set; }
    // Optional grouping. Fields sharing a category render together under one heading.
    public string? Category { get; set; }
    // Conditional visibility: when set, this field only shows (and is only required/collected) while
    // the answer to the field with key ShowWhenField equals ShowWhenValue. Null = always shown.
    public string? ShowWhenField { get; set; }
    public string? ShowWhenValue { get; set; }
}

public record EventUpsertRequest(
    string Title, string Description, DateTime StartsAt, DateTime EndsAt,
    string Venue, bool IsPublicLinkEnabled, string Status, int? Capacity,
    List<FormFieldDef>? FormFields, string? BannerImage, string? WelcomeMessage,
    List<SessionUpsertRequest>? Sessions, string? RegistrationFees, List<ScheduleItem>? Schedule,
    bool NotifyOnKitClaim = false, List<MealUpsertRequest>? Meals = null,
    string? Format = null, string? MeetingUrl = null);

public record EventDto(
    int Id, string Title, string Description, DateTime StartsAt, DateTime EndsAt,
    string Venue, bool IsPublicLinkEnabled, string PublicSlug, string Status,
    int RegisteredCount, int CheckedInCount, int? Capacity, bool IsFull,
    List<FormFieldDef> FormFields, string? BannerImage, string? WelcomeMessage,
    List<SessionDto> Sessions, string? RegistrationFees, List<ScheduleItem> Schedule,
    bool NotifyOnKitClaim, List<MealDto> Meals,
    // Format: InPerson / Online / Hybrid. MeetingUrl is only filled for admin responses — public
    // and browse responses never expose the join link (confirmed registrants get it via My Events).
    string Format = EventFormats.InPerson, string? MeetingUrl = null);

// A row in the event's schedule-of-activities grid.
public record ScheduleItem(string? Day, string? Time, string Activity);

// A meal stub: a face value, quantity per member, and optional colour. Day applies to event-level
// (per-day) stubs; it's ignored for sub-event stubs.
public record MealDto(int Id, string Name, decimal Denomination, int Quantity, string? Color, int Day,
    DateTime ValidFrom, DateTime ValidTo);
public record MealUpsertRequest(int Id, string Name, decimal Denomination, int Quantity, string? Color, int Day,
    DateTime? ValidFrom, DateTime? ValidTo);

// A sub-event (session) within an event.
public record SessionUpsertRequest(
    int Id, string Title, string? Description, DateTime StartsAt, DateTime EndsAt,
    string? Venue, int? Capacity, string? PosterImage, List<MealUpsertRequest>? Meals = null,
    string? MeetingUrl = null);
public record SessionDto(
    int Id, string Title, string? Description, DateTime StartsAt, DateTime EndsAt,
    string? Venue, int? Capacity, int RegisteredCount, int CheckedInCount, bool IsFull,
    string? PosterImage, List<MealDto> Meals, string? MeetingUrl = null);

public record InviteRequest(List<string> Emails);

// SessionIds: which sub-events to register for (empty/null = the whole event, for events
// that have no sub-events).
public record RegisterForEventRequest(int EventId, List<int>? SessionIds, Dictionary<string, string>? Responses);

// Public/guest registration — no account required. Name is required. NotificationChannel picks
// where the pass is sent once confirmed (Email or Viber); the matching contact is then required.
public record GuestRegisterRequest(string FullName, string? Email, string? Phone,
    List<int>? SessionIds, Dictionary<string, string>? Responses, string? NotificationChannel,
    string? Face, string? SenateNo, string? DisplayPicture = null);

// Result of a (possibly multi-session) registration submission. EditToken (when the event has
// custom form fields) is the registration token the caller can use to build a public edit link.
public record RegisterResult(int Created, int AlreadyRegistered, string EventTitle, string AttendeeName,
    string? EditToken = null);

public record RegistrationDto(
    int Id, int EventId, string EventTitle, DateTime StartsAt, string Venue,
    Guid Token, DateTime RegisteredAt, DateTime? ConfirmedAt, DateTime? CheckedInAt,
    int? SessionId, string? SessionTitle, string? SessionPosterImage, bool HasFormFields,
    // Online / Hybrid: the join link, only once the registration is confirmed.
    string Format = EventFormats.InPerson, string? MeetingUrl = null);

// The event's custom registration form + a participant's current answers, for self-service edit.
public record RegistrationFormDto(
    string EventTitle, string? SessionTitle, List<FormFieldDef> FormFields, Dictionary<string, string> Responses);
public record UpdateResponsesRequest(Dictionary<string, string>? Responses);

// Public (token-scoped) registration form for the guest edit page. Editable is false once the
// registrant has checked in or the event has ended, with LockReason explaining why.
public record PublicRegistrationFormDto(
    string EventTitle, string? SessionTitle, string EventSlug, string AttendeeName,
    List<FormFieldDef> FormFields, Dictionary<string, string> Responses, bool Editable, string? LockReason);
// Public-page recovery: "email/Viber me my edit link" for a registration on this event.
public record EditLinkRequest(string? Contact);
// Public-page recovery (Senate No. + registered name): verifies both and returns the edit token
// so the page can redirect straight to the edit form.
public record SenateEditRequest(string? SenateNo, string? Name);

public record CheckInRequest(string Token);
// Facial-recognition check-in: the client identified a user; check them in for this event.
public record UserCheckInRequest(int EventId, int UserId);
// Status: valid | already | invalid | unconfirmed | notstarted | ended
// Member fields (Level/SenateNo/Organization) drive the TV welcome display; they are
// populated for account-based registrations and null for guests.
public record CheckInResult(
    string Status, string? FullName, string? EventTitle, DateTime? CheckedInAt, string? Message = null,
    string? Level = null, string? SenateNo = null, string? Organization = null,
    string? WelcomeMessage = null, string? PhotoUrl = null, string? SessionTitle = null);

public record AttendeeDto(
    int RegistrationId, string FullName, string Email, string? Organization, string? SenateNo, string? Phone,
    DateTime RegisteredAt, DateTime? ConfirmedAt, DateTime? CheckedInAt, Dictionary<string, string>? Responses,
    int? SessionId, string? SessionTitle, string? CheckInMethod,
    DateTime? KitClaimedAt, string? KitClaimedBy,
    // Meal stubs for this registration's sub-event: total value + stub count, and redemption state.
    decimal MealValue, int MealCount, DateTime? MealsRedeemedAt, string? MealsRedeemedBy);

// Admin app settings. CcEmails are addresses CC'd on every outgoing email.
public record AppSettingsDto(List<string> CcEmails, string MobileProvider);
public record UpdateSettingsRequest(List<string>? CcEmails, string? MobileProvider);

// Bulk confirmation: admin selects registrations and confirms them, which issues the pass.
public record ConfirmRequest(List<int> RegistrationIds);
public record ConfirmResult(int Confirmed, int Emailed, int AlreadyConfirmed, int NoEmail);

// Admin bulk cancel: only pending registrations (not confirmed, not checked in) are removed.
public record CancelRegistrationsRequest(List<int> RegistrationIds);
public record CancelRegistrationsResult(int Cancelled, int NotPending);

// Manual bulk check-in: admin selects registrations and marks them checked in.
public record ManualCheckInRequest(List<int> RegistrationIds);
public record ManualCheckInResult(int CheckedIn, int AlreadyCheckedIn, int Unconfirmed);

// Kit claiming: admin marks selected registrations' kits as claimed. When SelfClaimed is true
// each registrant claimed their own kit (their own name is recorded); otherwise ClaimedBy names
// the single person who collected the kits on the group's behalf.
public record ClaimKitRequest(List<int> RegistrationIds, string? ClaimedBy, bool SelfClaimed);
public record ClaimKitResult(int Claimed, int AlreadyClaimed, int Notified);
public record UnclaimKitRequest(List<int> RegistrationIds);
public record UnclaimKitResult(int Cleared);

// Meal-stub redemption: issue a sub-event's whole stub set to selected registrants at once.
public record RedeemMealsRequest(List<int> RegistrationIds, string? RedeemedBy, bool SelfClaimed);
public record RedeemMealsResult(int Redeemed, int AlreadyRedeemed, int NoMeals, int Unconfirmed);
public record UnredeemMealsRequest(List<int> RegistrationIds);
public record UnredeemMealsResult(int Cleared);
// Result of redeeming meals by scanning the entry-pass QR at a meal counter.
public record MealScanResult(
    string Status, string? FullName, string? SessionTitle, decimal Value, int Count, string? Message = null);
// Scan-to-redeem request. Day identifies which day's stubs for an event-level (no-sub-event) event;
// it's ignored for sub-event events.
public record MealScanRequest(string Token, int? Day);

// ---- Event-level (per-day) meal stubs board + redemption ----
public record MealDayDto(int Day, decimal Value, int Count, List<MealDto> Stubs);
public record MealBoardRow(
    int RegistrationId, string FullName, string? Organization, string Email,
    DateTime RegisteredAt, bool Confirmed, List<int> RedeemedDays);
public record MealBoardDto(List<MealDayDto> Days, List<MealBoardRow> Rows);
public record RedeemMealDayRequest(List<int> RegistrationIds, int Day, string? RedeemedBy, bool SelfClaimed);
public record RedeemMealDayResult(int Redeemed, int AlreadyRedeemed, int Unconfirmed);
public record UnredeemMealDayRequest(List<int> RegistrationIds, int Day);
public record UnredeemMealDayResult(int Cleared);

// ---- Individually-issued meal stubs (control-number based) ----
// Scan a stub's QR (its control number) to redeem it.
public record MealStubScanRequest(string Code);
public record MealStubScanResult(
    string Status, string? FullName, string? Label, decimal Value, string? Color, string? Message = null);
// Running tally for the merchant scanner: how many stubs this user has ever redeemed
// (persists across sessions) and their total peso value.
public record MealScanTallyDto(int Count, decimal Value);
// Admin board: per-registrant stub summary.
public record MealStubRow(
    int RegistrationId, string FullName, string? Organization, string Email,
    bool Confirmed, int StubCount, int RedeemedCount, decimal Value, decimal ValueRedeemed);
public record MealStubBoardDto(int TotalStubs, int RedeemedStubs, decimal ValueRedeemed, List<MealStubRow> Rows);
public record RedeemStubsRequest(List<int> RegistrationIds, string? RedeemedBy, bool SelfClaimed);
public record RedeemStubsResult(int Redeemed, int NoStubs);
public record UnredeemStubsRequest(List<int> RegistrationIds);
public record UnredeemStubsResult(int Cleared);

// One issued stub, segregated per participant (shows which merchant redeemed it).
public record MealStubDetailDto(
    int StubId, int RegistrationId, string FullName, string? Organization,
    int Day, string Name, decimal Denomination, string? Color, string ControlNumber,
    DateTime? RedeemedAt, string? RedeemedBy, string? RedeemedMethod);
// Per-stub admin actions (by stub id).
public record StubIdsRequest(List<int> StubIds, string? RedeemedBy, bool SelfClaimed);
public record StubIdsResult(int Affected);

public record ContactDto(int Id, string FullName, string Email, string? Organization);

public record FeedbackRequest(int Rating, string? Comment);
public record FeedbackDto(int Id, int EventId, string FullName, int Rating, string? Comment, DateTime CreatedAt);
public record EventFeedbackSummary(int Count, double AverageRating, List<FeedbackDto> Items);

public record DashboardSummary(
    int TotalEvents, int UpcomingEvents, int TotalRegistrations, int TotalCheckedIn,
    double CheckInRate, List<EventDto> RecentEvents);

// Registration breakdown by chapter (the registrant's chapter): total registrations and how
// many of those have claimed the event kit.
public record ChapterCount(string Chapter, int Count, int KitClaimed);
public record EventChapterBreakdown(
    int EventId, string EventTitle, DateTime StartsAt, int TotalRegistrations, int TotalKitClaimed,
    List<ChapterCount> Chapters);
