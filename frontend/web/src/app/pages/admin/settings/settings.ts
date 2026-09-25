import { Component, OnInit, inject, signal } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatChipsModule, MatChipInputEvent } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { ApiService } from '../../../core/api.service';
import { ToastService } from '../../../core/toast.service';
import { MobileProvider } from '../../../core/models';

@Component({
  selector: 'app-settings',
  imports: [
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatChipsModule,
    MatIconModule,
    MatButtonModule,
    MatProgressBarModule,
    MatButtonToggleModule,
  ],
  templateUrl: './settings.html',
  styles: [
    `
      .settings-body { max-width: 640px; }
      .settings-card { overflow: hidden; }
      .section-sub { margin: 4px 0 16px; font-size: 13px; }
      .full-width { width: 100%; }
      .mobile-head { margin-top: 24px; }
      .mobile-note { margin-top: 12px; margin-bottom: 0; }
    `,
  ],
})
export class SettingsComponent implements OnInit {
  private api = inject(ApiService);
  private toast = inject(ToastService);

  loading = signal(true);
  saving = signal(false);
  ccEmails = signal<string[]>([]);
  inputError = signal<string | null>(null);
  // Which transport delivers phone notifications (entry pass, kit-claim, edit link).
  mobileProvider = signal<MobileProvider>('Viber');

  private static readonly EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  ngOnInit(): void {
    this.api.getSettings().subscribe({
      next: (s) => {
        this.ccEmails.set(s.ccEmails ?? []);
        this.mobileProvider.set(s.mobileProvider ?? 'Viber');
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  // Add one or more addresses (the chip input may deliver a comma/space separated paste).
  add(event: MatChipInputEvent): void {
    const parts = (event.value ?? '').split(/[,;\s]+/).map((p) => p.trim()).filter(Boolean);
    let added = false;
    for (const p of parts) {
      if (!SettingsComponent.EMAIL_RE.test(p)) {
        this.inputError.set(`"${p}" is not a valid email address.`);
        continue;
      }
      if (this.ccEmails().some((e) => e.toLowerCase() === p.toLowerCase())) continue;
      this.ccEmails.update((list) => [...list, p]);
      added = true;
    }
    if (added) this.inputError.set(null);
    event.chipInput?.clear();
  }

  remove(email: string): void {
    this.ccEmails.update((list) => list.filter((e) => e !== email));
  }

  save(): void {
    this.saving.set(true);
    this.api.updateSettings(this.ccEmails(), this.mobileProvider()).subscribe({
      next: (s) => {
        this.ccEmails.set(s.ccEmails ?? []);
        this.mobileProvider.set(s.mobileProvider ?? 'Viber');
        this.saving.set(false);
        this.toast.success('Settings saved.');
      },
      error: (err) => {
        this.saving.set(false);
        this.toast.error(err?.error?.message ?? 'Could not save settings.');
      },
    });
  }
}
