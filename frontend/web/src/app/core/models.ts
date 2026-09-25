export interface AuthResponse {
  token: string;
  userId: number;
  fullName: string;
  email: string;
  username: string;
  role: 'Admin' | 'Participant' | 'SuperAdmin' | 'Merchant';
  emailVerified: boolean;
  verificationRequired: boolean;
  senateNo: string | null;
  firstName: string | null;
  middleInitial: string | null;
  lastName: string | null;
  level: string | null;
  photoUrl: string | null;
  canConfirmRegistrations: boolean;
}

export interface UserDto {
  id: number;
  fullName: string;
  firstName: string | null;
  middleInitial: string | null;
  lastName: string | null;
  senateNo: string | null;
  level: string | null;
  email: string;
  username: string;
  role: 'Admin' | 'Participant' | 'SuperAdmin' | 'Merchant';
  organization: string | null;
  phone: string | null;
  notificationChannel: NotificationChannel;
  canConfirmRegistrations: boolean;
  emailVerified: boolean;
  createdAt: string;
  photoUrl: string | null;
  hasFace: boolean;
}

// Where a member's entry pass + notifications are delivered. Viber/Both require a phone number.
export type NotificationChannel = 'Email' | 'Viber' | 'Both';

export interface FaceDescriptorDto {
  userId: number;
  fullName: string;
  descriptor: number[];
}
// A guest registration's face for an event (matched by the scanner, checked in by token).
export interface RegistrationFace {
  token: string;
  name: string;
  descriptor: number[];
}

// ---- Realtime notifications (pushed over the SignalR hub) ----
export interface NewRegistrationNotice {
  eventId: number;
  eventTitle: string;
  attendeeName: string;
  sessionTitle: string | null;
  count: number;
  isGuest: boolean;
  at: string;
}
export interface RegistrationApprovedNotice {
  registrationId: number;
  eventId: number;
  eventTitle: string;
  sessionTitle: string | null;
  at: string;
}
export interface KitClaimedNotice {
  registrationId: number;
  eventId: number;
  eventTitle: string;
  sessionTitle: string | null;
  claimedBy: string | null;
  at: string;
}
// A notification as held in the client's in-app notification list.
export interface AppNotification {
  id: string;
  kind: 'newRegistration' | 'registrationApproved' | 'kitClaimed';
  icon: string;
  title: string;
  body: string;
  at: string;
  read: boolean;
  link?: string;
}

// ---- Offline bundle (mirrors the backend OfflineBundleDto) ----
export interface OfflineEvent {
  id: number;
  title: string;
  publicSlug: string;
  welcomeMessage: string | null;
  startsAt: string;
  endsAt: string;
  venue: string;
  status: string;
  isPublicLinkEnabled: boolean;
  bannerImage: string | null;
}
export interface OfflineSession {
  id: number;
  title: string;
  startsAt: string;
  endsAt: string;
  venue: string | null;
  capacity: number | null;
}
export interface OfflineMember {
  userId: number;
  fullName: string;
  level: string | null;
  senateNo: string | null;
  organization: string | null;
  photoUrl: string | null;
  face: number[] | null;
}
export interface OfflineReg {
  token: string;
  userId: number | null;
  guestName: string | null;
  sessionId: number | null;
  confirmed: boolean;
  checkedInAt: string | null;
  face: number[] | null; // guest's face descriptor (account faces are on OfflineMember)
}
export interface OfflineBundle {
  event: OfflineEvent;
  sessions: OfflineSession[];
  members: OfflineMember[];
  registrations: OfflineReg[];
  formFields: FormFieldDef[];
  generatedAt: string;
}

export interface SyncCheckInResult {
  applied: number;
  alreadyChecked: number;
  notFound: number;
}
export interface OfflineRegSyncResult {
  created: number;
  skipped: number;
}
export interface QueuedCheckIn {
  eventId: number;
  token: string;
  checkedInAt: string;
}
export interface QueuedRegistration {
  slug: string;
  fullName: string;
  senateNo?: string | null;
  email: string | null;
  phone: string | null;
  notificationChannel: string;
  sessionIds: number[];
  responses: Record<string, string>;
  registeredAt: string;
  face?: string | null; // JSON descriptor captured during offline registration
  displayPicture?: string | null; // profile photo data URL captured during offline registration
}

// ---- Bulk user import (spreadsheet upload) ----
export interface UserImportRow {
  firstName?: string | null;
  middleInitial?: string | null;
  lastName?: string | null;
  senateNo?: string | null;
  level?: string | null;
  email?: string | null;
  username?: string | null;
  organization?: string | null;
  phone?: string | null;
  role?: string | null;
  notificationChannel?: string | null;
}
export interface UserImportError {
  row: number;
  name: string;
  message: string;
}
export interface UserImportResult {
  created: number;
  skipped: number;
  failed: number;
  errors: UserImportError[];
}

export interface AdminUserUpsert {
  firstName: string;
  middleInitial?: string | null;
  lastName: string;
  username?: string | null;
  senateNo?: string | null;
  level?: string | null;
  email: string;
  password?: string | null;
  role: string;
  organization?: string | null;
  phone?: string | null;
  canConfirmRegistrations: boolean;
  photo?: string | null;
  face?: string | null; // JSON array of 128 floats; null = unchanged, "" = clear
  notificationChannel: NotificationChannel;
}

export interface VerifyEmailResult {
  success: boolean;
  message: string;
}

export interface ProfileDto {
  id: number;
  firstName: string | null;
  middleInitial: string | null;
  lastName: string | null;
  senateNo: string | null;
  level: string | null;
  email: string;
  organization: string | null;
  phone: string | null;
  notificationChannel: NotificationChannel;
  photoUrl: string | null;
  role: string;
  hasFace: boolean;
}

export interface ProfileUpdate {
  firstName: string;
  middleInitial?: string | null;
  lastName: string;
  senateNo?: string | null;
  level?: string | null;
  organization?: string | null;
  phone?: string | null;
  photo?: string | null;
  currentPassword?: string | null;
  newPassword?: string | null;
  notificationChannel: NotificationChannel;
  face?: string | null; // JSON array of 128 floats; null = unchanged, "" = clear
}

export interface InviteResolveResult {
  registered: boolean;
  email: string;
  eventSlug: string;
  auth: AuthResponse | null;
}

export type FieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'date'
  | 'time'
  | 'select'
  | 'multiselect'
  | 'radio'
  | 'checkbox'
  | 'image';

export interface FormFieldDef {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  options?: string[] | null;
  placeholder?: string | null;
  category?: string | null;
  // Conditional visibility: this field only shows (and is only required/collected) when the answer
  // to the field with key `showWhenField` equals `showWhenValue`. Null/absent = always shown.
  showWhenField?: string | null;
  showWhenValue?: string | null;
}

export interface ScheduleItem {
  day: string | null;
  time: string | null;
  activity: string;
}

export interface MealDto {
  id: number;
  name: string;
  denomination: number;
  quantity: number;
  color: string | null;
  day: number;
  validFrom: string;
  validTo: string;
}

export interface MealUpsert {
  id: number; // 0 for a new stub
  name: string;
  denomination: number;
  quantity: number;
  color: string | null;
  day: number;
  validFrom: string | null;
  validTo: string | null;
}

export interface SessionDto {
  id: number;
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string;
  venue: string | null;
  capacity: number | null;
  registeredCount: number;
  checkedInCount: number;
  isFull: boolean;
  posterImage: string | null;
  meals: MealDto[];
}

export interface SessionUpsert {
  id: number; // 0 for a new sub-event
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string;
  venue: string | null;
  capacity: number | null;
  posterImage: string | null;
  meals: MealUpsert[];
}

export interface EventDto {
  id: number;
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
  venue: string;
  isPublicLinkEnabled: boolean;
  publicSlug: string;
  status: string;
  registeredCount: number;
  checkedInCount: number;
  capacity: number | null;
  isFull: boolean;
  formFields: FormFieldDef[];
  bannerImage: string | null;
  welcomeMessage: string | null;
  sessions: SessionDto[];
  registrationFees: string | null;
  schedule: ScheduleItem[];
  notifyOnKitClaim: boolean;
  meals: MealDto[]; // event-level (per-day) meal stubs (no-sub-event events)
}

export interface EventUpsert {
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
  venue: string;
  isPublicLinkEnabled: boolean;
  status: string;
  capacity: number | null;
  formFields: FormFieldDef[];
  bannerImage: string | null;
  welcomeMessage: string | null;
  sessions: SessionUpsert[];
  registrationFees: string | null;
  schedule: ScheduleItem[];
  notifyOnKitClaim: boolean;
  meals: MealUpsert[]; // event-level (per-day) meal stubs
}

export interface RegistrationDto {
  id: number;
  eventId: number;
  eventTitle: string;
  startsAt: string;
  venue: string;
  token: string;
  registeredAt: string;
  confirmedAt: string | null;
  checkedInAt: string | null;
  sessionId: number | null;
  sessionTitle: string | null;
  sessionPosterImage: string | null;
  hasFormFields: boolean;
}

export interface RegistrationFormDto {
  eventTitle: string;
  sessionTitle: string | null;
  formFields: FormFieldDef[];
  responses: Record<string, string>;
}

export interface RegisterResult {
  created: number;
  alreadyRegistered: number;
  eventTitle: string;
  attendeeName: string;
  // Registration token for the public "edit your response" link (null when the event has no form fields).
  editToken?: string | null;
}

// Public (token-scoped) registration form for the guest edit page.
export interface PublicRegistrationForm {
  eventTitle: string;
  sessionTitle: string | null;
  eventSlug: string;
  attendeeName: string;
  formFields: FormFieldDef[];
  responses: Record<string, string>;
  editable: boolean;
  lockReason: string | null;
}

export interface CheckInResult {
  // 'error' is a client-only status the offline path uses when no bundle is cached; the API never returns it.
  status: 'valid' | 'already' | 'invalid' | 'unconfirmed' | 'notstarted' | 'ended' | 'error';
  fullName: string | null;
  eventTitle: string | null;
  checkedInAt: string | null;
  message: string | null;
  level: string | null;
  senateNo: string | null;
  organization: string | null;
  welcomeMessage: string | null;
  photoUrl: string | null;
  sessionTitle: string | null;
}

export interface AttendeeDto {
  registrationId: number;
  fullName: string;
  email: string;
  organization: string | null;
  senateNo: string | null;
  phone: string | null;
  registeredAt: string;
  confirmedAt: string | null;
  checkedInAt: string | null;
  responses: Record<string, string> | null;
  sessionId: number | null;
  sessionTitle: string | null;
  checkInMethod: string | null;
  kitClaimedAt: string | null;
  kitClaimedBy: string | null;
  mealValue: number;
  mealCount: number;
  mealsRedeemedAt: string | null;
  mealsRedeemedBy: string | null;
}

export interface ConfirmResult {
  confirmed: number;
  emailed: number;
  alreadyConfirmed: number;
  noEmail: number;
}

export interface ManualCheckInResult {
  checkedIn: number;
  alreadyCheckedIn: number;
  unconfirmed: number;
}

export interface ClaimKitResult {
  claimed: number;
  alreadyClaimed: number;
  notified: number;
}

export interface UnclaimKitResult {
  cleared: number;
}

export interface RedeemMealsResult {
  redeemed: number;
  alreadyRedeemed: number;
  noMeals: number;
  unconfirmed: number;
}

export interface UnredeemMealsResult {
  cleared: number;
}

export interface MealScanResult {
  status: string; // valid | already | invalid | unconfirmed | nomeals
  fullName: string | null;
  sessionTitle: string | null;
  value: number;
  count: number;
  message: string | null;
}

// Event-level (per-day) meal board.
export interface MealDayDto {
  day: number;
  value: number;
  count: number;
  stubs: MealDto[];
}

export interface MealBoardRow {
  registrationId: number;
  fullName: string;
  organization: string | null;
  email: string;
  registeredAt: string;
  confirmed: boolean;
  redeemedDays: number[];
}

export interface MealBoardDto {
  days: MealDayDto[];
  rows: MealBoardRow[];
}

export interface RedeemMealDayResult {
  redeemed: number;
  alreadyRedeemed: number;
  unconfirmed: number;
}

export interface UnredeemMealDayResult {
  cleared: number;
}

// Individually-issued meal stubs (control-number based).
export interface MealStubScanResult {
  status: string; // valid | already | invalid
  fullName: string | null;
  label: string | null;
  value: number;
  color: string | null;
  message: string | null;
}

// A merchant's all-time redemption tally (persists across sessions).
export interface MealScanTally {
  count: number;
  value: number;
}

export interface MealStubRow {
  registrationId: number;
  fullName: string;
  organization: string | null;
  email: string;
  confirmed: boolean;
  stubCount: number;
  redeemedCount: number;
  value: number;
  valueRedeemed: number;
}

export interface MealStubBoardDto {
  totalStubs: number;
  redeemedStubs: number;
  valueRedeemed: number;
  rows: MealStubRow[];
}

export interface RedeemStubsResult {
  redeemed: number;
  noStubs: number;
}

export interface UnredeemStubsResult {
  cleared: number;
}

// One issued stub, segregated per participant (shows which merchant redeemed it).
export interface MealStubDetailDto {
  stubId: number;
  registrationId: number;
  fullName: string;
  organization: string | null;
  day: number;
  name: string;
  denomination: number;
  color: string | null;
  controlNumber: string;
  redeemedAt: string | null;
  redeemedBy: string | null;
  redeemedMethod: string | null;
}

export interface StubIdsResult {
  affected: number;
}

export interface ContactDto {
  id: number;
  fullName: string;
  email: string;
  organization: string | null;
}

export type MobileProvider = 'Viber' | 'Sms';

export interface AppSettingsDto {
  ccEmails: string[];
  mobileProvider: MobileProvider;
}

export interface FeedbackDto {
  id: number;
  eventId: number;
  fullName: string;
  rating: number;
  comment: string | null;
  createdAt: string;
}

export interface EventFeedbackSummary {
  count: number;
  averageRating: number;
  items: FeedbackDto[];
}

export interface DashboardSummary {
  totalEvents: number;
  upcomingEvents: number;
  totalRegistrations: number;
  totalCheckedIn: number;
  checkInRate: number;
  recentEvents: EventDto[];
}

export interface ChapterCount {
  chapter: string;
  count: number;
  kitClaimed: number;
}

export interface EventChapterBreakdown {
  eventId: number;
  eventTitle: string;
  startsAt: string;
  totalRegistrations: number;
  totalKitClaimed: number;
  chapters: ChapterCount[];
}
