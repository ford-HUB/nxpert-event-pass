import { Injectable, computed, effect, inject, signal } from '@angular/core';
import {
  HubConnection,
  HubConnectionBuilder,
  HubConnectionState,
  LogLevel,
} from '@microsoft/signalr';
import { Subject } from 'rxjs';
import { API_BASE } from './config';
import { AuthService } from './auth.service';
import { ToastService } from './toast.service';
import {
  AppNotification,
  AttendeesChangedNotice,
  FaceGalleryChangedNotice,
  KitClaimedNotice,
  VerifyOnlyChangedNotice,
  NewRegistrationNotice,
  RegistrationApprovedNotice,
} from './models';

const MAX_KEEP = 50;

/**
 * Realtime notifications over SignalR. Connects to the API's notification hub while a user is
 * logged in (re-connecting automatically on drops), and maintains the in-app notification list:
 *  - admins/confirmers receive a "newRegistration" push whenever someone registers;
 *  - registrants receive a "registrationApproved" push when their registration is confirmed.
 * It also relays "attendeesChanged" (changed/removed Attendance rows) and "faceGalleryChanged" (an
 * event's registrants or their photos changed) to pages that want live data.
 * The list is persisted per-user in localStorage so it survives a reload.
 */
@Injectable({ providedIn: 'root' })
export class RealtimeService {
  private auth = inject(AuthService);
  private toast = inject(ToastService);

  private connection: HubConnection | null = null;

  readonly notifications = signal<AppNotification[]>([]);
  readonly connected = signal(false);
  readonly unread = computed(() => this.notifications().filter((n) => !n.read).length);

  private attendeesChangedSubject = new Subject<AttendeesChangedNotice>();
  /** Attendance rows as they're added, updated or removed (admins/confirmers only). */
  readonly attendeesChanged$ = this.attendeesChangedSubject.asObservable();

  private faceGalleryChangedSubject = new Subject<FaceGalleryChangedNotice>();
  /** An event's face gallery is stale (registration added/removed, photo changed). Admins only. */
  readonly faceGalleryChanged$ = this.faceGalleryChangedSubject.asObservable();

  private verifyOnlyChangedSubject = new Subject<VerifyOnlyChangedNotice>();
  /** An event's verify-only mode was switched (on another scanner). Admins only. */
  readonly verifyOnlyChanged$ = this.verifyOnlyChangedSubject.asObservable();

  constructor() {
    // Connect/disconnect as the auth state changes.
    effect(() => {
      const loggedIn = this.auth.isLoggedIn();
      if (loggedIn) {
        this.notifications.set(this.loadStored());
        void this.connect();
      } else {
        void this.disconnect();
        this.notifications.set([]);
      }
    });
  }

  private storageKey(): string | null {
    const uid = this.auth.auth()?.userId;
    return uid ? `evt_notifs_${uid}` : null;
  }

  private loadStored(): AppNotification[] {
    const key = this.storageKey();
    if (!key) return [];
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as AppNotification[]) : [];
    } catch {
      return [];
    }
  }

  private persist(): void {
    const key = this.storageKey();
    if (!key) return;
    try {
      localStorage.setItem(key, JSON.stringify(this.notifications().slice(0, MAX_KEEP)));
    } catch {
      /* storage may be unavailable (private mode) — the list still works in-memory */
    }
  }

  private async connect(): Promise<void> {
    if (this.connection) return; // already connected/connecting
    const conn = new HubConnectionBuilder()
      .withUrl(`${API_BASE}/hubs/notifications`, {
        accessTokenFactory: () => this.auth.token ?? '',
      })
      .withAutomaticReconnect()
      .configureLogging(LogLevel.Warning)
      .build();

    conn.on('newRegistration', (n: NewRegistrationNotice) => this.onNewRegistration(n));
    conn.on('registrationApproved', (n: RegistrationApprovedNotice) => this.onApproved(n));
    conn.on('kitClaimed', (n: KitClaimedNotice) => this.onKitClaimed(n));
    conn.on('attendeesChanged', (n: AttendeesChangedNotice) => this.attendeesChangedSubject.next(n));
    conn.on('faceGalleryChanged', (n: FaceGalleryChangedNotice) => this.faceGalleryChangedSubject.next(n));
    conn.on('verifyOnlyChanged', (n: VerifyOnlyChangedNotice) => this.verifyOnlyChangedSubject.next(n));
    conn.onreconnected(() => this.connected.set(true));
    conn.onreconnecting(() => this.connected.set(false));
    conn.onclose(() => this.connected.set(false));

    this.connection = conn;
    try {
      await conn.start();
      this.connected.set(true);
    } catch {
      // Hub unreachable (e.g. API down). Automatic reconnect handles later recovery; if the
      // very first start fails, drop the connection so a later auth change retries cleanly.
      this.connected.set(false);
      if (this.connection === conn) this.connection = null;
    }
  }

  private async disconnect(): Promise<void> {
    const conn = this.connection;
    this.connection = null;
    this.connected.set(false);
    if (conn && conn.state !== HubConnectionState.Disconnected) {
      try {
        await conn.stop();
      } catch {
        /* ignore */
      }
    }
  }

  private onNewRegistration(n: NewRegistrationNotice): void {
    const where = n.sessionTitle ? `${n.eventTitle} — ${n.sessionTitle}` : n.eventTitle;
    const extra = n.count > 1 ? ` (${n.count} sub-events)` : '';
    const body = `${n.attendeeName} registered for ${where}${extra}`;
    this.push({
      id: this.newId(),
      kind: 'newRegistration',
      icon: 'how_to_reg',
      title: n.isGuest ? 'New guest registration' : 'New registration',
      body,
      at: n.at,
      read: false,
      link: `/admin/events/${n.eventId}`,
    });
    this.toast.info(body);
  }

  private onApproved(n: RegistrationApprovedNotice): void {
    const where = n.sessionTitle ? `${n.eventTitle} — ${n.sessionTitle}` : n.eventTitle;
    const body = `Your registration for ${where} was approved`;
    this.push({
      id: this.newId(),
      kind: 'registrationApproved',
      icon: 'check_circle',
      title: 'Registration approved',
      body,
      at: n.at,
      read: false,
      link: '/my-events',
    });
    this.toast.success(body);
  }

  private onKitClaimed(n: KitClaimedNotice): void {
    const where = n.sessionTitle ? `${n.eventTitle} — ${n.sessionTitle}` : n.eventTitle;
    const by = n.claimedBy ? ` by ${n.claimedBy}` : '';
    const body = `Your event kit for ${where} was claimed${by}`;
    this.push({
      id: this.newId(),
      kind: 'kitClaimed',
      icon: 'inventory_2',
      title: 'Kit claimed',
      body,
      at: n.at,
      read: false,
      link: '/my-events',
    });
    this.toast.success(body);
  }

  private push(notification: AppNotification): void {
    this.notifications.update((list) => [notification, ...list].slice(0, MAX_KEEP));
    this.persist();
  }

  markAllRead(): void {
    this.notifications.update((list) => list.map((n) => (n.read ? n : { ...n, read: true })));
    this.persist();
  }

  markRead(id: string): void {
    this.notifications.update((list) => list.map((n) => (n.id === id ? { ...n, read: true } : n)));
    this.persist();
  }

  clear(): void {
    this.notifications.set([]);
    this.persist();
  }

  private newId(): string {
    return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}
