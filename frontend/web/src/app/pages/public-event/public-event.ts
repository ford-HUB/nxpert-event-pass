import { ChangeDetectorRef, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { OfflineService } from '../../core/offline.service';
import { ToastService } from '../../core/toast.service';
import { EventDto, MealDto } from '../../core/models';
import { DynamicFieldsComponent } from '../../shared/dynamic-fields/dynamic-fields';
import { FaceCaptureDialogComponent, FaceCaptureResult } from '../../shared/face-capture-dialog';
import { formatPhMobile, isCompletePhMobile } from '../../shared/ph-phone';

@Component({
  selector: 'app-public-event',
  imports: [
    DatePipe,
    DecimalPipe,
    FormsModule,
    RouterLink,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatCheckboxModule,
    MatDialogModule,
    MatProgressSpinnerModule,
    DynamicFieldsComponent,
  ],
  templateUrl: './public-event.html',
})
export class PublicEventComponent implements OnInit {
  protected auth = inject(AuthService);
  private api = inject(ApiService);
  protected offline = inject(OfflineService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private cdr = inject(ChangeDetectorRef);
  private toast = inject(ToastService);
  private dialog = inject(MatDialog);

  slug = '';
  loading = signal(true);
  event = signal<EventDto | null>(null);
  error = signal<string | null>(null);

  // Guest form (anonymous visitors)
  fullName = '';
  senateNo = '';
  email = '';
  phone = '';
  // Where the entry pass is sent once confirmed. The matching contact(s) become required.
  // "Both" sends via email AND Viber, requiring both an email and a mobile number.
  notificationChannel: 'Email' | 'Viber' | 'Both' = 'Email';

  // Optional facial registration (guest opt-in). A face is only sent when the guest has both
  // consented and captured one. Used for face check-in at the event.
  faceConsent = false;
  capturedFace = signal<string | null>(null); // JSON 128-float descriptor

  // Live-format the phone field to the PH mobile mask "+63 9XX XXX XXXX".
  onPhoneInput(e: Event): void {
    const input = e.target as HTMLInputElement;
    this.phone = formatPhMobile(input.value);
    input.value = this.phone;
  }

  // Which channel(s) the pass is delivered on (Both = email + Viber). The chosen channel only
  // decides where the pass is sent — email and phone are always collected regardless.
  usesEmail = () => this.notificationChannel === 'Email' || this.notificationChannel === 'Both';
  usesViber = () => this.notificationChannel === 'Viber' || this.notificationChannel === 'Both';

  // Email and mobile number are both always required, independent of the delivery channel.
  guestContactValid(): boolean {
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.email.trim());
    const phoneOk = isCompletePhMobile(this.phone);
    return emailOk && phoneOk;
  }

  registering = signal(false);

  // Sub-event (session) selection
  selectedSessions = signal<Set<number>>(new Set());
  hasSessions = computed(() => (this.event()?.sessions?.length ?? 0) > 0);
  // Sessions grouped by calendar day for display.
  sessionDays = computed(() => {
    const list = [...(this.event()?.sessions ?? [])].sort(
      (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
    );
    const groups = new Map<string, typeof list>();
    for (const s of list) {
      const day = new Date(s.startsAt).toDateString();
      (groups.get(day) ?? groups.set(day, []).get(day)!).push(s);
    }
    return [...groups.entries()].map(([day, sessions]) => ({ day, sessions }));
  });

  // Total face value of a sub-event's meal stubs (Σ denomination × quantity).
  mealTotal(s: { meals?: { denomination: number; quantity: number }[] }): number {
    return (s.meals ?? []).reduce((sum, m) => sum + m.denomination * m.quantity, 0);
  }
  hasMeals(s: { meals?: unknown[] }): boolean {
    return (s.meals?.length ?? 0) > 0;
  }

  // Event-level meal stubs grouped by day (for events with no sub-events).
  mealDaysOf(e: EventDto): { day: number; stubs: MealDto[]; total: number }[] {
    const map = new Map<number, MealDto[]>();
    for (const m of e.meals ?? []) {
      const list = map.get(m.day) ?? map.set(m.day, []).get(m.day)!;
      list.push(m);
    }
    return [...map.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([day, stubs]) => ({
        day,
        stubs,
        total: stubs.reduce((s, m) => s + m.denomination * m.quantity, 0),
      }));
  }

  toggleSession(id: number): void {
    const next = new Set(this.selectedSessions());
    next.has(id) ? next.delete(id) : next.add(id);
    this.selectedSessions.set(next);
  }
  isSessionSelected(id: number): boolean {
    return this.selectedSessions().has(id);
  }

  // Shared success state (set by either the account or guest path). Registrations are
  // pending admin confirmation — no pass is issued here; it arrives by email once confirmed.
  done = signal(false);
  attendeeName = signal('');
  hasEmail = signal(false);
  // The guest's chosen pass-delivery channel (drives the success message); null for account flow.
  deliveryChannel = signal<'Email' | 'Viber' | 'Both' | null>(null);
  isAccount = signal(false);
  createdCount = signal(0);
  queuedOffline = signal(false); // registration was saved on-device pending sync
  // Registration token for the "Edit your response" link (only when the event has form fields).
  editToken = signal<string | null>(null);
  hasFormFields = computed(() => (this.event()?.formFields?.length ?? 0) > 0);

  // "Lost my link" recovery (B): email/Viber the edit link to an existing registrant.
  showEditLookup = signal(false);
  editContact = '';
  editLinkSending = signal(false);
  editLinkSent = signal(false);
  // Recovery (A): verify Senate No. + registered name, then go straight to the edit page.
  editSenateNo = '';
  editName = '';
  editResolving = signal(false);

  ngOnInit(): void {
    this.slug = this.route.snapshot.paramMap.get('slug') ?? '';
    this.api.getPublicEvent(this.slug).subscribe({
      next: (e) => {
        this.event.set(e);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(
          err?.status === 404
            ? 'This event could not be found.'
            : (err?.error?.message ?? 'This event is not available.'),
        );
        this.loading.set(false);
      },
    });

    // Magic-link: if the URL carries an invite token and no one is signed in, resolve it —
    // registered invitees are auto-logged-in (→ auto-filled account flow); otherwise we
    // prefill the guest form with the invited email.
    const inviteToken = this.route.snapshot.queryParamMap.get('invite');
    if (inviteToken && !this.auth.isLoggedIn()) {
      this.auth.resolveInvite(inviteToken).subscribe({
        next: (res) => {
          // Registered invitees are auto-logged-in via a signal (re-renders on its own).
          // For guests we prefill the email; nudge change detection since this is a plain
          // field mutated in an async callback (the app runs zoneless).
          if (!res.registered) {
            this.email = res.email;
            this.cdr.detectChanges();
          }
        },
        error: () => {},
      });
    }
  }

  // ---- Logged-in account holders: original behavior (auto-filled, lands in My Events) ----
  registerAsUser(dyn?: DynamicFieldsComponent): void {
    const e = this.event();
    if (!e) return;
    const ids = [...this.selectedSessions()];
    if (this.hasSessions() && ids.length === 0) {
      this.toast.warning('Please select at least one sub-event.');
      return;
    }
    this.registering.set(true);
    this.api.registerForEvent(e.id, ids, dyn?.collect() ?? {}).subscribe({
      next: (res) => {
        this.showSuccess(res.attendeeName || this.auth.fullName(), true, true, res.created, res.editToken ?? null);
        this.registering.set(false);
      },
      error: (err) => {
        this.registering.set(false);
        this.toast.error(err?.error?.message ?? 'Registration failed. Please try again.');
      },
    });
  }

  // ---- Anonymous visitors: guest pass, no account created ----
  registerAsGuest(dyn?: DynamicFieldsComponent): void {
    if (!this.fullName.trim()) {
      this.toast.warning('Please enter your name.');
      return;
    }
    if (!this.senateNo.trim()) {
      this.toast.warning('Please enter your ID No.');
      return;
    }
    const ids = [...this.selectedSessions()];
    if (this.hasSessions() && ids.length === 0) {
      this.toast.warning('Please select at least one sub-event.');
      return;
    }
    // Validate the contact(s) for the chosen pass-delivery channel.
    if (!this.guestContactValid()) {
      this.toast.warning(
        this.notificationChannel === 'Viber'
          ? 'Please enter a valid Philippine mobile number (+63 9XX XXX XXXX).'
          : this.notificationChannel === 'Both'
            ? 'Please enter a valid email and mobile number.'
            : 'Please enter a valid email address to receive your pass.',
      );
      return;
    }
    const responses = dyn?.collect() ?? {};

    // Offline: queue the registration on this device; it syncs when the connection returns.
    if (!this.offline.online()) {
      void this.queueGuest(ids, responses);
      return;
    }

    this.registering.set(true);
    this.api
      .guestRegister(this.slug, {
        fullName: this.fullName.trim(),
        senateNo: this.senateNo.trim() || null,
        email: this.email.trim() || null,
        phone: this.phone.trim() || null,
        notificationChannel: this.notificationChannel,
        sessionIds: ids,
        responses,
        face: this.guestFace(),
        displayPicture: this.displayPicture(),
      })
      .subscribe({
        next: (res) => {
          this.deliveryChannel.set(this.notificationChannel);
          this.showSuccess(
            this.fullName.trim(), this.usesEmail(), false, res.created, res.editToken ?? null,
          );
          this.registering.set(false);
        },
        error: (err) => {
          // Lost connectivity mid-request → fall back to the offline queue instead of failing.
          if (!this.offline.online() || err?.status === 0) {
            void this.queueGuest(ids, responses);
            return;
          }
          this.registering.set(false);
          this.toast.error(err?.error?.message ?? 'Registration failed. Please try again.');
        },
      });
  }

  // Store a guest registration locally for later sync (used when there's no network).
  private async queueGuest(sessionIds: number[], responses: Record<string, string>): Promise<void> {
    this.registering.set(true);
    try {
      await this.offline.queueRegistration({
        slug: this.slug,
        fullName: this.fullName.trim(),
        senateNo: this.senateNo.trim() || null,
        email: this.email.trim() || null,
        phone: this.phone.trim() || null,
        notificationChannel: this.notificationChannel,
        sessionIds,
        responses,
        registeredAt: new Date().toISOString(),
        face: this.guestFace(),
        displayPicture: this.displayPicture(),
      });
      this.queuedOffline.set(true);
      this.deliveryChannel.set(this.notificationChannel);
      this.showSuccess(this.fullName.trim(), this.usesEmail(), false, 1);
    } catch {
      this.toast.error('Could not save your registration on this device. Please try again.');
    } finally {
      this.registering.set(false);
    }
  }

  private showSuccess(
    name: string,
    hasEmail: boolean,
    account: boolean,
    created: number,
    editToken: string | null = null,
  ): void {
    this.attendeeName.set(name);
    this.hasEmail.set(hasEmail);
    this.isAccount.set(account);
    this.createdCount.set(created);
    this.editToken.set(editToken);
    this.done.set(true);
  }

  // ---- Optional facial registration ----
  // The face descriptor to submit — only when consent is given AND a face was captured.
  private guestFace(): string | null {
    return this.faceConsent ? this.capturedFace() : null;
  }

  captureFace(): void {
    if (!this.faceConsent) {
      this.toast.warning('Please tick the consent box first.');
      return;
    }
    this.dialog
      .open(FaceCaptureDialogComponent, { width: '420px', maxWidth: '94vw', autoFocus: false })
      .afterClosed()
      .subscribe((res: FaceCaptureResult | undefined) => {
        if (res) {
          this.capturedFace.set(JSON.stringify(res.descriptor));
          this.cdr.detectChanges();
        }
      });
  }

  removeFace(): void {
    this.capturedFace.set(null);
  }

  // ---- Display picture (profile photo shown to staff during check-in) ----
  displayPicture = signal<string | null>(null); // compressed data URL
  displayPictureError = signal<string | null>(null);

  onDisplayPictureSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // allow re-picking the same file
    if (!file) return;

    this.displayPictureError.set(null);
    if (!file.type.startsWith('image/')) {
      this.displayPictureError.set('Please choose an image file.');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      this.displayPictureError.set('Image is too large (max 8 MB).');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        // Downscale so the stored data URL stays small (square-ish profile crop is fine as-is).
        const maxDim = 512;
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
        this.displayPicture.set(canvas.toDataURL('image/jpeg', 0.85));
        this.cdr.detectChanges();
      };
      img.onerror = () => {
        this.displayPictureError.set('Could not read that image.');
        this.cdr.detectChanges();
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  }

  removeDisplayPicture(): void {
    this.displayPicture.set(null);
    this.displayPictureError.set(null);
  }

  // Recovery (A): verify Senate No. + registered name, then redirect straight to the edit page.
  goToEditBySenate(): void {
    const senate = this.editSenateNo.trim();
    const name = this.editName.trim();
    if (!senate || !name) {
      this.toast.warning('Enter your ID No. and the name you registered with.');
      return;
    }
    this.editResolving.set(true);
    this.api.resolveEditToken(this.slug, senate, name).subscribe({
      next: (r) => {
        this.editResolving.set(false);
        this.router.navigate(['/r', r.token]);
      },
      error: (err) => {
        this.editResolving.set(false);
        this.toast.error(
          err?.error?.message ??
            'No matching registration was found. Please check your ID No. and name.',
        );
      },
    });
  }

  // Recovery (B): email/Viber the edit link to whoever registered with this contact.
  sendEditLink(): void {
    const contact = this.editContact.trim();
    if (!contact) {
      this.toast.warning('Enter the email or mobile number you registered with.');
      return;
    }
    this.editLinkSending.set(true);
    this.api.requestEditLink(this.slug, contact).subscribe({
      next: (r) => {
        this.editLinkSending.set(false);
        this.editLinkSent.set(true);
        this.toast.success(r.message);
      },
      error: () => {
        this.editLinkSending.set(false);
        this.toast.error('Could not send the edit link. Please try again.');
      },
    });
  }

  goSignIn(): void {
    this.router.navigate(['/login'], { queryParams: { returnUrl: `/e/${this.slug}` } });
  }

  // Reason registration is unavailable (closed / full), or null if open.
  blockedReason(): string | null {
    const e = this.event();
    if (!e) return null;
    if (e.status === 'Closed') return 'Registration for this event is closed.';
    if (e.isFull) return 'This event is already full.';
    return null;
  }
}
