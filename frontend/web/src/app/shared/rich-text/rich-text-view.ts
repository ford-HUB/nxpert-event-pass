import { Component, ElementRef, Input, OnChanges, inject } from '@angular/core';
import { richNodes } from './rich-text';

/** Read-only display of message HTML, rebuilt from the allowlist (links are styled but inert). */
@Component({
  selector: 'app-rich-text-view',
  template: '',
  host: { '(click)': '$event.preventDefault()' },
  styles: `
    :host { display: block; overflow-wrap: anywhere; }
    :host ::ng-deep {
      p, h1, h2, h3, blockquote, ul, ol { margin: 0 0 6px; }
      h1 { font-size: 1.25em; }
      h2 { font-size: 1.12em; }
      h3 { font-size: 1em; }
      ul, ol { padding-left: 20px; }
      blockquote { padding-left: 10px; border-left: 3px solid #e2e8f0; color: #475569; }
      a { color: #0f766e; text-decoration: underline; }
      img { max-width: min(100%, 480px); margin: 6px 0; border-radius: 6px; }
    }
  `,
})
export class RichTextViewComponent implements OnChanges {
  @Input() html: string | null | undefined = '';

  private host = inject<ElementRef<HTMLElement>>(ElementRef);

  ngOnChanges(): void {
    this.host.nativeElement.replaceChildren(...richNodes(this.html));
  }
}
