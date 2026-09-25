import { Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

/** Full-screen viewer for a single image (data URL or URL). Click anywhere to close. */
@Component({
  selector: 'app-image-lightbox',
  imports: [MatButtonModule, MatIconModule],
  template: `
    <div class="lb" (click)="ref.close()">
      <button mat-icon-button class="lb-close" (click)="ref.close()" aria-label="Close">
        <mat-icon>close</mat-icon>
      </button>
      <img [src]="data" alt="Full-size image" (click)="$event.stopPropagation()" />
    </div>
  `,
  styles: [
    `
      .lb {
        position: fixed;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 4vmin;
      }
      .lb img {
        max-width: 96vw;
        max-height: 92vh;
        object-fit: contain;
        border-radius: 8px;
        box-shadow: 0 10px 50px rgba(0, 0, 0, 0.55);
      }
      .lb-close {
        position: fixed;
        top: 14px;
        right: 14px;
        color: #fff;
        background: rgba(0, 0, 0, 0.45);
      }
    `,
  ],
})
export class ImageLightboxComponent {
  readonly data = inject<string>(MAT_DIALOG_DATA);
  readonly ref = inject(MatDialogRef<ImageLightboxComponent>);
}

/** Opens the lightbox for the given image. */
export function openImageLightbox(dialog: MatDialog, src: string | null | undefined): void {
  if (!src) return;
  dialog.open(ImageLightboxComponent, {
    data: src,
    panelClass: 'lightbox-panel',
    maxWidth: '100vw',
    maxHeight: '100vh',
    autoFocus: false,
  });
}
