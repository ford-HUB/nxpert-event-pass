import { Component, ViewChild, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import { FormFieldDef } from '../../core/models';
import { DynamicFieldsComponent } from '../../shared/dynamic-fields/dynamic-fields';

@Component({
  selector: 'app-responses-dialog',
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    DynamicFieldsComponent,
  ],
  templateUrl: './responses-dialog.html',
})
export class ResponsesDialogComponent {
  private api = inject(ApiService);
  private ref = inject(MatDialogRef<ResponsesDialogComponent>);
  private toast = inject(ToastService);
  private data = inject<{ registrationId: number; eventTitle: string }>(MAT_DIALOG_DATA);

  @ViewChild('dyn') dyn?: DynamicFieldsComponent;

  eventTitle = this.data.eventTitle;
  sessionTitle = signal<string | null>(null);
  fields = signal<FormFieldDef[]>([]);
  initial = signal<Record<string, string>>({});
  loading = signal(true);
  saving = signal(false);

  constructor() {
    this.api.getRegistrationForm(this.data.registrationId).subscribe({
      next: (f) => {
        this.eventTitle = f.eventTitle;
        this.sessionTitle.set(f.sessionTitle);
        this.initial.set(f.responses ?? {});
        this.fields.set(f.formFields ?? []);
        this.loading.set(false);
      },
      error: () => {
        this.toast.error('Could not load the registration form.');
        this.loading.set(false);
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
    this.api.updateRegistrationResponses(this.data.registrationId, this.dyn.collect()).subscribe({
      next: () => {
        this.saving.set(false);
        this.toast.success('Your responses were updated.');
        this.ref.close(true);
      },
      error: (err) => {
        this.saving.set(false);
        this.toast.error(err?.error?.message ?? 'Could not save your responses.');
      },
    });
  }

  close(): void {
    this.ref.close();
  }
}
