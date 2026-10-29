import { Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

export interface ScreenDisplayData {
  src: string; // event banner (data URL or http(s) URL)
  eventTitle: string;
}

/** Scanner "Screen Display": the event banner, large, in a framed card with its own close button. */
@Component({
  selector: 'app-screen-display-dialog',
  imports: [MatDialogModule, MatButtonModule, MatIconModule],
  template: `
    <div class="sd-head">
      <mat-icon class="sd-icon">fit_screen</mat-icon>
      <div class="sd-titles">
        <h2 class="sd-title">Screen Display</h2>
        @if (data.eventTitle) { <p class="sd-caption">{{ data.eventTitle }}</p> }
      </div>
      <button mat-icon-button class="sd-close" (click)="ref.close()" aria-label="Close screen display">
        <mat-icon>close</mat-icon>
      </button>
    </div>
    <div class="sd-stage">
      <img [src]="data.src" [alt]="data.eventTitle + ' banner'" />
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        padding: 14px 16px 16px;
      }
      .sd-head {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 12px;
      }
      .sd-icon {
        flex: none;
        width: 36px;
        height: 36px;
        padding: 7px;
        box-sizing: border-box;
        border-radius: 11px;
        font-size: 22px;
        line-height: 22px;
        background: #ecf8f4;
        color: #0d9488;
      }
      .sd-titles {
        flex: 1;
        min-width: 0;
      }
      .sd-title {
        margin: 0;
        font-size: 17px;
        font-weight: 800;
        color: #0f172a;
      }
      .sd-caption {
        margin: 1px 0 0;
        font-size: 13px;
        color: #475569;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .sd-close {
        flex: none;
        background: #f1f5f9;
      }
      /* The banner fills a brand-backed stage at its own proportions — wide banners span the
         width, square/portrait ones centre with brand gutters; never cropped or stretched. */
      .sd-stage {
        display: flex;
        align-items: center;
        justify-content: center;
        height: min(72vh, 680px);
        border-radius: 14px;
        overflow: hidden;
        background: var(--brand-grad);
      }
      .sd-stage img {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: contain;
      }
      @media (max-width: 600px) {
        :host {
          padding: 10px 10px 12px;
        }
        .sd-stage {
          height: 60vh;
        }
      }
    `,
  ],
})
export class ScreenDisplayDialogComponent {
  readonly ref = inject(MatDialogRef<ScreenDisplayDialogComponent>);
  readonly data = inject<ScreenDisplayData>(MAT_DIALOG_DATA);
}

/** Opens the Screen Display for the given banner (no-op when the event has none). */
export function openScreenDisplay(dialog: MatDialog, src: string | null, eventTitle: string): void {
  if (!src) return;
  dialog.open(ScreenDisplayDialogComponent, {
    data: { src, eventTitle },
    width: '1100px',
    maxWidth: '94vw',
    autoFocus: false,
  });
}
