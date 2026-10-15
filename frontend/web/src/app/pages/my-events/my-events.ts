import { Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { ToastService } from '../../core/toast.service';
import { ConfirmService } from '../../core/confirm.service';
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
  private confirmer = inject(ConfirmService);

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

  async cancel(reg: RegistrationDto): Promise<void> {
    const ok = await this.confirmer.confirm({
      title: 'Cancel registration?',
      message: `Your registration for "${reg.eventTitle}" will be cancelled and your pass will no longer work.`,
      confirmText: 'Cancel registration',
      cancelText: 'Keep it',
      tone: 'error',
      icon: 'event_busy',
    });
    if (!ok) return;
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
