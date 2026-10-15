import { Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { AlertTone } from './alert-tones';

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  /** 'error' renders a destructive (red) confirm button. */
  tone?: AlertTone;
  icon?: string;
}

const DEFAULT_ICONS: Record<AlertTone, string> = {
  error: 'delete_forever',
  warning: 'warning',
  info: 'help',
  success: 'check_circle',
};

// Confirmation prompt styled like the toasts. Closes with true (confirm) or false.
@Component({
  selector: 'app-confirm-dialog',
  imports: [MatDialogModule, MatIconModule],
  template: `
    <div class="confirm-card tone-{{ tone }}">
      <span class="confirm-icon"><mat-icon>{{ data.icon ?? defaultIcon }}</mat-icon></span>
      <h2 class="confirm-title">{{ data.title }}</h2>
      <p class="confirm-msg">{{ data.message }}</p>
      <div class="confirm-actions">
        <button type="button" class="confirm-btn ghost" (click)="ref.close(false)">
          {{ data.cancelText ?? 'Cancel' }}
        </button>
        <button type="button" class="confirm-btn solid" (click)="ref.close(true)">
          {{ data.confirmText ?? 'Confirm' }}
        </button>
      </div>
    </div>
  `,
})
export class ConfirmDialogComponent {
  readonly data = inject<ConfirmOptions>(MAT_DIALOG_DATA);
  readonly ref = inject(MatDialogRef<ConfirmDialogComponent, boolean>);
  readonly tone: AlertTone = this.data.tone ?? 'info';
  readonly defaultIcon = DEFAULT_ICONS[this.tone];
}
