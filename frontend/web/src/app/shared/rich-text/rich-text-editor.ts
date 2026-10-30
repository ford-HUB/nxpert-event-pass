import { Component, ElementRef, EventEmitter, Input, OnChanges, Output, ViewChild, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import { IMAGE_TYPES, imageBudget, insertAtSelection, newImage, pasteMessage, readPaste, richNodes, toPng } from './rich-text';

/**
 * Message editor with a formatting toolbar and inline images. The value is the editor's HTML;
 * pasted content keeps its basic formatting and images (re-encoded as PNG).
 */
@Component({
  selector: 'app-rich-text-editor',
  imports: [FormsModule, MatButtonModule, MatIconModule, MatTooltipModule],
  templateUrl: './rich-text-editor.html',
  styleUrl: './rich-text-editor.scss',
})
export class RichTextEditorComponent implements OnChanges {
  @Input() value = '';
  @Output() valueChange = new EventEmitter<string>();
  @Input() placeholder = 'Write your message here.';
  @Input() label = 'Message';
  // Limit on the text (images excluded); 0 = no counter.
  @Input() maxLength = 0;
  @Input() invalid = false;
  @ViewChild('editor', { static: true }) editor!: ElementRef<HTMLDivElement>;

  private toast = inject(ToastService);
  private api = inject(ApiService);

  processing = signal(false);
  textLength = signal(0);
  linkOpen = false;
  linkUrl = '';
  private selection: Range | null = null;
  // Last HTML emitted, so our own updates don't rebuild the editor and move the caret.
  private emitted: string | null = null;

  ngOnChanges(): void {
    if (this.value === this.emitted) return;
    this.editor.nativeElement.replaceChildren(...richNodes(this.value));
    this.emitted = this.value;
    this.selection = null;
    this.textLength.set(this.editor.nativeElement.textContent?.length ?? 0);
  }

  changed(): void {
    const editor = this.editor.nativeElement;
    this.textLength.set(editor.textContent?.length ?? 0);
    this.emitted = editor.innerHTML;
    this.valueChange.emit(this.emitted);
  }

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
    this.changed();
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
      this.insert([link]);
    } else {
      document.execCommand('createLink', false, url.href);
      this.changed();
    }
    this.linkOpen = false;
    this.linkUrl = '';
    this.rememberSelection();
  }

  private insert(nodes: Node[]): void {
    this.restoreSelection();
    insertAtSelection(nodes);
    this.rememberSelection();
    this.changed();
  }

  async imagePicked(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || this.processing()) return;
    if (!IMAGE_TYPES.includes(file.type)) {
      this.toast.error('Choose a PNG, JPEG, WebP, GIF or BMP image up to 10 MB.');
      return;
    }
    this.processing.set(true);
    try {
      const png = await toPng(file, imageBudget(this.editor.nativeElement));
      this.insert([newImage(png, file.name), document.createElement('br')]);
    } catch (error) {
      this.toast.error(error instanceof Error ? error.message : 'Could not read this image.');
    } finally {
      this.processing.set(false);
    }
  }

  async paste(event: ClipboardEvent): Promise<void> {
    event.preventDefault();
    if (this.processing()) return;
    this.rememberSelection();
    this.processing.set(true);
    try {
      const result = await readPaste(event.clipboardData, imageBudget(this.editor.nativeElement), (url) => firstValueFrom(this.api.pastedImage(url)).catch(() => undefined));
      if (result.nodes.length) this.insert(result.nodes);
      if (result.skipped || result.overLimit) this.toast.warning(pasteMessage(result), 8000);
    } finally {
      this.processing.set(false);
    }
  }
}
