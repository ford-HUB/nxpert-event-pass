import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { ApiService } from '../../core/api.service';
import { EventDto } from '../../core/models';
import { EventDetailsDialogComponent } from './event-details-dialog';
import { openImageLightbox } from '../../shared/image-lightbox';

@Component({
  selector: 'app-events-browse',
  imports: [
    DatePipe,
    FormsModule,
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatDialogModule,
  ],
  templateUrl: './events-browse.html',
  styleUrl: './events-browse.scss',
})
export class EventsBrowseComponent implements OnInit {
  private api = inject(ApiService);
  private dialog = inject(MatDialog);

  openDetails(e: EventDto): void {
    this.dialog.open(EventDetailsDialogComponent, {
      data: { event: e, registered: this.isRegistered(e), blocked: this.registrationBlocked(e) },
      width: '640px',
      maxWidth: '94vw',
    });
  }

  viewImage(src: string | null | undefined): void {
    openImageLightbox(this.dialog, src);
  }

  loading = signal(true);
  events = signal<EventDto[]>([]);
  search = signal('');
  // Event IDs the signed-in user already has a registration for.
  registeredEventIds = signal<Set<number>>(new Set());

  filtered = computed(() => {
    const q = this.search().trim().toLowerCase();
    const list = this.events();
    if (!q) return list;
    return list.filter(
      (e) =>
        e.title.toLowerCase().includes(q) ||
        e.venue.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q),
    );
  });

  ngOnInit(): void {
    this.api.browseEvents().subscribe({
      next: (e) => {
        this.events.set(e);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
    // Which events the user is already registered for (to badge + block re-registration).
    this.api.myRegistrations().subscribe({
      next: (regs) => this.registeredEventIds.set(new Set(regs.map((r) => r.eventId))),
      error: () => {},
    });
  }

  isPast(e: EventDto): boolean {
    return new Date(e.endsAt).getTime() < Date.now();
  }

  isRegistered(e: EventDto): boolean {
    return this.registeredEventIds().has(e.id);
  }

  // A multi-session event can still add more sub-events; only single events are a full duplicate.
  registrationBlocked(e: EventDto): boolean {
    return this.isRegistered(e) && e.sessions.length === 0;
  }
}
