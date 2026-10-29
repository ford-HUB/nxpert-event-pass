import { Component, OnInit, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../core/api.service';
import { AttendeeDto } from '../core/models';
import { ToastService } from '../core/toast.service';
import { downloadPass, fileSlug, passQrDataUrl } from '../core/qr.util';

interface AttendeePassData {
  eventId: number;
  eventTitle: string;
  attendee: AttendeeDto;
  autoPrint?: boolean; // open the browser print dialog as soon as the QR has rendered
}

@Component({
  selector: 'app-attendee-pass-dialog',
  imports: [MatDialogModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule],
  template: `
    <h2 mat-dialog-title>QR pass</h2>
    <mat-dialog-content class="pass-content">
      <h3>{{ data.attendee.fullName }}</h3>
      <p>{{ data.eventTitle }}</p>
      @if (data.attendee.sessionTitle) {
        <p class="muted">{{ data.attendee.sessionTitle }}</p>
      }
      <div class="qr-wrap">
        @if (qrDataUrl()) {
          <img [src]="qrDataUrl()" [alt]="'QR pass for ' + data.attendee.fullName"
               width="260" height="260" (load)="onQrRendered()" />
        } @else if (qrError()) {
          <div role="alert">
            <p>{{ qrError() }}</p>
            <button mat-button (click)="loadQr()">Try again</button>
          </div>
        } @else {
          <mat-spinner diameter="36" aria-label="Loading QR pass" />
        }
      </div>
      <p class="muted pass-hint">Present this code at the door for check-in.</p>
      <p class="email no-print">{{ registeredEmail() || 'No registered email address.' }}</p>
      @if (!confirmedAt()) {
        <p class="muted no-print">Confirm this registration in Attendance before emailing the pass.</p>
      }
      @if (emailStatus()) {
        <p role="status" class="no-print">{{ emailStatus() }}</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Close</button>
      <button mat-stroked-button (click)="print()" [disabled]="!qrDataUrl()">
        <mat-icon>print</mat-icon> Print
      </button>
      <button mat-stroked-button (click)="resend()"
              [disabled]="sending() || !registeredEmail() || !confirmedAt()">
        <mat-icon>email</mat-icon> {{ sending() ? 'Sending…' : 'Resend email' }}
      </button>
      <button mat-flat-button (click)="download()" [disabled]="!qrDataUrl() || downloading()">
        <mat-icon>download</mat-icon> {{ downloading() ? 'Downloading…' : 'Download PNG' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    h3 { margin: 0 0 8px; }
    p { margin: 8px 0; }
    .qr-wrap { min-height: 260px; display: flex; align-items: center; justify-content: center; }
    .qr-wrap img { max-width: 100%; height: auto; }
    .email { overflow-wrap: anywhere; }
    mat-dialog-actions { gap: 8px; flex-wrap: wrap; }
  `],
})
export class AttendeePassDialogComponent implements OnInit {
  readonly data = inject<AttendeePassData>(MAT_DIALOG_DATA);
  private api = inject(ApiService);
  private toast = inject(ToastService);
  registeredEmail = signal(this.data.attendee.email?.includes('@') ? this.data.attendee.email : '');
  confirmedAt = signal(this.data.attendee.confirmedAt);
  private token = this.data.attendee.token;
  qrDataUrl = signal<string | null>(null);
  qrError = signal('');
  sending = signal(false);
  downloading = signal(false);
  emailStatus = signal('');

  ngOnInit(): void {
    void this.loadQr();
  }

  async loadQr(): Promise<void> {
    this.qrError.set('');
    try {
      // Older attendance responses omit the token. Resolve by registration ID,
      // never by name/email, so two attendees cannot receive each other's pass.
      if (!this.token) {
        const pass = await firstValueFrom(
          this.api.getAttendeePass(this.data.eventId, this.data.attendee.registrationId),
        );
        this.token = pass.token;
        this.registeredEmail.set(pass.email ?? '');
        this.confirmedAt.set(pass.confirmedAt);
      }
      if (!this.token) throw new Error('Missing registration pass token.');
      this.qrDataUrl.set(await passQrDataUrl(this.token));
    } catch (error) {
      const status = (error as { status?: number })?.status;
      this.qrError.set(status === 404
        ? 'Pass unavailable. The attendee may have been removed, or the API needs the QR pass update. Refresh Attendance after updating the backend.'
        : 'Could not load the QR pass. Please try again.');
    }
  }

  private autoPrinted = false;

  onQrRendered(): void {
    if (this.data.autoPrint && !this.autoPrinted) {
      this.autoPrinted = true;
      this.print();
    }
  }

  // Prints just this pass: the global print styles hide everything but the pass dialog while
  // body.printing-pass is set.
  print(): void {
    if (!this.qrDataUrl()) return;
    document.body.classList.add('printing-pass');
    window.addEventListener('afterprint', () => document.body.classList.remove('printing-pass'), { once: true });
    window.print();
  }

  async download(): Promise<void> {
    if (!this.token || !this.qrDataUrl() || this.downloading()) return;
    this.downloading.set(true);
    try {
      const fileBase = [fileSlug(this.data.eventTitle), fileSlug(this.data.attendee.fullName),
        this.data.attendee.registrationId].join('-');
      await downloadPass(this.token, fileBase);
    } catch {
      this.toast.error('Could not download the QR pass. Please try again.');
    } finally {
      this.downloading.set(false);
    }
  }

  async resend(): Promise<void> {
    if (this.sending() || !this.registeredEmail() || !this.confirmedAt()) return;
    this.sending.set(true);
    this.emailStatus.set('');
    try {
      const result = await firstValueFrom(
        this.api.resendAttendeePass(this.data.eventId, this.data.attendee.registrationId),
      );
      this.emailStatus.set(result.message);
      this.toast.success(result.message);
    } catch {
      this.emailStatus.set('Could not send the pass. Please try again.');
      this.toast.error(this.emailStatus());
    } finally {
      this.sending.set(false);
    }
  }
}
