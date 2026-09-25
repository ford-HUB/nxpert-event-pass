import { Component, OnInit, ViewChild, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import { PublicRegistrationForm } from '../../core/models';
import { DynamicFieldsComponent } from '../../shared/dynamic-fields/dynamic-fields';

/**
 * Public, account-free page to review/update a registration's custom-form response, reached by a
 * magic link (`/r/:token`) that's shown on the success screen and included in the pass email/Viber.
 * Editing is open until the registrant checks in or the event ends (enforced server-side).
 */
@Component({
  selector: 'app-registration-edit',
  imports: [
    RouterLink,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    DynamicFieldsComponent,
  ],
  templateUrl: './registration-edit.html',
})
export class RegistrationEditComponent implements OnInit {
  private api = inject(ApiService);
  private route = inject(ActivatedRoute);
  private toast = inject(ToastService);

  @ViewChild('dyn') private dyn?: DynamicFieldsComponent;

  private token = '';
  loading = signal(true);
  notFound = signal(false);
  form = signal<PublicRegistrationForm | null>(null);
  saving = signal(false);
  saved = signal(false);

  ngOnInit(): void {
    this.token = this.route.snapshot.paramMap.get('token') ?? '';
    this.api.getPublicRegistration(this.token).subscribe({
      next: (f) => {
        this.form.set(f);
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        if (err?.status === 404) this.notFound.set(true);
        else this.toast.error('Could not load your registration.');
      },
    });
  }

  save(): void {
    if (!this.dyn) return;
    if (!this.dyn.isValid()) {
      this.toast.warning('Please answer all required questions.');
      return;
    }
    this.saving.set(true);
    this.api.updatePublicResponses(this.token, this.dyn.collect()).subscribe({
      next: () => {
        this.saving.set(false);
        this.saved.set(true);
        this.toast.success('Your response was updated.');
      },
      error: (err) => {
        this.saving.set(false);
        this.toast.error(err?.error?.message ?? 'Could not save your response.');
      },
    });
  }
}
