import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';

export interface KitClaimData {
  count: number; // how many registrations are being claimed
  // Optional wording overrides so the same dialog serves kits and meal stubs.
  noun?: string; // singular item noun, e.g. "kit" (default) or "meal stub"
  title?: string; // dialog title (default "Claim kit(s)")
  confirmLabel?: string; // confirm button (default "Mark claimed")
}

// null = cancelled. selfClaimed=true means each registrant claimed/received their own item.
export interface KitClaimResult {
  selfClaimed: boolean;
  claimedBy: string | null;
}

/** Prompts for who claimed the selected item(s), or that each person self-claimed. */
@Component({
  selector: 'app-kit-claim-dialog',
  imports: [
    FormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatSlideToggleModule,
  ],
  template: `
    <h2 mat-dialog-title>{{ data.title ?? 'Claim kit' + (data.count === 1 ? '' : 's') }}</h2>
    <mat-dialog-content>
      <p class="muted kc-intro">
        Marking <strong>{{ data.count }}</strong> registrant{{ data.count === 1 ? '' : 's' }}'
        {{ noun }}{{ data.count === 1 ? '' : 's' }} as claimed.
      </p>

      <mat-slide-toggle [(ngModel)]="selfClaimed">Self-claimed</mat-slide-toggle>
      <p class="muted kc-hint">
        On — each person collected their own {{ noun }} (their own name is recorded).
        Off — one person collected on their behalf; enter that name below.
      </p>

      @if (!selfClaimed()) {
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Claimed by</mat-label>
          <input matInput [(ngModel)]="claimedBy" maxlength="200" placeholder="Name of the person claiming"
                 (keyup.enter)="confirm()" />
          <mat-icon matSuffix>person</mat-icon>
        </mat-form-field>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="ref.close()">Cancel</button>
      <button mat-flat-button color="primary" (click)="confirm()" [disabled]="!canConfirm()">
        <mat-icon>redeem</mat-icon> {{ data.confirmLabel ?? 'Mark claimed' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: [
    `
      :host { display: block; min-width: min(400px, 82vw); }
      .kc-intro { margin: 0 0 12px; }
      .kc-hint { margin: 6px 0 12px; font-size: 12px; }
      .full-width { width: 100%; }
    `,
  ],
})
export class KitClaimDialogComponent {
  readonly ref = inject(MatDialogRef<KitClaimDialogComponent, KitClaimResult>);
  readonly data = inject<KitClaimData>(MAT_DIALOG_DATA);

  readonly noun = this.data.noun ?? 'kit';
  selfClaimed = signal(false);
  claimedBy = '';

  canConfirm(): boolean {
    return this.selfClaimed() || this.claimedBy.trim().length > 0;
  }

  confirm(): void {
    if (!this.canConfirm()) return;
    this.ref.close({
      selfClaimed: this.selfClaimed(),
      claimedBy: this.selfClaimed() ? null : this.claimedBy.trim(),
    });
  }
}
