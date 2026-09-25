import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiService } from './api.service';
import { CheckInResult, OfflineBundle, QueuedCheckIn, QueuedRegistration } from './models';

const DB_NAME = 'eventpass-offline';
const DB_VERSION = 1;
const STORE_BUNDLES = 'bundles';
const STORE_CHECKINS = 'checkinQueue';
const STORE_REGS = 'regQueue';

function startOfDay(iso: string | Date): number {
  const d = new Date(iso);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Offline support: caches an event's data bundle in IndexedDB, resolves/records check-ins and
 * registrations locally when there's no network, and syncs the queued actions when back online.
 */
@Injectable({ providedIn: 'root' })
export class OfflineService {
  private api = inject(ApiService);
  private dbp?: Promise<IDBDatabase>;

  readonly online = signal(typeof navigator === 'undefined' ? true : navigator.onLine);
  readonly pending = signal(0); // queued items waiting to sync
  readonly syncing = signal(false);

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        this.online.set(true);
        void this.syncAll();
      });
      window.addEventListener('offline', () => this.online.set(false));
    }
    void this.refreshPending();
  }

  // ---- IndexedDB plumbing ----
  private db(): Promise<IDBDatabase> {
    if (!this.dbp) {
      this.dbp = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE_BUNDLES))
            db.createObjectStore(STORE_BUNDLES, { keyPath: 'eventId' });
          if (!db.objectStoreNames.contains(STORE_CHECKINS))
            db.createObjectStore(STORE_CHECKINS, { keyPath: 'id', autoIncrement: true });
          if (!db.objectStoreNames.contains(STORE_REGS))
            db.createObjectStore(STORE_REGS, { keyPath: 'id', autoIncrement: true });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return this.dbp;
  }

  private async tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
    const db = await this.db();
    return new Promise<T>((resolve, reject) => {
      const t = db.transaction(store, mode);
      const req = fn(t.objectStore(store));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => reject(req.error);
    });
  }

  private async getAll<T>(store: string): Promise<T[]> {
    return this.tx<T[]>(store, 'readonly', (s) => s.getAll());
  }

  // ---- Bundle ----
  async saveBundle(bundle: OfflineBundle): Promise<void> {
    await this.tx(STORE_BUNDLES, 'readwrite', (s) =>
      s.put({ eventId: bundle.event.id, bundle }),
    );
  }

  async getBundle(eventId: number): Promise<OfflineBundle | null> {
    const row = await this.tx<{ eventId: number; bundle: OfflineBundle } | undefined>(
      STORE_BUNDLES,
      'readonly',
      (s) => s.get(eventId),
    );
    return row?.bundle ?? null;
  }

  /** Fetch the latest bundle from the API (when online) and cache it. Returns the cached copy. */
  async refreshBundle(eventId: number): Promise<OfflineBundle | null> {
    if (this.online()) {
      try {
        const bundle = await firstValueFrom(this.api.getOfflineBundle(eventId));
        await this.saveBundle(bundle);
        return bundle;
      } catch {
        /* fall back to whatever is cached */
      }
    }
    return this.getBundle(eventId);
  }

  // ---- Queues ----
  private async refreshPending(): Promise<void> {
    try {
      const [c, r] = await Promise.all([
        this.getAll<QueuedCheckIn>(STORE_CHECKINS),
        this.getAll<QueuedRegistration>(STORE_REGS),
      ]);
      this.pending.set(c.length + r.length);
    } catch {
      this.pending.set(0);
    }
  }

  private async enqueueCheckIn(item: QueuedCheckIn): Promise<void> {
    await this.tx(STORE_CHECKINS, 'readwrite', (s) => s.add(item));
    await this.refreshPending();
  }

  async queueRegistration(item: QueuedRegistration): Promise<void> {
    await this.tx(STORE_REGS, 'readwrite', (s) => s.add(item));
    await this.refreshPending();
  }

  // ---- Local (offline) check-in ----
  private windowOf(bundle: OfflineBundle, sessionId: number | null): { start: string; end: string; title: string | null } {
    const s = sessionId != null ? bundle.sessions.find((x) => x.id === sessionId) : null;
    return {
      start: s ? s.startsAt : bundle.event.startsAt,
      end: s ? s.endsAt : bundle.event.endsAt,
      title: s ? s.title : null,
    };
  }

  /** Pick the registration token for a recognized member for today's sub-event. */
  resolveFaceToken(bundle: OfflineBundle, userId: number): string | null {
    const regs = bundle.registrations.filter((r) => r.userId === userId);
    if (regs.length === 0) return null;
    const today = startOfDay(new Date());
    const inWindow = (r: (typeof regs)[number]) => {
      const w = this.windowOf(bundle, r.sessionId);
      return today >= startOfDay(w.start) && today <= startOfDay(w.end);
    };
    const pick =
      regs.find((r) => !r.checkedInAt && r.confirmed && inWindow(r)) ??
      regs.find(inWindow) ??
      [...regs].sort((a, b) => startOfDay(this.windowOf(bundle, a.sessionId).start) - startOfDay(this.windowOf(bundle, b.sessionId).start))[0];
    return pick?.token ?? null;
  }

  /**
   * Validate and record a check-in against the cached bundle (no network). Mutates + persists
   * the bundle, queues the check-in for sync, and returns the same shape as the online API.
   */
  async localCheckIn(eventId: number, rawToken: string): Promise<CheckInResult> {
    const bundle = await this.getBundle(eventId);
    const none = (status: CheckInResult['status'], message: string | null = null, fullName: string | null = null): CheckInResult => ({
      status,
      fullName,
      eventTitle: bundle?.event.title ?? null,
      checkedInAt: null,
      message,
      level: null,
      senateNo: null,
      organization: null,
      welcomeMessage: bundle?.event.welcomeMessage ?? null,
      photoUrl: null,
      sessionTitle: null,
    });

    if (!bundle) return none('error', 'No offline data for this event. Connect once to download it.');

    let token = rawToken.trim();
    if (token.toUpperCase().startsWith('REG:')) token = token.slice(4);
    const reg = bundle.registrations.find((r) => r.token.toLowerCase() === token.toLowerCase());
    if (!reg) return none('invalid');

    const member = reg.userId != null ? bundle.members.find((m) => m.userId === reg.userId) : null;
    const name = member?.fullName ?? reg.guestName ?? 'Guest';
    const w = this.windowOf(bundle, reg.sessionId);

    const base = (status: CheckInResult['status'], checkedInAt: string | null, message: string | null = null): CheckInResult => ({
      status,
      fullName: name,
      eventTitle: bundle.event.title,
      checkedInAt,
      message,
      level: member?.level ?? null,
      senateNo: member?.senateNo ?? null,
      organization: member?.organization ?? null,
      welcomeMessage: bundle.event.welcomeMessage,
      photoUrl: member?.photoUrl ?? null,
      sessionTitle: w.title,
    });

    if (reg.checkedInAt) return base('already', reg.checkedInAt);
    if (!reg.confirmed) return base('unconfirmed', null, "This registration hasn't been confirmed yet.");

    const today = startOfDay(new Date());
    if (today < startOfDay(w.start))
      return base('notstarted', null, `This ${w.title ? 'sub-event' : 'event'} hasn't started yet.`);
    if (today > startOfDay(w.end))
      return base('ended', null, `This ${w.title ? 'sub-event' : 'event'} has ended.`);

    // Record it: mutate the cached bundle + queue for sync.
    const now = new Date().toISOString();
    reg.checkedInAt = now;
    await this.saveBundle(bundle);
    await this.enqueueCheckIn({ eventId, token: reg.token, checkedInAt: now });
    return base('valid', now);
  }

  // ---- Sync ----
  async syncAll(): Promise<{ checkins: number; regs: number } | null> {
    if (!this.online() || this.syncing()) return null;
    this.syncing.set(true);
    let checkins = 0;
    let regs = 0;
    try {
      const queuedC = await this.getAll<QueuedCheckIn & { id: number }>(STORE_CHECKINS);
      if (queuedC.length > 0) {
        const res = await firstValueFrom(
          this.api.syncCheckIns(queuedC.map((c) => ({ token: c.token, checkedInAt: c.checkedInAt }))),
        );
        checkins = res.applied;
        // Applied or already-recorded are done; drop them all (notFound also dropped to avoid loops).
        for (const c of queuedC) await this.tx(STORE_CHECKINS, 'readwrite', (s) => s.delete(c.id));
      }

      const queuedR = await this.getAll<QueuedRegistration & { id: number }>(STORE_REGS);
      if (queuedR.length > 0) {
        // Group by event slug.
        const bySlug = new Map<string, (QueuedRegistration & { id: number })[]>();
        for (const r of queuedR) (bySlug.get(r.slug) ?? bySlug.set(r.slug, []).get(r.slug)!).push(r);
        for (const [slug, items] of bySlug) {
          const res = await firstValueFrom(
            this.api.syncOfflineRegistrations(
              slug,
              items.map((i) => ({
                fullName: i.fullName,
                senateNo: i.senateNo ?? null,
                email: i.email,
                phone: i.phone,
                notificationChannel: i.notificationChannel ?? 'Email',
                sessionIds: i.sessionIds,
                responses: i.responses,
                registeredAt: i.registeredAt,
                face: i.face ?? null,
                displayPicture: i.displayPicture ?? null,
              })),
            ),
          );
          regs += res.created;
          for (const i of items) await this.tx(STORE_REGS, 'readwrite', (s) => s.delete(i.id));
        }
      }
      await this.refreshPending();
      return { checkins, regs };
    } catch {
      return null; // stay queued; try again later
    } finally {
      this.syncing.set(false);
    }
  }
}
