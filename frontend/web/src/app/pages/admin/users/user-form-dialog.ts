import { ChangeDetectorRef, Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { ApiService } from '../../../core/api.service';
import { ToastService } from '../../../core/toast.service';
import { AdminUserUpsert, NotificationChannel, UserDto } from '../../../core/models';
import { FaceCaptureDialogComponent, FaceCaptureResult } from '../../../shared/face-capture-dialog';

export const LEVEL_OPTIONS = [
  'Senator',
  'Jake Gonzales Exemplary Fellow',
  'Jake Gonzales Venerable Fellow',
  'Chairman Circle',
  'Honorary Chairman',
];

// Formats any input into the Philippine mobile mask "+63 000 000 0000".
// Accepts local (09xx…), +63/63 prefixed, or bare subscriber digits; empty stays empty.
export function formatPhMobile(value: string | null | undefined): string {
  let d = (value ?? '').replace(/\D/g, '');
  if (d.startsWith('63')) d = d.slice(2);
  else if (d.startsWith('0')) d = d.slice(1);
  d = d.slice(0, 10);
  if (d.length === 0) return '';
  let out = '+63 ' + d.slice(0, 3);
  if (d.length > 3) out += ' ' + d.slice(3, 6);
  if (d.length > 6) out += ' ' + d.slice(6, 10);
  return out;
}

@Component({
  selector: 'app-user-form-dialog',
  imports: [
    FormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatIconModule,
    MatSlideToggleModule,
    MatProgressBarModule,
  ],
  templateUrl: './user-form-dialog.html',
  styles: [
    `
      .user-form { display: flex; flex-direction: column; padding-top: 8px; min-width: min(460px, 80vw); }
      .full-width { width: 100%; }
      .row-2 { display: flex; gap: 12px; }
      .row-2 > mat-form-field { flex: 1 1 auto; }
      .row-2 .mi { flex: 0 0 84px; }
      .grant-box {
        margin: 4px 0 8px;
        padding: 12px 14px;
        border-radius: 10px;
        background: var(--mat-sys-surface-container-high);
      }
      .grant-hint { margin: 6px 0 0; font-size: 13px; }
      .face-ok {
        color: #1e8e3e;
        display: inline-flex;
        align-items: center;
        gap: 3px;
        margin-left: 8px;
        font-weight: 600;
      }
      .photo-buttons { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
    `,
  ],
})
export class UserFormDialogComponent implements OnInit {
  private api = inject(ApiService);
  private ref = inject(MatDialogRef<UserFormDialogComponent>);
  private dialog = inject(MatDialog);
  private cdr = inject(ChangeDetectorRef);
  private toast = inject(ToastService);
  readonly data = inject<UserDto | null>(MAT_DIALOG_DATA);

  readonly levelOptions = LEVEL_OPTIONS;
  readonly isEdit = !!this.data;

  firstName = this.data?.firstName ?? '';
  middleInitial = this.data?.middleInitial ?? '';
  lastName = this.data?.lastName ?? '';
  senateNo = this.data?.senateNo ?? '';
  level = this.data?.level ?? '';
  email = this.data?.email ?? '';
  username = this.data?.username ?? '';
  password = '';
  role = this.data?.role ?? 'Participant';
  organization = this.data?.organization ?? '';
  phone = formatPhMobile(this.data?.phone);
  notificationChannel: NotificationChannel = this.data?.notificationChannel ?? 'Email';
  canConfirmRegistrations = this.data?.canConfirmRegistrations ?? false;

  // Viber passes are delivered to the phone number, so it's mandatory when Viber or Both is chosen.
  phoneRequired = () => this.notificationChannel === 'Viber' || this.notificationChannel === 'Both';

  // Live-format the phone field to the PH mobile mask "+63 000 000 0000".
  onPhoneInput(e: Event): void {
    const input = e.target as HTMLInputElement;
    this.phone = formatPhMobile(input.value);
    input.value = this.phone;
  }

  // Photo state. existingPhoto = current photo (loaded on edit); newPhoto = a freshly picked
  // data URL; clearPhoto = the admin removed the existing one. On save: newPhoto wins, else
  // "" when cleared, else null (unchanged / none).
  existingPhoto = signal<string | null>(null);
  newPhoto = signal<string | null>(null);
  clearPhoto = signal(false);
  photoError = signal<string | null>(null);

  // Facial registration state. A newly captured descriptor (JSON), or "cleared".
  hadFace = this.data?.hasFace ?? false;
  newFace = signal<string | null>(null); // JSON descriptor
  clearFace = signal(false);
  faceRegistered = () => !!this.newFace() || (this.hadFace && !this.clearFace());

  saving = signal(false);

  // What to show in the preview: a freshly picked photo, else the existing one (unless cleared).
  previewPhoto = () => this.newPhoto() ?? (this.clearPhoto() ? null : this.existingPhoto());

  ngOnInit(): void {
    // On edit, fetch the full record (the list omits the photo to stay light).
    if (this.data) {
      this.api.getUser(this.data.id).subscribe({
        next: (u) => {
          this.existingPhoto.set(u.photoUrl);
          this.cdr.detectChanges();
        },
        error: () => {},
      });
    }
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
      this.photoError.set('Image is too large (max 8 MB before compression).');
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

  // Value to send: a new photo, "" to clear an existing one, or null for no change.
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
        // Store ONLY the face descriptor for recognition — the profile picture is uploaded
        // separately (and is what's shown at check-in), so we don't touch the photo here.
        this.newFace.set(JSON.stringify(res.descriptor));
        this.clearFace.set(false);
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
    const hasNames = !!this.firstName.trim() && !!this.lastName.trim();
    const hasEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.email.trim());
    const pwOk = this.isEdit ? !this.password || this.password.length >= 8 : this.password.length >= 8;
    // A phone is optional unless Viber; when present it must be a complete PH mobile number.
    const phone = this.phone.trim();
    const phoneComplete = /^\+63 \d{3} \d{3} \d{4}$/.test(phone);
    const phoneOk = phone ? phoneComplete : !this.phoneRequired();
    return hasNames && hasEmail && pwOk && !!this.role && phoneOk;
  }

  save(): void {
    if (!this.valid) return;
    this.saving.set(true);

    const body: AdminUserUpsert = {
      firstName: this.firstName.trim(),
      middleInitial: this.middleInitial.trim() || null,
      lastName: this.lastName.trim(),
      username: this.username.trim() || null,
      senateNo: this.senateNo.trim() || null,
      level: this.level || null,
      email: this.email.trim(),
      password: this.password || null,
      role: this.role,
      organization: this.organization.trim() || null,
      phone: this.phone.trim() || null,
      canConfirmRegistrations: this.canConfirmRegistrations,
      photo: this.photoPayload(),
      face: this.facePayload(),
      notificationChannel: this.notificationChannel,
    };

    const req =
      this.isEdit && this.data
        ? this.api.updateUser(this.data.id, body)
        : this.api.createUser(body);

    req.subscribe({
      next: (u) => {
        this.saving.set(false);
        this.ref.close(u);
      },
      error: (err) => {
        this.saving.set(false);
        this.toast.error(err?.error?.message ?? 'Could not save the user.');
      },
    });
  }

  cancel(): void {
    this.ref.close();
  }
}
