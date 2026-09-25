import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ApiService } from '../core/api.service';

export interface ViberBroadcastData {
  eventId: number;
  eventTitle: string;
}

// null = cancelled/sent internally; the dialog performs the send itself and closes with true on success.
/**
 * Lets an event organizer type a message and blast it over Viber to every registered Viber
 * number for the event. Shows the recipient count up front and sends via the API directly.
 */
@Component({
  selector: 'app-viber-broadcast-dialog',
  imports: [
    FormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
  ],
  template: `
    <h2 mat-dialog-title>Send Viber message</h2>
    <mat-dialog-content>
      <p class="muted vb-intro">
        Type an announcement to blast over Viber to everyone registered for
        <strong>{{ data.eventTitle }}</strong> who chose Viber (or Both) and has a phone on file.
      </p>

      @if (loadingCount()) {
        <p class="muted vb-count"><mat-spinner diameter="16"></mat-spinner> Counting recipients…</p>
      } @else if (recipientCount() === 0) {
        <p class="vb-none">
          <mat-icon>info</mat-icon>
          No registrations with a Viber number were found for this event yet.
        </p>
      } @else {
        <p class="vb-count">
          <mat-icon>groups</mat-icon>
          This will send to <strong>{{ recipientCount() }}</strong>
          Viber number{{ recipientCount() === 1 ? '' : 's' }}.
        </p>
      }

      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Message</mat-label>
        <textarea matInput [(ngModel)]="message" rows="5" maxlength="1000"
                  placeholder="e.g. The keynote in Hall A starts in 15 minutes. Please take your seats."
                  [disabled]="sending()"></textarea>
        <mat-hint align="end">{{ message.length }}/1000</mat-hint>
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="ref.close()" [disabled]="sending()">Cancel</button>
      <button mat-flat-button color="primary" (click)="send()"
              [disabled]="!canSend()">
        @if (sending()) {
          <mat-spinner diameter="18"></mat-spinner>
        } @else {
          <mat-icon>send</mat-icon>
        }
        Send now
      </button>
    </mat-dialog-actions>
  `,
  styles: [
    `
      :host { display: block; min-width: min(460px, 86vw); }
      .vb-intro { margin: 0 0 12px; }
      .vb-count, .vb-none {
        display: flex; align-items: center; gap: 8px;
        margin: 0 0 14px; font-size: 13px;
      }
      .vb-none { color: var(--mat-sys-error, #b00020); }
      .full-width { width: 100%; }
      button mat-spinner { display: inline-block; margin-right: 6px; }
    `,
  ],
})
export class ViberBroadcastDialogComponent {
  readonly ref = inject(MatDialogRef<ViberBroadcastDialogComponent, { sent: number; message: string }>);
  readonly data = inject<ViberBroadcastData>(MAT_DIALOG_DATA);
  private api = inject(ApiService);

  message = '';
  sending = signal(false);
  loadingCount = signal(true);
  recipientCount = signal(0);

  constructor() {
    this.api.viberRecipientCount(this.data.eventId).subscribe({
      next: (r) => {
        this.recipientCount.set(r.count);
        this.loadingCount.set(false);
      },
      error: () => this.loadingCount.set(false),
    });
  }

  canSend(): boolean {
    return !this.sending() && !this.loadingCount() && this.recipientCount() > 0 && this.message.trim().length > 0;
  }

  send(): void {
    if (!this.canSend()) return;
    this.sending.set(true);
    this.api.viberBroadcast(this.data.eventId, this.message.trim()).subscribe({
      next: (res) => this.ref.close(res),
      error: () => this.sending.set(false),
    });
  }
}
