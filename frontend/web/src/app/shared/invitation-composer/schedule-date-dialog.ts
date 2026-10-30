import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { Observable } from 'rxjs';

const PH_OFFSET_MS = 8 * 3600000;

export interface ScheduleDateDialogData {
  title: string;
  // Philippine wall-clock time as 'YYYY-MM-DDTHH:mm' (datetime-local format), or '' for a new date.
  value: string;
  // Returns an error for a candidate value (past, conflicting…), or '' when it can be used.
  validate: (value: string) => string;
}

/** Calendar + hour, minute and AM/PM picker for one scheduled send, in Philippine time. */
@Component({
  selector: 'app-schedule-date-dialog',
  imports: [FormsModule, MatDialogModule, MatButtonModule, MatButtonToggleModule, MatDatepickerModule,
    MatFormFieldModule, MatIconModule, MatSelectModule],
  template: `
    <h2 mat-dialog-title>{{ data.title }}</h2>
    <mat-dialog-content>
      <mat-calendar [selected]="date" (selectedChange)="date = $event" [startAt]="date" [minDate]="minDate" />
      <div class="time-row">
        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-label>Hour</mat-label>
          <mat-select [(ngModel)]="hour">
            @for (h of hours; track h) { <mat-option [value]="h">{{ h }}</mat-option> }
          </mat-select>
        </mat-form-field>
        <span class="colon" aria-hidden="true">:</span>
        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-label>Minute</mat-label>
          <mat-select [(ngModel)]="minute">
            @for (m of minutes; track m) { <mat-option [value]="m">{{ pad(m) }}</mat-option> }
          </mat-select>
        </mat-form-field>
        <mat-button-toggle-group [(ngModel)]="period" aria-label="AM or PM" hideSingleSelectionIndicator>
          <mat-button-toggle value="AM">AM</mat-button-toggle>
          <mat-button-toggle value="PM">PM</mat-button-toggle>
        </mat-button-toggle-group>
      </div>
      <p class="summary">
        <mat-icon>schedule_send</mat-icon>
        <span>{{ label }} <span class="muted">· Philippine time</span></span>
      </p>
      @if (error) { <p class="error" role="alert">{{ error }}</p> }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button (click)="save()" [disabled]="!!error">Set date and time</button>
    </mat-dialog-actions>
  `,
  styles: [
    `
      mat-calendar { width: 300px; max-width: 100%; margin: 0 auto; }
      .time-row { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
      .time-row mat-form-field { width: 84px; }
      .colon { font-weight: 700; color: #64748b; }
      mat-button-toggle-group { margin-left: auto; border-radius: 999px; }
      .summary { display: flex; align-items: center; gap: 8px; margin: 14px 0 0; font-weight: 600; color: #0f766e; }
      .summary mat-icon { font-size: 18px; width: 18px; height: 18px; }
      .muted { font-weight: 400; color: #64748b; }
      .error { margin: 6px 0 0; color: #b91c1c; font-size: 12.5px; }
    `,
  ],
})
export class ScheduleDateDialogComponent {
  readonly data = inject<ScheduleDateDialogData>(MAT_DIALOG_DATA);
  private ref = inject(MatDialogRef<ScheduleDateDialogComponent, string>);

  readonly hours = Array.from({ length: 12 }, (_, i) => i + 1);
  minutes = Array.from({ length: 12 }, (_, i) => i * 5);
  // Calendar dates are local midnight Dates; only their year/month/day are used, as Philippine dates.
  readonly minDate: Date;
  date: Date;
  hour = 9;
  minute = 0;
  period: 'AM' | 'PM' = 'AM';

  constructor() {
    const today = new Date(Date.now() + PH_OFFSET_MS).toISOString().slice(0, 10);
    this.minDate = this.calendarDate(today);
    // New dates default to the next full hour.
    const start = this.data.value || new Date(Math.ceil(Date.now() / 3600000) * 3600000 + PH_OFFSET_MS).toISOString().slice(0, 16);
    this.date = this.calendarDate(start.slice(0, 10));
    const h24 = Number(start.slice(11, 13));
    this.minute = Number(start.slice(14, 16));
    this.hour = h24 % 12 || 12;
    this.period = h24 < 12 ? 'AM' : 'PM';
    if (!this.minutes.includes(this.minute)) this.minutes = [...this.minutes, this.minute].sort((a, b) => a - b);
  }

  get value(): string {
    const h24 = (this.hour % 12) + (this.period === 'PM' ? 12 : 0);
    return `${this.date.getFullYear()}-${this.pad(this.date.getMonth() + 1)}-${this.pad(this.date.getDate())}T${this.pad(h24)}:${this.pad(this.minute)}`;
  }

  get label(): string {
    return formatScheduleLabel(this.value, true);
  }

  get error(): string {
    return this.data.validate(this.value);
  }

  pad(n: number): string {
    return String(n).padStart(2, '0');
  }

  save(): void {
    if (!this.error) this.ref.close(this.value);
  }

  private calendarDate(ymd: string): Date {
    const [y, m, d] = ymd.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
}

/** "Fri, Oct 30, 2026 · 9:00 AM" for a Philippine 'YYYY-MM-DDTHH:mm' value ('' stays ''). */
export function formatScheduleLabel(value: string, longDay = false): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return '';
  const [y, mo, d, h, mi] = match.slice(1).map(Number);
  const utc = new Date(Date.UTC(y, mo - 1, d, h, mi));
  const day = utc.toLocaleDateString('en-US', { timeZone: 'UTC', weekday: longDay ? 'long' : 'short',
    month: longDay ? 'long' : 'short', day: 'numeric', year: 'numeric' });
  const time = utc.toLocaleTimeString('en-US', { timeZone: 'UTC', hour: 'numeric', minute: '2-digit' });
  return `${day} · ${time}`;
}

export function openScheduleDateDialog(dialog: MatDialog, data: ScheduleDateDialogData): Observable<string | undefined> {
  return dialog.open<ScheduleDateDialogComponent, ScheduleDateDialogData, string>(ScheduleDateDialogComponent, {
    data,
    width: '380px',
    maxWidth: '95vw',
    autoFocus: false,
  }).afterClosed();
}
