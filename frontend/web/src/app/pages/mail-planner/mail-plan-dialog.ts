import { Component, DestroyRef, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatAutocompleteModule, MatAutocompleteTrigger } from '@angular/material/autocomplete';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ApiService } from '../../core/api.service';
import { ConfirmService } from '../../core/confirm.service';
import { MailAudienceGroup, MailPlanDto, MailPlanSaveRequest } from '../../core/models';
import { ToastService } from '../../core/toast.service';
import { RichTextEditorComponent } from '../../shared/rich-text/rich-text-editor';
import { RichTextViewComponent } from '../../shared/rich-text/rich-text-view';
import { richTextInfo, richTextIsEmpty, toXhtml } from '../../shared/rich-text/rich-text';
import { MailChannel, MailKind, MailPlan, PlanSend, resolveReceivers } from './mail-planner.model';
import {
  BODY_MAX,
  CC_MAX,
  CHANNEL_ICONS,
  EMAIL_PATTERN,
  EVENT_NAME_MAX,
  EXTRA_EMAILS_MAX,
  KIND_ICONS,
  MAIL_CHANNELS,
  MAIL_KINDS,
  SUBJECT_MAX,
  dayKey,
  shift,
  sortedSends,
  startOfToday,
} from './mail-planner.util';

export interface MailPlanDialogData {
  // Existing plan to edit (with full message bodies), or null to create one.
  plan: MailPlan | null;
  // Saved receiver lists from the server.
  groups: MailAudienceGroup[];
  // Events to pick from; savedEvents are the names users typed in and saved.
  events: string[];
  savedEvents: string[];
  // Keeps a newly saved event name for later plans.
  onSaveEvent: (name: string) => void;
  // CC addresses saved for the dropdown; onSavedCcChange keeps the page's copy current.
  savedCc: string[];
  onSavedCcChange: (list: string[]) => void;
  // Pre-selected target day for a new plan.
  defaultDay: Date;
}

type Step = 0 | 1 | 2 | 3;

interface DayCell {
  date: Date;
  key: string;
  past: boolean;
  today: boolean;
  locked: boolean;
}

/** One editable target day: its own date, time, subject and message (HTML with inline images). */
interface DayEntry {
  uid: number;
  // Saved day being edited; null for a day added in this dialog.
  id: number | null;
  date: Date;
  time: string;
  subject: string;
  body: string;
}

let nextUid = 1;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function timeOf(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Create / edit a mail plan in four steps: details, days & messages, receivers, review.
 * Every target day carries its own time, subject and message. Days that have gone out (sent,
 * sending, queued or failed) stay on the plan as read-only history. Saving goes to the API and
 * the dialog closes with the saved plan.
 */
@Component({
  selector: 'app-mail-plan-dialog',
  imports: [
    DatePipe,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatAutocompleteModule,
    MatChipsModule,
    MatTooltipModule,
    RichTextEditorComponent,
    RichTextViewComponent,
  ],
  templateUrl: './mail-plan-dialog.html',
  styleUrl: './mail-plan-dialog.scss',
})
export class MailPlanDialogComponent {
  readonly data = inject<MailPlanDialogData>(MAT_DIALOG_DATA);
  private ref = inject(MatDialogRef<MailPlanDialogComponent, MailPlanDto>);
  private api = inject(ApiService);
  private confirm = inject(ConfirmService);
  private toast = inject(ToastService);
  private destroyRef = inject(DestroyRef);

  readonly steps = [
    { label: 'Details', icon: 'tune' },
    { label: 'Days & messages', icon: 'date_range' },
    { label: 'Receivers', icon: 'group_add' },
    { label: 'Review', icon: 'fact_check' },
  ];
  readonly kinds = MAIL_KINDS;
  readonly channels = MAIL_CHANNELS;
  readonly kindIcons = KIND_ICONS;
  readonly channelIcons = CHANNEL_ICONS;
  readonly bodyMax = BODY_MAX;
  readonly subjectMax = SUBJECT_MAX;
  readonly emailsMax = EXTRA_EMAILS_MAX;
  readonly ccMax = CC_MAX;
  readonly eventMax = EVENT_NAME_MAX;
  readonly weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  readonly groups = this.data.groups;

  readonly step = signal<Step>(0);
  // Steps the user has tried to leave; their errors are shown from then on.
  readonly touched = signal<ReadonlySet<Step>>(new Set());
  readonly saving = signal(false);

  // ---- Step 1: details ----
  kind: MailKind = this.data.plan?.kind ?? 'Announcement';
  event = this.data.plan?.event ?? '';
  channel: MailChannel = this.data.plan?.channel ?? 'Email';
  readonly savedEvents = signal<string[]>([...this.data.savedEvents]);
  readonly eventOptions = computed(() => [...new Set([...this.data.events, ...this.savedEvents()])]);

  // ---- Step 2: days & messages ----
  // Days that have gone out are kept as-is; only Scheduled days can be edited.
  readonly lockedSends: PlanSend[] = sortedSends(this.data.plan?.sends ?? []).filter((s) => s.status !== 'Scheduled');
  readonly entries = signal<DayEntry[]>(this.initialEntries());
  readonly viewMonth = signal(this.monthOf(this.entries()[0]?.date ?? this.data.defaultDay));

  readonly selectedKeys = computed(() => new Set(this.entries().map((e) => dayKey(e.date))));
  readonly lockedKeys = new Set(this.lockedSends.map((s) => dayKey(s.at)));
  readonly cells = computed<(DayCell | null)[]>(() => {
    const first = this.viewMonth();
    const today = startOfToday().getTime();
    const count = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    const cells: (DayCell | null)[] = Array.from({ length: first.getDay() }, () => null);
    for (let d = 1; d <= count; d++) {
      const date = new Date(first.getFullYear(), first.getMonth(), d);
      const key = dayKey(date);
      const t = date.getTime();
      cells.push({ date, key, past: t < today, today: t === today, locked: this.lockedKeys.has(key) });
    }
    return cells;
  });

  // ---- Step 3: receivers ----
  readonly groupIds = signal<string[]>(this.data.plan?.receivers.groupIds ?? []);
  readonly emails = signal<string[]>(this.data.plan?.receivers.emails ?? []);
  emailDraft = '';
  readonly cc = signal<string[]>(this.data.plan?.receivers.cc ?? []);
  readonly savedCc = signal<string[]>([...this.data.savedCc]);
  ccDraft = '';
  private readonly ccInput = viewChild<ElementRef<HTMLInputElement>>('ccInput');

  readonly resolved = computed(() => resolveReceivers(this.groups, { groupIds: this.groupIds(), emails: this.emails() }));
  readonly totalSends = computed(() => this.entries().length * this.resolved().length);

  // ---- Init helpers ----
  private initialEntries(): DayEntry[] {
    const sends = this.data.plan?.sends;
    if (sends) {
      return sortedSends(sends)
        .filter((s) => s.status === 'Scheduled')
        .map((s) => this.entry(shift(s.at, 0, 0), timeOf(s.at), s.subject, s.body, s.id));
    }
    return [this.entry(this.data.defaultDay, this.defaultTime(this.data.defaultDay))];
  }

  private entry(date: Date, time: string, subject = '', body = '', id: number | null = null): DayEntry {
    return { uid: nextUid++, id, date, time, subject, body };
  }

  // 9:00 AM, or the next full hour when today's 9:00 AM has already passed.
  private defaultTime(date: Date): string {
    const now = new Date();
    if (dayKey(date) !== dayKey(now) || now.getHours() < 9) return '09:00';
    return `${pad(Math.min(now.getHours() + 1, 23))}:00`;
  }

  private monthOf(d: Date): Date {
    return new Date(d.getFullYear(), d.getMonth(), 1);
  }

  // ---- Related event ----
  // Typed text filters the list; an exact match (or empty box) shows everything.
  filteredEvents(): string[] {
    const q = this.event.trim().toLowerCase();
    const all = this.eventOptions();
    if (!q || all.some((e) => e.toLowerCase() === q)) return all;
    return all.filter((e) => e.toLowerCase().includes(q));
  }

  canSaveEvent(): boolean {
    const name = this.event.trim().toLowerCase();
    return !!name && !this.eventOptions().some((e) => e.toLowerCase() === name);
  }

  saveEvent(): void {
    const name = this.event.trim().replace(/\s+/g, ' ').slice(0, EVENT_NAME_MAX);
    if (!name || !this.canSaveEvent()) return;
    this.event = name;
    this.api.saveMailEventName(name).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(({ name: saved }) => {
      this.savedEvents.update((list) => [...list, saved]);
      this.data.onSaveEvent(saved);
      this.toast.success(`"${saved}" saved to your event list.`);
    });
  }

  pickEvent(value: string): void {
    this.event = value;
    if (value && this.canSaveEvent()) this.saveEvent();
  }

  // ---- Navigation & validation ----
  entryErrors(e: DayEntry): string[] {
    const list: string[] = [];
    if (!e.subject.trim()) list.push('add a subject');
    if (!this.hasBody(e)) list.push('write the message');
    if (richTextInfo(e.body).text.length > BODY_MAX) list.push(`keep the message under ${BODY_MAX} characters`);
    if (!e.time) list.push('set a send time');
    else if (this.sendTime(e).getTime() <= Date.now()) list.push('pick a time that has not passed');
    return list;
  }

  errors(step: Step): string[] {
    if (step === 1) {
      if (!this.entries().length) return ['Pick at least one target day.'];
      return this.entries().flatMap((e, i) => {
        const errs = this.entryErrors(e);
        return errs.length ? [`Day ${this.dayNumber(i)}: ${errs.join(', ')}.`] : [];
      });
    }
    if (step === 2 && !this.resolved().length) return ['Add at least one receiver email.'];
    return [];
  }

  hasBody(e: DayEntry): boolean {
    return !richTextIsEmpty(e.body);
  }

  showEntryErrors(e: DayEntry): boolean {
    return this.touched().has(1) && this.entryErrors(e).length > 0;
  }

  hasErrors(step: number): boolean {
    return this.touched().has(step as Step) && this.errors(step as Step).length > 0;
  }

  go(step: number): void {
    this.touched.update((set) => new Set(set).add(this.step()));
    this.step.set(step as Step);
  }

  next(): void {
    const current = this.step();
    if (current === 2 && (!this.addEmails() || !this.flushCc())) return;
    this.touched.update((set) => new Set(set).add(current));
    if (this.errors(current).length) return;
    this.step.set((current + 1) as Step);
  }

  back(): void {
    this.step.update((s) => Math.max(0, s - 1) as Step);
  }

  // Day numbers continue after the days already sent.
  dayNumber(index: number): number {
    return this.lockedSends.length + index + 1;
  }

  // ---- Days ----
  private isFree(date: Date, except?: DayEntry): boolean {
    const key = dayKey(date);
    return (
      date.getTime() >= startOfToday().getTime() &&
      !this.lockedKeys.has(key) &&
      !this.entries().some((e) => e !== except && dayKey(e.date) === key)
    );
  }

  private sortEntries(list: DayEntry[]): DayEntry[] {
    return [...list].sort((a, b) => a.date.getTime() - b.date.getTime());
  }

  private lastTime(): string {
    const list = this.entries();
    return list.length ? list[list.length - 1].time : '09:00';
  }

  private addDates(dates: Date[]): void {
    const fresh = dates.filter((d) => this.isFree(d)).map((d) => this.entry(d, this.lastTime()));
    if (!fresh.length) return;
    this.entries.update((list) => this.sortEntries([...list, ...fresh]));
    this.viewMonth.set(this.monthOf(fresh[0].date));
  }

  async toggleDay(cell: DayCell): Promise<void> {
    if (cell.past || cell.locked) return;
    const existing = this.entries().find((e) => dayKey(e.date) === cell.key);
    if (!existing) {
      this.addDates([cell.date]);
      return;
    }
    await this.removeEntry(existing);
  }

  /** Adds the day after the last planned day (skipping taken days), at the same time. */
  addNextDay(): void {
    const list = this.entries();
    let date = list.length ? shift(list[list.length - 1].date, 1) : shift(startOfToday(), 1);
    while (!this.isFree(date)) date = shift(date, 1);
    const last = list[list.length - 1];
    const added = this.entry(date, last?.time ?? '09:00');
    this.entries.update((all) => this.sortEntries([...all, added]));
    this.viewMonth.set(this.monthOf(date));
  }

  /** Moves a day earlier or later, skipping days that are taken. */
  moveEntry(e: DayEntry, delta: number): void {
    let date = shift(e.date, delta);
    for (let i = 0; i < 60 && !this.isFree(date, e); i++) {
      if (date.getTime() < startOfToday().getTime()) return;
      date = shift(date, delta);
    }
    if (!this.isFree(date, e)) return;
    this.entries.update((list) => this.sortEntries(list.map((x) => (x === e ? { ...x, date } : x))));
    this.viewMonth.set(this.monthOf(date));
  }

  canMoveBack(e: DayEntry): boolean {
    return shift(e.date, -1).getTime() >= startOfToday().getTime();
  }

  /** Nudges a day's send time by `minutes` (wraps within the day). */
  bumpTime(e: DayEntry, minutes: number): void {
    const [h, m] = (e.time || '09:00').split(':').map(Number);
    const total = (((h * 60 + m + minutes) % 1440) + 1440) % 1440;
    e.time = `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
  }

  applyTimeToAll(e: DayEntry): void {
    this.entries().forEach((x) => (x.time = e.time));
    this.toast.info(`All days set to ${this.sendTime(e).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`);
  }

  copyPrevious(index: number): void {
    const prev = this.entries()[index - 1] ?? this.lockedSends[this.lockedSends.length - 1];
    const target = this.entries()[index];
    if (!prev || !target) return;
    target.subject = prev.subject;
    target.body = prev.body;
  }

  async removeEntry(e: DayEntry): Promise<void> {
    if (e.subject.trim() || this.hasBody(e)) {
      const ok = await this.confirm.confirm({
        title: 'Remove this day?',
        message: `The subject and message written for ${e.date.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })} will be discarded.`,
        confirmText: 'Remove',
        cancelText: 'Keep',
        tone: 'error',
      });
      if (!ok) return;
    }
    this.entries.update((list) => list.filter((x) => x !== e));
  }

  moveMonth(delta: number): void {
    const m = this.viewMonth();
    this.viewMonth.set(new Date(m.getFullYear(), m.getMonth() + delta, 1));
  }

  canGoBack(): boolean {
    return this.viewMonth().getTime() > this.monthOf(startOfToday()).getTime();
  }

  pickNextDays(count: number): void {
    const tomorrow = shift(startOfToday(), 1);
    this.addDates(Array.from({ length: count }, (_, i) => shift(tomorrow, i)));
  }

  pickWeekdays(): void {
    // Remaining Mon–Fri of this week from tomorrow, or next week's if none are left.
    let start = shift(startOfToday(), 1);
    if (start.getDay() === 6 || start.getDay() === 0) start = shift(start, (8 - start.getDay()) % 7);
    const dates: Date[] = [];
    for (let d = start; d.getDay() >= 1 && d.getDay() <= 5; d = shift(d, 1)) dates.push(d);
    this.addDates(dates);
  }

  pickWeekly(weeks: number): void {
    const base = this.entries()[0]?.date ?? shift(startOfToday(), 1);
    this.addDates(Array.from({ length: weeks }, (_, i) => shift(base, i * 7)));
  }

  sendTime(e: DayEntry): Date {
    const [h, m] = (e.time || '09:00').split(':').map(Number);
    const at = new Date(e.date);
    at.setHours(h, m, 0, 0);
    return at;
  }


  // ---- Receivers ----
  removeGroup(id: string): void {
    this.groupIds.update((ids) => ids.filter((x) => x !== id));
  }

  /** Adds every valid address in the draft; invalid ones stay in the box to be fixed. Also runs on blur, Next and save. */
  addEmails(): boolean {
    const parts = this.emailDraft.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
    if (!parts.length) return true;
    const invalid = parts.filter((e) => !EMAIL_PATTERN.test(e) || e.length > 256);
    const valid = [...new Set(parts.filter((e) => !invalid.includes(e)))].filter((e) => !this.emails().includes(e));
    const room = EXTRA_EMAILS_MAX - this.emails().length;
    if (valid.length > room) this.toast.warning(`Up to ${EXTRA_EMAILS_MAX} addresses per plan.`);
    this.emails.update((list) => [...list, ...valid.slice(0, Math.max(0, room))]);
    if (invalid.length) this.toast.warning(`Check ${invalid.length === 1 ? 'this address' : 'these addresses'}: ${invalid.join(', ')}`);
    this.emailDraft = invalid.join(', ');
    return !invalid.length;
  }

  // ---- CC ----
  /** Saved addresses matching what's typed, not yet on this plan's CC. */
  ccSuggestions(): string[] {
    const q = this.ccDraft.trim().toLowerCase();
    return this.savedCc().filter((e) => !this.cc().includes(e) && (!q || e.includes(q))).slice(0, 20);
  }

  isSavedCc(email: string): boolean {
    return this.savedCc().includes(email);
  }

  /** Adds every valid address in the text; invalid ones stay in the box to be fixed. */
  addCc(value: string): boolean {
    const parts = value.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
    const invalid = parts.filter((e) => !EMAIL_PATTERN.test(e) || e.length > 256);
    const valid = [...new Set(parts.filter((e) => !invalid.includes(e)))].filter((e) => !this.cc().includes(e));
    const room = CC_MAX - this.cc().length;
    if (valid.length > room) this.toast.warning(`Up to ${CC_MAX} CC addresses per plan.`);
    this.cc.update((list) => [...list, ...valid.slice(0, Math.max(0, room))]);
    if (invalid.length) this.toast.warning(`Check ${invalid.length === 1 ? 'this CC address' : 'these CC addresses'}: ${invalid.join(', ')}`);
    this.ccDraft = invalid.join(', ');
    // Write the box directly too: with the autocomplete as value accessor, ngModel doesn't always
    // repaint the input after Enter, leaving the added address visible next to its chip.
    const input = this.ccInput()?.nativeElement;
    if (input) input.value = this.ccDraft;
    return !invalid.length;
  }

  // Enter, comma, semicolon or Tab turns the typed text into a chip.
  ccKey(event: KeyboardEvent, trigger: MatAutocompleteTrigger): void {
    if (!['Enter', ',', ';', 'Tab'].includes(event.key) || !this.ccDraft.trim()) return;
    if (event.key === 'Enter' && trigger.panelOpen && trigger.activeOption) return;
    if (event.key !== 'Tab') event.preventDefault();
    if (this.addCc(this.ccDraft)) trigger.closePanel();
  }

  pasteCc(event: ClipboardEvent): void {
    const value = event.clipboardData?.getData('text/plain') ?? '';
    if (!/[\s,;]/.test(value.trim())) return;
    event.preventDefault();
    this.addCc(this.ccDraft + ' ' + value);
  }

  // The autocomplete writes the picked option into the box; addCc clears it again.
  pickCc(value: string): void {
    this.ccDraft = '';
    this.addCc(value);
  }

  removeCc(email: string): void {
    this.cc.update((list) => list.filter((e) => e !== email));
  }

  // Text still in the CC box when moving on or saving is added, or blocks if it isn't valid.
  private flushCc(): boolean {
    return !this.ccDraft.trim() || this.addCc(this.ccDraft);
  }

  /** Keeps addresses in the saved CC list so later plans can pick them from the dropdown. */
  saveCc(emails: string[]): void {
    const fresh = emails.filter((e) => !this.isSavedCc(e));
    for (const email of fresh) {
      this.api.saveMailCc(email).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(({ email: saved }) => {
        if (!this.isSavedCc(saved)) this.savedCc.update((list) => [...list, saved].sort());
        this.data.onSavedCcChange(this.savedCc());
        if (fresh.length === 1) this.toast.success(`${saved} saved to your CC list.`);
      });
    }
    if (fresh.length > 1) this.toast.success(`${fresh.length} addresses saved to your CC list.`);
  }

  forgetCc(email: string, event: Event): void {
    event.stopPropagation();
    event.preventDefault();
    this.api.forgetMailCc(email).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.savedCc.update((list) => list.filter((e) => e !== email));
      this.data.onSavedCcChange(this.savedCc());
    });
  }

  unsavedCc(): string[] {
    return this.cc().filter((e) => !this.isSavedCc(e));
  }

  removeEmail(email: string): void {
    this.emails.update((list) => list.filter((e) => e !== email));
  }

  clearEmails(): void {
    this.emails.set([]);
  }

  groupName(id: string): string {
    return this.groups.find((g) => g.id === id)?.name ?? id;
  }

  groupSize(id: string): number {
    return this.groups.find((g) => g.id === id)?.emails.length ?? 0;
  }

  // ---- Save ----
  save(draft: boolean): void {
    if (this.saving()) return;
    if (!this.addEmails() || !this.flushCc()) {
      this.step.set(2);
      return;
    }
    const failing = ([1, 2] as Step[]).find((s) => this.errors(s).length);
    if (failing !== undefined) {
      this.touched.set(new Set([0, 1, 2]));
      this.step.set(failing);
      this.toast.warning(this.errors(failing)[0]);
      return;
    }
    const request: MailPlanSaveRequest = {
      kind: this.kind,
      eventName: this.event.trim() || null,
      channel: this.channel,
      draft,
      groupIds: this.groupIds(),
      emails: this.emails(),
      cc: this.cc(),
      sends: this.entries().map((e) => ({
        id: e.id,
        sendAt: this.sendTime(e).toISOString(),
        subject: e.subject.trim(),
        bodyHtml: toXhtml(e.body),
      })),
      version: this.data.plan?.version ?? null,
    };
    const plan = this.data.plan;
    this.saving.set(true);
    (plan ? this.api.updateMailPlan(plan.id, request) : this.api.createMailPlan(request))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (saved) => this.ref.close(saved),
        error: (error) => {
          this.saving.set(false);
          const message = (error?.error as { message?: unknown } | null)?.message;
          this.toast.error(typeof message === 'string' && message ? message : 'The plan could not be saved. Try again.', 8000);
        },
      });
  }
}
