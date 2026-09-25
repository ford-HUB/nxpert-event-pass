import { Component, Inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RegistrationDto } from '../../core/models';
import { downloadPass, fileSlug, passQrDataUrl } from '../../core/qr.util';

@Component({
  selector: 'app-pass-dialog',
  imports: [DatePipe, MatDialogModule, MatButtonModule, MatIconModule],
  templateUrl: './pass-dialog.html',
})
export class PassDialogComponent implements OnInit {
  qrDataUrl = signal<string | null>(null);

  constructor(@Inject(MAT_DIALOG_DATA) public reg: RegistrationDto) {}

  async ngOnInit(): Promise<void> {
    this.qrDataUrl.set(await passQrDataUrl(this.reg.token));
  }

  download(): void {
    downloadPass(this.reg.token, fileSlug(this.reg.eventTitle));
  }
}
