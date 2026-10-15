import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatTableModule } from '@angular/material/table';
import { MatSortModule, Sort } from '@angular/material/sort';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialog } from '@angular/material/dialog';
import { ApiService } from '../../../core/api.service';
import { AuthService } from '../../../core/auth.service';
import { ToastService } from '../../../core/toast.service';
import { ConfirmService } from '../../../core/confirm.service';
import { AttendeeDto, ContactDto, EventDto, EventFeedbackSummary, MealBoardDto, MealBoardRow, MealStubDetailDto } from '../../../core/models';
import { ImageViewerDialogComponent } from '../../../shared/image-viewer/image-viewer-dialog';
import { KitClaimDialogComponent, KitClaimResult } from '../../../shared/kit-claim-dialog';
import { ViberBroadcastDialogComponent } from '../../../shared/viber-broadcast-dialog';

@Component({
  selector: 'app-event-detail',
  imports: [
    DatePipe,
    DecimalPipe,
    FormsModule,
    RouterLink,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatTabsModule,
    MatButtonToggleModule,
    MatTableModule,
    MatSortModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatChipsModule,
    MatTooltipModule,
    MatPaginatorModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './event-detail.html',
})
export class EventDetailComponent implements OnInit {
  private api = inject(ApiService);
  protected auth = inject(AuthService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private toast = inject(ToastService);
  private confirmer = inject(ConfirmService);
  private dialog = inject(MatDialog);

  // Open an uploaded image-field answer in a full-size viewer dialog.
  viewImage(src: string, fieldLabel: string, attendeeName: string): void {
    this.dialog.open(ImageViewerDialogComponent, {
      data: { src, title: fieldLabel, caption: attendeeName },
      maxWidth: '92vw',
      width: '640px',
      autoFocus: false,
    });
  }

  id = 0;
  loading = signal(true);
  event = signal<EventDto | null>(null);
  contacts = signal<ContactDto[]>([]);
  attendees = signal<AttendeeDto[]>([]);
  feedback = signal<EventFeedbackSummary | null>(null);
  selected = signal<Set<number>>(new Set());
  extraEmails = '';
  sending = signal(false);

  // Attendance: bulk-confirm / manual check-in selection (independent of the invite picker's `selected`).
  selectedAttendees = signal<Set<number>>(new Set());
  confirming = signal(false);
  checkingIn = signal(false);
  cancelling = signal(false);

  // Kit claiming: its own selection + filters, independent of the attendance tab.
  selectedKits = signal<Set<number>>(new Set());
  kitSearch = signal('');
  kitClaimFilter = signal<'all' | 'claimed' | 'unclaimed'>('all');
  kitOrgFilter = signal<string>('all');
  kitSort = signal<{ active: string; direction: 'asc' | 'desc' | '' }>({ active: '', direction: '' });
  kitClaiming = signal(false);

  // Meal-stub redemption: its own selection + filters.
  selectedMeals = signal<Set<number>>(new Set());
  mealSearch = signal('');
  mealRedeemFilter = signal<'all' | 'redeemed' | 'unredeemed'>('all');
  mealSort = signal<{ active: string; direction: 'asc' | 'desc' | '' }>({ active: '', direction: '' });
  mealRedeeming = signal(false);

  // Contact picker: search + pagination
  contactSearch = signal('');
  pageIndex = signal(0);
  pageSize = signal(5);

  filteredContacts = computed(() => {
    const q = this.contactSearch().trim().toLowerCase();
    const list = this.contacts();
    if (!q) return list;
    return list.filter(
      (c) =>
        c.fullName.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        (c.organization ?? '').toLowerCase().includes(q),
    );
  });

  pagedContacts = computed(() => {
    const start = this.pageIndex() * this.pageSize();
    return this.filteredContacts().slice(start, start + this.pageSize());
  });

  selectedCount = computed(() => this.selected().size);

  // Filters for the attendance list: sub-event, status, organization, and free-text search.
  sessionFilter = signal<number | 'all'>('all');
  statusFilter = signal<'all' | 'pending' | 'confirmed' | 'checkedin'>('all');
  orgFilter = signal<string>('all');
  attendeeSearch = signal('');
  // Active column sort for the attendance grid ('' direction = no sort / original order).
  sort = signal<{ active: string; direction: 'asc' | 'desc' | '' }>({ active: '', direction: '' });
  eventSessions = computed(() => this.event()?.sessions ?? []);
  hasSessions = computed(() => this.eventSessions().length > 0);

  // Distinct organizations present in the roster (for the Organization column filter).
  orgOptions = computed(() => {
    const set = new Set<string>();
    for (const a of this.attendees()) {
      const o = (a.organization ?? '').trim();
      if (o) set.add(o);
    }
    return [...set].sort((x, y) => x.localeCompare(y));
  });

  displayedAttendees = computed(() => {
    const f = this.sessionFilter();
    const st = this.statusFilter();
    const org = this.orgFilter();
    const q = this.attendeeSearch().trim().toLowerCase();
    let list = this.attendees();
    if (f !== 'all') list = list.filter((a) => a.sessionId === f);
    if (st !== 'all') list = list.filter((a) => this.attendeeStatus(a) === st);
    if (org !== 'all') list = list.filter((a) => (a.organization ?? '') === org);
    if (q) {
      list = list.filter((a) => {
        const responses = a.responses ? Object.values(a.responses).join(' ') : '';
        return [a.fullName, a.email, a.organization ?? '', a.sessionTitle ?? '', responses]
          .join(' ')
          .toLowerCase()
          .includes(q);
      });
    }
    // Column sort (applied last so it orders the filtered result).
    const { active, direction } = this.sort();
    if (active && direction) {
      const dir = direction === 'asc' ? 1 : -1;
      list = [...list].sort((a, b) => dir * this.compareAttendees(a, b, active));
    }
    return list;
  });

  onSort(s: Sort): void {
    this.sort.set({ active: s.active, direction: s.direction });
  }

  private compareAttendees(a: AttendeeDto, b: AttendeeDto, col: string): number {
    switch (col) {
      case 'name':
        return a.fullName.localeCompare(b.fullName);
      case 'email':
        return a.email.localeCompare(b.email);
      case 'organization':
        return (a.organization ?? '').localeCompare(b.organization ?? '');
      case 'senate':
        return (a.senateNo ?? '').localeCompare(b.senateNo ?? '', undefined, { numeric: true });
      case 'phone':
        return (a.phone ?? '').localeCompare(b.phone ?? '');
      case 'session':
        return (a.sessionTitle ?? '').localeCompare(b.sessionTitle ?? '');
      case 'registered':
        return new Date(a.registeredAt).getTime() - new Date(b.registeredAt).getTime();
      case 'status': {
        const rank = (x: AttendeeDto) => {
          const s = this.attendeeStatus(x);
          return s === 'pending' ? 0 : s === 'confirmed' ? 1 : 2;
        };
        return rank(a) - rank(b);
      }
      default:
        return 0;
    }
  }

  // Registrations awaiting confirmation (not yet confirmed and not checked in), within the filter.
  pendingAttendees = computed(() =>
    this.displayedAttendees().filter((a) => !a.confirmedAt && !a.checkedInAt),
  );
  pendingCount = computed(() => this.pendingAttendees().length);
  // Rows eligible for selection (anything not yet checked in — can be confirmed and/or checked in).
  selectableAttendees = computed(() => this.displayedAttendees().filter((a) => !a.checkedInAt));
  selectedAttendeeCount = computed(() => this.selectedAttendees().size);
  // Of the current selection, how many are eligible for a manual check-in / a confirm.
  selectedCheckInCount = computed(() => {
    const sel = this.selectedAttendees();
    return this.selectableAttendees().filter((a) => sel.has(a.registrationId)).length;
  });
  selectedPendingCount = computed(() => {
    const sel = this.selectedAttendees();
    return this.pendingAttendees().filter((a) => sel.has(a.registrationId)).length;
  });
  allSelectableSelected = computed(() => {
    const items = this.selectableAttendees();
    const sel = this.selectedAttendees();
    return items.length > 0 && items.every((a) => sel.has(a.registrationId));
  });

  attendeeStatus(a: AttendeeDto): 'checkedin' | 'confirmed' | 'pending' {
    if (a.checkedInAt) return 'checkedin';
    if (a.confirmedAt) return 'confirmed';
    return 'pending';
  }

  private readonly baseColumns = ['select', 'name', 'senate', 'phone', 'email', 'registered', 'status'];
  // Custom form fields become extra attendance columns.
  formFields = computed(() => this.event()?.formFields ?? []);
  displayedColumns = computed(() => {
    const cols = [...this.baseColumns];
    if (this.hasSessions()) cols.splice(cols.indexOf('email') + 1, 0, 'session');
    return [...cols, ...this.formFields().map((f) => 'ff_' + f.key)];
  });
  colId(key: string): string {
    return 'ff_' + key;
  }

  publicUrl = computed(() => {
    const e = this.event();
    return e ? `${location.origin}/e/${e.publicSlug}` : '';
  });

  ngOnInit(): void {
    this.id = +(this.route.snapshot.paramMap.get('id') ?? 0);
    this.reload();
    // Contacts (invite picker) are admin-only; confirmers only need the attendance list.
    if (this.auth.isAdmin()) {
      this.api.listContacts().subscribe((c) => this.contacts.set(c));
    }
  }

  reload(): void {
    this.loading.set(true);
    this.api.getEvent(this.id).subscribe({
      next: (e) => {
        this.event.set(e);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
    this.api.attendance(this.id).subscribe((a) => this.attendees.set(a));
    this.loadStubBoard();
    // Feedback summary is admin-only on the API; skip it for non-admin confirmers.
    if (this.auth.isAdmin()) {
      this.api.feedbackSummary(this.id).subscribe((f) => this.feedback.set(f));
    }
  }

  starArray(n: number): number[] {
    return Array.from({ length: n }, (_, i) => i + 1);
  }

  toggle(id: number): void {
    const next = new Set(this.selected());
    next.has(id) ? next.delete(id) : next.add(id);
    this.selected.set(next);
  }

  isSelected(id: number): boolean {
    return this.selected().has(id);
  }

  // ---- Attendance bulk-confirm selection ----
  toggleAttendee(id: number): void {
    const next = new Set(this.selectedAttendees());
    next.has(id) ? next.delete(id) : next.add(id);
    this.selectedAttendees.set(next);
  }

  isAttendeeSelected(id: number): boolean {
    return this.selectedAttendees().has(id);
  }

  toggleAllSelectable(): void {
    if (this.allSelectableSelected()) {
      this.selectedAttendees.set(new Set());
    } else {
      this.selectedAttendees.set(new Set(this.selectableAttendees().map((a) => a.registrationId)));
    }
  }

  confirmSelected(): void {
    // Confirm only the pending rows in the selection (already-confirmed rows may be selected for
    // check-in, but there's nothing to confirm for them).
    const pendingIds = new Set(this.pendingAttendees().map((a) => a.registrationId));
    const ids = [...this.selectedAttendees()].filter((id) => pendingIds.has(id));
    if (ids.length === 0) {
      this.toast.warning('Select at least one pending registration to confirm.');
      return;
    }
    this.confirming.set(true);
    this.api.confirmRegistrations(this.id, ids).subscribe({
      next: (res) => {
        this.confirming.set(false);
        this.selectedAttendees.set(new Set());
        const parts = [`Confirmed ${res.confirmed}`];
        if (res.emailed) parts.push(`emailed ${res.emailed} pass(es)`);
        if (res.noEmail) parts.push(`${res.noEmail} had no email`);
        this.toast.success(parts.join(' · ') + '.');
        this.reload();
      },
      error: (err) => {
        this.confirming.set(false);
        this.toast.error(err?.error?.message ?? 'Could not confirm registrations.');
      },
    });
  }

  // Cancel (remove) the selected registrations — pending ones only. Confirmed / checked-in rows in
  // the selection are left alone (the server enforces the same rule).
  async cancelSelected(): Promise<void> {
    const pending = this.pendingAttendees().filter((a) => this.selectedAttendees().has(a.registrationId));
    if (pending.length === 0) {
      this.toast.warning('Only pending registrations can be cancelled.');
      return;
    }
    const skipped = this.selectedAttendeeCount() - pending.length;
    const who = pending.length === 1 ? pending[0].fullName : `${pending.length} pending registrations`;
    const ok = await this.confirmer.confirm({
      title: pending.length === 1 ? 'Cancel registration?' : `Cancel ${pending.length} registrations?`,
      message:
        `${who} will be removed from this event. This cannot be undone.` +
        (skipped > 0 ? ` ${skipped} confirmed or checked-in selection${skipped === 1 ? '' : 's'} will be kept.` : ''),
      confirmText: pending.length === 1 ? 'Cancel registration' : `Cancel ${pending.length}`,
      cancelText: 'Keep',
      tone: 'error',
      icon: 'event_busy',
    });
    if (!ok) return;

    this.cancelling.set(true);
    this.api.cancelRegistrations(this.id, pending.map((a) => a.registrationId)).subscribe({
      next: (res) => {
        this.cancelling.set(false);
        this.selectedAttendees.set(new Set());
        const parts = [`Cancelled ${res.cancelled} registration${res.cancelled === 1 ? '' : 's'}`];
        if (res.notPending) parts.push(`${res.notPending} not pending — kept`);
        this.toast.success(parts.join(' · ') + '.');
        this.reload();
      },
      error: (err) => {
        this.cancelling.set(false);
        this.toast.error(err?.error?.message ?? 'Could not cancel registrations.');
      },
    });
  }

  // Manually check in the selected registrations (marks them attended with method "Manual").
  checkInSelected(): void {
    const ids = [...this.selectedAttendees()];
    if (ids.length === 0) {
      this.toast.warning('Select at least one registration to check in.');
      return;
    }
    this.checkingIn.set(true);
    this.api.manualCheckIn(this.id, ids).subscribe({
      next: (res) => {
        this.checkingIn.set(false);
        this.selectedAttendees.set(new Set());
        const parts = [`Checked in ${res.checkedIn}`];
        if (res.unconfirmed) parts.push(`${res.unconfirmed} auto-confirmed`);
        if (res.alreadyCheckedIn) parts.push(`${res.alreadyCheckedIn} already checked in`);
        this.toast.success(parts.join(' · ') + '.');
        this.reload();
      },
      error: (err) => {
        this.checkingIn.set(false);
        this.toast.error(err?.error?.message ?? 'Could not check in registrations.');
      },
    });
  }

  // ---- Kit claiming ----
  kitClaimedCount = computed(() => this.attendees().filter((a) => !!a.kitClaimedAt).length);

  kitDisplayed = computed(() => {
    const q = this.kitSearch().trim().toLowerCase();
    const cf = this.kitClaimFilter();
    const org = this.kitOrgFilter();
    let list = this.attendees();
    if (cf === 'claimed') list = list.filter((a) => !!a.kitClaimedAt);
    else if (cf === 'unclaimed') list = list.filter((a) => !a.kitClaimedAt);
    if (org !== 'all') list = list.filter((a) => (a.organization ?? '') === org);
    if (q) {
      list = list.filter((a) =>
        [a.fullName, a.email, a.organization ?? '', a.sessionTitle ?? '', a.kitClaimedBy ?? '']
          .join(' ')
          .toLowerCase()
          .includes(q),
      );
    }
    const { active, direction } = this.kitSort();
    if (active && direction) {
      const dir = direction === 'asc' ? 1 : -1;
      list = [...list].sort((a, b) => dir * this.compareKit(a, b, active));
    }
    return list;
  });

  onKitSort(s: Sort): void {
    this.kitSort.set({ active: s.active, direction: s.direction });
  }

  private compareKit(a: AttendeeDto, b: AttendeeDto, col: string): number {
    if (col === 'kit') {
      const ka = a.kitClaimedAt ? 1 : 0;
      const kb = b.kitClaimedAt ? 1 : 0;
      if (ka !== kb) return ka - kb;
      return (a.kitClaimedBy ?? '').localeCompare(b.kitClaimedBy ?? '');
    }
    if (col === 'claimedby') {
      return (a.kitClaimedBy ?? '').localeCompare(b.kitClaimedBy ?? '');
    }
    return this.compareAttendees(a, b, col);
  }

  // True when the kit was claimed by the registrant themselves (self-claimed).
  isSelfClaimed(a: AttendeeDto): boolean {
    return !!a.kitClaimedAt && a.kitClaimedBy === a.fullName;
  }

  selectedKitCount = computed(() => this.selectedKits().size);
  // Of the selection, how many can be claimed (currently unclaimed) vs cleared (currently claimed).
  selectedKitClaimableCount = computed(() => {
    const sel = this.selectedKits();
    return this.kitDisplayed().filter((a) => sel.has(a.registrationId) && !a.kitClaimedAt).length;
  });
  selectedKitClaimedCount = computed(() => {
    const sel = this.selectedKits();
    return this.kitDisplayed().filter((a) => sel.has(a.registrationId) && !!a.kitClaimedAt).length;
  });
  allKitsSelected = computed(() => {
    const items = this.kitDisplayed();
    const sel = this.selectedKits();
    return items.length > 0 && items.every((a) => sel.has(a.registrationId));
  });

  toggleKit(id: number): void {
    const next = new Set(this.selectedKits());
    next.has(id) ? next.delete(id) : next.add(id);
    this.selectedKits.set(next);
  }
  isKitSelected(id: number): boolean {
    return this.selectedKits().has(id);
  }
  toggleAllKits(): void {
    if (this.allKitsSelected()) {
      this.selectedKits.set(new Set());
    } else {
      this.selectedKits.set(new Set(this.kitDisplayed().map((a) => a.registrationId)));
    }
  }

  // Open the claim dialog for the unclaimed rows in the selection, then record the claim.
  claimKitSelected(): void {
    const claimableIds = new Set(
      this.kitDisplayed().filter((a) => !a.kitClaimedAt).map((a) => a.registrationId),
    );
    const ids = [...this.selectedKits()].filter((id) => claimableIds.has(id));
    if (ids.length === 0) {
      this.toast.warning('Select at least one unclaimed registrant.');
      return;
    }
    this.dialog
      .open(KitClaimDialogComponent, { data: { count: ids.length }, autoFocus: false })
      .afterClosed()
      .subscribe((res: KitClaimResult | undefined) => {
        if (!res) return;
        this.kitClaiming.set(true);
        this.api.claimKit(this.id, ids, res.claimedBy, res.selfClaimed).subscribe({
          next: (r) => {
            this.kitClaiming.set(false);
            this.selectedKits.set(new Set());
            const parts = [`Marked ${r.claimed} kit(s) claimed`];
            if (r.notified) parts.push(`notified ${r.notified}`);
            if (r.alreadyClaimed) parts.push(`${r.alreadyClaimed} already claimed`);
            this.toast.success(parts.join(' · ') + '.');
            this.reload();
          },
          error: (err) => {
            this.kitClaiming.set(false);
            this.toast.error(err?.error?.message ?? 'Could not record the kit claim.');
          },
        });
      });
  }

  // Clear the kit-claimed flag on the claimed rows in the selection.
  unclaimKitSelected(): void {
    const claimedIds = new Set(
      this.kitDisplayed().filter((a) => !!a.kitClaimedAt).map((a) => a.registrationId),
    );
    const ids = [...this.selectedKits()].filter((id) => claimedIds.has(id));
    if (ids.length === 0) {
      this.toast.warning('Select at least one claimed registrant to clear.');
      return;
    }
    this.kitClaiming.set(true);
    this.api.unclaimKit(this.id, ids).subscribe({
      next: (r) => {
        this.kitClaiming.set(false);
        this.selectedKits.set(new Set());
        this.toast.success(`Cleared ${r.cleared} kit claim(s).`);
        this.reload();
      },
      error: (err) => {
        this.kitClaiming.set(false);
        this.toast.error(err?.error?.message ?? 'Could not clear the kit claim.');
      },
    });
  }

  private readonly kitBaseColumns = ['kitselect', 'name', 'senate', 'phone', 'email', 'registered', 'kit', 'claimedby'];
  kitColumns = computed(() => {
    const cols = [...this.kitBaseColumns];
    if (this.hasSessions()) cols.splice(cols.indexOf('email') + 1, 0, 'session');
    return cols;
  });

  // ---- Meal-stub redemption ----
  // Only registrations whose sub-event has meal stubs are relevant (mealCount > 0).
  mealEligible = computed(() => this.attendees().filter((a) => a.mealCount > 0));
  hasMeals = computed(() => this.mealEligible().length > 0);
  mealRedeemedCount = computed(() => this.mealEligible().filter((a) => !!a.mealsRedeemedAt).length);
  // Total value redeemed so far (Σ meal value over redeemed registrations).
  mealValueRedeemed = computed(() =>
    this.mealEligible().filter((a) => !!a.mealsRedeemedAt).reduce((sum, a) => sum + a.mealValue, 0),
  );

  mealDisplayed = computed(() => {
    const q = this.mealSearch().trim().toLowerCase();
    const rf = this.mealRedeemFilter();
    const f = this.sessionFilter();
    let list = this.mealEligible();
    if (f !== 'all') list = list.filter((a) => a.sessionId === f);
    if (rf === 'redeemed') list = list.filter((a) => !!a.mealsRedeemedAt);
    else if (rf === 'unredeemed') list = list.filter((a) => !a.mealsRedeemedAt);
    if (q) {
      list = list.filter((a) =>
        [a.fullName, a.email, a.organization ?? '', a.sessionTitle ?? '', a.mealsRedeemedBy ?? '']
          .join(' ')
          .toLowerCase()
          .includes(q),
      );
    }
    const { active, direction } = this.mealSort();
    if (active && direction) {
      const dir = direction === 'asc' ? 1 : -1;
      list = [...list].sort((a, b) => dir * this.compareMeal(a, b, active));
    }
    return list;
  });

  onMealSort(s: Sort): void {
    this.mealSort.set({ active: s.active, direction: s.direction });
  }

  private compareMeal(a: AttendeeDto, b: AttendeeDto, col: string): number {
    if (col === 'meal') {
      const ra = a.mealsRedeemedAt ? 1 : 0;
      const rb = b.mealsRedeemedAt ? 1 : 0;
      if (ra !== rb) return ra - rb;
      return a.mealValue - b.mealValue;
    }
    if (col === 'mealvalue') return a.mealValue - b.mealValue;
    if (col === 'redeemedby') return (a.mealsRedeemedBy ?? '').localeCompare(b.mealsRedeemedBy ?? '');
    return this.compareAttendees(a, b, col);
  }

  isSelfRedeemed(a: AttendeeDto): boolean {
    return !!a.mealsRedeemedAt && a.mealsRedeemedBy === a.fullName;
  }

  selectedMealCount = computed(() => this.selectedMeals().size);
  selectedMealRedeemableCount = computed(() => {
    const sel = this.selectedMeals();
    return this.mealDisplayed().filter((a) => sel.has(a.registrationId) && !a.mealsRedeemedAt).length;
  });
  selectedMealRedeemedCount = computed(() => {
    const sel = this.selectedMeals();
    return this.mealDisplayed().filter((a) => sel.has(a.registrationId) && !!a.mealsRedeemedAt).length;
  });
  allMealsSelected = computed(() => {
    const items = this.mealDisplayed();
    const sel = this.selectedMeals();
    return items.length > 0 && items.every((a) => sel.has(a.registrationId));
  });

  toggleMeal(id: number): void {
    const next = new Set(this.selectedMeals());
    next.has(id) ? next.delete(id) : next.add(id);
    this.selectedMeals.set(next);
  }
  isMealSelected(id: number): boolean {
    return this.selectedMeals().has(id);
  }
  toggleAllMeals(): void {
    if (this.allMealsSelected()) {
      this.selectedMeals.set(new Set());
    } else {
      this.selectedMeals.set(new Set(this.mealDisplayed().map((a) => a.registrationId)));
    }
  }

  redeemMealsSelected(): void {
    const redeemableIds = new Set(
      this.mealDisplayed().filter((a) => !a.mealsRedeemedAt).map((a) => a.registrationId),
    );
    const ids = [...this.selectedMeals()].filter((id) => redeemableIds.has(id));
    if (ids.length === 0) {
      this.toast.warning('Select at least one un-redeemed registrant.');
      return;
    }
    this.dialog
      .open(KitClaimDialogComponent, {
        data: {
          count: ids.length,
          noun: 'meal stub set',
          title: 'Redeem meal stubs',
          confirmLabel: 'Mark redeemed',
        },
        autoFocus: false,
      })
      .afterClosed()
      .subscribe((res: KitClaimResult | undefined) => {
        if (!res) return;
        this.mealRedeeming.set(true);
        this.api.redeemMeals(this.id, ids, res.claimedBy, res.selfClaimed).subscribe({
          next: (r) => {
            this.mealRedeeming.set(false);
            this.selectedMeals.set(new Set());
            const parts = [`Redeemed ${r.redeemed}`];
            if (r.unconfirmed) parts.push(`${r.unconfirmed} not confirmed`);
            if (r.alreadyRedeemed) parts.push(`${r.alreadyRedeemed} already redeemed`);
            this.toast.success(parts.join(' · ') + '.');
            this.reload();
          },
          error: (err) => {
            this.mealRedeeming.set(false);
            this.toast.error(err?.error?.message ?? 'Could not redeem meal stubs.');
          },
        });
      });
  }

  unredeemMealsSelected(): void {
    const redeemedIds = new Set(
      this.mealDisplayed().filter((a) => !!a.mealsRedeemedAt).map((a) => a.registrationId),
    );
    const ids = [...this.selectedMeals()].filter((id) => redeemedIds.has(id));
    if (ids.length === 0) {
      this.toast.warning('Select at least one redeemed registrant to clear.');
      return;
    }
    this.mealRedeeming.set(true);
    this.api.unredeemMeals(this.id, ids).subscribe({
      next: (r) => {
        this.mealRedeeming.set(false);
        this.selectedMeals.set(new Set());
        this.toast.success(`Cleared ${r.cleared} meal redemption(s).`);
        this.reload();
      },
      error: (err) => {
        this.mealRedeeming.set(false);
        this.toast.error(err?.error?.message ?? 'Could not clear the redemption.');
      },
    });
  }

  private readonly mealBaseColumns = ['mealselect', 'name', 'organization', 'registered', 'mealvalue', 'meal', 'redeemedby'];
  mealColumns = computed(() => {
    const cols = [...this.mealBaseColumns];
    if (this.hasSessions()) cols.splice(cols.indexOf('organization') + 1, 0, 'session');
    return cols;
  });

  // ---- Event-level (per-day) meal stubs board (no-sub-event events) ----
  mealBoard = signal<MealBoardDto | null>(null);
  selectedMealDay = signal<number | null>(null);
  mealBoardSearch = signal('');
  selectedMealRows = signal<Set<number>>(new Set());
  mealDayRedeeming = signal(false);

  hasEventMeals = computed(() => !this.hasSessions() && (this.mealBoard()?.days.length ?? 0) > 0);
  mealDays = computed(() => this.mealBoard()?.days ?? []);
  currentMealDay = computed(
    () => this.mealDays().find((d) => d.day === this.selectedMealDay()) ?? this.mealDays()[0] ?? null,
  );
  // Total value redeemed for the selected day across all registrants.
  mealDayRedeemedValue = computed(() => {
    const day = this.currentMealDay();
    if (!day) return 0;
    const redeemed = (this.mealBoard()?.rows ?? []).filter((r) => r.redeemedDays.includes(day.day)).length;
    return redeemed * day.value;
  });

  mealBoardRows = computed(() => {
    const q = this.mealBoardSearch().trim().toLowerCase();
    let rows = this.mealBoard()?.rows ?? [];
    if (q) {
      rows = rows.filter((r) =>
        [r.fullName, r.email, r.organization ?? ''].join(' ').toLowerCase().includes(q),
      );
    }
    return rows;
  });

  isDayRedeemed(r: MealBoardRow, day: number): boolean {
    return r.redeemedDays.includes(day);
  }

  onMealDayChange(day: number): void {
    this.selectedMealDay.set(day);
    this.selectedMealRows.set(new Set());
  }

  private loadMealBoard(): void {
    this.api.mealBoard(this.id).subscribe({
      next: (b) => {
        this.mealBoard.set(b);
        if (this.selectedMealDay() == null && b.days.length) this.selectedMealDay.set(b.days[0].day);
      },
      error: () => {},
    });
  }

  selectedMealRowRedeemable = computed(() => {
    const day = this.selectedMealDay();
    if (day == null) return 0;
    const sel = this.selectedMealRows();
    return this.mealBoardRows().filter((r) => sel.has(r.registrationId) && !r.redeemedDays.includes(day)).length;
  });
  selectedMealRowRedeemed = computed(() => {
    const day = this.selectedMealDay();
    if (day == null) return 0;
    const sel = this.selectedMealRows();
    return this.mealBoardRows().filter((r) => sel.has(r.registrationId) && r.redeemedDays.includes(day)).length;
  });
  allMealRowsSelected = computed(() => {
    const rows = this.mealBoardRows();
    const sel = this.selectedMealRows();
    return rows.length > 0 && rows.every((r) => sel.has(r.registrationId));
  });

  toggleMealRow(id: number): void {
    const next = new Set(this.selectedMealRows());
    next.has(id) ? next.delete(id) : next.add(id);
    this.selectedMealRows.set(next);
  }
  isMealRowSelected(id: number): boolean {
    return this.selectedMealRows().has(id);
  }
  toggleAllMealRows(): void {
    if (this.allMealRowsSelected()) this.selectedMealRows.set(new Set());
    else this.selectedMealRows.set(new Set(this.mealBoardRows().map((r) => r.registrationId)));
  }

  redeemMealDaySelected(): void {
    const day = this.selectedMealDay();
    if (day == null) return;
    const eligible = new Set(
      this.mealBoardRows().filter((r) => !r.redeemedDays.includes(day)).map((r) => r.registrationId),
    );
    const ids = [...this.selectedMealRows()].filter((id) => eligible.has(id));
    if (ids.length === 0) {
      this.toast.warning('Select at least one un-redeemed registrant.');
      return;
    }
    this.dialog
      .open(KitClaimDialogComponent, {
        data: {
          count: ids.length,
          noun: `Day ${day} meal set`,
          title: `Redeem Day ${day} meals`,
          confirmLabel: 'Mark redeemed',
        },
        autoFocus: false,
      })
      .afterClosed()
      .subscribe((res: KitClaimResult | undefined) => {
        if (!res) return;
        this.mealDayRedeeming.set(true);
        this.api.redeemMealDay(this.id, ids, day, res.claimedBy, res.selfClaimed).subscribe({
          next: (r) => {
            this.mealDayRedeeming.set(false);
            this.selectedMealRows.set(new Set());
            const parts = [`Redeemed ${r.redeemed}`];
            if (r.unconfirmed) parts.push(`${r.unconfirmed} not confirmed`);
            if (r.alreadyRedeemed) parts.push(`${r.alreadyRedeemed} already redeemed`);
            this.toast.success(parts.join(' · ') + '.');
            this.loadMealBoard();
          },
          error: (err) => {
            this.mealDayRedeeming.set(false);
            this.toast.error(err?.error?.message ?? 'Could not redeem meal stubs.');
          },
        });
      });
  }

  unredeemMealDaySelected(): void {
    const day = this.selectedMealDay();
    if (day == null) return;
    const redeemed = new Set(
      this.mealBoardRows().filter((r) => r.redeemedDays.includes(day)).map((r) => r.registrationId),
    );
    const ids = [...this.selectedMealRows()].filter((id) => redeemed.has(id));
    if (ids.length === 0) {
      this.toast.warning('Select at least one redeemed registrant to clear.');
      return;
    }
    this.mealDayRedeeming.set(true);
    this.api.unredeemMealDay(this.id, ids, day).subscribe({
      next: (r) => {
        this.mealDayRedeeming.set(false);
        this.selectedMealRows.set(new Set());
        this.toast.success(`Cleared ${r.cleared} redemption(s).`);
        this.loadMealBoard();
      },
      error: (err) => {
        this.mealDayRedeeming.set(false);
        this.toast.error(err?.error?.message ?? 'Could not clear the redemption.');
      },
    });
  }

  readonly mealBoardColumns = ['mbselect', 'name', 'organization', 'registered', 'mbstatus'];

  // ---- Individually-issued meal stubs, segregated per stub (shows the redeeming merchant) ----
  stubList = signal<MealStubDetailDto[]>([]);
  stubSearch = signal('');
  stubStatusFilter = signal<'all' | 'redeemed' | 'unredeemed'>('all');
  // Filter by where the stub was redeemed (the merchant/vendor that scanned it).
  redeemedAtFilter = signal<string>('all');
  selectedStubIds = signal<Set<number>>(new Set());
  stubRedeeming = signal(false);

  // Distinct "redeemed at" values (merchants/vendors that have redeemed at least one stub).
  redeemedAtOptions = computed(() => {
    const set = new Set<string>();
    for (const s of this.stubList()) {
      if (s.redeemedAt && s.redeemedBy) set.add(s.redeemedBy);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  });

  // The event defines meal stubs (event-level per-day, or any sub-event's stubs).
  eventHasMealDefs = computed(
    () => (this.event()?.meals?.length ?? 0) > 0 || (this.event()?.sessions ?? []).some((s) => s.meals.length > 0),
  );

  stubTotals = computed(() => {
    const list = this.stubList();
    const redeemed = list.filter((s) => !!s.redeemedAt);
    return {
      total: list.length,
      redeemed: redeemed.length,
      valueRedeemed: redeemed.reduce((sum, s) => sum + s.denomination, 0),
    };
  });

  filteredStubs = computed(() => {
    const q = this.stubSearch().trim().toLowerCase();
    const sf = this.stubStatusFilter();
    const at = this.redeemedAtFilter();
    let list = this.stubList();
    if (sf === 'redeemed') list = list.filter((s) => !!s.redeemedAt);
    else if (sf === 'unredeemed') list = list.filter((s) => !s.redeemedAt);
    if (at !== 'all') list = list.filter((s) => !!s.redeemedAt && s.redeemedBy === at);
    if (q) {
      list = list.filter((s) =>
        [s.fullName, s.organization ?? '', s.name, s.redeemedBy ?? '', s.controlNumber]
          .join(' ')
          .toLowerCase()
          .includes(q),
      );
    }
    return list;
  });

  // Redeemed count + value within the current filter (e.g. total redeemed at a selected vendor).
  filteredRedeemed = computed(() => {
    const redeemed = this.filteredStubs().filter((s) => !!s.redeemedAt);
    return {
      count: redeemed.length,
      value: redeemed.reduce((sum, s) => sum + s.denomination, 0),
    };
  });

  private loadStubBoard(): void {
    this.api.mealStubList(this.id).subscribe({
      next: (l) => this.stubList.set(l),
      error: () => {},
    });
  }

  controlShort(s: MealStubDetailDto): string {
    return s.controlNumber.slice(0, 8).toUpperCase();
  }

  selectedStubRedeemable = computed(() => {
    const sel = this.selectedStubIds();
    return this.filteredStubs().filter((s) => sel.has(s.stubId) && !s.redeemedAt).length;
  });
  selectedStubRedeemed = computed(() => {
    const sel = this.selectedStubIds();
    return this.filteredStubs().filter((s) => sel.has(s.stubId) && !!s.redeemedAt).length;
  });
  allStubsSelected = computed(() => {
    const rows = this.filteredStubs();
    const sel = this.selectedStubIds();
    return rows.length > 0 && rows.every((s) => sel.has(s.stubId));
  });

  toggleStub(id: number): void {
    const next = new Set(this.selectedStubIds());
    next.has(id) ? next.delete(id) : next.add(id);
    this.selectedStubIds.set(next);
  }
  isStubSelected(id: number): boolean {
    return this.selectedStubIds().has(id);
  }
  toggleAllStubs(): void {
    if (this.allStubsSelected()) this.selectedStubIds.set(new Set());
    else this.selectedStubIds.set(new Set(this.filteredStubs().map((s) => s.stubId)));
  }

  redeemStubsSelected(): void {
    const redeemable = new Set(this.filteredStubs().filter((s) => !s.redeemedAt).map((s) => s.stubId));
    const ids = [...this.selectedStubIds()].filter((id) => redeemable.has(id));
    if (ids.length === 0) {
      this.toast.warning('Select at least one un-redeemed stub.');
      return;
    }
    this.dialog
      .open(KitClaimDialogComponent, {
        data: { count: ids.length, noun: 'meal stub', title: 'Redeem meal stubs', confirmLabel: 'Mark redeemed' },
        autoFocus: false,
      })
      .afterClosed()
      .subscribe((res: KitClaimResult | undefined) => {
        if (!res) return;
        this.stubRedeeming.set(true);
        this.api.redeemStubIds(this.id, ids, res.claimedBy, res.selfClaimed).subscribe({
          next: (r) => {
            this.stubRedeeming.set(false);
            this.selectedStubIds.set(new Set());
            this.toast.success(`Redeemed ${r.affected} stub(s).`);
            this.loadStubBoard();
          },
          error: (err) => {
            this.stubRedeeming.set(false);
            this.toast.error(err?.error?.message ?? 'Could not redeem stubs.');
          },
        });
      });
  }

  unredeemStubsSelected(): void {
    const redeemed = new Set(this.filteredStubs().filter((s) => !!s.redeemedAt).map((s) => s.stubId));
    const ids = [...this.selectedStubIds()].filter((id) => redeemed.has(id));
    if (ids.length === 0) {
      this.toast.warning('Select at least one redeemed stub to clear.');
      return;
    }
    this.stubRedeeming.set(true);
    this.api.unredeemStubIds(this.id, ids).subscribe({
      next: (r) => {
        this.stubRedeeming.set(false);
        this.selectedStubIds.set(new Set());
        this.toast.success(`Cleared ${r.affected} stub redemption(s).`);
        this.loadStubBoard();
      },
      error: (err) => {
        this.stubRedeeming.set(false);
        this.toast.error(err?.error?.message ?? 'Could not clear redemptions.');
      },
    });
  }

  readonly stubColumns = ['sselect', 'name', 'stub', 'denom', 'control', 'sstatus', 'merchant'];

  onSearch(value: string): void {
    this.contactSearch.set(value);
    this.pageIndex.set(0); // jump back to the first page of results
  }

  onPage(e: PageEvent): void {
    this.pageIndex.set(e.pageIndex);
    this.pageSize.set(e.pageSize);
  }

  sendInvites(): void {
    const emails = new Set<string>();
    for (const c of this.contacts()) {
      if (this.selected().has(c.id)) emails.add(c.email);
    }

    // Validate the free-text extras: collect valid ones and flag anything malformed.
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const invalid: string[] = [];
    for (const raw of this.extraEmails.split(/[\s,;]+/)) {
      const e = raw.trim().toLowerCase();
      if (!e) continue;
      if (emailRe.test(e)) emails.add(e);
      else invalid.push(e);
    }

    if (invalid.length > 0) {
      this.toast.warning(`Invalid email(s): ${invalid.join(', ')}`);
      return;
    }
    if (emails.size === 0) {
      this.toast.warning('Pick at least one contact or enter an email.');
      return;
    }
    if (emails.size > 200) {
      this.toast.warning('Too many recipients — send to at most 200 at a time.');
      return;
    }

    this.sending.set(true);
    this.api.sendInvites(this.id, [...emails]).subscribe({
      next: (res) => {
        this.sending.set(false);
        this.selected.set(new Set());
        this.extraEmails = '';
        this.toast.success(`Sent ${res.sent} invitation(s).`);
        this.reload();
      },
      error: () => {
        this.sending.set(false);
        this.toast.error('Could not send invitations.');
      },
    });
  }

  copyLink(): void {
    navigator.clipboard?.writeText(this.publicUrl());
    this.toast.success('Registration link copied.');
  }

  downloadingBundle = signal(false);
  // Build + download the event's offline bundle as a JSON file. This can be sideloaded onto a
  // device that was never online (via the scanner's "Import bundle") to enable offline check-in.
  downloadOfflineBundle(): void {
    this.downloadingBundle.set(true);
    this.api.getOfflineBundle(this.id).subscribe({
      next: (bundle) => {
        this.downloadingBundle.set(false);
        const blob = new Blob([JSON.stringify(bundle)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `offline-bundle-${bundle.event.publicSlug || this.id}.json`;
        a.click();
        URL.revokeObjectURL(url);
        const kb = Math.round(blob.size / 1024);
        this.toast.success(`Offline bundle: ${bundle.members.length} members, ${bundle.registrations.length} registrations (~${kb} KB).`);
      },
    });
  }

  exportCsv(): void {
    this.api.exportCsv(this.id).subscribe((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `attendance-${this.event()?.publicSlug ?? this.id}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  async deleteEvent(): Promise<void> {
    const ok = await this.confirmer.confirm({
      title: 'Delete event?',
      message: 'This event and all of its registrations will be permanently removed. This cannot be undone.',
      confirmText: 'Delete event',
      tone: 'error',
    });
    if (!ok) return;
    this.api.deleteEvent(this.id).subscribe(() => {
      this.toast.success('Event deleted.');
      this.router.navigate(['/admin/events']);
    });
  }

  // Open the manual Viber broadcast composer and toast the result when a message is sent.
  sendViberBroadcast(): void {
    const e = this.event();
    if (!e) return;
    this.dialog
      .open(ViberBroadcastDialogComponent, {
        data: { eventId: this.id, eventTitle: e.title },
        maxWidth: '92vw',
        width: '520px',
        autoFocus: false,
      })
      .afterClosed()
      .subscribe((res) => {
        if (res) this.toast.success(res.message);
      });
  }

  toggleClosed(): void {
    const e = this.event();
    if (!e) return;
    const closing = e.status !== 'Closed';
    const req = closing ? this.api.closeEvent(this.id) : this.api.reopenEvent(this.id);
    req.subscribe({
      next: (updated) => {
        this.event.set(updated);
        this.toast.success(closing ? 'Registration closed.' : 'Registration reopened.');
      },
      error: () => this.toast.error('Could not update the event.'),
    });
  }
}
