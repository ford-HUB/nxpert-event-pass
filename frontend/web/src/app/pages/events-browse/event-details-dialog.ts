import { Component, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { EventDto } from '../../core/models';
import { openImageLightbox } from '../../shared/image-lightbox';

export interface EventDetailsData {
  event: EventDto;
  registered: boolean;
  // True when re-registration is a full duplicate (single event already registered).
  blocked: boolean;
}

@Component({
  selector: 'app-event-details-dialog',
  imports: [DatePipe, MatDialogModule, MatButtonModule, MatIconModule],
  templateUrl: './event-details-dialog.html',
  styleUrl: './event-details-dialog.scss',
})
export class EventDetailsDialogComponent {
  private data = inject<EventDetailsData>(MAT_DIALOG_DATA);
  readonly e = this.data.event;
  readonly registered = this.data.registered;
  readonly blocked = this.data.blocked;
  private ref = inject(MatDialogRef<EventDetailsDialogComponent>);
  private router = inject(Router);
  private dialog = inject(MatDialog);

  viewImage(src: string | null | undefined): void {
    openImageLightbox(this.dialog, src);
  }

  isPast(): boolean {
    return new Date(this.e.endsAt).getTime() < Date.now();
  }

  close(): void {
    this.ref.close();
  }

  register(): void {
    this.ref.close();
    this.router.navigate(['/e', this.e.publicSlug]);
  }

  goMyEvents(): void {
    this.ref.close();
    this.router.navigate(['/my-events']);
  }
}
