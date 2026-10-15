import { ChangeDetectorRef, Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatDividerModule } from '@angular/material/divider';
import { MatDialog } from '@angular/material/dialog';
import { ToastService } from '../../core/toast.service';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { NotificationChannel, ProfileUpdate } from '../../core/models';
import { FaceCaptureDialogComponent, FaceCaptureResult } from '../../shared/face-capture-dialog';

@Component({
  selector: 'app-account',
  imports: [
    FormsModule,
    RouterLink,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    MatDividerModule,
  ],
  templateUrl: './account.html',
})
export class AccountComponent implements OnInit {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private router = inject(Router);
  private toast = inject(ToastService);
  private dialog = inject(MatDialog);
  private cdr = inject(ChangeDetectorRef);

  loading = signal(true);
  saving = signal(false);

  firstName = '';
  middleInitial = '';
  lastName = '';
  senateNo = '';
  level = '';
  email = '';
  organization = '';
  phone = '';
  notificationChannel: NotificationChannel = 'Email';

  // Viber passes are delivered to the phone number, so it's mandatory when Viber is chosen.
  phoneRequired = () => this.notificationChannel === 'Viber';

  // Photo state: existing (loaded), newPhoto (picked), clearPhoto (removed).
  existingPhoto = signal<string | null>(null);
  newPhoto = signal<string | null>(null);
  clearPhoto = signal(false);
  photoError = signal<string | null>(null);

  // Facial-registration state (mirrors photo semantics).
  hadFace = false;
  newFace = signal<string | null>(null);
  clearFace = signal(false);
  faceRegistered = () => !!this.newFace() || (this.hadFace && !this.clearFace());

  // Optional password change
  currentPassword = '';
  newPassword = '';

  previewPhoto = () => this.newPhoto() ?? (this.clearPhoto() ? null : this.existingPhoto());

  ngOnInit(): void {
    this.api.getMyProfile().subscribe({
      next: (p) => {
        this.firstName = p.firstName ?? '';
        this.middleInitial = p.middleInitial ?? '';
        this.lastName = p.lastName ?? '';
        this.senateNo = p.senateNo ?? '';
        this.level = p.level ?? '';
        this.email = p.email;
        this.organization = p.organization ?? '';
        this.phone = p.phone ?? '';
        this.notificationChannel = p.notificationChannel ?? 'Email';
        this.existingPhoto.set(p.photoUrl);
        this.hadFace = p.hasFace;
        this.loading.set(false);
        this.cdr.detectChanges();
      },
      error: () => {
        this.toast.error('Could not load your account.');
        this.loading.set(false);
      },
    });
  }

  onPhotoSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.photoError.set(null);
    if (!file.type.startsWith('image/')) {
      this.photoError.set('Please choose an image file.');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      this.photoError.set('Image is too large (max 8 MB).');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const maxDim = 512;
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
        this.newPhoto.set(canvas.toDataURL('image/jpeg', 0.85));
        this.clearPhoto.set(false);
        this.cdr.detectChanges();
      };
      img.onerror = () => {
        this.photoError.set('Could not read that image.');
        this.cdr.detectChanges();
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  }

  removePhoto(): void {
    this.newPhoto.set(null);
    this.clearPhoto.set(true);
    this.photoError.set(null);
  }

  private photoPayload(): string | null {
    if (this.newPhoto()) return this.newPhoto();
    if (this.clearPhoto()) return '';
    return null;
  }

  // ---- Facial registration ----
  registerFace(): void {
    this.dialog
      .open(FaceCaptureDialogComponent, { width: '420px', maxWidth: '94vw', autoFocus: false })
      .afterClosed()
      .subscribe((res: FaceCaptureResult | undefined) => {
        if (!res) return;
        this.newFace.set(JSON.stringify(res.descriptor));
        this.clearFace.set(false);
        // The captured face doubles as the profile photo (used on the check-in welcome screen).
        this.newPhoto.set(res.image);
        this.clearPhoto.set(false);
        this.cdr.detectChanges();
      });
  }

  removeFace(): void {
    this.newFace.set(null);
    this.clearFace.set(true);
  }

  private facePayload(): string | null {
    if (this.newFace()) return this.newFace();
    if (this.clearFace()) return '';
    return null;
  }

  get valid(): boolean {
    const names = !!this.firstName.trim() && !!this.lastName.trim();
    const pwOk = !this.newPassword || (this.newPassword.length >= 8 && !!this.currentPassword);
    const phoneOk = !this.phoneRequired() || !!this.phone.trim();
    return names && pwOk && phoneOk;
  }

  save(): void {
    if (!this.valid) return;
    this.saving.set(true);

    const body: ProfileUpdate = {
      firstName: this.firstName.trim(),
      middleInitial: this.middleInitial.trim() || null,
      lastName: this.lastName.trim(),
      senateNo: this.senateNo.trim() || null,
      level: this.level || null,
      organization: this.organization.trim() || null,
      phone: this.phone.trim() || null,
      photo: this.photoPayload(),
      currentPassword: this.newPassword ? this.currentPassword : null,
      newPassword: this.newPassword || null,
      notificationChannel: this.notificationChannel,
      face: this.facePayload(),
    };

    this.api.updateMyProfile(body).subscribe({
      next: (res) => {
        this.auth.applyProfileUpdate(res);
        this.saving.set(false);
        this.currentPassword = '';
        this.newPassword = '';
        this.toast.success('Your account has been updated.');
      },
      error: (err) => {
        this.saving.set(false);
        this.toast.error(err?.error?.message ?? 'Could not update your account.');
      },
    });
  }
}
