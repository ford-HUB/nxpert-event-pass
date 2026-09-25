import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-verify',
  imports: [RouterLink, MatCardModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule],
  templateUrl: './verify.html',
})
export class VerifyComponent implements OnInit {
  private auth = inject(AuthService);
  private route = inject(ActivatedRoute);

  loading = signal(true);
  success = signal(false);
  message = signal('');

  ngOnInit(): void {
    const token = this.route.snapshot.paramMap.get('token') ?? '';
    this.auth.verifyEmail(token).subscribe({
      next: (res) => {
        this.success.set(res.success);
        this.message.set(res.message);
        this.loading.set(false);
      },
      error: () => {
        this.success.set(false);
        this.message.set('Verification failed. The link may be invalid or expired.');
        this.loading.set(false);
      },
    });
  }

  get homeLink(): string {
    return this.auth.isLoggedIn() ? (this.auth.isAdmin() ? '/admin/dashboard' : '/my-events') : '/login';
  }
}
