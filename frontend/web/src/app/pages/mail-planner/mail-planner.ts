import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Observable, finalize, forkJoin, interval, of } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { ConfirmService } from '../../core/confirm.service';
import { InboxMailDto, MailAudienceGroup, MailPlanDto, MailPlanSendDto } from '../../core/models';
import { ToastService } from '../../core/toast.service';
import { RichTextViewComponent } from '../../shared/rich-text/rich-text-view';
import { MailPlanDialogComponent, MailPlanDialogData } from './mail-plan-dialog';
import {
  MailPlan,
  PlanSend,
  ReceivedMail,
  ReminderStatus,
  resolveReceivers,
  toPlan,
  toPlanSend,
  toReceived,
} from './mail-planner.model';
import { CHANNEL_ICONS, KIND_ICONS, dayKey, shift, sortedSends, startOfToday } from './mail-planner.util';

type Tab = 'plan' | 'reminders';
type ReminderFilter = 'All' | ReminderStatus;

interface QuickPlan {
  label: string;
  icon: string;
  // Only offered for mails that belong to an event.
  needsEvent?: boolean;
  pick: (mail: ReceivedMail) => Date;
}

/** One target day of a plan, as shown on the day timeline. */
interface DayItem {
  plan: MailPlan;
  send: PlanSend;
  // 1-based position of this day within the plan's days.
  index: number;
  total: number;
  receivers: number;
}

/**
 * Mail Planner: organizers create mail plans — the days they go out, each day's mail and a
 * receiver list — which the server sends on schedule; receivers turn the mails they got into
 * reminders. Lists hold message previews; full bodies (with images) load when expanded.
 */
@Component({
  selector: 'app-mail-planner',
  imports: [DatePipe, MatButtonModule, MatIconModule, MatTooltipModule, RichTextViewComponent],
  templateUrl: './mail-planner.html',
  styleUrl: './mail-planner.scss',
})
export class MailPlannerComponent {
  protected auth = inject(AuthService);
  private api = inject(ApiService);
  private confirm = inject(ConfirmService);
  private dialog = inject(MatDialog);
  private toast = inject(ToastService);
  private destroyRef = inject(DestroyRef);

  readonly kindIcons = KIND_ICONS;
  readonly channelIcons = CHANNEL_ICONS;
  readonly reminderFilters: ReminderFilter[] = ['All', 'Due today', 'Upcoming', 'Not planned', 'Snoozed', 'Done'];

  readonly tab = signal<Tab>(this.auth.isAdmin() ? 'plan' : 'reminders');
  readonly loading = signal(true);
  readonly loadError = signal('');
  // Plan or reminder action in progress, so buttons can't be double-clicked.
  readonly busy = signal(false);

  // ---- Send plan (organizer) ----
  readonly plans = signal<MailPlan[]>([]);
  readonly groups = signal<MailAudienceGroup[]>([]);
  readonly events = signal<string[]>([]);
  readonly savedEvents = signal<string[]>([]);
  readonly savedCc = signal<string[]>([]);
  readonly selectedDay = signal(startOfToday());
  readonly week = computed(() => Array.from({ length: 7 }, (_, i) => shift(startOfToday(), i)));

  readonly receiverCounts = computed(() => new Map(this.plans().map((p) => [p.id, resolveReceivers(this.groups(), p.receivers).length])));

  readonly dayItems = computed<DayItem[]>(() => {
    const key = dayKey(this.selectedDay());
    const items: DayItem[] = [];
    for (const plan of this.plans()) {
      const sends = sortedSends(plan.sends);
      sends.forEach((send, i) => {
        if (dayKey(send.at) === key)
          items.push({ plan, send, index: i + 1, total: sends.length, receivers: this.receiversOf(plan, send) });
      });
    }
    return items.sort((a, b) => a.send.at.getTime() - b.send.at.getTime());
  });

  // Plans for the side list: upcoming first, then drafts, then finished.
  readonly planList = computed(() => {
    const rank = (p: MailPlan) => (p.draft ? 1 : this.nextSend(p) ? 0 : 2);
    return [...this.plans()].sort((a, b) => rank(a) - rank(b) || (this.nextSend(a)?.at.getTime() ?? 0) - (this.nextSend(b)?.at.getTime() ?? 0));
  });

  readonly stats = computed(() => {
    const plans = this.plans();
    const live = plans.filter((p) => !p.draft);
    const sends = live.flatMap((p) => p.sends.map((s) => ({ s, n: this.receiverCounts().get(p.id) ?? 0 })));
    const today = dayKey(new Date());
    return {
      active: live.filter((p) => this.nextSend(p)).length,
      today: sends.filter(({ s }) => dayKey(s.at) === today && s.status === 'Scheduled').length,
      drafts: plans.length - live.length,
      deliveries: sends.filter(({ s }) => s.status === 'Scheduled').reduce((sum, { n }) => sum + n, 0),
      failed: sends.filter(({ s }) => s.status === 'Failed').length,
    };
  });

  // ---- My reminders (receiver) ----
  readonly received = signal<ReceivedMail[]>([]);
  readonly reminderFilter = signal<ReminderFilter>('All');

  readonly visibleReceived = computed(() => {
    const f = this.reminderFilter();
    return f === 'All' ? this.received() : this.received().filter((m) => m.status === f);
  });

  readonly reminderCounts = computed(() => {
    const counts: Partial<Record<ReminderFilter, number>> = { All: this.received().length };
    for (const m of this.received()) counts[m.status] = (counts[m.status] ?? 0) + 1;
    return counts;
  });

  // Next reminders in time order, for the agenda side card.
  readonly agenda = computed(() =>
    this.received()
      .filter((m) => m.remindAt && m.status !== 'Done')
      .sort((a, b) => a.remindAt!.getTime() - b.remindAt!.getTime())
      .slice(0, 5),
  );

  readonly quickPlans: QuickPlan[] = [
    { label: 'Tonight 6 PM', icon: 'nights_stay', pick: () => shift(startOfToday(), 0, 18) },
    { label: 'Tomorrow 9 AM', icon: 'wb_sunny', pick: () => shift(startOfToday(), 1, 9) },
    { label: 'Day before event', icon: 'event_upcoming', needsEvent: true, pick: (m) => shift(m.eventAt!, -1, 9) },
    { label: 'Event morning', icon: 'alarm', needsEvent: true, pick: (m) => shift(m.eventAt!, 0, 7) },
    { label: 'In 3 days', icon: 'date_range', pick: () => shift(startOfToday(), 3, 9) },
  ];

  // Expanded messages and their loaded bodies: 's<sendId>' on the timeline, 'r<mailId>' in reminders.
  readonly expanded = signal<ReadonlySet<string>>(new Set());
  readonly bodies = signal<ReadonlyMap<string, string>>(new Map());

  readonly isToday = (d: Date) => dayKey(d) === dayKey(new Date());
  readonly sameDay = (a: Date, b: Date) => dayKey(a) === dayKey(b);

  constructor() {
    this.load();
    // Picks up days the server sent (or failed) and reminders coming due.
    interval(30_000).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      if (!this.busy() && document.visibilityState === 'visible') this.refresh();
    });
  }

  load(): void {
    this.loading.set(true);
    const admin = this.auth.isAdmin();
    forkJoin({
      inbox: this.api.mailInbox(),
      plans: admin ? this.api.mailPlans() : of(null),
      options: admin ? this.api.mailPlanOptions() : of(null),
    })
      .pipe(takeUntilDestroyed(this.destroyRef), finalize(() => this.loading.set(false)))
      .subscribe({
        next: ({ inbox, plans, options }) => {
          this.received.set(inbox.map(toReceived));
          if (plans) this.plans.set(plans.map(toPlan));
          if (options) {
            // Missing lists (e.g. an older API) fall back to empty so the plan dialog still opens.
            this.groups.set(options.groups ?? []);
            this.events.set(options.events ?? []);
            this.savedEvents.set(options.savedEvents ?? []);
            this.savedCc.set(options.savedCc ?? []);
          }
          this.loadError.set('');
        },
        error: () => this.loadError.set('The mail planner could not be loaded. Check your connection and try again.'),
      });
  }

  private refresh(): void {
    if (this.auth.isAdmin())
      this.api.mailPlans().pipe(takeUntilDestroyed(this.destroyRef)).subscribe((plans) => this.plans.set(plans.map(toPlan)));
    this.api.mailInbox().pipe(takeUntilDestroyed(this.destroyRef)).subscribe((inbox) => this.received.set(inbox.map(toReceived)));
  }

  // Days that have gone out show who actually got them; the rest show the list's current size.
  private receiversOf(plan: MailPlan, send: PlanSend): number {
    return send.status === 'Scheduled' ? this.receiverCounts().get(plan.id) ?? 0 : send.recipientCount;
  }

  countOn(day: Date): number {
    const key = dayKey(day);
    return this.plans().reduce((n, p) => n + p.sends.filter((s) => dayKey(s.at) === key).length, 0);
  }

  daysUntil(d: Date): number {
    return Math.round((shift(d, 0, 0).getTime() - startOfToday().getTime()) / 86_400_000);
  }

  nextSend(plan: MailPlan): PlanSend | undefined {
    return plan.sends
      .filter((s) => s.status === 'Scheduled' && s.at.getTime() > Date.now())
      .sort((a, b) => a.at.getTime() - b.at.getTime())[0];
  }

  /** A plan is named after its first day's subject. */
  planTitle(plan: MailPlan): string {
    return sortedSends(plan.sends)[0]?.subject ?? 'Untitled plan';
  }

  sentCount(plan: MailPlan): number {
    return plan.sends.filter((s) => s.status === 'Sent').length;
  }

  receiverSummary(plan: MailPlan): string {
    const parts = plan.receivers.groupIds.map((id) => this.groups().find((g) => g.id === id)?.name ?? 'Removed list');
    if (plan.receivers.emails.length) parts.unshift(`${plan.receivers.emails.length} email${plan.receivers.emails.length === 1 ? '' : 's'}`);
    if (plan.receivers.cc.length) parts.push(`CC ${plan.receivers.cc.length}`);
    return parts.join(', ');
  }

  quickPlansFor(mail: ReceivedMail): QuickPlan[] {
    return this.quickPlans.filter((q) => !q.needsEvent || mail.eventAt);
  }

  // Long text or any image gets a "Read full message" toggle.
  isLong(preview: string, images: number): boolean {
    return preview.length > 140 || images > 0;
  }

  /** Expands a message, loading its full body (with images) the first time. */
  toggleBody(key: string, load: () => Observable<{ bodyHtml: string }>): void {
    const open = this.expanded().has(key);
    this.expanded.update((set) => {
      const next = new Set(set);
      if (open) next.delete(key);
      else next.add(key);
      return next;
    });
    if (open || this.bodies().has(key)) return;
    load().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(({ bodyHtml }) =>
      this.bodies.update((map) => new Map(map).set(key, bodyHtml)));
  }

  sendBody(send: PlanSend): () => Observable<{ bodyHtml: string }> {
    return () => this.api.mailPlanSendBody(send.id);
  }

  mailBody(mail: ReceivedMail): () => Observable<{ bodyHtml: string }> {
    return () => this.api.mailInboxBody(mail.id);
  }

  // ---- Send plan actions ----
  openPlan(plan: MailPlan | null = null): void {
    if (this.busy()) return;
    if (!plan) {
      this.openDialog(null);
      return;
    }
    // The editor needs every day's full message, which the list leaves out.
    this.busy.set(true);
    this.api.mailPlan(plan.id).pipe(takeUntilDestroyed(this.destroyRef), finalize(() => this.busy.set(false)))
      .subscribe((full) => this.openDialog(toPlan(full)));
  }

  private openDialog(plan: MailPlan | null): void {
    const day = this.selectedDay().getTime() < startOfToday().getTime() ? startOfToday() : this.selectedDay();
    this.dialog
      .open<MailPlanDialogComponent, MailPlanDialogData, MailPlanDto>(MailPlanDialogComponent, {
        data: {
          plan,
          groups: this.groups(),
          events: this.events(),
          savedEvents: this.savedEvents(),
          onSaveEvent: (name) => this.savedEvents.update((list) => [...list, name]),
          savedCc: this.savedCc(),
          onSavedCcChange: (list) => this.savedCc.set(list),
          defaultDay: day,
        },
        width: '1040px',
        maxWidth: '96vw',
        maxHeight: '94vh',
        panelClass: 'mail-plan-panel',
        autoFocus: false,
      })
      .afterClosed()
      .subscribe((dto) => {
        if (!dto) return;
        const saved = toPlan(dto);
        this.plans.update((list) => (list.some((p) => p.id === saved.id) ? list.map((p) => (p.id === saved.id ? saved : p)) : [...list, saved]));
        // Edited days get new bodies; drop the cached copies.
        this.bodies.update((map) => new Map([...map].filter(([key]) => !saved.sends.some((s) => key === 's' + s.id))));
        const first = this.nextSend(saved) ?? saved.sends[0];
        if (first) this.selectedDay.set(shift(first.at, 0, 0));
        const days = saved.sends.filter((s) => s.status === 'Scheduled').length;
        this.toast.success(saved.draft ? 'Plan saved as draft.' : `Plan scheduled on ${days} day${days === 1 ? '' : 's'}.`);
      });
  }

  async sendNow(item: DayItem): Promise<void> {
    const ok = await this.confirm.confirm({
      title: 'Send this mail now?',
      message: `"${item.send.subject}" goes out to ${item.receivers} receiver${item.receivers === 1 ? '' : 's'} now instead of ${item.send.at.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}.`,
      confirmText: 'Send now',
      cancelText: 'Keep schedule',
    });
    if (ok) this.deliver(item, this.api.sendMailPlanNow(item.send.id));
  }

  retry(item: DayItem): void {
    this.deliver(item, this.api.retryMailPlanSend(item.send.id));
  }

  private deliver(item: DayItem, request: Observable<MailPlanSendDto>): void {
    if (this.busy()) return;
    this.busy.set(true);
    request.pipe(takeUntilDestroyed(this.destroyRef), finalize(() => this.busy.set(false))).subscribe((dto) => {
      const send = toPlanSend(dto);
      this.plans.update((list) =>
        list.map((p) => (p.id === item.plan.id ? { ...p, sends: p.sends.map((s) => (s.id === send.id ? send : s)) } : p)));
      this.selectedDay.set(shift(send.at, 0, 0));
      if (send.status === 'Sent') this.toast.success(`Sent to ${send.recipientCount} receiver${send.recipientCount === 1 ? '' : 's'}.`);
      else this.toast.warning(send.lastError ?? 'The mail could not be sent yet.', 8000);
    });
  }

  async removeDay(item: DayItem): Promise<void> {
    const last = item.total === 1;
    const ok = await this.confirm.confirm({
      title: last ? 'Remove this plan?' : 'Remove this day from the plan?',
      message: last
        ? `"${item.send.subject}" is the only day of this plan, so the whole plan will be removed.`
        : `"${item.send.subject}" will not go out on ${item.send.at.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}. Its other days stay planned.`,
      confirmText: 'Remove',
      cancelText: 'Keep',
      tone: 'error',
    });
    if (!ok || this.busy()) return;
    this.busy.set(true);
    this.api.deleteMailPlanSend(item.send.id).pipe(takeUntilDestroyed(this.destroyRef), finalize(() => this.busy.set(false)))
      .subscribe(({ planDeleted }) => {
        this.plans.update((list) =>
          planDeleted
            ? list.filter((p) => p.id !== item.plan.id)
            : list.map((p) => (p.id === item.plan.id ? { ...p, sends: p.sends.filter((s) => s.id !== item.send.id) } : p)));
        this.toast.success(planDeleted ? 'Plan removed.' : 'Day removed from the plan.');
      });
  }

  async deletePlan(plan: MailPlan): Promise<void> {
    const ok = await this.confirm.confirm({
      title: 'Delete this plan?',
      message: `"${this.planTitle(plan)}" and all ${plan.sends.length} of its days will be removed, including mails already sent from receivers' My Reminders.`,
      confirmText: 'Delete',
      cancelText: 'Keep',
      tone: 'error',
    });
    if (!ok || this.busy()) return;
    this.busy.set(true);
    this.api.deleteMailPlan(plan.id).pipe(takeUntilDestroyed(this.destroyRef), finalize(() => this.busy.set(false)))
      .subscribe(() => {
        this.plans.update((list) => list.filter((p) => p.id !== plan.id));
        this.toast.success('Plan deleted.');
      });
  }

  jumpTo(plan: MailPlan): void {
    const target = this.nextSend(plan) ?? plan.sends[0];
    if (target) this.selectedDay.set(shift(target.at, 0, 0));
  }

  // ---- Reminder actions ----
  planReminder(mail: ReceivedMail, when: Date): void {
    if (when.getTime() < Date.now()) {
      this.toast.warning('Pick a reminder time in the future.');
      return;
    }
    this.updateReceived(this.api.setMailReminder(mail.id, when), () =>
      this.toast.success(`Reminder set for ${when.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}.`));
  }

  planCustom(mail: ReceivedMail, value: string): void {
    if (value) this.planReminder(mail, new Date(value));
  }

  snooze(mail: ReceivedMail): void {
    this.updateReceived(this.api.snoozeMailReminder(mail.id), () => this.toast.info('Snoozed for one day.'));
  }

  markDone(mail: ReceivedMail): void {
    this.updateReceived(this.api.markMailDone(mail.id));
  }

  clearReminder(mail: ReceivedMail): void {
    this.updateReceived(this.api.setMailReminder(mail.id, null));
  }

  private updateReceived(request: Observable<InboxMailDto>, done?: () => void): void {
    if (this.busy()) return;
    this.busy.set(true);
    request.pipe(takeUntilDestroyed(this.destroyRef), finalize(() => this.busy.set(false))).subscribe((dto) => {
      const mail = toReceived(dto);
      this.received.update((list) => list.map((m) => (m.id === mail.id ? mail : m)));
      done?.();
    });
  }

  statusClass(status: string): string {
    switch (status) {
      case 'Sent':
      case 'Done':
        return 'ok';
      case 'Scheduled':
      case 'Sending':
      case 'Upcoming':
        return 'brand';
      case 'Draft':
      case 'Snoozed':
      case 'Not planned':
        return '';
      case 'Queued':
      case 'Due today':
        return 'pending';
      default:
        return 'closed';
    }
  }
}
