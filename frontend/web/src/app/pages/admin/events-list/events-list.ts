import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ToastService } from '../../../core/toast.service';
import { ApiService } from '../../../core/api.service';
import { AuthService } from '../../../core/auth.service';
import { EventDto } from '../../../core/models';

type Phase = 'live' | 'upcoming' | 'past';
type EventFilter = 'all' | Phase | 'draft' | 'closed';
type EventSort = 'relevance' | 'newest' | 'oldest' | 'title' | 'registrations';
type EventView = 'grid' | 'list';

const VIEW_KEY = 'nxpass.events.view';
const PAGE_SIZE_KEY = 'nxpass.events.pageSize';

// Per-viewer conveniences only; storage can be blocked (private mode), so fall back quietly.
function readPref(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writePref(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* ignore */ }
}

@Component({
  selector: 'app-events-list',
  imports: [
    DatePipe,
    NgTemplateOutlet,
    FormsModule,
    RouterLink,
    MatButtonModule,
    MatButtonToggleModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatPaginatorModule,
    MatSelectModule,
    MatTooltipModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './events-list.html',
  styleUrl: './events-list.scss',
})
export class EventsListComponent implements OnInit {
  private api = inject(ApiService);
  protected auth = inject(AuthService);
  private router = inject(Router);
  private toast = inject(ToastService);
  loading = signal(true);
  events = signal<EventDto[]>([]);

  // ---- Search / filter / sort / view / paging ----
  search = signal('');
  filter = signal<EventFilter>('all');
  sort = signal<EventSort>('relevance');
  view = signal<EventView>(readPref(VIEW_KEY) === 'list' ? 'list' : 'grid');
  pageIndex = signal(0);
  pageSize = signal(Number(readPref(PAGE_SIZE_KEY)) || 12);
  readonly pageSizeOptions = [12, 24, 48, 96];

  readonly filterTabs: { id: EventFilter; label: string; icon: string }[] = [
    { id: 'all', label: 'All', icon: 'apps' },
    { id: 'live', label: 'Live now', icon: 'sensors' },
    { id: 'upcoming', label: 'Upcoming', icon: 'upcoming' },
    { id: 'past', label: 'Past', icon: 'history' },
    { id: 'draft', label: 'Drafts', icon: 'edit_note' },
    { id: 'closed', label: 'Closed', icon: 'lock' },
  ];

  counts = computed(() => {
    const c: Record<EventFilter, number> = { all: 0, live: 0, upcoming: 0, past: 0, draft: 0, closed: 0 };
    for (const e of this.events()) {
      c.all++;
      c[this.phase(e)]++;
      if (e.status === 'Draft') c.draft++;
      if (e.status === 'Closed') c.closed++;
    }
    return c;
  });

  filtered = computed(() => {
    const q = this.search().trim().toLowerCase();
    const f = this.filter();
    const rows = this.events().filter((e) => {
      if (f === 'draft' && e.status !== 'Draft') return false;
      if (f === 'closed' && e.status !== 'Closed') return false;
      if ((f === 'live' || f === 'upcoming' || f === 'past') && this.phase(e) !== f) return false;
      return !q || e.title.toLowerCase().includes(q) || (e.venue ?? '').toLowerCase().includes(q);
    });
    const time = (d: string) => new Date(d).getTime();
    const rank: Record<Phase, number> = { live: 0, upcoming: 1, past: 2 };
    switch (this.sort()) {
      case 'newest': return rows.sort((a, b) => time(b.startsAt) - time(a.startsAt));
      case 'oldest': return rows.sort((a, b) => time(a.startsAt) - time(b.startsAt));
      case 'title': return rows.sort((a, b) => a.title.localeCompare(b.title));
      case 'registrations': return rows.sort((a, b) => b.registeredCount - a.registeredCount);
      default:
        // Live first, then upcoming (soonest first), then past (most recent first).
        return rows.sort((a, b) => {
          const pa = this.phase(a), pb = this.phase(b);
          if (pa !== pb) return rank[pa] - rank[pb];
          return pa === 'past' ? time(b.startsAt) - time(a.startsAt) : time(a.startsAt) - time(b.startsAt);
        });
    }
  });

  paged = computed(() => {
    const start = this.pageIndex() * this.pageSize();
    return this.filtered().slice(start, start + this.pageSize());
  });

  ngOnInit(): void {
    this.api.listEvents().subscribe({
      next: (e) => {
        this.events.set(e);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  phase(e: EventDto): Phase {
    const now = Date.now();
    if (new Date(e.endsAt).getTime() < now) return 'past';
    if (new Date(e.startsAt).getTime() > now) return 'upcoming';
    return 'live';
  }

  setFilter(f: EventFilter): void {
    this.filter.set(f);
    this.pageIndex.set(0);
  }

  onSearch(q: string): void {
    this.search.set(q);
    this.pageIndex.set(0);
  }

  onSort(s: EventSort): void {
    this.sort.set(s);
    this.pageIndex.set(0);
  }

  setView(v: EventView): void {
    this.view.set(v);
    writePref(VIEW_KEY, v);
  }

  onPage(e: PageEvent): void {
    this.pageIndex.set(e.pageIndex);
    if (e.pageSize !== this.pageSize()) {
      this.pageSize.set(e.pageSize);
      writePref(PAGE_SIZE_KEY, String(e.pageSize));
    }
  }

  clearFilters(): void {
    this.search.set('');
    this.filter.set('all');
    this.pageIndex.set(0);
  }

  // Keyboard open for the card (Enter on the card itself, not on its inner button).
  open(e: EventDto, ev: Event): void {
    if (ev.target === ev.currentTarget) this.router.navigate(['/admin/events', e.id]);
  }

  // Progress-bar width (0–100) for a count against its total.
  fill(count: number, total: number): number {
    return total > 0 ? Math.min(100, Math.round((count / total) * 100)) : 0;
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
