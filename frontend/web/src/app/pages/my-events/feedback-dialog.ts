import { Component, Inject, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';

export interface FeedbackDialogData {
  eventId: number;
  eventTitle: string;
}

@Component({
  selector: 'app-feedback-dialog',
  imports: [
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  templateUrl: './feedback-dialog.html',
})
export class FeedbackDialogComponent implements OnInit {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  private ref = inject(MatDialogRef<FeedbackDialogComponent>);

  rating = signal(0);
  hover = signal(0);
  comment = '';
  saving = signal(false);
  readonly stars = [1, 2, 3, 4, 5];

  constructor(@Inject(MAT_DIALOG_DATA) public data: FeedbackDialogData) {}

  ngOnInit(): void {
    this.api.myFeedback(this.data.eventId).subscribe((fb) => {
      if (fb) {
        this.rating.set(fb.rating);
        this.comment = fb.comment ?? '';
      }
    });
  }

  submit(): void {
    if (this.rating() < 1) return;
    this.saving.set(true);
    this.api.submitFeedback(this.data.eventId, this.rating(), this.comment.trim() || null).subscribe({
      next: () => {
        this.toast.success('Thanks for your feedback!');
        this.ref.close(true);
      },
      error: () => {
        this.saving.set(false);
        this.toast.error('Could not submit feedback.');
      },
    });
  }
}
