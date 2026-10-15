import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { ConfirmDialogComponent, ConfirmOptions } from '../shared/alert/confirm-dialog';

/** In-app replacement for window.confirm(), styled like the toasts. Resolves true on confirm. */
@Injectable({ providedIn: 'root' })
export class ConfirmService {
  private dialog = inject(MatDialog);

  async confirm(options: ConfirmOptions): Promise<boolean> {
    const ref = this.dialog.open(ConfirmDialogComponent, {
      data: options,
      width: '420px',
      maxWidth: '92vw',
      panelClass: 'app-confirm-panel',
      // Focus lands on Cancel, so a stray Enter never confirms a destructive action.
      autoFocus: 'first-tabbable',
      restoreFocus: true,
    });
    return (await firstValueFrom(ref.afterClosed())) === true;
  }
}
