import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_BASE } from './config';
import {
  AdminUserUpsert,
  AppSettingsDto,
  MobileProvider,
  AuthResponse,
  AttendeeDto,
  CheckInResult,
  ClaimKitResult,
  ConfirmResult,
  ContactDto,
  DashboardSummary,
  EventChapterBreakdown,
  MealBoardDto,
  MealScanResult,
  MealScanTally,
  MealStubBoardDto,
  MealStubDetailDto,
  MealStubScanResult,
  StubIdsResult,
  RedeemMealDayResult,
  RedeemMealsResult,
  RedeemStubsResult,
  UnredeemMealDayResult,
  UnredeemMealsResult,
  UnredeemStubsResult,
  EventDto,
  EventFeedbackSummary,
  EventUpsert,
  FaceDescriptorDto,
  FeedbackDto,
  ManualCheckInResult,
  OfflineBundle,
  UnclaimKitResult,
  OfflineRegSyncResult,
  ProfileDto,
  ProfileUpdate,
  PublicRegistrationForm,
  RegisterResult,
  RegistrationDto,
  RegistrationFace,
  RegistrationFormDto,
  SyncCheckInResult,
  UserDto,
  UserImportRow,
  UserImportResult,
} from './models';

@Injectable({ providedIn: 'root' })
export class ApiService {
  constructor(private http: HttpClient) {}
  private url(path: string) {
    return `${API_BASE}${path}`;
  }

  // ---- Events ----
  listEvents(): Observable<EventDto[]> {
    return this.http.get<EventDto[]>(this.url('/api/events'));
  }
  getEvent(id: number): Observable<EventDto> {
    return this.http.get<EventDto>(this.url(`/api/events/${id}`));
  }
  getPublicEvent(slug: string): Observable<EventDto> {
    return this.http.get<EventDto>(this.url(`/api/events/public/${slug}`));
  }
  browseEvents(): Observable<EventDto[]> {
    return this.http.get<EventDto[]>(this.url('/api/events/browse'));
  }
  // ---- Offline ----
  getOfflineBundle(eventId: number): Observable<OfflineBundle> {
    return this.http.get<OfflineBundle>(this.url(`/api/events/${eventId}/offline-bundle`));
  }
  syncCheckIns(items: { token: string; checkedInAt: string }[]): Observable<SyncCheckInResult> {
    return this.http.post<SyncCheckInResult>(this.url('/api/checkin/sync'), { items });
  }
  syncOfflineRegistrations(
    slug: string,
    items: {
      fullName: string;
      senateNo?: string | null;
      email: string | null;
      phone: string | null;
      notificationChannel: string;
      sessionIds: number[];
      responses: Record<string, string>;
      registeredAt: string;
      face?: string | null;
      displayPicture?: string | null;
    }[],
  ): Observable<OfflineRegSyncResult> {
    return this.http.post<OfflineRegSyncResult>(this.url('/api/registrations/offline-sync'), {
      slug,
      items,
    });
  }
  createEvent(body: EventUpsert): Observable<EventDto> {
    return this.http.post<EventDto>(this.url('/api/events'), body);
  }
  updateEvent(id: number, body: EventUpsert): Observable<EventDto> {
    return this.http.put<EventDto>(this.url(`/api/events/${id}`), body);
  }
  deleteEvent(id: number): Observable<void> {
    return this.http.delete<void>(this.url(`/api/events/${id}`));
  }
  closeEvent(id: number): Observable<EventDto> {
    return this.http.post<EventDto>(this.url(`/api/events/${id}/close`), {});
  }
  reopenEvent(id: number): Observable<EventDto> {
    return this.http.post<EventDto>(this.url(`/api/events/${id}/reopen`), {});
  }
  viberRecipientCount(eventId: number): Observable<{ count: number }> {
    return this.http.get<{ count: number }>(this.url(`/api/events/${eventId}/viber-recipients`));
  }
  viberBroadcast(eventId: number, message: string): Observable<{ sent: number; message: string }> {
    return this.http.post<{ sent: number; message: string }>(
      this.url(`/api/events/${eventId}/viber-broadcast`),
      { message },
    );
  }

  // ---- Registrations ----
  myRegistrations(): Observable<RegistrationDto[]> {
    return this.http.get<RegistrationDto[]>(this.url('/api/registrations/mine'));
  }
  registerForEvent(
    eventId: number,
    sessionIds: number[] = [],
    responses: Record<string, string> = {},
  ): Observable<RegisterResult> {
    return this.http.post<RegisterResult>(this.url('/api/registrations'), {
      eventId,
      sessionIds,
      responses,
    });
  }
  guestRegister(
    slug: string,
    body: {
      fullName: string;
      senateNo?: string | null;
      email?: string | null;
      phone?: string | null;
      notificationChannel?: string | null;
      sessionIds?: number[];
      responses?: Record<string, string>;
      face?: string | null;
      displayPicture?: string | null;
    },
  ): Observable<RegisterResult> {
    return this.http.post<RegisterResult>(this.url(`/api/registrations/guest/${slug}`), body);
  }
  getRegistrationForm(registrationId: number): Observable<RegistrationFormDto> {
    return this.http.get<RegistrationFormDto>(
      this.url(`/api/registrations/${registrationId}/form`),
    );
  }
  updateRegistrationResponses(
    registrationId: number,
    responses: Record<string, string>,
  ): Observable<{ message: string }> {
    return this.http.put<{ message: string }>(
      this.url(`/api/registrations/${registrationId}/responses`),
      { responses },
    );
  }
  resendPass(registrationId: number): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(
      this.url(`/api/registrations/${registrationId}/resend-pass`),
      {},
    );
  }
  // ---- Public (token magic-link) response editing — no account needed ----
  getPublicRegistration(token: string): Observable<PublicRegistrationForm> {
    return this.http.get<PublicRegistrationForm>(this.url(`/api/registrations/public/${token}`));
  }
  updatePublicResponses(token: string, responses: Record<string, string>): Observable<{ message: string }> {
    return this.http.put<{ message: string }>(
      this.url(`/api/registrations/public/${token}/responses`),
      { responses },
    );
  }
  // Public recovery: email/Viber the registrant their edit link for this event.
  requestEditLink(slug: string, contact: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(
      this.url(`/api/registrations/public/${slug}/edit-link`),
      { contact },
    );
  }
  // Public recovery (Senate No. + registered name): returns the edit token on a verified match.
  resolveEditToken(slug: string, senateNo: string, name: string): Observable<{ token: string }> {
    return this.http.post<{ token: string }>(
      this.url(`/api/registrations/public/${slug}/edit-token`),
      { senateNo, name },
    );
  }
  cancelRegistration(registrationId: number): Observable<void> {
    return this.http.delete<void>(this.url(`/api/registrations/${registrationId}`));
  }

  // ---- Self-service profile ----
  getMyProfile(): Observable<ProfileDto> {
    return this.http.get<ProfileDto>(this.url('/api/auth/me'));
  }
  updateMyProfile(body: ProfileUpdate): Observable<AuthResponse> {
    return this.http.put<AuthResponse>(this.url('/api/auth/me'), body);
  }

  // ---- Feedback ----
  myFeedback(eventId: number): Observable<FeedbackDto | null> {
    return this.http.get<FeedbackDto | null>(this.url(`/api/events/${eventId}/feedback/mine`));
  }
  submitFeedback(eventId: number, rating: number, comment: string | null): Observable<FeedbackDto> {
    return this.http.post<FeedbackDto>(this.url(`/api/events/${eventId}/feedback`), {
      rating,
      comment,
    });
  }
  feedbackSummary(eventId: number): Observable<EventFeedbackSummary> {
    return this.http.get<EventFeedbackSummary>(this.url(`/api/events/${eventId}/feedback`));
  }

  // ---- Dashboard ----
  dashboard(): Observable<DashboardSummary> {
    return this.http.get<DashboardSummary>(this.url('/api/dashboard/summary'));
  }
  chapterBreakdown(eventId: number): Observable<EventChapterBreakdown> {
    return this.http.get<EventChapterBreakdown>(
      this.url(`/api/dashboard/chapter-breakdown?eventId=${eventId}`),
    );
  }

  // ---- Contacts + invitations ----
  listContacts(): Observable<ContactDto[]> {
    return this.http.get<ContactDto[]>(this.url('/api/contacts'));
  }
  sendInvites(eventId: number, emails: string[]): Observable<{ sent: number; registerUrl: string }> {
    return this.http.post<{ sent: number; registerUrl: string }>(
      this.url(`/api/events/${eventId}/invitations`),
      { emails },
    );
  }

  // ---- Attendance ----
  attendance(eventId: number): Observable<AttendeeDto[]> {
    return this.http.get<AttendeeDto[]>(this.url(`/api/events/${eventId}/attendance`));
  }
  confirmRegistrations(eventId: number, registrationIds: number[]): Observable<ConfirmResult> {
    return this.http.post<ConfirmResult>(this.url(`/api/events/${eventId}/attendance/confirm`), {
      registrationIds,
    });
  }
  manualCheckIn(eventId: number, registrationIds: number[]): Observable<ManualCheckInResult> {
    return this.http.post<ManualCheckInResult>(this.url(`/api/events/${eventId}/attendance/checkin`), {
      registrationIds,
    });
  }
  claimKit(
    eventId: number,
    registrationIds: number[],
    claimedBy: string | null,
    selfClaimed: boolean,
  ): Observable<ClaimKitResult> {
    return this.http.post<ClaimKitResult>(this.url(`/api/events/${eventId}/attendance/claim-kit`), {
      registrationIds,
      claimedBy,
      selfClaimed,
    });
  }
  unclaimKit(eventId: number, registrationIds: number[]): Observable<UnclaimKitResult> {
    return this.http.post<UnclaimKitResult>(this.url(`/api/events/${eventId}/attendance/unclaim-kit`), {
      registrationIds,
    });
  }
  redeemMeals(
    eventId: number,
    registrationIds: number[],
    redeemedBy: string | null,
    selfClaimed: boolean,
  ): Observable<RedeemMealsResult> {
    return this.http.post<RedeemMealsResult>(this.url(`/api/events/${eventId}/attendance/redeem-meals`), {
      registrationIds,
      redeemedBy,
      selfClaimed,
    });
  }
  unredeemMeals(eventId: number, registrationIds: number[]): Observable<UnredeemMealsResult> {
    return this.http.post<UnredeemMealsResult>(this.url(`/api/events/${eventId}/attendance/unredeem-meals`), {
      registrationIds,
    });
  }
  redeemMealByToken(token: string, day?: number | null): Observable<MealScanResult> {
    return this.http.post<MealScanResult>(this.url('/api/checkin/redeem-meals'), { token, day: day ?? null });
  }
  mealBoard(eventId: number): Observable<MealBoardDto> {
    return this.http.get<MealBoardDto>(this.url(`/api/events/${eventId}/attendance/meal-board`));
  }
  redeemMealDay(
    eventId: number,
    registrationIds: number[],
    day: number,
    redeemedBy: string | null,
    selfClaimed: boolean,
  ): Observable<RedeemMealDayResult> {
    return this.http.post<RedeemMealDayResult>(this.url(`/api/events/${eventId}/attendance/redeem-meal-day`), {
      registrationIds,
      day,
      redeemedBy,
      selfClaimed,
    });
  }
  unredeemMealDay(eventId: number, registrationIds: number[], day: number): Observable<UnredeemMealDayResult> {
    return this.http.post<UnredeemMealDayResult>(this.url(`/api/events/${eventId}/attendance/unredeem-meal-day`), {
      registrationIds,
      day,
    });
  }
  // Individually-issued meal stubs. Redemption is open to merchants (meal-scan controller).
  redeemMealStub(code: string): Observable<MealStubScanResult> {
    return this.http.post<MealStubScanResult>(this.url('/api/meal-scan/redeem'), { code });
  }
  // The current merchant's all-time redemption tally (count + value), across all sessions.
  mealScanTally(): Observable<MealScanTally> {
    return this.http.get<MealScanTally>(this.url('/api/meal-scan/my-tally'));
  }
  mealStubBoard(eventId: number): Observable<MealStubBoardDto> {
    return this.http.get<MealStubBoardDto>(this.url(`/api/events/${eventId}/attendance/meal-stubs`));
  }
  // Segregated per-stub list (each stub, with the merchant who redeemed it).
  mealStubList(eventId: number): Observable<MealStubDetailDto[]> {
    return this.http.get<MealStubDetailDto[]>(this.url(`/api/events/${eventId}/attendance/meal-stub-list`));
  }
  redeemStubIds(
    eventId: number,
    stubIds: number[],
    redeemedBy: string | null,
    selfClaimed: boolean,
  ): Observable<StubIdsResult> {
    return this.http.post<StubIdsResult>(this.url(`/api/events/${eventId}/attendance/redeem-stub-ids`), {
      stubIds,
      redeemedBy,
      selfClaimed,
    });
  }
  unredeemStubIds(eventId: number, stubIds: number[]): Observable<StubIdsResult> {
    return this.http.post<StubIdsResult>(this.url(`/api/events/${eventId}/attendance/unredeem-stub-ids`), {
      stubIds,
      redeemedBy: null,
      selfClaimed: false,
    });
  }
  redeemStubs(
    eventId: number,
    registrationIds: number[],
    redeemedBy: string | null,
    selfClaimed: boolean,
  ): Observable<RedeemStubsResult> {
    return this.http.post<RedeemStubsResult>(this.url(`/api/events/${eventId}/attendance/redeem-stubs`), {
      registrationIds,
      redeemedBy,
      selfClaimed,
    });
  }
  unredeemStubs(eventId: number, registrationIds: number[]): Observable<UnredeemStubsResult> {
    return this.http.post<UnredeemStubsResult>(this.url(`/api/events/${eventId}/attendance/unredeem-stubs`), {
      registrationIds,
    });
  }
  exportUrl(eventId: number): string {
    return this.url(`/api/events/${eventId}/attendance/export`);
  }
  exportCsv(eventId: number): Observable<Blob> {
    return this.http.get(this.url(`/api/events/${eventId}/attendance/export`), {
      responseType: 'blob',
    });
  }

  // ---- App settings (admin) ----
  getSettings(): Observable<AppSettingsDto> {
    return this.http.get<AppSettingsDto>(this.url('/api/settings'));
  }
  updateSettings(ccEmails: string[], mobileProvider: MobileProvider): Observable<AppSettingsDto> {
    return this.http.put<AppSettingsDto>(this.url('/api/settings'), { ccEmails, mobileProvider });
  }

  // ---- Check-in ----
  checkIn(token: string): Observable<CheckInResult> {
    return this.http.post<CheckInResult>(this.url('/api/checkin'), { token });
  }
  // Facial recognition identified a user → check them in for this event.
  checkInUser(eventId: number, userId: number): Observable<CheckInResult> {
    return this.http.post<CheckInResult>(this.url('/api/checkin/user'), { eventId, userId });
  }

  // ---- User master (admin) ----
  listUsers(): Observable<UserDto[]> {
    return this.http.get<UserDto[]>(this.url('/api/users'));
  }
  getUser(id: number): Observable<UserDto> {
    return this.http.get<UserDto>(this.url(`/api/users/${id}`));
  }
  createUser(body: AdminUserUpsert): Observable<UserDto> {
    return this.http.post<UserDto>(this.url('/api/users'), body);
  }
  // Bulk-create accounts from a spreadsheet upload (each gets the default password).
  importUsers(rows: UserImportRow[]): Observable<UserImportResult> {
    return this.http.post<UserImportResult>(this.url('/api/users/import'), { rows });
  }
  updateUser(id: number, body: AdminUserUpsert): Observable<UserDto> {
    return this.http.put<UserDto>(this.url(`/api/users/${id}`), body);
  }
  deleteUser(id: number): Observable<void> {
    return this.http.delete<void>(this.url(`/api/users/${id}`));
  }
  // Registered face descriptors, for facial-recognition check-in.
  faceDescriptors(): Observable<FaceDescriptorDto[]> {
    return this.http.get<FaceDescriptorDto[]>(this.url('/api/users/face-descriptors'));
  }
  // Guest-registration faces for an event (token-based), for facial-recognition check-in of guests.
  eventGuestFaceDescriptors(eventId: number): Observable<RegistrationFace[]> {
    return this.http.get<RegistrationFace[]>(this.url(`/api/events/${eventId}/guest-face-descriptors`));
  }
}
