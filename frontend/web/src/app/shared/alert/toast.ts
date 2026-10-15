import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { MAT_SNACK_BAR_DATA, MatSnackBarRef } from '@angular/material/snack-bar';
import { MatIconModule } from '@angular/material/icon';
import { ALERT_TONES, AlertTone } from './alert-tones';

export interface ToastData {
  message: string;
  tone: AlertTone;
  duration: number;
}

// Card-style toast rendered inside MatSnackBar. Owns its own timer so hovering pauses it.
@Component({
  selector: 'app-toast',
  imports: [MatIconModule],
  template: `
    <div class="alert-card tone-{{ data.tone }}" role="status"
         (mouseenter)="pause()" (mouseleave)="resume()">
      <span class="alert-icon"><mat-icon>{{ meta.icon }}</mat-icon></span>
      <div class="alert-body">
        <span class="alert-title">{{ meta.title }}</span>
        <span class="alert-msg">{{ data.message }}</span>
      </div>
      <button type="button" class="alert-close" (click)="close()" aria-label="Dismiss">
        <mat-icon>close</mat-icon>
      </button>
      <span class="alert-timer" [class.paused]="paused"
            [style.animation-duration.ms]="data.duration"></span>
    </div>
  `,
})
export class ToastComponent implements OnInit, OnDestroy {
  readonly data = inject<ToastData>(MAT_SNACK_BAR_DATA);
  private readonly ref = inject(MatSnackBarRef<ToastComponent>);
  readonly meta = ALERT_TONES[this.data.tone];

  paused = false;
  private remaining = this.data.duration;
  private startedAt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  ngOnInit(): void {
    this.resume();
  }

  ngOnDestroy(): void {
    this.clear();
  }

  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.clear();
    this.remaining -= Date.now() - this.startedAt;
  }

  resume(): void {
    this.paused = false;
    this.startedAt = Date.now();
    this.clear();
    this.timer = setTimeout(() => this.close(), Math.max(0, this.remaining));
  }

  close(): void {
    this.ref.dismiss();
  }

  private clear(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
