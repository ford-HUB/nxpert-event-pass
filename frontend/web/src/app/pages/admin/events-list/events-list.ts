import { Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ToastService } from '../../../core/toast.service';
import { ApiService } from '../../../core/api.service';
import { AuthService } from '../../../core/auth.service';
import { EventDto } from '../../../core/models';

@Component({
  selector: 'app-events-list',
  imports: [
    DatePipe,
    RouterLink,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './events-list.html',
})
export class EventsListComponent implements OnInit {
  private api = inject(ApiService);
  protected auth = inject(AuthService);
  private router = inject(Router);
  private toast = inject(ToastService);
  loading = signal(true);
  events = signal<EventDto[]>([]);

  ngOnInit(): void {
    this.api.listEvents().subscribe({
      next: (e) => {
        this.events.set(e);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  // Launch the check-in scanner for an event — but only within the event's date window.
  startScanning(e: EventDto, ev: Event): void {
    ev.stopPropagation();
    ev.preventDefault();

    const dayOf = (d: string) => {
      const x = new Date(d);
      x.setHours(0, 0, 0, 0);
      return x.getTime();
    };
    const today = dayOf(new Date().toISOString());
    const start = dayOf(e.startsAt);
    const end = dayOf(e.endsAt);

    if (today < start) {
      const when = new Date(e.startsAt).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
      this.toast.warning(`This event starts ${when}. Check-in isn't open yet.`);
      return;
    }
    if (today > end) {
      const when = new Date(e.endsAt).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
      this.toast.warning(`This event ended ${when}. Check-in is closed.`);
      return;
    }
    this.router.navigate(['/scanner', e.id]);
  }
}
