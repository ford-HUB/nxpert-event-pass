import { Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { ToastService } from '../../core/toast.service';
import { ApiService } from '../../core/api.service';
import { RegistrationDto } from '../../core/models';
import { PassDialogComponent } from './pass-dialog';
import { FeedbackDialogComponent } from './feedback-dialog';
import { ResponsesDialogComponent } from './responses-dialog';
import { openImageLightbox } from '../../shared/image-lightbox';

@Component({
  selector: 'app-my-events',
  imports: [
    DatePipe,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatMenuModule,
    MatTooltipModule,
    MatDialogModule,
  ],
  templateUrl: './my-events.html',
})
export class MyEventsComponent implements OnInit {
  private api = inject(ApiService);
  private dialog = inject(MatDialog);
  private toast = inject(ToastService);

  viewImage(src: string | null | undefined): void {
    openImageLightbox(this.dialog, src);
  }

  loading = signal(true);
  regs = signal<RegistrationDto[]>([]);

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.api.myRegistrations().subscribe({
      next: (r) => {
        this.regs.set(r);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  showPass(reg: RegistrationDto): void {
    this.dialog.open(PassDialogComponent, { data: reg, width: '360px' });
  }

  resend(reg: RegistrationDto): void {
    this.api.resendPass(reg.id).subscribe({
      next: () => this.toast.success('Pass email re-sent.'),
      error: () => this.toast.error('Could not re-send pass.'),
    });
  }

  editResponses(reg: RegistrationDto): void {
    this.dialog.open(ResponsesDialogComponent, {
      data: { registrationId: reg.id, eventTitle: reg.eventTitle },
      width: '520px',
      maxWidth: '94vw',
    });
  }

  leaveFeedback(reg: RegistrationDto): void {
    this.dialog.open(FeedbackDialogComponent, {
      data: { eventId: reg.eventId, eventTitle: reg.eventTitle },
      width: '400px',
    });
  }

  cancel(reg: RegistrationDto): void {
    if (!confirm(`Cancel your registration for "${reg.eventTitle}"?`)) return;
    this.api.cancelRegistration(reg.id).subscribe({
      next: () => {
        this.toast.success('Registration cancelled.');
        this.load();
      },
      error: () => this.toast.error('Could not cancel registration.'),
    });
  }

  hasStarted(reg: RegistrationDto): boolean {
    return new Date(reg.startsAt).getTime() <= Date.now();
  }
}
