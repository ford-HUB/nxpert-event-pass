import { Component, HostListener, OnDestroy, OnInit, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { debounceTime, filter, firstValueFrom, timeout } from 'rxjs';
import { ApiService } from '../../core/api.service';
import {
  EngineCheckIn,
  EngineDetectionMode,
  EngineScanMode,
  FaceEngineService,
} from '../../core/face-engine.service';
import { AttendeeDto, CheckInResult } from '../../core/models';
import { RealtimeService } from '../../core/realtime.service';

const POLL_MS = 500;
// The gallery re-syncs as soon as the backend reports a change (registration added/removed,
// photo changed). Changes that arrive together (a bulk import) are batched into one reload.
const GALLERY_CHANGE_DEBOUNCE_MS = 2000;
// Safety net for pushes the TV missed (hub dropped, change made outside the API).
const GALLERY_SYNC_MS = 5 * 60 * 1000;
// On first load only check-ins from the last few seconds are shown, so a refresh doesn't replay
// the whole session but someone who just arrived is still greeted.
const REPLAY_RECENT_SECONDS = 30;
const QUEUE_SLOTS = 4;
// The attendee list also refreshes on its own, to pick up QR and manual check-ins.
const ATTENDEES_REFRESH_MS = 30 * 1000;
const CAMERA_RETRY_MS = 3000;
// Exit waits this long at most for the engine to release the webcam before leaving.
const EXIT_RELEASE_TIMEOUT_MS = 8000;
// The TV's scan mode is remembered per device.
const SCAN_MODE_KEY = 'nxpass.tvScanMode';
const SCAN_MODES: EngineScanMode[] = ['qr', 'face', 'auto'];
// So is the face detection mode: wait until people are steady, or detect continuously.
const DETECTION_MODE_KEY = 'nxpass.tvDetectionMode';
const DETECTION_MODES: EngineDetectionMode[] = ['steady', 'continuous'];
// The camera preview's size is remembered per device too; null means the default size.
const CAMERA_WIDTH_KEY = 'nxpass.tvCameraWidth';
const CAMERA_MIN_WIDTH = 120;
const CAMERA_ASPECT = 16 / 9;
const CAMERA_KEY_STEP = 24;

function loadCameraWidth(): number | null {
  try {
    const v = Number(localStorage.getItem(CAMERA_WIDTH_KEY));
    return v >= CAMERA_MIN_WIDTH ? v : null;
  } catch {
    return null;
  }
}

// Up to 60% of the screen in either direction, so the preview never covers the spotlight.
function clampCameraWidth(width: number): number {
  const max = Math.min(window.innerWidth * 0.6, window.innerHeight * 0.6 * CAMERA_ASPECT);
  return Math.round(Math.max(CAMERA_MIN_WIDTH, Math.min(width, max)));
}

function loadScanMode(): EngineScanMode {
  try {
    const v = localStorage.getItem(SCAN_MODE_KEY) as EngineScanMode | null;
    return v && SCAN_MODES.includes(v) ? v : 'face';
  } catch {
    return 'face';
  }
}

function loadDetectionMode(): EngineDetectionMode {
  try {
    const v = localStorage.getItem(DETECTION_MODE_KEY) as EngineDetectionMode | null;
    return v && DETECTION_MODES.includes(v) ? v : 'steady';
  } catch {
    return 'steady';
  }
}

// One recognized person, after the backend recorded (or refused) the check-in.
interface TvItem {
  sequence: number;
  name: string;
  photo: string;
  result: CheckInResult;
}

/**
 * Door TV for camera check-in. The face engine watches the camera and reports who it
 * recognized; each person is checked in through the backend, and the backend's answer is what
 * the TV shows (so only confirmed registrations, inside the event window, are checked in).
 */
@Component({
  selector: 'app-face-tv',
  templateUrl: './face-tv.html',
  styleUrl: './face-tv.scss',
})
export class FaceTvComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private api = inject(ApiService);
  private engine = inject(FaceEngineService);
  private realtime = inject(RealtimeService);

  readonly eventId = Number(this.route.snapshot.paramMap.get('eventId'));
  readonly cameraUrl = signal(this.engine.streamUrl());
  readonly engineOnline = signal(true);
  readonly exiting = signal(false);
  readonly galleryMessage = signal('Loading registered faces…');
  readonly galleryError = signal(false);

  // The event's own branding (set on the event form): banner image and TV welcome message.
  readonly eventTitle = signal('');
  readonly eventWelcome = signal<string | null>(null);
  readonly eventBanner = signal<string | null>(null);
  // Verify-only mode (stored on the event): the TV identifies people but nobody is checked in.
  readonly verifyOnly = signal(false);

  readonly current = signal<TvItem | null>(null);
  readonly shown = computed(() => (this.current() ? [this.current()!] : []));
  readonly waiting = signal<TvItem[]>([]);
  readonly queuePreview = computed(() => this.waiting().slice(0, QUEUE_SLOTS));
  readonly queueOverflow = computed(() => Math.max(0, this.waiting().length - QUEUE_SLOTS));
  readonly displaySeconds = signal(3);

  // What the camera checks people in with: QR passes, faces, or both (auto).
  readonly scanMode = signal<EngineScanMode>(loadScanMode());
  readonly scanModes: { value: EngineScanMode; label: string }[] = [
    { value: 'qr', label: 'QR' },
    { value: 'face', label: 'Face' },
    { value: 'auto', label: 'Auto' },
  ];
  readonly idleTitle = computed(() =>
    ({
      qr: 'Show your QR pass to the camera',
      face: 'Look at the camera to check in',
      auto: 'Look at the camera or show your QR pass',
    })[this.scanMode()],
  );

  // When faces are identified: once the person stands or moves a little (steady), or right
  // away even while walking quickly (continuous). Only matters when faces are scanned.
  readonly detectionMode = signal<EngineDetectionMode>(loadDetectionMode());
  readonly detectionModes: { value: EngineDetectionMode; label: string; hint: string }[] = [
    { value: 'steady', label: 'Steady', hint: 'Detect once the person stands still or moves a little' },
    { value: 'continuous', label: 'Continuous', hint: 'Detect right away, even people walking quickly' },
  ];
  readonly idleHint = computed(() =>
    this.scanMode() !== 'qr' && this.detectionMode() === 'steady'
      ? 'Stand still for a moment in front of the camera.'
      : 'Registered participants appear here automatically.',
  );

  // Width of the camera preview in px, set by dragging its corner; null uses the CSS default.
  readonly cameraWidth = signal<number | null>(loadCameraWidth());

  // The attendee sidebar can be closed so the stage takes the full width.
  readonly sideOpen = signal(true);

  // Right-side list: every registration of the event, latest check-in first, then the rest by name.
  readonly attendees = signal<AttendeeDto[]>([]);
  readonly checkedInCount = computed(() => this.attendees().filter((a) => a.checkedInAt).length);
  readonly attendeeRows = computed(() =>
    [...this.attendees()]
      .sort((a, b) => {
        if (a.checkedInAt && b.checkedInAt) return b.checkedInAt.localeCompare(a.checkedInAt);
        if (a.checkedInAt || b.checkedInAt) return a.checkedInAt ? -1 : 1;
        return a.fullName.localeCompare(b.fullName);
      })
      .map((a) => ({
        id: a.registrationId,
        name: a.fullName,
        detail: a.sessionTitle,
        ...(a.checkedInAt
          ? { tone: 'good', label: `✓ ${this.formatTime(new Date(a.checkedInAt))}` }
          : a.confirmedAt
            ? { tone: 'muted', label: 'Not yet' }
            : { tone: 'warn', label: 'Pending' }),
      })),
  );

  // How the spotlight presents the backend's answer. The tone picks the full-screen colour:
  // green for a new check-in, amber for already in / not confirmed, grey outside the check-in
  // window, red otherwise. Member details (chips, event) only show for valid / already.
  readonly spotlight = computed(() => {
    const r = this.current()?.result;
    if (!r) return null;
    const at = r.checkedInAt ? `at ${this.formatTime(new Date(r.checkedInAt))}` : null;
    const chips = [r.level, r.senateNo ? `Senate No. ${r.senateNo}` : null, r.organization].filter(
      (c): c is string => !!c,
    );
    const details = { chips, event: r.eventTitle, session: r.sessionTitle };
    const none = { chips: [] as string[], event: null, session: null };
    switch (r.status) {
      case 'valid':
        return {
          tone: 'good',
          kicker: r.welcomeMessage || this.eventWelcome() || 'Welcome',
          badge: '✓ Checked in',
          note: at,
          ...details,
        };
      case 'verified':
        return {
          tone: 'info',
          kicker: r.welcomeMessage || this.eventWelcome() || 'Welcome',
          badge: '✓ Verified',
          note: 'Confirmed registration — not checked in.',
          ...details,
        };
      case 'already':
        return { tone: 'warn', kicker: 'Welcome back', badge: 'Already checked in', note: at, ...details };
      case 'unconfirmed':
        return {
          tone: 'warn',
          kicker: null,
          badge: 'Registration not yet confirmed',
          note: 'Please see the registration desk.',
          ...none,
        };
      case 'notstarted':
      case 'ended':
        return {
          tone: 'muted',
          kicker: null,
          badge: r.status === 'ended' ? 'Check-in closed' : 'Check-in not open yet',
          note: r.message,
          ...none,
        };
      default:
        return {
          tone: 'bad',
          kicker: null,
          badge: 'Not checked in',
          note: r.message || 'Please see the registration desk.',
          ...none,
        };
    }
  });

  // Shown in place of the photo when there is none.
  initials(name: string): string {
    return name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0].toUpperCase())
      .join('');
  }

  private sessionId: string | null = null;
  private lastSequence = 0;
  private isPolling = false;
  private timers: ReturnType<typeof setInterval>[] = [];
  private showTimer: ReturnType<typeof setTimeout> | null = null;
  private cameraRetry: ReturnType<typeof setTimeout> | null = null;
  private galleryLoading = false;
  private galleryReloadQueued = false;
  private hubWasDown = false;

  constructor() {
    this.realtime.faceGalleryChanged$
      .pipe(
        filter((n) => n.eventId === this.eventId),
        debounceTime(GALLERY_CHANGE_DEBOUNCE_MS),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.loadGallery());
    this.realtime.verifyOnlyChanged$
      .pipe(
        filter((n) => n.eventId === this.eventId),
        takeUntilDestroyed(),
      )
      .subscribe((n) => this.verifyOnly.set(n.enabled));
    // Pushes sent while the hub was down are lost — re-sync once it's back.
    effect(() => {
      if (!this.realtime.connected()) this.hubWasDown = true;
      else if (this.hubWasDown) {
        this.hubWasDown = false;
        untracked(() => this.loadGallery());
      }
    });
  }

  ngOnInit(): void {
    this.startCamera();
    this.loadEvent();
    this.loadGallery();
    this.loadAttendees();
    this.poll();
    this.timers.push(
      setInterval(() => this.poll(), POLL_MS),
      setInterval(() => this.loadGallery(), GALLERY_SYNC_MS),
      // Picks up banner / welcome message edits made while the TV is open.
      setInterval(() => this.loadEvent(), GALLERY_SYNC_MS),
      setInterval(() => this.loadAttendees(), ATTENDEES_REFRESH_MS),
    );
  }

  ngOnDestroy(): void {
    this.timers.forEach(clearInterval);
    if (this.showTimer) clearTimeout(this.showTimer);
    if (this.cameraRetry) clearTimeout(this.cameraRetry);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    // Hand the webcam back to the browser scanner (Exit goes straight back to it).
    this.engine.stopStream().subscribe({ error: () => {} });
  }

  // Go back to the scanner only once the engine has released the webcam; leaving right away
  // made the scanner find the camera still in use and give up.
  async exit(): Promise<void> {
    if (this.exiting()) return;
    this.exiting.set(true);
    try {
      await firstValueFrom(this.engine.stopStream().pipe(timeout(EXIT_RELEASE_TIMEOUT_MS)));
    } catch {
      /* engine offline or slow — the scanner retries a busy camera by itself */
    }
    void this.router.navigate(['/scanner', this.eventId]);
  }

  @HostListener('window:pagehide')
  onPageHide(): void {
    this.engine.stopStreamOnUnload();
  }

  // The engine opens the camera only while the TV is showing. The scanner page may still be
  // releasing it for a moment; the engine keeps retrying, and the preview reconnects on error.
  private startCamera(): void {
    this.engine.startStream().subscribe({
      next: () => {
        this.cameraUrl.set(this.engine.streamUrl());
        this.applyScanMode(); // the engine forgets both on restart
        this.applyDetectionMode();
      },
      error: () => this.onCameraError(),
    });
  }

  setScanMode(mode: EngineScanMode): void {
    if (mode === this.scanMode()) return;
    this.scanMode.set(mode);
    try {
      localStorage.setItem(SCAN_MODE_KEY, mode);
    } catch {
      /* storage unavailable — keep the in-memory choice */
    }
    this.applyScanMode();
  }

  private applyScanMode(): void {
    this.engine.setScanMode(this.scanMode()).subscribe({ error: () => {} });
  }

  setDetectionMode(mode: EngineDetectionMode): void {
    if (mode === this.detectionMode()) return;
    this.detectionMode.set(mode);
    try {
      localStorage.setItem(DETECTION_MODE_KEY, mode);
    } catch {
      /* storage unavailable — keep the in-memory choice */
    }
    this.applyDetectionMode();
  }

  private applyDetectionMode(): void {
    this.engine.setDetectionMode(this.detectionMode()).subscribe({ error: () => {} });
  }

  loadGallery(): void {
    // One reload at a time; a change that comes in mid-reload gets one more pass afterwards.
    if (this.galleryLoading) {
      this.galleryReloadQueued = true;
      return;
    }
    this.galleryLoading = true;
    this.engine.loadGallery(this.eventId).subscribe({
      complete: () => this.onGalleryLoaded(),
      next: (s) => {
        this.galleryError.set(false);
        const skipped = s.skipped_people.length
          ? ` · ${s.skipped_people.length} photo${s.skipped_people.length === 1 ? '' : 's'} without a clear face`
          : '';
        this.galleryMessage.set(`${s.person_count} registered face${s.person_count === 1 ? '' : 's'}${skipped}`);
      },
      error: (err) => {
        this.galleryError.set(true);
        this.galleryMessage.set(err?.error?.detail ?? 'Could not load registered faces from the face engine.');
        this.onGalleryLoaded();
      },
    });
  }

  private onGalleryLoaded(): void {
    this.galleryLoading = false;
    if (this.galleryReloadQueued) {
      this.galleryReloadQueued = false;
      this.loadGallery();
    }
  }

  private loadEvent(): void {
    this.api.getEvent(this.eventId).subscribe({
      next: (e) => {
        this.eventTitle.set(e.title);
        this.eventWelcome.set(e.welcomeMessage);
        this.verifyOnly.set(e.verifyOnly);
        this.eventBanner.set(e.bannerImage);
      },
      error: () => {},
    });
  }

  loadAttendees(): void {
    this.api.attendance(this.eventId).subscribe({ next: (list) => this.attendees.set(list), error: () => {} });
  }

  @HostListener('document:keydown', ['$event'])
  onKey(event: KeyboardEvent): void {
    if ((event.key === 'f' || event.key === 'F') && !event.ctrlKey && !event.metaKey) this.toggleFullscreen();
  }

  toggleFullscreen(): void {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else {
      // Going fullscreen gives the stage the whole screen; "Attendees" brings the list back.
      this.sideOpen.set(false);
      document.documentElement.requestFullscreen().catch(() => {});
    }
  }

  // The preview sits in the bottom-left corner, so dragging the handle up or right grows it.
  startCameraResize(event: PointerEvent): void {
    event.preventDefault();
    const handle = event.currentTarget as HTMLElement;
    const preview = handle.parentElement!;
    const startWidth = preview.getBoundingClientRect().width;
    const { clientX: startX, clientY: startY } = event;
    handle.setPointerCapture(event.pointerId);

    const move = (e: PointerEvent) => {
      const dx = e.clientX - startX;
      const dy = (startY - e.clientY) * CAMERA_ASPECT;
      this.cameraWidth.set(clampCameraWidth(startWidth + (Math.abs(dx) > Math.abs(dy) ? dx : dy)));
    };
    const end = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      this.saveCameraWidth();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }

  onCameraResizeKey(event: KeyboardEvent): void {
    const steps: Record<string, number> = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 };
    const step = steps[event.key];
    if (!step) return;
    event.preventDefault();
    const preview = (event.currentTarget as HTMLElement).parentElement!;
    this.cameraWidth.set(clampCameraWidth(preview.getBoundingClientRect().width + step * CAMERA_KEY_STEP));
    this.saveCameraWidth();
  }

  resetCameraSize(): void {
    this.cameraWidth.set(null);
    this.saveCameraWidth();
  }

  private saveCameraWidth(): void {
    const width = this.cameraWidth();
    try {
      if (width === null) localStorage.removeItem(CAMERA_WIDTH_KEY);
      else localStorage.setItem(CAMERA_WIDTH_KEY, String(width));
    } catch {
      /* storage unavailable — keep the in-memory size */
    }
  }

  onCameraError(): void {
    if (this.cameraRetry) return;
    // Start again too (a no-op if it's running): the engine may have restarted, or the camera
    // was released by another page.
    this.cameraRetry = setTimeout(() => {
      this.cameraRetry = null;
      this.startCamera();
    }, CAMERA_RETRY_MS);
  }

  private async poll(): Promise<void> {
    if (this.isPolling) return;
    this.isPolling = true;
    try {
      const data = await firstValueFrom(this.engine.checkIns(this.lastSequence));
      this.engineOnline.set(true);
      const isFirstLoad = this.sessionId === null;
      if (data.session_id !== this.sessionId) {
        // The engine started a new session: sequence numbers restarted.
        this.sessionId = data.session_id;
        this.lastSequence = 0;
        this.waiting.set([]);
        if (!isFirstLoad) {
          this.isPolling = false;
          await this.poll();
          return;
        }
      }
      this.displaySeconds.set(data.display_seconds);
      this.lastSequence = data.last_sequence;
      const replayAfter = Date.now() / 1000 - REPLAY_RECENT_SECONDS;
      const fresh = data.check_ins.filter((c) => !isFirstLoad || c.checked_in_at >= replayAfter);
      // Recorded together, so people recognized in the same frame are shown in order.
      const items = await Promise.all(fresh.map((c) => this.record(c)));
      if (items.length) {
        this.waiting.update((list) => [...list, ...items]);
        this.loadAttendees();
      }
      this.showNext();
    } catch {
      this.engineOnline.set(false); // engine restarting: keep the screen and retry
    } finally {
      this.isPolling = false;
    }
  }

  /** Record the check-in in the backend; its answer decides what the TV shows. */
  private async record(checkIn: EngineCheckIn): Promise<TvItem> {
    const { person } = checkIn;
    let result: CheckInResult;
    try {
      result = await firstValueFrom(this.checkInRequest(person.person_id));
    } catch {
      result = this.errorResult(person.name, 'Could not record this check-in. Please see the registration desk.');
    }
    // A QR pass has no engine photo; only the backend knows whose pass it is.
    const isQr = person.person_id.startsWith('q');
    return {
      sequence: checkIn.sequence,
      name: result.fullName || person.name || (isQr ? 'QR pass' : 'Guest'),
      photo: result.photoUrl || (isQr ? '' : this.engine.photoUrl(person)),
      result,
    };
  }

  private checkInRequest(personId: string) {
    if (personId.startsWith('u')) return this.api.checkInUser(this.eventId, Number(personId.slice(1)));
    // "g{token}": a guest registration's face; "q{token}": a QR pass the camera read.
    return this.api.checkIn(personId.slice(1));
  }

  private showNext(): void {
    if (this.current()) return;
    const [next, ...rest] = this.waiting();
    if (!next) return;
    this.waiting.set(rest);
    this.current.set(next);
    this.showTimer = setTimeout(() => {
      this.showTimer = null;
      this.current.set(null);
      this.showNext();
    }, this.displaySeconds() * 1000);
  }

  private errorResult(name: string, message: string): CheckInResult {
    return {
      status: 'error',
      fullName: name,
      eventTitle: null,
      checkedInAt: null,
      message,
      level: null,
      senateNo: null,
      organization: null,
      welcomeMessage: null,
      photoUrl: null,
      sessionTitle: null,
    };
  }

  private formatTime(date: Date): string {
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
}
