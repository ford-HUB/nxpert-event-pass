import { Component, ElementRef, OnDestroy, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Subscription } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { CalendarEvent, addDays, calendarDays, dateKey, dayEvents, wallDate, weekBlocks } from '../../core/calendar.util';

const REFRESH_MS = 30_000;
const MONTH_PREVIEW = 3;

/**
 * Month / week calendar of events, in Philippine time. Events appear as soon as they're created;
 * admins and confirmers see every event, others see public, registered and invited ones.
 */
@Component({
  selector: 'app-calendar',
  imports: [
    DatePipe,
    FormsModule,
    RouterLink,
    MatButtonModule,
    MatButtonToggleModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
  ],
  templateUrl: './calendar.html',
  styleUrl: './calendar.scss',
})
export class CalendarComponent implements OnInit, OnDestroy {
  protected auth = inject(AuthService);
  private api = inject(ApiService);
  @ViewChild('weekScroll') weekScroll?: ElementRef<HTMLDivElement>;

  private request?: Subscription;
  private refreshTimer?: ReturnType<typeof setInterval>;
  private initialWeekScroll?: ReturnType<typeof setTimeout>;

  readonly view = signal<'month' | 'week'>('month');
  readonly anchor = signal(this.today());
  readonly selected = signal(this.today());
  readonly events = signal<CalendarEvent[]>([]);
  readonly loading = signal(false);
  readonly error = signal(false);
  readonly days = computed(() => calendarDays(this.anchor(), this.view()));
  readonly selectedEvents = computed(() => dayEvents(this.events(), this.selected()));
  readonly monthPreview = MONTH_PREVIEW;
  readonly weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  readonly hours = Array.from({ length: 24 }, (_, i) => i);
  readonly dayEvents = dayEvents;
  readonly weekBlocks = weekBlocks;
  readonly key = dateKey;
  readonly date = wallDate;

  // Today in Manila, as a UTC surrogate date (see calendar.util).
  today(): Date {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Manila',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    const part = (type: string) => Number(parts.find((p) => p.type === type)!.value);
    return new Date(Date.UTC(part('year'), part('month') - 1, part('day')));
  }

  ngOnInit(): void {
    this.load();
    this.refreshTimer = setInterval(() => {
      if (!document.hidden && !this.loading()) this.load(false);
    }, REFRESH_MS);
  }

  ngOnDestroy(): void {
    this.request?.unsubscribe();
    clearInterval(this.refreshTimer);
    clearTimeout(this.initialWeekScroll);
  }

  move(delta: number): void {
    const a = this.anchor();
    this.anchor.set(
      this.view() === 'week'
        ? addDays(a, delta * 7)
        : new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth() + delta, 1)),
    );
    this.selected.set(this.anchor());
    this.load();
  }

  goToday(): void {
    this.anchor.set(this.today());
    this.selected.set(this.today());
    this.load();
  }

  setView(view: 'month' | 'week'): void {
    this.view.set(view);
    this.load();
    // Start the week view at 8 AM rather than midnight.
    if (view === 'week')
      this.initialWeekScroll = setTimeout(() => this.weekScroll?.nativeElement.scrollTo({ top: 8 * 60 }), 0);
  }

  jump(value: string): void {
    if (!/^\d{4}-\d{2}$/.test(value)) return;
    this.anchor.set(wallDate(value + '-01'));
    this.selected.set(this.anchor());
    this.load();
  }

  load(showLoading = true): void {
    this.request?.unsubscribe();
    if (showLoading) this.loading.set(true);
    this.error.set(false);
    const days = this.days();
    this.request = this.api.calendar(dateKey(days[0]), dateKey(addDays(days.at(-1)!, 1))).subscribe({
      next: (result) => {
        this.events.set(result.events);
        this.loading.set(false);
      },
      error: () => {
        this.error.set(true);
        this.loading.set(false);
      },
    });
  }

  eventLink(event: CalendarEvent): string[] {
    return event.canManage ? ['/admin/events', String(event.id)] : ['/e', event.publicSlug];
  }

  hourLabel(hour: number): string {
    if (hour === 0) return '12 AM';
    if (hour < 12) return `${hour} AM`;
    return hour === 12 ? '12 PM' : `${hour - 12} PM`;
  }

  tagFor(event: CalendarEvent): { label: string; tone: string } {
    if (event.isRegistered) return { label: 'Registered', tone: 'ok' };
    if (event.isInvited) return { label: 'Invited', tone: 'brand' };
    if (event.status === 'Draft') return { label: 'Draft', tone: 'pending' };
    if (event.status === 'Closed') return { label: 'Closed', tone: 'closed' };
    return { label: event.status, tone: '' };
  }
}
