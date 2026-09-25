import { Component, ElementRef, OnDestroy, OnInit, ViewChild, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { Html5Qrcode } from 'html5-qrcode';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ApiService } from '../../core/api.service';
import { FaceService } from '../../core/face.service';
import { OfflineService } from '../../core/offline.service';
import {
  CheckInResult,
  FaceDescriptorDto,
  MealStubScanResult,
  OfflineBundle,
  RegistrationFace,
} from '../../core/models';

type ScanMode = 'camera' | 'barcode' | 'face' | 'auto';
// What a scan does: record attendance (check-in) or redeem the sub-event's meal stubs.
type ScanAction = 'checkin' | 'meal';

// Max descriptor distance to accept a face match (lower = stricter). ~0.5 is a good default.
const FACE_MATCH_THRESHOLD = 0.5;

type BannerState =
  | 'idle'
  | 'valid'
  | 'already'
  | 'invalid'
  | 'unconfirmed'
  | 'notstarted'
  | 'ended'
  | 'nomatch'
  | 'notreg'
  | 'error'
  | 'mealvalid'
  | 'mealalready'
  | 'mealnone'
  | 'mealnotvalid';

@Component({
  selector: 'app-scanner',
  imports: [
    FormsModule,
    RouterLink,
    MatButtonModule,
    MatButtonToggleModule,
    MatIconModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './scanner.html',
  styleUrl: './scanner.scss',
})
export class ScannerComponent implements OnInit, OnDestroy {
  private api = inject(ApiService);
  private route = inject(ActivatedRoute);
  private face = inject(FaceService);
  protected offline = inject(OfflineService);
  private scanner: Html5Qrcode | null = null;
  private readonly regionId = 'qr-reader';

  // Cached offline data for this event (members, registrations). Loaded on init when online,
  // and used to check people in without a network at the venue.
  private bundle: OfflineBundle | null = null;
  syncMsg = signal<string | null>(null);

  // The event this scanner session is for (its title + welcome greeting).
  eventId = 0;
  eventTitle = signal<string>('');
  eventWelcome = signal<string | null>(null);
  // The event's banner image (base64 data URL), shown as a header strip and the TV standby hero.
  eventBanner = signal<string | null>(null);

  // Input source: QR camera, hardware barcode scanner (keyboard-wedge), or facial recognition.
  mode = signal<ScanMode>('camera');
  // What a scan does. Meal redemption is token-based (camera/barcode) and requires a connection.
  scanAction = signal<ScanAction>('checkin');
  mealsRedeemedCount = signal(0);
  barcodeValue = '';
  @ViewChild('barcodeInput') private barcodeInput?: ElementRef<HTMLInputElement>;

  // ---- Facial recognition state ----
  @ViewChild('faceVideo') private faceVideo?: ElementRef<HTMLVideoElement>;
  private faceStream: MediaStream | null = null;
  private faceTimer: ReturnType<typeof setInterval> | null = null;
  private faceBusy = false;
  private enrolled: FaceDescriptorDto[] = []; // user master faces → userId
  private guestFaces: RegistrationFace[] = []; // this event's guest faces → registration token
  private lastMatchedKey = ''; // 'u:{userId}' or 'g:{token}' — guards re-checking the same face
  faceLoading = signal(false);
  faceReady = signal(false);
  faceError = signal<string | null>(null);

  // Guard against firing the same code repeatedly while it sits in frame.
  private lastToken = '';
  private busy = false;
  private resumeTimer: ReturnType<typeof setTimeout> | null = null;

  scanning = signal(false);
  starting = signal(false);
  cameraError = signal<string | null>(null);
  banner = signal<BannerState>('idle');
  resultName = signal<string | null>(null);
  resultEvent = signal<string | null>(null);
  resultMessage = signal<string | null>(null);
  resultLevel = signal<string | null>(null);
  resultSenateNo = signal<string | null>(null);
  resultOrganization = signal<string | null>(null);
  resultWelcome = signal<string | null>(null);
  resultPhoto = signal<string | null>(null);
  resultSession = signal<string | null>(null);
  checkedCount = signal(0);

  // TV / presentation mode: a full-screen welcome display for a big screen at the door.
  tvMode = signal(false);

  ngOnInit(): void {
    this.eventId = +(this.route.snapshot.paramMap.get('eventId') ?? 0);
    if (this.eventId) {
      this.api.getEvent(this.eventId).subscribe({
        next: (e) => {
          this.eventTitle.set(e.title);
          this.eventWelcome.set(e.welcomeMessage);
          this.eventBanner.set(e.bannerImage);
        },
        error: () => {},
      });
      // Download + cache the offline bundle for this event so check-in keeps working with no
      // network. Falls back to any previously cached copy when offline.
      void this.loadBundle();
      // Flush anything queued from a previous offline session.
      if (this.offline.online() && this.offline.pending() > 0) void this.syncNow();
    }
    this.start();
  }

  private async loadBundle(): Promise<void> {
    try {
      this.bundle = await this.offline.refreshBundle(this.eventId);
    } catch {
      this.bundle = null;
    }
  }

  ngOnDestroy(): void {
    this.stop();
    this.stopFace();
  }

  async start(): Promise<void> {
    this.cameraError.set(null);
    this.starting.set(true);
    try {
      this.scanner = new Html5Qrcode(this.regionId, { verbose: false });
      await this.scanner.start(
        { facingMode: 'environment' },
        {
          fps: 10,
          // Adaptive scan box: sized to the actual viewfinder so it stays valid whether the
          // camera is full-size or shrunk into the TV-mode corner preview.
          qrbox: (vw: number, vh: number) => {
            const s = Math.max(120, Math.floor(Math.min(vw, vh) * 0.8));
            return { width: s, height: s };
          },
        },
        (decoded) => this.onScan(decoded),
        () => {}, // per-frame decode failures are noise; ignore
      );
      this.scanning.set(true);
    } catch (err) {
      this.cameraError.set(
        'Could not open the camera. Grant camera permission and use HTTPS (or localhost).',
      );
    } finally {
      this.starting.set(false);
    }
  }

  async stop(): Promise<void> {
    if (this.resumeTimer) clearTimeout(this.resumeTimer);
    if (this.scanner) {
      try {
        if (this.scanner.isScanning) await this.scanner.stop();
        this.scanner.clear();
      } catch {
        /* ignore */
      }
      this.scanner = null;
    }
    this.scanning.set(false);
  }

  // Toggle the big-screen welcome display and (best-effort) browser fullscreen.
  async toggleTv(): Promise<void> {
    const on = !this.tvMode();
    this.tvMode.set(on);
    try {
      if (on) {
        await document.documentElement.requestFullscreen?.();
      } else if (document.fullscreenElement) {
        await document.exitFullscreen?.();
      }
    } catch {
      /* fullscreen may be blocked; TV layout still applies without it */
    }

    // The camera viewfinder changes size between the full view and the corner PiP. Restart
    // the scanner so html5-qrcode recomputes its scan region for the new size — otherwise it
    // keeps the old (mismatched) region and stops detecting QR codes.
    if ((this.mode() === 'camera' || this.mode() === 'auto') && this.scanner) {
      await this.stop();
      // Wait for the fullscreen transition + layout reflow before re-reading the element size.
      // The face loop (auto) keeps running and re-attaches to the new video element automatically.
      setTimeout(() => {
        if (this.mode() === 'camera' || this.mode() === 'auto') this.start();
      }, 300);
    }
  }

  // Switch between check-in and meal-stub redemption. Meal redemption is token-based, so face
  // input isn't available for it — fall back to the QR camera.
  setAction(a: ScanAction): void {
    if (a === this.scanAction()) return;
    this.scanAction.set(a);
    this.banner.set('idle');
    this.busy = false;
    this.lastToken = '';
    // Meal redemption is token-only, so drop face input (dedicated or auto) back to the QR camera.
    if (a === 'meal' && (this.mode() === 'face' || this.mode() === 'auto')) void this.setMode('camera');
  }

  // ---- Input source switching (camera <-> barcode scanner) ----
  async setMode(m: ScanMode): Promise<void> {
    if (m === this.mode()) return;
    await this.stop(); // stop QR camera
    this.stopFace(); // stop face camera
    this.mode.set(m);
    this.barcodeValue = '';
    this.banner.set('idle');
    if (m === 'camera') {
      // Defer so the #qr-reader element is rendered before html5-qrcode attaches to it.
      setTimeout(() => this.start(), 0);
    } else if (m === 'auto') {
      // QR camera + face detection on the same stream.
      setTimeout(() => { void this.start(); void this.startAutoFace(); }, 0);
    } else if (m === 'barcode') {
      this.focusBarcode();
    } else {
      setTimeout(() => this.startFace(), 0);
    }
  }

  // Load the face-match sets (user master + this event's guest faces), online or from the bundle.
  private async loadFaceData(): Promise<void> {
    if (this.enrolled.length > 0 || this.guestFaces.length > 0) return;
    if (this.offline.online()) {
      try {
        this.enrolled = await firstValueFrom(this.api.faceDescriptors());
      } catch {
        this.enrolled = this.enrolledFromBundle();
      }
      // Guests who added a face during public registration (event-scoped, token-based).
      try {
        this.guestFaces = await firstValueFrom(this.api.eventGuestFaceDescriptors(this.eventId));
      } catch {
        this.guestFaces = this.guestFacesFromBundle();
      }
    } else {
      this.enrolled = this.enrolledFromBundle();
      this.guestFaces = this.guestFacesFromBundle();
    }
  }

  // ---- Facial recognition mode (dedicated) ----
  async startFace(): Promise<void> {
    this.faceError.set(null);
    this.faceReady.set(false);
    this.faceLoading.set(true);
    try {
      await this.face.ensureLoaded();
      await this.loadFaceData();
      this.faceStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      const v = this.faceVideo!.nativeElement;
      v.srcObject = this.faceStream;
      await v.play();
      this.faceLoading.set(false);
      this.faceReady.set(true);
      if (this.enrolled.length === 0 && this.guestFaces.length === 0) {
        this.faceError.set('No registered faces yet — register a face in Users, or have guests add one at sign-up.');
      }
      this.faceTimer = setInterval(() => this.detectFace(), 800);
    } catch {
      this.faceLoading.set(false);
      this.faceError.set(
        'Could not start facial recognition. Grant camera permission and use HTTPS (or localhost).',
      );
    }
  }

  // ---- Auto mode: QR + face on the SAME camera (the QR camera's video), QR taking priority ----
  // Reuses the html5-qrcode camera stream; face detection runs on its <video> on a throttle and
  // never opens a second camera. Degrades to QR-only if the face models/data can't load.
  async startAutoFace(): Promise<void> {
    this.faceError.set(null);
    this.faceReady.set(false);
    try {
      await this.face.ensureLoaded();
      await this.loadFaceData();
      this.faceReady.set(true); // detectFace reads the QR camera's video element in auto mode
      if (this.faceTimer) clearInterval(this.faceTimer);
      this.faceTimer = setInterval(() => this.detectFace(), 800);
    } catch {
      // Face couldn't initialize — auto keeps working as QR-only.
      this.faceReady.set(false);
    }
  }

  // The video element face detection reads from: the QR camera's own <video> in auto mode,
  // or the dedicated face-mode video otherwise.
  private faceSourceVideo(): HTMLVideoElement | null {
    if (this.mode() === 'auto') {
      return document.querySelector<HTMLVideoElement>(`#${this.regionId} video`);
    }
    return this.faceVideo?.nativeElement ?? null;
  }

  // Build the face-match set from the cached bundle (members registered for this event who have
  // an enrolled face). Used when there's no network to fetch the live descriptor list.
  private enrolledFromBundle(): FaceDescriptorDto[] {
    return (this.bundle?.members ?? [])
      .filter((m) => m.face && m.face.length > 0)
      .map((m) => ({ userId: m.userId, fullName: m.fullName, descriptor: m.face! }));
  }

  // Guest faces from the cached bundle (guest registrations with a captured face), for offline
  // face check-in of guests. Each maps to a registration token.
  private guestFacesFromBundle(): RegistrationFace[] {
    return (this.bundle?.registrations ?? [])
      .filter((r) => r.userId == null && r.face && r.face.length > 0)
      .map((r) => ({ token: r.token, name: r.guestName ?? 'Guest', descriptor: r.face! }));
  }

  // A face was seen but doesn't match anyone in the user master → "Face not registered".
  private showNoMatch(): void {
    this.banner.set('nomatch');
    this.resultName.set(null);
    this.resultEvent.set(null);
    this.resultMessage.set('This face is not registered in the system.');
    this.resultLevel.set(null);
    this.resultSenateNo.set(null);
    this.resultOrganization.set(null);
    this.resultWelcome.set(null);
    this.resultPhoto.set(null);
    this.resultSession.set(null);
    // faceBusy stays true until scheduleResume clears the banner and resets it.
    this.scheduleResume(2500);
  }

  // Face matched a member in the user master, but they aren't registered for THIS event.
  private showNotRegistered(name: string | null): void {
    this.banner.set('notreg');
    this.resultName.set(name);
    this.resultEvent.set(this.eventTitle() || null);
    this.resultMessage.set('This member is not registered for this event.');
    this.resultLevel.set(null);
    this.resultSenateNo.set(null);
    this.resultOrganization.set(null);
    this.resultWelcome.set(null);
    this.resultPhoto.set(null);
    this.resultSession.set(null);
    this.scheduleResume(3500);
  }

  stopFace(): void {
    if (this.faceTimer) {
      clearInterval(this.faceTimer);
      this.faceTimer = null;
    }
    this.faceStream?.getTracks().forEach((t) => t.stop());
    this.faceStream = null;
    this.faceReady.set(false);
    this.faceBusy = false;
    this.lastMatchedKey = '';
  }

  private async detectFace(): Promise<void> {
    if (this.faceBusy || !this.faceReady()) return;
    // QR priority: never run face while a QR scan is being handled or a result is on screen.
    if (this.busy || this.banner() !== 'idle') return;
    const video = this.faceSourceVideo();
    if (!video || video.readyState < 2) return; // camera not delivering frames yet
    this.faceBusy = true;
    try {
      const desc = await this.face.describe(video);
      if (!desc) {
        this.faceBusy = false;
        return; // no face in frame — keep watching (idle)
      }
      if (this.enrolled.length === 0 && this.guestFaces.length === 0) {
        this.faceBusy = false;
        return; // nothing to match against (an error is already shown)
      }

      // Match against both the user master (→ userId) and this event's guest faces (→ token),
      // keeping whichever is closest.
      let best = Number.POSITIVE_INFINITY;
      let user: FaceDescriptorDto | null = null;
      let guest: RegistrationFace | null = null;
      for (const e of this.enrolled) {
        const d = this.face.distance(desc, e.descriptor);
        if (d < best) { best = d; user = e; guest = null; }
      }
      for (const g of this.guestFaces) {
        const d = this.face.distance(desc, g.descriptor);
        if (d < best) { best = d; guest = g; user = null; }
      }

      if (best <= FACE_MATCH_THRESHOLD && (user || guest)) {
        const key = user ? `u:${user.userId}` : `g:${guest!.token}`;
        if (key === this.lastMatchedKey) {
          this.faceBusy = false;
          return; // same person still in frame — don't re-check
        }
        this.lastMatchedKey = key;
        // faceBusy stays true until the result banner clears (scheduleResume).
        if (user) void this.checkInFace(user.userId, user.fullName);
        else void this.checkInGuestFace(guest!.token, guest!.name);
      } else if (this.mode() === 'auto') {
        // Auto mode is QR-first: an unrecognized face shouldn't interrupt scanning — keep watching.
        this.faceBusy = false;
      } else {
        // Dedicated face mode: a detected face that matches no one is a reportable result.
        this.showNoMatch();
      }
    } catch {
      this.faceBusy = false;
    }
  }

  // Hardware barcode/QR scanners type the code then press Enter into the focused field.
  submitBarcode(): void {
    const v = this.barcodeValue.trim();
    this.barcodeValue = '';
    if (v) this.check(v);
    this.focusBarcode();
  }

  // Keep the barcode field focused so scanner keystrokes always land there.
  onBarcodeBlur(): void {
    if (this.mode() === 'barcode') this.focusBarcode();
  }

  private focusBarcode(): void {
    setTimeout(() => this.barcodeInput?.nativeElement?.focus(), 60);
  }

  private onScan(decoded: string): void {
    if (this.busy || decoded === this.lastToken) return;
    this.busy = true;
    this.lastToken = decoded;
    this.check(decoded);
  }

  // Shared check-in for both the camera and the barcode scanner. Uses the server when online and
  // falls back to the cached offline bundle (queuing the check-in for later sync) otherwise.
  private async check(token: string): Promise<void> {
    // Meal-stub redemption path (token-based, online only).
    if (this.scanAction() === 'meal') {
      await this.redeemMeal(token);
      return;
    }
    try {
      const res = this.offline.online()
        ? await firstValueFrom(this.api.checkIn(token))
        : await this.offline.localCheckIn(this.eventId, token);
      this.showResult(res);
    } catch {
      // Online request failed (e.g. network dropped mid-scan) → try the local bundle.
      try {
        this.showResult(await this.offline.localCheckIn(this.eventId, token));
      } catch {
        this.showError();
      }
    }
  }

  // Redeem the sub-event's meal stubs from a scanned entry-pass token (online only).
  private async redeemMeal(token: string): Promise<void> {
    if (!this.offline.online()) {
      this.banner.set('error');
      this.resultName.set('Meal redemption needs a connection');
      this.resultEvent.set(null);
      this.resultMessage.set(null);
      this.scheduleResume();
      return;
    }
    try {
      const res = await firstValueFrom(this.api.redeemMealStub(token));
      this.showStubResult(res);
    } catch {
      this.showError();
    }
  }

  private showStubResult(res: MealStubScanResult): void {
    const map: Record<string, BannerState> = {
      valid: 'mealvalid',
      already: 'mealalready',
      invalid: 'invalid',
      notvalid: 'mealnotvalid',
    };
    this.banner.set(map[res.status] ?? 'error');
    this.resultName.set(res.fullName ?? 'Meal stub');
    this.resultEvent.set(res.label);
    this.resultSession.set(res.label);
    this.resultMessage.set(
      res.status === 'valid'
        ? `₱${res.value.toFixed(2)} · ${res.label ?? ''}`
        : res.message ?? (res.status === 'invalid' ? 'Not a valid meal stub.' : null),
    );
    // Meal results don't use the member-info / welcome fields.
    this.resultLevel.set(null);
    this.resultSenateNo.set(null);
    this.resultOrganization.set(null);
    this.resultWelcome.set(null);
    this.resultPhoto.set(null);
    if (res.status === 'valid') this.mealsRedeemedCount.update((c) => c + 1);
    this.scheduleResume(2800);
  }

  // Check in a face-recognized member. Online uses the server; offline resolves the member's
  // registration token from the cached bundle and records the check-in locally. The person was
  // matched in the user master, so a "not found for this event" result means they're recognized
  // but simply not registered for it — reported with their name, not as an unknown face.
  private async checkInFace(userId: number, name: string): Promise<void> {
    if (this.offline.online()) {
      try {
        const res = await firstValueFrom(this.api.checkInUser(this.eventId, userId));
        if (res.status === 'invalid') {
          this.showNotRegistered(res.fullName ?? name);
        } else {
          this.showResult(res);
        }
        return;
      } catch {
        /* network dropped — fall through to the offline bundle */
      }
    }
    const token = this.bundle ? this.offline.resolveFaceToken(this.bundle, userId) : null;
    if (!token) {
      this.showNotRegistered(name); // recognized, but no registration for this event in the bundle
      return;
    }
    try {
      this.showResult(await this.offline.localCheckIn(this.eventId, token));
    } catch {
      this.showError();
    }
  }

  // Check in a face-recognized guest (identified by their registration token — no user account).
  private async checkInGuestFace(token: string, _name: string): Promise<void> {
    try {
      const res = this.offline.online()
        ? await firstValueFrom(this.api.checkIn(token))
        : await this.offline.localCheckIn(this.eventId, token);
      this.showResult(res);
    } catch {
      try {
        this.showResult(await this.offline.localCheckIn(this.eventId, token));
      } catch {
        this.showError();
      }
    }
  }

  private showError(): void {
    this.banner.set('error');
    this.resultName.set('Check-in request failed');
    this.resultEvent.set(null);
    this.resultMessage.set(null);
    this.scheduleResume();
  }

  // Import an offline bundle file (downloaded from the event page) onto this device — for a
  // device that can't reach the server at all. Caches it and uses it for offline check-in.
  async importBundle(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // allow re-importing the same file
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as OfflineBundle;
      if (!parsed?.event?.id || !Array.isArray(parsed.registrations)) {
        throw new Error('bad bundle');
      }
      if (parsed.event.id !== this.eventId) {
        this.syncMsg.set(`That bundle is for a different event ("${parsed.event.title}").`);
        setTimeout(() => this.syncMsg.set(null), 5000);
        return;
      }
      await this.offline.saveBundle(parsed);
      this.bundle = parsed;
      this.enrolled = []; // rebuilt from the new bundle next time face mode starts
      this.guestFaces = [];
      this.syncMsg.set(
        `Bundle loaded: ${parsed.members.length} members, ${parsed.registrations.length} registrations.`,
      );
      setTimeout(() => this.syncMsg.set(null), 5000);
    } catch {
      this.syncMsg.set('That file is not a valid offline bundle.');
      setTimeout(() => this.syncMsg.set(null), 5000);
    }
  }

  // Push queued offline check-ins + registrations to the server.
  async syncNow(): Promise<void> {
    if (!this.offline.online() || this.offline.syncing()) return;
    const res = await this.offline.syncAll();
    if (res) {
      const parts: string[] = [];
      if (res.checkins) parts.push(`${res.checkins} check-in${res.checkins === 1 ? '' : 's'}`);
      if (res.regs) parts.push(`${res.regs} registration${res.regs === 1 ? '' : 's'}`);
      this.syncMsg.set(parts.length ? `Synced ${parts.join(' + ')}.` : 'Everything is up to date.');
      // Refresh the bundle so newly-synced state is reflected locally.
      void this.loadBundle();
    } else {
      this.syncMsg.set('Sync failed — will retry automatically.');
    }
    setTimeout(() => this.syncMsg.set(null), 4000);
  }

  private showResult(res: CheckInResult): void {
    this.banner.set(res.status);
    this.resultName.set(res.fullName);
    this.resultEvent.set(res.eventTitle);
    this.resultMessage.set(res.message);
    this.resultLevel.set(res.level);
    this.resultSenateNo.set(res.senateNo);
    this.resultOrganization.set(res.organization);
    this.resultWelcome.set(res.welcomeMessage);
    this.resultPhoto.set(res.photoUrl);
    this.resultSession.set(res.sessionTitle);
    if (res.status === 'valid') this.checkedCount.update((c) => c + 1);
    // Off-window / unconfirmed scans linger a touch longer so the operator reads the reason.
    const longer = res.status === 'notstarted' || res.status === 'ended' || res.status === 'unconfirmed';
    this.scheduleResume(longer ? 4000 : 2500);
  }

  // Clear the banner and allow the next scan after a short pause.
  private scheduleResume(delayMs = 2500): void {
    if (this.resumeTimer) clearTimeout(this.resumeTimer);
    this.resumeTimer = setTimeout(() => {
      this.banner.set('idle');
      this.busy = false;
      this.lastToken = '';
      // Resume facial recognition. Clear the last match so the same person can be detected
      // again after the result clears (they'll simply show "already checked in").
      this.faceBusy = false;
      this.lastMatchedKey = '';
    }, delayMs);
  }
}
