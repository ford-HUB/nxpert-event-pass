import { Component, computed, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterOutlet, RouterLink, RouterLinkActive, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatBadgeModule } from '@angular/material/badge';
import { AuthService } from './core/auth.service';
import { ToastService } from './core/toast.service';
import { RealtimeService } from './core/realtime.service';
import { PwaInstallService } from './core/pwa-install.service';
import { AppNotification } from './core/models';

@Component({
  selector: 'app-root',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    DatePipe,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatBadgeModule,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly auth = inject(AuthService);
  protected readonly rt = inject(RealtimeService);
  protected readonly pwa = inject(PwaInstallService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  // "Vien Dexter" -> "VD" for the header avatar.
  protected readonly initials = computed(() => {
    const first = this.auth.firstName() || this.auth.fullName();
    const last = this.auth.lastName();
    return ((first[0] ?? '') + (last[0] ?? '')).toUpperCase() || '?';
  });

  // "SuperAdmin" -> "Super Admin"
  protected readonly roleLabel = computed(() =>
    (this.auth.role() ?? '').replace(/([a-z])([A-Z])/g, '$1 $2'),
  );

  // Open a notification: mark it read and follow its link.
  openNotif(n: AppNotification): void {
    this.rt.markRead(n.id);
    if (n.link) this.router.navigateByUrl(n.link);
  }

  logout(): void {
    this.auth.logout();
    this.router.navigate(['/login']);
  }

  resendVerification(): void {
    this.auth.resendVerification().subscribe({
      next: (r) => this.toast.success(r.message),
      error: () => this.toast.error('Could not send verification email.'),
    });
  }
}
