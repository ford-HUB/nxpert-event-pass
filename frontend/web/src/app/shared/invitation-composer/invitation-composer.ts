import { Component, DestroyRef, ElementRef, EventEmitter, Input, OnChanges, Output, ViewChild, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatAutocompleteModule, MatAutocompleteTrigger } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSelectModule } from '@angular/material/select';
import { concatMap, finalize, firstValueFrom, from, interval } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { ContactDto, EventDto, InvitationEmail, InvitationMessageRequest, InvitationMessageResult } from '../../core/models';
import { ToastService } from '../../core/toast.service';
import { ConfirmService } from '../../core/confirm.service';
import { AuthService } from '../../core/auth.service';
import { ALL_USERS, expandRecipients, invitationErrorMessage, recipientAddress } from '../../core/invitation.util';
import { MatDialog } from '@angular/material/dialog';
import { formatScheduleLabel, openScheduleDateDialog } from './schedule-date-dialog';
import { IMAGE_TYPES, cleanNode, imageBudget, insertAtSelection, newImage, pasteMessage, readPaste, toPng } from '../rich-text/rich-text';

type RecipientField = 'to' | 'cc';

const MAX_SCHEDULES = 30;
const MAX_SAVED = 200;
const MAX_SUGGESTIONS = 8;
const PH_OFFSET_MS = 8 * 3600000;
const DAY_MS = 24 * 3600000;
// The server (InvitationMessageBuilder.InjectScheduleDay) replaces this with each email's send day.
const SCHEDULE_DAY_TOKEN = '{{schedule_day}}';
const SCHEDULE_DAY_PATTERN = /\{\{\s*schedule_day\s*\}\}/i;

/**
 * Event invitation email, Gmail / Outlook style: To and CC chips (typed or comma-separated
 * addresses, previously used addresses suggested while typing, or the @n-pax group = every
 * system user), a formatted message with inline images, and the
 * event's details + calendar invitation appended by the server.
 */
@Component({
  selector: 'app-invitation-composer',
  imports: [
    DatePipe,
    FormsModule,
    MatAutocompleteModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatChipsModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatTooltipModule,
    MatSelectModule,
  ],
  templateUrl: './invitation-composer.html',
  styleUrl: './invitation-composer.scss',
})
export class InvitationComposerComponent implements OnChanges {
  @Input({ required: true }) event!: EventDto;
  @Input() contacts: ContactDto[] = [];
  @Output() sent = new EventEmitter<void>();
  // Lets the page show its "Sending invitations…" overlay.
  @Output() sendingChange = new EventEmitter<boolean>();
  @ViewChild('editor', { static: true }) editor!: ElementRef<HTMLDivElement>;
  @ViewChild('previewBody', { static: true }) previewBody!: ElementRef<HTMLDivElement>;
  @ViewChild('historyBody') set historyBody(element: ElementRef<HTMLDivElement> | undefined) {
    if (!element) return;
    const doc = new DOMParser().parseFromString(this.openedEmail()?.bodyHtml ?? '<div></div>', 'text/html');
    element.nativeElement.replaceChildren(...Array.from(doc.body.childNodes, (n) => cleanNode(n)));
  }

  private api = inject(ApiService);
  private toast = inject(ToastService);
  private confirmer = inject(ConfirmService);
  private dialog = inject(MatDialog);
  private destroyRef = inject(DestroyRef);
  private auth = inject(AuthService);

  readonly allUsers = ALL_USERS;
  // Addresses this admin has sent to before, offered as suggestions while typing.
  savedAddresses = signal<string[]>(this.loadSaved());
  readonly fields: RecipientField[] = ['to', 'cc'];
  recipients: Record<RecipientField, string[]> = { to: [], cc: [] };
  query: Record<RecipientField, string> = { to: '', cc: '' };
  subject = '';
  sending = signal(false);
  processingImage = signal(false);
  linkOpen = false;
  linkUrl = '';
  private selection: Range | null = null;
  // Live preview of the email in the summary panel shows the message with its formatting.
  hasMessage = signal(false);
  scheduleEnabled = false;
  // datetime-local values in Philippine time; each date sends its own copy of the email.
  scheduleAt: string[] = [''];
  readonly maxSchedules = MAX_SCHEDULES;
  readonly scheduleDayToken = SCHEDULE_DAY_TOKEN;
  hasScheduleDay = signal(false);
  history = signal<InvitationEmail[]>([]);
  historyLoading = signal(false);
  historyError = signal('');
  historyVisible = true;
  historyFilter: 'All' | 'Scheduled' | 'Sent' = 'All';
  openedEmail = signal<InvitationEmail | null>(null);
  openingEmail = signal(false);
  // Row showing the "opening" indicator while its email loads.
  openingId: number | null = null;
  editingEmail: InvitationEmail | null = null;
  private historyEventId: number | null = null;

  constructor() {
    interval(15000).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      if (this.historyVisible && this.event && !this.historyLoading()) this.loadHistory(false);
    });
  }

  ngOnChanges(): void {
    if (!this.subject && this.event) this.subject = `You're invited: ${this.event.title}`.slice(0, 200);
    if (this.event && this.historyEventId !== this.event.id) {
      if (this.historyEventId !== null) this.resetDraft();
      this.historyEventId = this.event.id;
      this.history.set([]);
      this.openedEmail.set(null);
      this.loadHistory();
    }
  }

  get filteredHistory(): InvitationEmail[] {
    return this.history().filter((m) => this.matchesFilter(m, this.historyFilter));
  }

  historyCount(filter: 'All' | 'Scheduled' | 'Sent'): number {
    return this.history().filter((m) => this.matchesFilter(m, filter)).length;
  }

  private matchesFilter(email: InvitationEmail, filter: 'All' | 'Scheduled' | 'Sent'): boolean {
    return filter === 'All' ||
      (filter === 'Sent' ? email.status === 'Sent' : ['Scheduled', 'Queued', 'Sending', 'Failed'].includes(email.status));
  }

  canEdit(email: InvitationEmail): boolean {
    return ['Scheduled', 'Queued', 'Failed'].includes(email.status);
  }

  loadHistory(showLoading = true): void {
    const eventId = this.event.id;
    if (showLoading) this.historyLoading.set(true);
    this.api.invitationEmailHistory(eventId).pipe(takeUntilDestroyed(this.destroyRef),
      finalize(() => { if (eventId === this.event.id) this.historyLoading.set(false); })).subscribe({
      next: (items) => {
        if (eventId !== this.event.id) return;
        this.history.set(items);
        this.historyError.set('');
        const opened = this.openedEmail();
        if (opened) {
          const latest = items.find((m) => m.id === opened.id);
          // If another admin edited the body, require reopening rather than mix
          // old content with the new concurrency token.
          if (latest && latest.version !== opened.version) this.openedEmail.set(null);
        }
      },
      error: () => this.historyError.set('Email history could not be loaded. Refresh to try again.'),
    });
  }

  toggleHistory(): void {
    this.historyVisible = !this.historyVisible;
    if (this.historyVisible) this.loadHistory();
  }

  // Rows expand in place; clicking the open row collapses it.
  toggleEmail(email: InvitationEmail): void {
    if (this.openedEmail()?.id === email.id) this.openedEmail.set(null);
    else this.openEmail(email);
  }

  openEmail(email: InvitationEmail): void {
    if (this.openingEmail()) return;
    this.openingId = email.id;
    this.openingEmail.set(true);
    this.openedEmail.set(null);
    const eventId = this.event.id;
    this.api.invitationEmail(eventId, email.id).pipe(takeUntilDestroyed(this.destroyRef),
      finalize(() => this.openingEmail.set(false))).subscribe({
      next: (message) => { if (eventId === this.event.id) this.openedEmail.set(message); },
      error: () => this.toast.error('This email could not be opened. Refresh the history and try again.'),
    });
  }

  async editEmail(email: InvitationEmail, copy = false): Promise<void> {
    if (this.sending() || (!copy && !this.canEdit(email))) return;
    if (this.recipients.to.length || this.recipients.cc.length || this.editor.nativeElement.textContent?.trim() ||
        this.editor.nativeElement.querySelector('img') || this.scheduleEnabled || this.editingEmail ||
        this.subject !== `You're invited: ${this.event.title}`.slice(0, 200)) {
      if (!await this.confirmer.confirm({ title: 'Replace current draft?',
        message: 'Unsaved changes in the composer will be lost.', confirmText: 'Replace draft', cancelText: 'Keep draft' })) return;
    }
    this.editingEmail = copy ? null : email;
    this.recipients = { to: [...email.to], cc: [...email.cc] };
    this.query = { to: '', cc: '' };
    this.subject = email.subject;
    this.scheduleEnabled = !copy && !!email.scheduledAt;
    this.scheduleAt = [email.scheduledAt ? this.toPhInput(new Date(email.scheduledAt).getTime()) : ''];
    // Rebuild nodes using the same allowlist as the preview. Never inject stored
    // content directly into contenteditable, even though the API sanitizes it.
    const doc = new DOMParser().parseFromString(email.bodyHtml ?? '<div></div>', 'text/html');
    const content = doc.body.firstElementChild?.childNodes ?? doc.body.childNodes;
    this.editor.nativeElement.replaceChildren(...Array.from(content, (n) => cleanNode(n)));
    this.selection = null;
    this.syncPreview();
    this.editor.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  async cancelScheduled(email: InvitationEmail): Promise<void> {
    if (this.sending()) return;
    if (!await this.confirmer.confirm({ title: 'Cancel scheduled email?',
      message: 'This email will remain in history and will no longer be sent.', confirmText: 'Cancel email', cancelText: 'Keep email' })) return;
    this.setSending(true);
    this.api.cancelInvitationEmail(this.event.id, email.id, email.version)
      .pipe(takeUntilDestroyed(this.destroyRef), finalize(() => this.setSending(false))).subscribe({
        next: () => {
          this.toast.success('Email cancelled.');
          if (this.editingEmail?.id === email.id) this.resetDraft();
          this.openedEmail.set(null);
          this.loadHistory();
        },
        error: (error) => { this.toast.error(invitationErrorMessage(error)); this.loadHistory(); },
      });
  }

  resetDraft(): void {
    this.editingEmail = null;
    this.recipients = { to: [], cc: [] };
    this.query = { to: '', cc: '' };
    this.subject = `You're invited: ${this.event.title}`.slice(0, 200);
    this.scheduleEnabled = false;
    this.scheduleAt = [''];
    this.editor.nativeElement.replaceChildren();
    this.selection = null;
    this.syncPreview();
  }

  // ---- Schedule dates ----

  // The + button adds the next free day after the last date, at the same time.
  addSchedule(): void {
    if (this.scheduleAt.length >= MAX_SCHEDULES) return;
    const last = this.parsePh(this.scheduleAt[this.scheduleAt.length - 1]);
    let next = last === null ? null : last + DAY_MS;
    while (next !== null && this.scheduleAt.some((v) => this.minuteOf(this.parsePh(v)) === this.minuteOf(next))) next += DAY_MS;
    this.scheduleAt = [...this.scheduleAt, next === null ? '' : this.toPhInput(next)];
  }

  removeSchedule(index: number): void {
    this.scheduleAt = this.scheduleAt.filter((_, i) => i !== index);
  }

  scheduleLabel(value: string): string {
    return formatScheduleLabel(value);
  }

  // Calendar + hour/minute/AM-PM dialog; it refuses past or conflicting times before closing.
  pickSchedule(index: number): void {
    if (this.sending()) return;
    openScheduleDateDialog(this.dialog, {
      title: this.scheduleAt.length > 1 ? `Send date and time #${index + 1}` : 'Send date and time',
      value: this.scheduleAt[index],
      validate: (value) => this.issueFor(value, index, true),
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe((value) => {
      if (value) this.scheduleAt = this.scheduleAt.map((v, i) => (i === index ? value : v));
    });
  }

  // Two sends of the same event on the same day and minute conflict, whether in this draft or
  // already scheduled. The email being edited is replaced, so it doesn't conflict with itself.
  scheduleIssue(index: number): string {
    return this.issueFor(this.scheduleAt[index], index, false);
  }

  // Inline messages flag only the later of two equal dates; the dialog checks against all others.
  private issueFor(value: string, index: number, compareAll: boolean): string {
    if (!value) return '';
    const time = this.parsePh(value);
    if (time === null) return 'Enter a valid date and time.';
    if (time <= Date.now()) return 'Choose a future date and time.';
    const minute = this.minuteOf(time);
    const twin = this.scheduleAt.findIndex((v, i) => (compareAll ? i !== index : i < index) && this.minuteOf(this.parsePh(v)) === minute);
    if (twin >= 0) return `Same day and time as date #${twin + 1}. Choose a different time.`;
    const taken = this.history().some((m) => m.status === 'Scheduled' && m.scheduledAt && m.id !== this.editingEmail?.id &&
      this.minuteOf(new Date(m.scheduledAt).getTime()) === minute);
    return taken ? 'Another email for this event is already scheduled at this day and time.' : '';
  }

  // The send-day placeholder only makes sense across several dates. A saved email being edited
  // keeps it, since it may be one day of an earlier multi-date schedule.
  get canUseScheduleDay(): boolean {
    return this.scheduleEnabled && (this.scheduleAt.length > 1 || !!this.editingEmail);
  }

  insertScheduleDay(): void {
    this.insertNode(document.createTextNode(SCHEDULE_DAY_TOKEN));
  }

  private parsePh(value: string): number | null {
    const time = value ? new Date(value + '+08:00').getTime() : NaN;
    return Number.isFinite(time) ? time : null;
  }

  private toPhInput(time: number): string {
    return new Date(time + PH_OFFSET_MS).toISOString().slice(0, 16);
  }

  private minuteOf(time: number | null): number | null {
    return time === null ? null : Math.floor(time / 60000);
  }

  // Unique addresses after @n-pax expansion; To wins over CC.
  get counts() {
    return expandRecipients(this.recipients.to, this.recipients.cc, this.contacts.map((c) => c.email));
  }

  // CC addresses dropped because they are already in To (they still get one copy, as To).
  get ccInTo(): number {
    const enteredCc = expandRecipients([], this.recipients.cc, this.contacts.map((c) => c.email)).cc.length;
    return enteredCc - this.counts.cc.length;
  }

  get directoryCount() {
    return expandRecipients([ALL_USERS], [], this.contacts.map((c) => c.email)).to.length;
  }

  // Saved addresses matching what is being typed; nothing is listed until the admin types.
  suggestions(field: RecipientField): string[] {
    const q = this.query[field].trim().toLowerCase();
    if (!q) return [];
    return this.savedAddresses()
      .filter((a) => a.includes(q) && !this.recipients[field].includes(a))
      .slice(0, MAX_SUGGESTIONS);
  }

  // ---- Saved addresses (per admin, in this browser) ----

  private savedKey(): string | null {
    const uid = this.auth.auth()?.userId;
    return uid ? `evt_saved_recipients_${uid}` : null;
  }

  private loadSaved(): string[] {
    const key = this.savedKey();
    if (!key) return [];
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
      return Array.isArray(parsed)
        ? parsed.map((v) => (typeof v === 'string' ? recipientAddress(v) : null)).filter((a): a is string => !!a && a !== ALL_USERS)
        : [];
    } catch {
      return [];
    }
  }

  private storeSaved(addresses: string[]): void {
    this.savedAddresses.set(addresses.slice(0, MAX_SAVED));
    const key = this.savedKey();
    if (!key) return;
    try {
      localStorage.setItem(key, JSON.stringify(this.savedAddresses()));
    } catch {
      /* storage may be unavailable (private mode) — suggestions still work for this session */
    }
  }

  // Most recently used first; @n-pax is a group, not an address, so it is never saved.
  private rememberAddresses(addresses: string[]): void {
    const used = addresses.filter((a) => a !== ALL_USERS);
    if (used.length) this.storeSaved([...new Set([...used, ...this.savedAddresses()])]);
  }

  forgetAddress(event: MouseEvent, address: string): void {
    // Keep the click from selecting the option underneath.
    event.stopPropagation();
    this.storeSaved(this.savedAddresses().filter((a) => a !== address));
  }

  label(address: string): string {
    if (address === ALL_USERS) return `@n-pax · All users (${this.directoryCount})`;
    const contact = this.contacts.find((c) => c.email.toLowerCase() === address);
    return contact ? `${contact.fullName} <${address}>` : address;
  }

  add(field: RecipientField, value: string): boolean {
    const addresses = value.split(/[\s,;]+/).filter(Boolean).map(recipientAddress);
    if (addresses.some((a) => !a)) {
      this.toast.error('Enter valid email addresses or choose @n-pax.');
      return false;
    }
    this.recipients[field] = [...new Set([...this.recipients[field], ...(addresses as string[])])];
    this.rememberAddresses(addresses as string[]);
    this.query[field] = '';
    return true;
  }

  remove(field: RecipientField, address: string): void {
    this.recipients[field] = this.recipients[field].filter((a) => a !== address);
  }

  // Enter, comma, semicolon or Tab turns the typed text into a chip.
  key(event: KeyboardEvent, field: RecipientField, trigger: MatAutocompleteTrigger): void {
    if (!['Enter', ',', ';', 'Tab'].includes(event.key) || !this.query[field].trim()) return;
    if (event.key === 'Enter' && trigger.panelOpen && trigger.activeOption) return;
    if (event.key !== 'Tab') event.preventDefault();
    if (this.add(field, this.query[field])) trigger.closePanel();
  }

  pasteRecipients(event: ClipboardEvent, field: RecipientField): void {
    const value = event.clipboardData?.getData('text/plain') ?? '';
    if (!/[\s,;]/.test(value.trim())) return;
    event.preventDefault();
    this.add(field, this.query[field] + value);
  }

  // ---- Email preview (summary panel) ----

  // Rebuild the preview from the editor node by node with the server's allowlist — elements are
  // created and text is copied as text, never parsed as HTML. Links are styled but inert.
  syncPreview(): void {
    const editor = this.editor.nativeElement;
    this.previewBody.nativeElement.replaceChildren(...Array.from(editor.childNodes, (n) => cleanNode(n)));
    this.hasMessage.set(!!editor.textContent?.trim() || !!editor.querySelector('img'));
    this.hasScheduleDay.set(SCHEDULE_DAY_PATTERN.test(editor.textContent ?? ''));
  }

  // Same link the server builds (App:FrontendBaseUrl is this app's own origin).
  get registerUrl(): string {
    return `${location.origin}/e/${encodeURIComponent(this.event.publicSlug)}`;
  }

  get sameDay(): boolean {
    return new Date(this.event.startsAt).toDateString() === new Date(this.event.endsAt).toDateString();
  }

  // Mirrors the "Where" line of the server's invitation card.
  get whereText(): string {
    if (this.event.format === 'Online') return 'Online meeting — the join link is sent once your registration is confirmed';
    if (this.event.format === 'Hybrid') return `${this.event.venue} · also online (join link sent once confirmed)`;
    return this.event.venue;
  }

  // ---- Message editor ----

  rememberSelection(): void {
    const selection = window.getSelection();
    const editor = this.editor.nativeElement;
    if (selection?.rangeCount && editor.contains(selection.anchorNode) && editor.contains(selection.focusNode))
      this.selection = selection.getRangeAt(0).cloneRange();
  }

  private restoreSelection(): void {
    const editor = this.editor.nativeElement;
    editor.focus();
    const selection = window.getSelection();
    if (!selection) return;
    const saved = this.selection && editor.contains(this.selection.commonAncestorContainer) ? this.selection : null;
    const range = saved ?? document.createRange();
    if (!saved) {
      range.selectNodeContents(editor);
      range.collapse(false);
    }
    selection.removeAllRanges();
    selection.addRange(range);
  }

  format(command: string): void {
    this.restoreSelection();
    document.execCommand(command);
    this.rememberSelection();
  }

  // Select text first to turn it into a link; otherwise the URL itself is inserted.
  insertLink(): void {
    let url: URL;
    try {
      url = new URL(this.linkUrl);
    } catch {
      this.toast.error('Enter a complete https:// or http:// link.');
      return;
    }
    if (!['https:', 'http:'].includes(url.protocol)) {
      this.toast.error('Use an https:// or http:// link.');
      return;
    }
    this.restoreSelection();
    if (window.getSelection()?.isCollapsed) {
      const link = document.createElement('a');
      link.href = url.href;
      link.textContent = url.href;
      this.insertNode(link);
    } else document.execCommand('createLink', false, url.href);
    this.linkOpen = false;
    this.linkUrl = '';
    this.rememberSelection();
  }

  private insertNode(...nodes: Node[]): void {
    this.restoreSelection();
    insertAtSelection(nodes);
    this.rememberSelection();
    this.syncPreview();
  }

  async imagePicked(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) await this.insertImage(file);
  }

  // Pasted text keeps its basic formatting and images; images are re-encoded like uploads.
  async pasteBody(event: ClipboardEvent): Promise<void> {
    event.preventDefault();
    if (this.processingImage()) return;
    this.rememberSelection();
    this.processingImage.set(true);
    try {
      const result = await readPaste(event.clipboardData, imageBudget(this.editor.nativeElement), (url) => firstValueFrom(this.api.pastedImage(url)).catch(() => undefined));
      if (result.nodes.length) this.insertNode(...result.nodes);
      if (result.skipped || result.overLimit) this.toast.warning(pasteMessage(result), 8000);
    } finally {
      this.processingImage.set(false);
    }
  }

  // Images are re-encoded as static PNGs (max 1600 px); the server sends them as CID parts.
  async insertImage(file: File): Promise<void> {
    if (this.processingImage()) return;
    if (!IMAGE_TYPES.includes(file.type)) {
      this.toast.error('Choose a PNG, JPEG, WebP, GIF or BMP image up to 10 MB.');
      return;
    }
    this.processingImage.set(true);
    try {
      const png = await toPng(file, imageBudget(this.editor.nativeElement));
      this.insertNode(newImage(png, file.name), document.createElement('br'));
    } catch (error) {
      this.toast.error(error instanceof Error ? error.message : 'Could not read this image.');
    } finally {
      this.processingImage.set(false);
    }
  }

  send(): void {
    if (this.sending() || this.processingImage()) return;
    for (const field of this.fields) if (this.query[field].trim() && !this.add(field, this.query[field])) return;
    if (!this.counts.to.length) {
      this.toast.error('Add at least one To recipient.');
      return;
    }
    if (!this.subject.trim() || this.subject.length > 200) {
      this.toast.error('Enter a subject up to 200 characters.');
      return;
    }
    if (this.hasScheduleDay() && !this.canUseScheduleDay) {
      this.toast.error(`${SCHEDULE_DAY_TOKEN} only works when scheduling on two or more dates. Remove it or add another date.`);
      return;
    }
    let schedules: (string | null)[] = [null];
    if (this.scheduleEnabled) {
      if (this.scheduleAt.some((v) => !v)) {
        this.toast.error('Choose a date and time in Philippine time (UTC+8) for every schedule, or remove the empty ones.');
        return;
      }
      const issue = this.scheduleAt.map((_, i) => this.scheduleIssue(i)).find(Boolean);
      if (issue) {
        this.toast.error(issue);
        return;
      }
      schedules = this.scheduleAt.map((v) => new Date(this.parsePh(v)!).toISOString());
    }
    // XHTML: the server parses it without DTDs and rebuilds an allowlist of safe formatting.
    const bodyHtml = new XMLSerializer().serializeToString(this.editor.nativeElement);
    const base = { to: [...this.recipients.to], cc: [...this.recipients.cc], subject: this.subject.trim(), bodyHtml };
    // When editing, the first date updates the saved email; every other date adds a new one.
    const editing = this.editingEmail;
    const results: InvitationMessageResult[] = [];
    this.setSending(true);
    from(schedules)
      .pipe(
        concatMap((scheduledAt, i) => {
          const request: InvitationMessageRequest = { ...base, scheduledAt };
          return i === 0 && editing
            ? this.api.updateInvitationEmail(this.event.id, editing.id, { ...request, version: editing.version })
            : this.api.sendInvitationMessage(this.event.id, request);
        }),
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.setSending(false)),
      )
      .subscribe({
        next: (result) => {
          results.push(result);
          if (results.length < schedules.length) return;
          const problem = results.find((r) => r.queued || r.status === 'Failed');
          this.rememberAddresses([...base.to, ...base.cc]);
          if (problem) this.toast.warning(problem.message, 8000);
          else if (results.length > 1) this.toast.success(`Invitation scheduled on ${results.length} dates for ${result.recipientCount} recipient(s).`);
          else this.toast.success(result.message);
          this.resetDraft();
          this.openedEmail.set(null);
          this.loadHistory();
          this.sent.emit();
        },
        error: (error) => {
          const message = invitationErrorMessage(error);
          // The draft is kept so it can be retried, minus the dates already saved.
          if (!results.length) {
            this.toast.error(message, 10000);
            return;
          }
          this.scheduleAt = this.scheduleAt.slice(results.length);
          this.editingEmail = null;
          this.openedEmail.set(null);
          this.loadHistory();
          this.toast.error(`${results.length} of ${schedules.length} dates were scheduled; the rest were not. ${message}`, 10000);
        },
      });
  }

  private setSending(on: boolean): void {
    this.sending.set(on);
    this.sendingChange.emit(on);
  }
}
