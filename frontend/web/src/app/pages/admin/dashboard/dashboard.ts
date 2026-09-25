import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { ApiService } from '../../../core/api.service';
import { ChapterCount, DashboardSummary, EventChapterBreakdown, EventDto } from '../../../core/models';

@Component({
  selector: 'app-dashboard',
  imports: [
    DatePipe,
    FormsModule,
    RouterLink,
    MatCardModule,
    MatIconModule,
    MatButtonModule,
    MatFormFieldModule,
    MatSelectModule,
    MatProgressSpinnerModule,
    MatProgressBarModule,
  ],
  templateUrl: './dashboard.html',
  styles: [
    `
      .event-picker { min-width: 240px; max-width: 360px; }
      .select-search {
        position: sticky;
        top: 0;
        z-index: 1;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        background: var(--mat-sys-surface-container);
        border-bottom: 1px solid var(--mat-sys-outline-variant);
      }
      .select-search mat-icon {
        color: var(--mat-sys-on-surface-variant);
        font-size: 20px;
        width: 20px;
        height: 20px;
      }
      .select-search input {
        flex: 1;
        border: 0;
        outline: 0;
        background: transparent;
        color: inherit;
        font: inherit;
      }
      .select-empty {
        padding: 10px 16px;
        color: var(--mat-sys-on-surface-variant);
        font-size: 13px;
      }
      .chapter-card mat-card-content { padding-top: 4px; }
      .kit-card { margin-top: 16px; }
      .collapse-head {
        display: flex;
        align-items: center;
        gap: 8px;
        cursor: pointer;
        user-select: none;
      }
      .collapse-head .collapse-titles { flex: 1; min-width: 0; }
      .collapse-head .collapse-toggle { flex: none; }
      .chapter-row { margin: 10px 0; }
      .chapter-row.zero { opacity: 0.55; }
      .chapter-line {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        font-size: 13px;
        margin-bottom: 3px;
      }
      .chapter-name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .chapter-pct { color: var(--mat-sys-on-surface-variant); white-space: nowrap; }
      .chapter-track {
        height: 8px;
        border-radius: 999px;
        background: var(--mat-sys-surface-container-high);
        overflow: hidden;
      }
      .chapter-fill { height: 100%; border-radius: 999px; min-width: 2px; transition: width 0.3s ease; }
    `,
  ],
})
export class DashboardComponent implements OnInit {
  private api = inject(ApiService);
  loading = signal(true);
  summary = signal<DashboardSummary | null>(null);

  // Chapter breakdown for a single, user-selected event.
  events = signal<EventDto[]>([]);
  selectedEventId = signal<number | null>(null);
  breakdown = signal<EventChapterBreakdown | null>(null);
  breakdownLoading = signal(false);

  // Inline search for the event dropdown. The selected event is always kept in the list so the
  // trigger label stays populated even when it doesn't match the current query.
  eventSearch = signal('');
  filteredEvents = computed(() => {
    const q = this.eventSearch().trim().toLowerCase();
    const list = this.events();
    if (!q) return list;
    const sel = this.selectedEventId();
    return list.filter((e) => e.title.toLowerCase().includes(q) || e.id === sel);
  });

  ngOnInit(): void {
    this.api.dashboard().subscribe({
      next: (s) => {
        this.summary.set(s);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
    // Events for the chapter-breakdown selector (default to the most recent one).
    this.api.listEvents().subscribe({
      next: (evts) => {
        this.events.set(evts);
        if (evts.length > 0) {
          this.selectedEventId.set(evts[0].id);
          this.loadBreakdown(evts[0].id);
        }
      },
      error: () => {},
    });
  }

  onEventChange(id: number): void {
    this.selectedEventId.set(id);
    this.loadBreakdown(id);
  }

  // Clear the search box when the dropdown panel closes.
  onPanelToggle(open: boolean): void {
    if (!open) this.eventSearch.set('');
  }

  private loadBreakdown(id: number): void {
    this.breakdownLoading.set(true);
    this.api.chapterBreakdown(id).subscribe({
      next: (b) => {
        this.breakdown.set(b);
        this.breakdownLoading.set(false);
      },
      error: () => {
        this.breakdown.set(null);
        this.breakdownLoading.set(false);
      },
    });
  }

  // Whether each chapter chart card is expanded (collapsible headers).
  regChartOpen = signal(true);
  kitChartOpen = signal(true);

  // Bar length as a % of the widest chapter, so the chart scales to the largest count.
  barWidth(count: number): number {
    const max = Math.max(0, ...(this.breakdown()?.chapters ?? []).map((c) => c.count));
    return max === 0 ? 0 : Math.round((100 * count) / max);
  }

  // Bar length for the kit-claimed chart, scaled to the chapter with the most kits claimed.
  barWidthClaimed(count: number): number {
    const max = Math.max(0, ...(this.breakdown()?.chapters ?? []).map((c) => c.kitClaimed));
    return max === 0 ? 0 : Math.round((100 * count) / max);
  }

  // Chapters ordered by kit claims (desc) for the kit-claimed chart.
  claimedChapters(): ChapterCount[] {
    return [...(this.breakdown()?.chapters ?? [])].sort(
      (a, b) => b.kitClaimed - a.kitClaimed || a.chapter.localeCompare(b.chapter),
    );
  }

  // A stable color for a chapter's bar (hashes the name into a hue).
  chapterColor(chapter: string): string {
    let h = 0;
    for (let i = 0; i < chapter.length; i++) h = (h * 31 + chapter.charCodeAt(i)) % 360;
    return `hsl(${h}, 55%, 55%)`;
  }

  pct(e: { registeredCount: number; checkedInCount: number }): number {
    return e.registeredCount === 0 ? 0 : Math.round((100 * e.checkedInCount) / e.registeredCount);
  }
}
