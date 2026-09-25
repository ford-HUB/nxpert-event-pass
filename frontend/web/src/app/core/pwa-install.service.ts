import { Injectable, computed, signal } from '@angular/core';

// The (non-standard) beforeinstallprompt event exposed by Chromium browsers.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'pwa_install_dismissed';

/**
 * Drives "install this app on your phone". On Android/desktop Chromium we capture the
 * `beforeinstallprompt` event and trigger the native install on demand. iOS Safari has no such
 * API — installation is manual (Share → Add to Home Screen) — so we surface a short instruction
 * instead. Already-installed (standalone) sessions show nothing.
 */
@Injectable({ providedIn: 'root' })
export class PwaInstallService {
  private deferred: BeforeInstallPromptEvent | null = null;

  readonly canInstall = signal(false); // native prompt is available (Android/desktop)
  readonly isIosSafari = signal(false); // needs manual "Add to Home Screen"
  readonly installed = signal(false); // already running as an installed app
  readonly dismissed = signal(false); // user hid the banner this session

  // Show the install banner when it's installable and not already installed/dismissed.
  readonly showBanner = computed(
    () => !this.installed() && !this.dismissed() && (this.canInstall() || this.isIosSafari()),
  );

  constructor() {
    if (typeof window === 'undefined') return;

    const standalone =
      window.matchMedia?.('(display-mode: standalone)')?.matches === true ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    this.installed.set(standalone);

    const ua = navigator.userAgent || '';
    // iOS Safari only — Chrome/Firefox/Edge on iOS (CriOS/FxiOS/EdgiOS) can't add to home screen.
    const iosDevice = /iphone|ipad|ipod/i.test(ua);
    const otherIosBrowser = /crios|fxios|edgios/i.test(ua);
    this.isIosSafari.set(iosDevice && !otherIosBrowser && !standalone);

    window.addEventListener('beforeinstallprompt', (e: Event) => {
      e.preventDefault(); // stash it so we can trigger the prompt from our own button
      this.deferred = e as BeforeInstallPromptEvent;
      this.canInstall.set(true);
    });
    window.addEventListener('appinstalled', () => {
      this.deferred = null;
      this.canInstall.set(false);
      this.installed.set(true);
    });

    try {
      this.dismissed.set(sessionStorage.getItem(DISMISS_KEY) === '1');
    } catch {
      /* storage unavailable — banner just stays visible */
    }
  }

  /** Trigger the native install prompt (Android/desktop). No-op on iOS. */
  async install(): Promise<void> {
    const evt = this.deferred;
    if (!evt) return;
    this.deferred = null;
    this.canInstall.set(false);
    try {
      await evt.prompt();
      await evt.userChoice;
    } catch {
      /* user dismissed or the prompt is no longer valid */
    }
  }

  dismiss(): void {
    this.dismissed.set(true);
    try {
      sessionStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* ignore */
    }
  }
}
