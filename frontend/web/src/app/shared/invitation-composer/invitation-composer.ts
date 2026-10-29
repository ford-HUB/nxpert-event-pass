import { Component, ElementRef, EventEmitter, Input, OnChanges, Output, ViewChild, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatAutocompleteModule, MatAutocompleteTrigger } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { finalize } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { ContactDto, EventDto } from '../../core/models';
import { ToastService } from '../../core/toast.service';
import { ALL_USERS, expandRecipients, invitationErrorMessage, recipientAddress } from '../../core/invitation.util';

type RecipientField = 'to' | 'cc';

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp'];
const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_EDGE = 1600;
const MAX_IMAGES = 5;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 5 * 1024 * 1024;

// Formatting the server keeps (InvitationMessageBuilder.RenderBody) — the preview mirrors it.
const PREVIEW_TAGS = new Set(['p', 'div', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'ul', 'ol', 'li', 'blockquote', 'span', 'h1', 'h2', 'h3', 'a']);
const PREVIEW_STYLES: Record<string, RegExp> = {
  'text-align': /^(left|center|right)$/,
  'font-weight': /^(bold|400|600|700)$/,
  'font-style': /^(italic|normal)$/,
  'text-decoration': /^(underline|line-through)$/,
  color: /^#[0-9a-f]{3}([0-9a-f]{3})?$/,
};

/**
 * Event invitation email, Gmail / Outlook style: To and CC chips (system users, typed addresses
 * or the @n-pax group = every system user), a formatted message with inline images, and the
 * event's details + calendar invitation appended by the server.
 */
@Component({
  selector: 'app-invitation-composer',
  imports: [
    DatePipe,
    FormsModule,
    MatAutocompleteModule,
    MatButtonModule,
    MatChipsModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatTooltipModule,
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

  private api = inject(ApiService);
  private toast = inject(ToastService);

  readonly allUsers = ALL_USERS;
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

  ngOnChanges(): void {
    if (!this.subject && this.event) this.subject = `You're invited: ${this.event.title}`.slice(0, 200);
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

  suggestions(field: RecipientField): ContactDto[] {
    const q = this.query[field].trim().toLowerCase();
    return this.contacts
      .filter(
        (c) =>
          recipientAddress(c.email) &&
          !this.recipients[field].includes(c.email.toLowerCase()) &&
          `${c.fullName} ${c.email} ${c.organization ?? ''}`.toLowerCase().includes(q),
      )
      .slice(0, 15);
  }

  showGroup(field: RecipientField): boolean {
    const q = this.query[field].trim().toLowerCase();
    return (
      !this.recipients[field].includes(ALL_USERS) &&
      this.directoryCount > 0 &&
      (!q || ALL_USERS.includes(q) || 'all system users'.includes(q))
    );
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
    this.previewBody.nativeElement.replaceChildren(...Array.from(editor.childNodes, (n) => this.mirror(n, 0)));
    this.hasMessage.set(!!editor.textContent?.trim() || !!editor.querySelector('img'));
  }

  private mirror(node: Node, depth: number): Node {
    if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent ?? '');
    const fragment = document.createDocumentFragment();
    if (!(node instanceof HTMLElement) || depth > 30) return fragment;
    const tag = node.tagName.toLowerCase();
    if (tag === 'img') {
      const src = (node as HTMLImageElement).src;
      if (!src.startsWith('data:image/png;base64,')) return fragment;
      const img = document.createElement('img');
      img.src = src;
      img.alt = (node as HTMLImageElement).alt || 'Invitation image';
      return img;
    }
    const children = Array.from(node.childNodes, (n) => this.mirror(n, depth + 1));
    if (!PREVIEW_TAGS.has(tag)) {
      fragment.append(...children);
      return fragment;
    }
    const el = document.createElement(tag);
    for (const [prop, ok] of Object.entries(PREVIEW_STYLES)) {
      const value = node.style.getPropertyValue(prop).trim().toLowerCase();
      if (value && ok.test(value)) el.style.setProperty(prop, value);
    }
    el.append(...children);
    return el;
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

  private insertNode(node: Node): void {
    this.restoreSelection();
    const selection = window.getSelection()!;
    const range = selection.getRangeAt(0);
    range.deleteContents();
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    this.rememberSelection();
    this.syncPreview();
  }

  async imagePicked(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) await this.insertImage(file);
  }

  async pasteBody(event: ClipboardEvent): Promise<void> {
    event.preventDefault();
    this.rememberSelection();
    const image = Array.from(event.clipboardData?.files ?? []).find((f) => f.type.startsWith('image/'));
    if (image) {
      await this.insertImage(image);
      return;
    }
    // Plain text only: no scripts, remote tracking images or client-specific markup.
    const text = event.clipboardData?.getData('text/plain') ?? '';
    this.restoreSelection();
    document.execCommand('insertText', false, text);
    this.rememberSelection();
  }

  // Images are re-encoded as static PNGs (max 1600 px); the server sends them as CID parts.
  async insertImage(file: File): Promise<void> {
    if (this.processingImage()) return;
    if (!IMAGE_TYPES.includes(file.type) || file.size > MAX_SOURCE_BYTES) {
      this.toast.error('Choose a PNG, JPEG, WebP, GIF or BMP image up to 10 MB.');
      return;
    }
    this.processingImage.set(true);
    const objectUrl = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = objectUrl;
      await image.decode();
      const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
      const png = canvas.toDataURL('image/png');
      const existing = Array.from(this.editor.nativeElement.querySelectorAll('img'));
      const size = (data: string) => Math.ceil(((data.split(',')[1]?.length ?? 0) * 3) / 4);
      const total = existing.reduce((sum, i) => sum + size(i.src), size(png));
      if (existing.length >= MAX_IMAGES || size(png) > MAX_IMAGE_BYTES || total > MAX_TOTAL_IMAGE_BYTES)
        throw new Error('Use up to five images, at most 2 MB each and 5 MB in total after resizing.');
      const node = document.createElement('img');
      node.src = png;
      node.alt = file.name;
      node.style.maxWidth = '100%';
      node.style.height = 'auto';
      node.style.display = 'block';
      this.insertNode(node);
      this.insertNode(document.createElement('br'));
    } catch (error) {
      this.toast.error(error instanceof Error ? error.message : 'Could not read this image.');
    } finally {
      URL.revokeObjectURL(objectUrl);
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
    // XHTML: the server parses it without DTDs and rebuilds an allowlist of safe formatting.
    const bodyHtml = new XMLSerializer().serializeToString(this.editor.nativeElement);
    this.setSending(true);
    this.api
      .sendInvitationMessage(this.event.id, {
        to: [...this.recipients.to],
        cc: [...this.recipients.cc],
        subject: this.subject.trim(),
        bodyHtml,
      })
      .pipe(finalize(() => this.setSending(false)))
      .subscribe({
        next: (result) => {
          if (result.queued) this.toast.warning(result.message, 8000);
          else this.toast.success(result.message);
          this.recipients = { to: [], cc: [] };
          this.editor.nativeElement.replaceChildren();
          this.selection = null;
          this.syncPreview();
          this.sent.emit();
        },
        // The draft is kept so it can be retried.
        error: (error) => this.toast.error(invitationErrorMessage(error), 10000),
      });
  }

  private setSending(on: boolean): void {
    this.sending.set(on);
    this.sendingChange.emit(on);
  }
}
