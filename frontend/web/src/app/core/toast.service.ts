import { Injectable, inject } from '@angular/core';
import { MatSnackBar, MatSnackBarConfig } from '@angular/material/snack-bar';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

/**
 * Central place for every user-facing message in the app. Wraps MatSnackBar so
 * that success / error / info / warning notifications all share one look
 * (colour, position, duration) and so a message can be raised from anywhere —
 * components, dialogs, or the global HTTP error interceptor.
 *
 * De-duplication: the same request can be reported twice (a component's own
 * error callback AND the global interceptor). We swallow a toast when an
 * identical one is already on screen, and we collapse a burst of *error*
 * toasts fired within a short window down to the first — so one failed request
 * never stacks two red toasts.
 */
@Injectable({ providedIn: 'root' })
export class ToastService {
  private snack = inject(MatSnackBar);

  private lastKey = '';
  private lastAt = 0;
  private lastErrorAt = 0;

  success(message: string, duration = 3000): void {
    this.show(message, 'success', duration);
  }

  error(message: string, duration = 5000): void {
    this.show(message, 'error', duration);
  }

  info(message: string, duration = 3500): void {
    this.show(message, 'info', duration);
  }

  warning(message: string, duration = 4000): void {
    this.show(message, 'warning', duration);
  }

  private show(message: string, type: ToastType, duration: number): void {
    const msg = (message ?? '').toString().trim();
    if (!msg) return;

    const now = Date.now();
    const key = `${type}:${msg}`;

    // Exact same toast still fresh → skip.
    if (key === this.lastKey && now - this.lastAt < 5000) return;
    // A different error moments after another (same failed request handled in
    // two places) → keep only the first.
    if (type === 'error' && now - this.lastErrorAt < 900) return;

    this.lastKey = key;
    this.lastAt = now;
    if (type === 'error') this.lastErrorAt = now;

    const config: MatSnackBarConfig = {
      duration,
      horizontalPosition: 'right',
      verticalPosition: 'top',
      panelClass: ['app-toast', `app-toast-${type}`],
    };
    this.snack.open(msg, 'Dismiss', config);
  }
}
