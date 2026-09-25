import { Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

export interface ImageViewerData {
  src: string; // data URL or http(s) URL
  title: string; // e.g. the field label
  caption?: string | null; // e.g. the attendee's name
}

/** Simple lightbox: shows an uploaded image at full size with a download option. */
@Component({
  selector: 'app-image-viewer-dialog',
  imports: [MatDialogModule, MatButtonModule, MatIconModule],
  template: `
    <div class="iv-head">
      <div class="iv-titles">
        <h2 mat-dialog-title>{{ data.title }}</h2>
        @if (data.caption) { <p class="iv-caption">{{ data.caption }}</p> }
      </div>
      <button mat-icon-button (click)="ref.close()" aria-label="Close">
        <mat-icon>close</mat-icon>
      </button>
    </div>
    <mat-dialog-content class="iv-body">
      <img [src]="data.src" [alt]="data.title" />
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-stroked-button (click)="download()">
        <mat-icon>download</mat-icon> Download
      </button>
      <button mat-flat-button color="primary" (click)="ref.close()">Close</button>
    </mat-dialog-actions>
  `,
  styles: [
    `
      .iv-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 8px;
        padding: 8px 8px 0 24px;
      }
      .iv-titles h2 { margin: 0; }
      .iv-caption { margin: 2px 0 0; font-size: 13px; color: var(--mat-sys-on-surface-variant); }
      .iv-body {
        display: flex;
        justify-content: center;
        max-height: 72vh;
      }
      .iv-body img {
        max-width: 100%;
        max-height: 70vh;
        object-fit: contain;
        border-radius: 8px;
      }
    `,
  ],
})
export class ImageViewerDialogComponent {
  readonly ref = inject(MatDialogRef<ImageViewerDialogComponent>);
  readonly data = inject<ImageViewerData>(MAT_DIALOG_DATA);

  download(): void {
    const a = document.createElement('a');
    a.href = this.data.src;
    const safe = this.data.title.replace(/[^\w.-]+/g, '_').slice(0, 60) || 'image';
    a.download = `${safe}.jpg`;
    a.click();
  }
}
