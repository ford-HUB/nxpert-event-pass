import { Component, ElementRef, OnDestroy, OnInit, ViewChild, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { Html5Qrcode } from 'html5-qrcode';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { MealStubScanResult } from '../../core/models';
import { BeepService } from '../../core/beep.service';

type Input = 'camera' | 'barcode';
type Banner = 'idle' | 'valid' | 'already' | 'invalid' | 'notvalid' | 'error';

// A standalone meal-stub scanner for merchant accounts. Redeems by the stub's control number
// (QR payload "MEAL:{guid}"), so it needs no event context.
@Component({
  selector: 'app-meal-scanner',
  imports: [
    DecimalPipe,
    FormsModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatIconModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  templateUrl: './meal-scanner.html',
  styleUrl: './meal-scanner.scss',
})
export class MealScannerComponent implements OnInit, OnDestroy {
  private api = inject(ApiService);
  protected auth = inject(AuthService);
  protected beeper = inject(BeepService);
  private scanner: Html5Qrcode | null = null;
  private readonly regionId = 'meal-qr-reader';

  input = signal<Input>('camera');
  barcodeValue = '';
  @ViewChild('barcodeInput') private barcodeInput?: ElementRef<HTMLInputElement>;

  scanning = signal(false);
  cameraError = signal<string | null>(null);
  banner = signal<Banner>('idle');
  resultName = signal<string | null>(null);
  resultLabel = signal<string | null>(null);
  resultValue = signal<number | null>(null);
  resultColor = signal<string | null>(null);
  resultMessage = signal<string | null>(null);
  // All-time tally for this merchant, seeded from the server on load so it survives logout/login.
  redeemedCount = signal(0);
  redeemedValue = signal(0);

  private busy = false;
  private lastCode = '';
  private resumeTimer: ReturnType<typeof setTimeout> | null = null;

  ngOnInit(): void {
    this.loadTally();
    this.beeper.warmUp();
    this.start();
  }

  // Seed the running total from the server (all stubs this merchant has ever redeemed), so the
  // count reflects prior sessions — not just what was scanned since this login.
  private loadTally(): void {
    this.api.mealScanTally().subscribe({
      next: (t) => {
        this.redeemedCount.set(t.count);
        this.redeemedValue.set(t.value);
      },
      error: () => {},
    });
  }
  ngOnDestroy(): void {
    this.stop();
  }

  async setInput(m: Input): Promise<void> {
    if (m === this.input()) return;
    await this.stop();
    this.input.set(m);
    this.barcodeValue = '';
    this.banner.set('idle');
    if (m === 'camera') setTimeout(() => this.start(), 0);
    else this.focusBarcode();
  }

  async start(): Promise<void> {
    if (this.input() !== 'camera') return;
    this.cameraError.set(null);
    try {
      this.scanner = new Html5Qrcode(this.regionId, { verbose: false });
      await this.scanner.start(
        { facingMode: 'environment' },
        {
          fps: 30,
          videoConstraints: { facingMode: 'environment', frameRate: { ideal: 30 } },
          qrbox: (vw: number, vh: number) => {
            const s = Math.max(120, Math.floor(Math.min(vw, vh) * 0.8));
            return { width: s, height: s };
          },
        },
        (decoded) => this.onScan(decoded),
        () => {},
      );
      this.scanning.set(true);
    } catch {
      this.cameraError.set('Could not open the camera. Grant permission and use HTTPS (or localhost).');
    }
  }

  async stop(): Promise<void> {
    if (this.resumeTimer) clearTimeout(this.resumeTimer);
    if (this.scanner) {
      try {
        if (this.scanner.isScanning) await this.scanner.stop();
        this.scanner.clear();
      } catch {
        /* ignore */
      }
      this.scanner = null;
    }
    this.scanning.set(false);
  }

  submitBarcode(): void {
    const v = this.barcodeValue.trim();
    this.barcodeValue = '';
    if (v) {
      this.beeper.beep(); // code read
      this.redeem(v);
    }
    this.focusBarcode();
  }
  onBarcodeBlur(): void {
    if (this.input() === 'barcode') this.focusBarcode();
  }
  private focusBarcode(): void {
    setTimeout(() => this.barcodeInput?.nativeElement?.focus(), 60);
  }

  private onScan(decoded: string): void {
    if (this.busy || decoded === this.lastCode) return;
    this.busy = true;
    this.lastCode = decoded;
    this.beeper.beep(); // QR read
    this.redeem(decoded);
  }

  private async redeem(code: string): Promise<void> {
    try {
      const res = await firstValueFrom(this.api.redeemMealStub(code));
      this.show(res);
    } catch {
      this.banner.set('error');
      this.resultName.set('Request failed');
      this.resultLabel.set(null);
      this.resultMessage.set('Could not reach the server.');
      this.resume();
    }
  }

  private show(res: MealStubScanResult): void {
    const map: Record<string, Banner> = { valid: 'valid', already: 'already', invalid: 'invalid', notvalid: 'notvalid' };
    this.banner.set(map[res.status] ?? 'error');
    this.resultName.set(res.fullName ?? (res.status === 'invalid' ? 'Not a meal stub' : null));
    this.resultLabel.set(res.label);
    this.resultValue.set(res.value || null);
    this.resultColor.set(res.color);
    this.resultMessage.set(res.message);
    if (res.status === 'valid') {
      this.redeemedCount.update((c) => c + 1);
      this.redeemedValue.update((v) => v + (res.value || 0));
    }
    this.resume();
  }

  private resume(): void {
    if (this.resumeTimer) clearTimeout(this.resumeTimer);
    this.resumeTimer = setTimeout(() => {
      this.banner.set('idle');
      this.busy = false;
      this.lastCode = '';
    }, 2600);
  }
}
