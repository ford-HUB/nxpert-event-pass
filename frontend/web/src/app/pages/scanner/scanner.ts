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
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RealtimeService } from '../../core/realtime.service';
import { ApiService } from '../../core/api.service';
import { FaceSample, FaceService } from '../../core/face.service';
import { OfflineService } from '../../core/offline.service';
import { BeepService } from '../../core/beep.service';
import {
  CheckInOptions,
  CheckInResult,
  FaceDescriptorDto,
  MealStubScanResult,
  OfflineBundle,
  RegistrationFace,
  SessionDto,
} from '../../core/models';

type ScanMode = 'camera' | 'barcode' | 'face' | 'auto';
// What a scan does: record attendance (check-in) or redeem the sub-event's meal stubs.
type ScanAction = 'checkin' | 'meal';

// Max descriptor distance to accept a face match (lower = stricter). ~0.5 is a good default.
const FACE_MATCH_THRESHOLD = 0.45;
// Reject a match when the runner-up (a different person) is nearly as close — the face is
// ambiguous, not a confident identification.
const FACE_AMBIGUITY_MARGIN = 0.07;
// The same person must be the confident match on this many consecutive good frames before a
// check-in happens (one noisy frame can't check anyone in). Auto mode watches the QR camera,
// where faces are often small or angled, so it asks for more.
const FACE_CONFIRM_FRAMES = { face: 2, auto: 3 } as const;
// Frames further apart than this don't count as consecutive.
const FACE_CONFIRM_WINDOW_MS = 2500;
// Minimum face quality to even try matching: detector confidence, face width (px and share of
// the frame), and how squarely it faces the camera.
const FACE_MIN_SCORE = 0.6;
const FACE_MIN_WIDTH_PX = 80;
const FACE_MIN_WIDTH_RATIO = 0.1;
const FACE_MAX_YAW = 0.3;
const FACE_MAX_ROLL = 15;
const FACE_CHECK_INTERVAL_MS = 600;
// Camera preview frame rate (ideal, not required, so cameras that can't do it still open).
const CAMERA_FPS = 30;
// After a result clears, the same pass/face is ignored for a short, fixed time so it doesn't
// re-fire the instant the banner disappears. Errors come back quickly; successes wait longer.
const ERROR_COOLDOWN_MS = 1000;
const SUCCESS_COOLDOWN_MS = 4000;

// Which physical camera to open: "environment" = back, "user" = front (selfie).
type CameraFacing = 'environment' | 'user';
const QR_FACING_KEY = 'scanner_qr_camera';
const FACE_FACING_KEY = 'scanner_face_camera';

// Camera preview size (Medium = the original size). Remembered per device.
type CamSize = 'sm' | 'md' | 'lg';
const CAM_SIZE_KEY = 'scanner_preview_size';
const CAM_SIZES: CamSize[] = ['sm', 'md', 'lg'];

function loadCamSize(): CamSize {
  try {
    const v = localStorage.getItem(CAM_SIZE_KEY) as CamSize | null;
    return v && CAM_SIZES.includes(v) ? v : 'md';
  } catch {
    return 'md';
  }
}

// The chosen sub-event is remembered per event on this device. (Verify-only is stored on the
// event in the database, so it applies to every scanner.)
const sessionKey = (eventId: number) => `scanner_session_${eventId}`;

function loadFacing(key: string, fallback: CameraFacing): CameraFacing {
  try {
    const v = localStorage.getItem(key);
    return v === 'user' || v === 'environment' ? v : fallback;
  } catch {
    return fallback;
  }
}

function saveFacing(key: string, value: CameraFacing): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable — keep the in-memory choice */
  }
}

type BannerState =
  | 'idle'
  | 'valid'
  | 'verified'
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

// Results that mean "done" (checked in / redeemed); anything else is a validation error.
const SUCCESS_STATES = new Set<BannerState>(['valid', 'verified', 'already', 'mealvalid', 'mealalready']);

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
    MatSelectModule,
    MatSlideToggleModule,
  ],
  templateUrl: './scanner.html',
  styleUrl: './scanner.scss',
})
export class ScannerComponent implements OnInit, OnDestroy {
  private api = inject(ApiService);
  private route = inject(ActivatedRoute);
  private face = inject(FaceService);
  protected offline = inject(OfflineService);
  protected beeper = inject(BeepService);
  private realtime = inject(RealtimeService);
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
  // The event's banner image (base64 data URL), shown as a header strip.
  eventBanner = signal<string | null>(null);

  // Input source: QR camera, hardware barcode scanner (keyboard-wedge), or facial recognition.
  mode = signal<ScanMode>('camera');
  // What a scan does. Meal redemption is token-based (camera/barcode) and requires a connection.
  scanAction = signal<ScanAction>('checkin');
  mealsRedeemedCount = signal(0);
  // Verify only: scans look passes up (who, confirmed?) without recording any check-in. Stored on
  // the event and enforced by the server, so every scanner and TV of the event follows it.
  verifyOnly = signal(false);
  verifyOnlySaving = signal(false);
  verifiedCount = signal(0);
  // Sub-events of this event; when one is chosen, only its passes are accepted.
  sessions = signal<SessionDto[]>([]);
  sessionId = signal<number | null>(null);
  barcodeValue = '';
  @ViewChild('barcodeInput') private barcodeInput?: ElementRef<HTMLInputElement>;

  // ---- Facial recognition state ----
  @ViewChild('faceVideo') private faceVideo?: ElementRef<HTMLVideoElement>;
  private faceStream: MediaStream | null = null;
  private faceTimer: ReturnType<typeof setInterval> | null = null;
  private faceBusy = false;
  // Identity seen on recent good frames, confirmed once it repeats FACE_CONFIRM_FRAMES times.
  // key = "u:{userId}" / "g:{token}" for a match, "none" for an unknown face (face mode).
  private faceCandidate: { key: string; hits: number; at: number } | null = null;
  private enrolled: FaceDescriptorDto[] = []; // user master faces → userId
  private guestFaces: RegistrationFace[] = []; // this event's guest faces → registration token
  faceLoading = signal(false);
  faceReady = signal(false);
  faceError = signal<string | null>(null);

  // ---- One scan at a time, across QR, barcode and face ----
  // `busy` is held from the moment a scan is accepted until its banner clears, so QR and face
  // (auto mode) can never both be in flight. `attempt` numbers each accepted scan: an async
  // result whose number is no longer current (superseded, mode switched) is dropped instead of
  // overwriting the screen with a stale message.
  private busy = false;
  private attempt = 0;
  private resumeTimer: ReturnType<typeof setTimeout> | null = null;
  // Recently handled inputs → "ignore until" time (a short, fixed cooldown after the banner
  // clears). Keys: 'q:{token}', 'u:{userId}', 'g:{token}', 'f:none'.
  private recent = new Map<string, number>();
  private activeKeys: string[] = [];

  // ---- Front / back camera ----
  // QR scanning defaults to the back camera, face recognition to the front; each choice is
  // remembered per device. The switch only shows when the device has more than one camera.
  qrFacing = signal<CameraFacing>(loadFacing(QR_FACING_KEY, 'environment'));
  faceFacing = signal<CameraFacing>(loadFacing(FACE_FACING_KEY, 'user'));
  canSwitchCamera = signal(false);
  // Mirror the QR preview like face mode unless the camera that actually opened is a back camera.
  // Laptop webcams usually don't report a facing, so they mirror too.
  qrMirrored = signal(false);

  // ---- Camera preview size (Small / Medium / Large) ----
  camSize = signal<CamSize>(loadCamSize());
  readonly camSizes: { value: CamSize; label: string }[] = [
    { value: 'sm', label: 'Small' },
    { value: 'md', label: 'Medium' },
    { value: 'lg', label: 'Large' },
  ];
  private resizeTimer: ReturnType<typeof setTimeout> | null = null;
  switchingCamera = signal(false);

  // The facing in use for the current input.
  currentFacing(): CameraFacing {
    return this.mode() === 'face' ? this.faceFacing() : this.qrFacing();
  }

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


  constructor() {
    this.realtime.verifyOnlyChanged$
      .pipe(takeUntilDestroyed())
      .subscribe((n) => {
        if (n.eventId !== this.eventId || n.enabled === this.verifyOnly()) return;
        this.verifyOnly.set(n.enabled);
        if (n.enabled) this.verifiedCount.set(0);
      });
  }

  ngOnInit(): void {
    this.eventId = +(this.route.snapshot.paramMap.get('eventId') ?? 0);
    if (this.eventId) {
      this.api.getEvent(this.eventId).subscribe({
        next: (e) => {
          this.eventTitle.set(e.title);
          this.eventWelcome.set(e.welcomeMessage);
          this.eventBanner.set(e.bannerImage);
          this.sessions.set(e.sessions ?? []);
          this.verifyOnly.set(e.verifyOnly);
          this.restoreSession();
        },
        error: () => {},
      });
      // Download + cache the offline bundle for this event so check-in keeps working with no
      // network. Falls back to any previously cached copy when offline.
      void this.loadBundle();
      // Flush anything queued from a previous offline session.
      if (this.offline.online() && this.offline.pending() > 0) void this.syncNow();
    }
    this.beeper.warmUp();
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
    if (this.resumeTimer) clearTimeout(this.resumeTimer);
    if (this.resizeTimer) clearTimeout(this.resizeTimer);
    this.stop();
    this.stopFace();
  }

  async start(): Promise<void> {
    this.cameraError.set(null);
    this.starting.set(true);
    try {
      this.scanner = new Html5Qrcode(this.regionId, { verbose: false });
      await this.scanner.start(
        { facingMode: this.qrFacing() },
        {
          fps: CAMERA_FPS,
          // Ask the camera itself for 30 fps; otherwise many devices default to a choppy stream.
          videoConstraints: { facingMode: this.qrFacing(), frameRate: { ideal: CAMERA_FPS } },
          // Adaptive scan box: sized to the actual viewfinder so it stays valid whether the
          // preview is Small, Medium or Large.
          qrbox: (vw: number, vh: number) => {
            const s = Math.max(120, Math.floor(Math.min(vw, vh) * 0.8));
            return { width: s, height: s };
          },
        },
        (decoded) => this.onScan(decoded),
        () => {}, // per-frame decode failures are noise; ignore
      );
      this.scanning.set(true);
      this.qrMirrored.set(this.runningFacing() !== 'environment');
      void this.detectCameras();
    } catch (err) {
      this.cameraError.set(
        'Could not open the camera. Grant camera permission and use HTTPS (or localhost).',
      );
    } finally {
      this.starting.set(false);
    }
  }

  // Stops the camera only. The result banner keeps its own timer (clearing it here left a
  // banner stuck on screen when the camera restarted mid-result).
  async stop(): Promise<void> {
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

  private runningFacing(): string | undefined {
    try {
      return this.scanner?.getRunningTrackSettings().facingMode;
    } catch {
      return this.qrFacing();
    }
  }

  // Show the switch only when there's a second camera to switch to. Device labels/count are only
  // reliable after camera permission is granted, so this runs once a camera has started.
  private async detectCameras(): Promise<void> {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      this.canSwitchCamera.set(devices.filter((d) => d.kind === 'videoinput').length > 1);
    } catch {
      this.canSwitchCamera.set(false);
    }
  }

  // Flip between the front and back camera for the current input (QR / auto, or face) and
  // restart that camera. A result already on screen stays and clears on its own timer.
  async switchCamera(): Promise<void> {
    if (this.switchingCamera()) return;
    this.switchingCamera.set(true);
    try {
      const flip = (f: CameraFacing): CameraFacing => (f === 'user' ? 'environment' : 'user');
      if (this.mode() === 'face') {
        const next = flip(this.faceFacing());
        this.faceFacing.set(next);
        saveFacing(FACE_FACING_KEY, next);
        this.stopFace();
        await this.startFace();
      } else if (this.mode() === 'camera' || this.mode() === 'auto') {
        const next = flip(this.qrFacing());
        this.qrFacing.set(next);
        saveFacing(QR_FACING_KEY, next);
        // Auto mode's face loop reads the QR camera's <video> and re-attaches by itself.
        await this.stop();
        await this.start();
      }
    } finally {
      this.switchingCamera.set(false);
    }
  }

  // Resize the camera preview. html5-qrcode measures its scan region only when it starts, so a
  // running QR camera is restarted once the new layout has settled.
  // Face mode reads the <video> directly and needs no restart.
  setCamSize(size: CamSize): void {
    if (size === this.camSize()) return;
    this.camSize.set(size);
    try {
      localStorage.setItem(CAM_SIZE_KEY, size);
    } catch {
      /* storage unavailable — keep the in-memory choice */
    }
    if ((this.mode() === 'camera' || this.mode() === 'auto') && this.scanner) {
      if (this.resizeTimer) clearTimeout(this.resizeTimer);
      // Debounced, so stepping S → M → L quickly restarts the camera only once.
      this.resizeTimer = setTimeout(async () => {
        this.resizeTimer = null;
        if (!(this.mode() === 'camera' || this.mode() === 'auto')) return;
        await this.stop();
        await this.start();
      }, 350);
    }
  }

  // Switch between check-in and meal-stub redemption. Meal redemption is token-based, so face
  // input isn't available for it — fall back to the QR camera.
  setVerifyOnly(on: boolean): void {
    const was = this.verifyOnly();
    this.verifyOnly.set(on);
    if (on) this.verifiedCount.set(0);
    this.verifyOnlySaving.set(true);
    this.api.setVerifyOnly(this.eventId, on).subscribe({
      next: (r) => {
        this.verifyOnly.set(r.enabled);
        this.verifyOnlySaving.set(false);
      },
      error: () => {
        // Not saved (offline / no permission) — put the switch back so it shows the real state.
        this.verifyOnly.set(was);
        this.verifyOnlySaving.set(false);
        this.syncMsg.set('Could not change verify-only mode — it needs a connection.');
        setTimeout(() => this.syncMsg.set(null), 4000);
      },
    });
  }

  setSession(id: number | null): void {
    this.sessionId.set(id);
    try {
      if (id === null) localStorage.removeItem(sessionKey(this.eventId));
      else localStorage.setItem(sessionKey(this.eventId), String(id));
    } catch {
      /* storage unavailable — keep the in-memory choice */
    }
  }

  // Re-select the sub-event chosen last time, if it still exists.
  private restoreSession(): void {
    try {
      const id = Number(localStorage.getItem(sessionKey(this.eventId)));
      if (id && this.sessions().some((s) => s.id === id)) this.sessionId.set(id);
    } catch {
      /* storage unavailable — default to all sub-events */
    }
  }

  // What the current scanner settings ask of a check-in.
  private checkOptions(): CheckInOptions {
    // verify mirrors the event's flag; the server applies the stored flag either way.
    return { eventId: this.eventId, sessionId: this.sessionId(), verify: this.verifyOnly() };
  }

  setAction(a: ScanAction): void {
    if (a === this.scanAction()) return;
    this.scanAction.set(a);
    this.resetResult();
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
    this.resetResult();
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
        video: {
          facingMode: this.faceFacing(),
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: CAMERA_FPS },
        },
        audio: false,
      });
      const v = this.faceVideo!.nativeElement;
      v.srcObject = this.faceStream;
      await v.play();
      this.faceLoading.set(false);
      this.faceReady.set(true);
      void this.detectCameras();
      if (this.enrolled.length === 0 && this.guestFaces.length === 0) {
        this.faceError.set('No registered faces yet — register a face in Users, or have guests add one at sign-up.');
      }
      this.faceTimer = setInterval(() => this.detectFace(), FACE_CHECK_INTERVAL_MS);
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
      this.faceTimer = setInterval(() => this.detectFace(), FACE_CHECK_INTERVAL_MS);
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
    this.setResult('nomatch', { message: 'This face is not registered in the system.' });
    this.scheduleResume(2500);
  }

  // Face matched a member in the user master, but they aren't registered for THIS event.
  private showNotRegistered(name: string | null, message?: string | null): void {
    this.setResult('notreg', {
      name,
      event: this.eventTitle() || null,
      message: message || 'This member is not registered for this event.',
    });
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
    this.faceCandidate = null;
  }

  private async detectFace(): Promise<void> {
    if (this.faceBusy || !this.faceReady()) return;
    // QR priority: never run face while a QR scan is being handled or a result is on screen.
    if (this.busy || this.banner() !== 'idle') return;
    const video = this.faceSourceVideo();
    if (!video || video.readyState < 2) return; // camera not delivering frames yet
    this.faceBusy = true;
    try {
      const sample = await this.face.detect(video);
      // Detecting takes a moment; a QR scan may have been accepted meanwhile. QR wins.
      if (this.busy || this.banner() !== 'idle') {
        this.faceBusy = false;
        return;
      }
      if (!sample) {
        this.faceCandidate = null; // nobody in frame — any streak is broken
        this.faceBusy = false;
        return;
      }
      if (this.enrolled.length === 0 && this.guestFaces.length === 0) {
        this.faceBusy = false;
        return; // nothing to match against (an error is already shown)
      }
      // Too small, too blurry or turned away: its descriptor isn't trustworthy. Skip the frame
      // without breaking the streak — the person may simply be moving into position.
      if (!this.goodFaceSample(sample)) {
        this.faceBusy = false;
        return;
      }

      const match = this.bestFaceMatch(sample.descriptor);
      const key = match ? match.key : 'none';
      const required = FACE_CONFIRM_FRAMES[this.mode() === 'auto' ? 'auto' : 'face'];
      if (!this.confirmFace(key, required)) {
        this.faceBusy = false; // not confirmed yet — keep watching
        return;
      }

      if (match) {
        const t = this.accept([match.key]);
        if (t === null) {
          this.faceBusy = false;
          return; // same person still in frame since their last result — don't re-check
        }
        this.faceCandidate = null;
        this.beeper.beep(); // face recognized
        // faceBusy stays true until the result banner clears (scheduleResume).
        if (match.user) void this.checkInFace(match.user.userId, match.user.fullName, t);
        else void this.checkInGuestFace(match.guest!.token, t);
      } else if (this.mode() === 'auto') {
        // Auto mode is QR-first: an unrecognized face shouldn't interrupt scanning — keep watching.
        this.faceBusy = false;
      } else if (this.accept(['f:none']) !== null) {
        // Dedicated face mode: a face that matches no one is reported — once, not on every
        // detection while that unknown face stays in front of the camera.
        this.faceCandidate = null;
        this.showNoMatch();
      } else {
        this.faceBusy = false;
      }
    } catch {
      this.faceBusy = false;
    }
  }

  // Only clear, reasonably sized, front-facing faces are matched.
  private goodFaceSample(s: FaceSample): boolean {
    if (s.score < FACE_MIN_SCORE) return false;
    if (s.box.width < FACE_MIN_WIDTH_PX || s.box.width / s.imageWidth < FACE_MIN_WIDTH_RATIO) return false;
    const pose = this.face.pose(s);
    return !pose || (Math.abs(pose.yaw) <= FACE_MAX_YAW && pose.roll <= FACE_MAX_ROLL);
  }

  // Nearest enrolled identity (user master → userId, or this event's guests → token), or null
  // when nobody is close enough or the nearest is too close to call against a different person.
  private bestFaceMatch(
    desc: ArrayLike<number>,
  ): { key: string; user: FaceDescriptorDto | null; guest: RegistrationFace | null } | null {
    type Cand = { key: string; name: string; d: number; user: FaceDescriptorDto | null; guest: RegistrationFace | null };
    const cands: Cand[] = [
      ...this.enrolled.map((u) => ({
        key: `u:${u.userId}`, name: u.fullName, d: this.face.distance(desc, u.descriptor), user: u, guest: null,
      })),
      ...this.guestFaces.map((g) => ({
        key: `g:${g.token}`, name: g.name, d: this.face.distance(desc, g.descriptor), user: null, guest: g,
      })),
    ].sort((a, b) => a.d - b.d);

    const best = cands[0];
    if (!best || best.d > FACE_MATCH_THRESHOLD) return null;
    // Runner-up = the closest *different* person (the same person may be enrolled both as a
    // member and as a guest under the same name — that's not ambiguity).
    const norm = (n: string) => n.trim().toLowerCase();
    const runnerUp = cands.find((c) => c.key !== best.key && norm(c.name) !== norm(best.name));
    if (runnerUp && runnerUp.d - best.d < FACE_AMBIGUITY_MARGIN) return null;
    return { key: best.key, user: best.user, guest: best.guest };
  }

  // Count consecutive good frames agreeing on the same identity; true once `required` is reached.
  private confirmFace(key: string, required: number): boolean {
    const now = Date.now();
    const c = this.faceCandidate;
    if (c && c.key === key && now - c.at <= FACE_CONFIRM_WINDOW_MS) {
      c.hits++;
      c.at = now;
    } else {
      this.faceCandidate = { key, hits: 1, at: now };
    }
    return this.faceCandidate!.hits >= required;
  }

  // Hardware barcode/QR scanners type the code then press Enter into the focused field.
  submitBarcode(): void {
    const v = this.barcodeValue.trim();
    this.barcodeValue = '';
    // A hardware scan is a deliberate action: it may replace a result that is still showing.
    if (v) {
      this.beeper.beep(); // code read
      void this.check(v, this.accept(this.tokenKeys(v), true)!);
    }
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
    const t = this.accept(this.tokenKeys(decoded));
    if (t === null) return; // busy, or this pass is still in frame since its last result
    this.beeper.beep(); // QR read
    void this.check(decoded, t);
  }

  // Shared check-in for both the camera and the barcode scanner. Uses the server when online and
  // falls back to the cached offline bundle (queuing the check-in for later sync) otherwise.
  private async check(token: string, t: number): Promise<void> {
    // Meal-stub redemption path (token-based, online only).
    if (this.scanAction() === 'meal') {
      await this.redeemMeal(token, t);
      return;
    }
    const opts = this.checkOptions();
    try {
      const res = this.offline.online()
        ? await firstValueFrom(this.api.checkIn(token, opts))
        : await this.offline.localCheckIn(this.eventId, token, opts);
      if (this.isCurrent(t)) this.showResult(res);
    } catch {
      // Online request failed (e.g. network dropped mid-scan) → try the local bundle.
      try {
        const res = await this.offline.localCheckIn(this.eventId, token, opts);
        if (this.isCurrent(t)) this.showResult(res);
      } catch {
        if (this.isCurrent(t)) this.showError();
      }
    }
  }

  // Redeem the sub-event's meal stubs from a scanned entry-pass token (online only).
  private async redeemMeal(token: string, t: number): Promise<void> {
    if (!this.offline.online()) {
      this.setResult('error', { name: 'Meal redemption needs a connection' });
      this.scheduleResume();
      return;
    }
    try {
      const res = await firstValueFrom(this.api.redeemMealStub(token));
      if (this.isCurrent(t)) this.showStubResult(res);
    } catch {
      if (this.isCurrent(t)) this.showError();
    }
  }

  private showStubResult(res: MealStubScanResult): void {
    const map: Record<string, BannerState> = {
      valid: 'mealvalid',
      already: 'mealalready',
      invalid: 'invalid',
      notvalid: 'mealnotvalid',
    };
    // Meal results don't use the member-info / welcome fields (setResult clears them).
    this.setResult(map[res.status] ?? 'error', {
      name: res.fullName ?? 'Meal stub',
      event: res.label,
      session: res.label,
      message:
        res.status === 'valid'
          ? `₱${res.value.toFixed(2)} · ${res.label ?? ''}`
          : res.message ?? (res.status === 'invalid' ? 'Not a valid meal stub.' : null),
    });
    if (res.status === 'valid') this.mealsRedeemedCount.update((c) => c + 1);
    this.scheduleResume(2800);
  }

  // Check in a face-recognized member. Online uses the server; offline resolves the member's
  // registration token from the cached bundle and records the check-in locally. The person was
  // matched in the user master, so a "not found for this event" result means they're recognized
  // but simply not registered for it — reported with their name, not as an unknown face.
  private async checkInFace(userId: number, name: string, t: number): Promise<void> {
    const opts = this.checkOptions();
    if (this.offline.online()) {
      try {
        const res = await firstValueFrom(
          this.api.checkInUser(this.eventId, userId, { sessionId: opts.sessionId, verify: opts.verify }),
        );
        if (!this.isCurrent(t)) return;
        if (res.status === 'invalid') {
          this.showNotRegistered(res.fullName ?? name, res.message);
        } else {
          this.showResult(res);
        }
        return;
      } catch {
        /* network dropped — fall through to the offline bundle */
      }
    }
    if (!this.isCurrent(t)) return;
    const token = this.bundle ? this.offline.resolveFaceToken(this.bundle, userId, opts.sessionId) : null;
    if (!token) {
      this.showNotRegistered(name); // recognized, but no registration for this event in the bundle
      return;
    }
    try {
      const res = await this.offline.localCheckIn(this.eventId, token, opts);
      if (this.isCurrent(t)) this.showResult(res);
    } catch {
      if (this.isCurrent(t)) this.showError();
    }
  }

  // Check in a face-recognized guest (identified by their registration token — no user account).
  private async checkInGuestFace(token: string, t: number): Promise<void> {
    const opts = this.checkOptions();
    try {
      const res = this.offline.online()
        ? await firstValueFrom(this.api.checkIn(token, opts))
        : await this.offline.localCheckIn(this.eventId, token, opts);
      if (this.isCurrent(t)) this.showResult(res);
    } catch {
      try {
        const res = await this.offline.localCheckIn(this.eventId, token, opts);
        if (this.isCurrent(t)) this.showResult(res);
      } catch {
        if (this.isCurrent(t)) this.showError();
      }
    }
  }

  private showError(): void {
    this.setResult('error', { name: 'Check-in request failed' });
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
    this.setResult(res.status, {
      name: res.fullName,
      event: res.eventTitle,
      message: res.message,
      level: res.level,
      senateNo: res.senateNo,
      organization: res.organization,
      welcome: res.welcomeMessage,
      photo: res.photoUrl,
      session: res.sessionTitle,
    });
    if (res.status === 'valid') this.checkedCount.update((c) => c + 1);
    if (this.verifyOnly() && (res.status === 'verified' || res.status === 'already'))
      this.verifiedCount.update((c) => c + 1);
    // Off-window / unconfirmed scans linger a touch longer so the operator reads the reason.
    const longer = res.status === 'notstarted' || res.status === 'ended' || res.status === 'unconfirmed';
    this.scheduleResume(longer ? 4000 : 2500);
  }

  // Show a result. Every field is reset first, so nothing from the previous scan (photo,
  // designation, ID No., welcome text…) can leak into this one.
  private setResult(
    state: BannerState,
    f: {
      name?: string | null;
      event?: string | null;
      message?: string | null;
      level?: string | null;
      senateNo?: string | null;
      organization?: string | null;
      welcome?: string | null;
      photo?: string | null;
      session?: string | null;
    } = {},
  ): void {
    this.resultName.set(f.name ?? null);
    this.resultEvent.set(f.event ?? null);
    this.resultMessage.set(f.message ?? null);
    this.resultLevel.set(f.level ?? null);
    this.resultSenateNo.set(f.senateNo ?? null);
    this.resultOrganization.set(f.organization ?? null);
    this.resultWelcome.set(f.welcome ?? null);
    this.resultPhoto.set(f.photo ?? null);
    this.resultSession.set(f.session ?? null);
    this.banner.set(state);
  }

  // ---- Scan gating ----

  // Accept a new scan for the given input keys. Returns its attempt number, or null when another
  // scan is in progress / on screen, or when the input was just handled and hasn't left the
  // camera yet. `force` (hardware barcode) replaces whatever is showing.
  private accept(keys: string[], force = false): number | null {
    if (!force) {
      if (this.busy) return null;
      // Fixed cooldown only (never extended while the input stays in view), so presenting the
      // same pass/face again always gets its message back after a short pause.
      const now = Date.now();
      if (keys.some((k) => (this.recent.get(k) ?? 0) > now)) return null;
    }
    if (this.resumeTimer) clearTimeout(this.resumeTimer);
    this.resumeTimer = null;
    this.busy = true;
    this.activeKeys = keys;
    return ++this.attempt;
  }

  // Is this attempt still the one the screen belongs to?
  private isCurrent(t: number): boolean {
    return t === this.attempt;
  }

  // Keys for a scanned pass: the token itself, plus the person it belongs to (from the offline
  // bundle) so their face isn't immediately re-detected right after their QR check-in.
  private tokenKeys(token: string): string[] {
    const keys = [`q:${token}`];
    const reg = this.bundle?.registrations.find((r) => r.token === token);
    if (reg) keys.push(reg.userId != null ? `u:${reg.userId}` : `g:${token}`);
    return keys;
  }

  // Drop any result on screen and anything still in flight (mode / action / input switch).
  private resetResult(): void {
    if (this.resumeTimer) clearTimeout(this.resumeTimer);
    this.resumeTimer = null;
    this.attempt++; // in-flight requests become stale and are ignored when they return
    this.setResult('idle');
    this.busy = false;
    this.faceBusy = false;
    this.faceCandidate = null;
    this.activeKeys = [];
    this.recent.clear();
  }

  // Clear the banner and allow the next scan after a short pause.
  private scheduleResume(delayMs = 2500): void {
    if (this.resumeTimer) clearTimeout(this.resumeTimer);
    const t = this.attempt;
    this.resumeTimer = setTimeout(() => {
      this.resumeTimer = null;
      if (!this.isCurrent(t)) return;
      // Brief pause before the same pass/face can fire again: short after a validation error
      // (so re-presenting it shows the message again), longer after a successful check-in (so a
      // face still in view doesn't immediately flash "already checked in").
      const success = SUCCESS_STATES.has(this.banner());
      const until = Date.now() + (success ? SUCCESS_COOLDOWN_MS : ERROR_COOLDOWN_MS);
      this.setResult('idle');
      this.busy = false;
      this.faceBusy = false;
      for (const k of this.activeKeys) this.recent.set(k, until);
      this.activeKeys = [];
      this.pruneRecent();
    }, delayMs);
  }

  private pruneRecent(): void {
    const now = Date.now();
    for (const [k, until] of this.recent) if (until <= now) this.recent.delete(k);
  }
}
