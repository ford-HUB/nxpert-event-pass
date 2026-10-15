import { Component, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ApiService } from '../../../core/api.service';
import { ToastService } from '../../../core/toast.service';
import { AdminUserUpsert, NotificationChannel, UserDto } from '../../../core/models';
import { FaceCaptureDialogComponent, FaceCaptureResult } from '../../../shared/face-capture-dialog';
import { formatPhMobile } from '../../../shared/ph-phone';

// Right-hand form of the User Master screen. Shows the selected user (edit) or a blank
// record (new); the page toolbar drives it through save() / isDirty().
@Component({
  selector: 'app-user-form-panel',
  imports: [
    FormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatIconModule,
    MatCheckboxModule,
    MatTooltipModule,
  ],
  templateUrl: './user-form-panel.html',
  styleUrl: './user-form-panel.scss',
})
export class UserFormPanelComponent {
  private api = inject(ApiService);
  private dialog = inject(MatDialog);
  private toast = inject(ToastService);

  /** The record being edited; null = a new user. */
  readonly user = input<UserDto | null>(null);
  readonly saved = output<UserDto>();

  private readonly form = viewChild(NgForm);

  firstName = '';
  middleInitial = '';
  lastName = '';
  senateNo = '';
  level = '';
  email = '';
  username = '';
  password = '';
  role: string = 'Participant';
  organization = '';
  phone = '';
  notificationChannel: NotificationChannel = 'Email';
  canConfirmRegistrations = false;

  // Photo state. existingPhoto = current photo (loaded on edit); newPhoto = a freshly picked
  // data URL; clearPhoto = the admin removed the existing one. On save: newPhoto wins, else
  // "" when cleared, else null (unchanged / none).
  existingPhoto = signal<string | null>(null);
  newPhoto = signal<string | null>(null);
  clearPhoto = signal(false);
  photoError = signal<string | null>(null);

  // Facial registration state. A newly captured descriptor (JSON), or "cleared".
  hadFace = false;
  newFace = signal<string | null>(null);
  clearFace = signal(false);

  saving = signal(false);

  // Bumped on every reset so a slow photo fetch for a previous row can't land on the current one.
  private loadSeq = 0;

  constructor() {
    effect(() => {
      const u = this.user();
      untracked(() => this.reset(u));
    });
  }

  get isEdit(): boolean {
    return !!this.user();
  }

  faceRegistered = () => !!this.newFace() || (this.hadFace && !this.clearFace());
  previewPhoto = () => this.newPhoto() ?? (this.clearPhoto() ? null : this.existingPhoto());

  // Viber passes are delivered to the phone number, so it's mandatory when Viber or Both is chosen.
  phoneRequired = () => this.notificationChannel === 'Viber' || this.notificationChannel === 'Both';

  /** True when the admin has changed anything since the record was loaded. */
  isDirty(): boolean {
    return !!this.form()?.dirty || !!this.newPhoto() || this.clearPhoto() || !!this.newFace() || this.clearFace();
  }

  private reset(u: UserDto | null): void {
    this.firstName = u?.firstName ?? '';
    this.middleInitial = u?.middleInitial ?? '';
    this.lastName = u?.lastName ?? '';
    this.senateNo = u?.senateNo ?? '';
    this.level = u?.level ?? '';
    this.email = u?.email ?? '';
    this.username = u?.username ?? '';
    this.password = '';
    this.role = u?.role ?? 'Participant';
    this.organization = u?.organization ?? '';
    this.phone = formatPhMobile(u?.phone);
    this.notificationChannel = u?.notificationChannel ?? 'Email';
    this.canConfirmRegistrations = u?.canConfirmRegistrations ?? false;
    this.hadFace = u?.hasFace ?? false;

    this.existingPhoto.set(null);
    this.newPhoto.set(null);
    this.clearPhoto.set(false);
    this.photoError.set(null);
    this.newFace.set(null);
    this.clearFace.set(false);

    // Clear dirty/touched flags once the new values have been bound.
    queueMicrotask(() => this.form()?.resetForm(this.formValues()));

    // The list omits the photo to stay light, so fetch the full record.
    const seq = ++this.loadSeq;
    if (u) {
      this.api.getUser(u.id).subscribe({
        next: (full) => {
          if (seq === this.loadSeq) this.existingPhoto.set(full.photoUrl);
        },
        error: () => {},
      });
    }
  }

  // resetForm() would blank ngModel-bound fields, so hand it the current values back.
  private formValues(): Record<string, unknown> {
    return {
      firstName: this.firstName,
      middleInitial: this.middleInitial,
      lastName: this.lastName,
      senateNo: this.senateNo,
      level: this.level,
      email: this.email,
      username: this.username,
      password: '',
      role: this.role,
      notificationChannel: this.notificationChannel,
      phone: this.phone,
      organization: this.organization,
      canConfirm: this.canConfirmRegistrations,
    };
  }

  // Live-format the phone field to the PH mobile mask "+63 000 000 0000".
  onPhoneInput(e: Event): void {
    const el = e.target as HTMLInputElement;
    this.phone = formatPhMobile(el.value);
    el.value = this.phone;
  }

  onPhotoSelected(event: Event): void {
    const el = event.target as HTMLInputElement;
    const file = el.files?.[0];
    el.value = '';
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
      };
      img.onerror = () => this.photoError.set('Could not read that image.');
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  }

  removePhoto(): void {
    this.newPhoto.set(null);
    this.clearPhoto.set(true);
    this.photoError.set(null);
  }

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
      });
  }

  removeFace(): void {
    this.newFace.set(null);
    this.clearFace.set(true);
  }

  private photoPayload(): string | null {
    if (this.newPhoto()) return this.newPhoto();
    if (this.clearPhoto()) return '';
    return null;
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
    if (this.saving()) return;
    if (!this.valid) {
      this.form()?.form.markAllAsTouched();
      this.toast.warning('Please complete the required fields.');
      return;
    }
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

    const current = this.user();
    const req = current ? this.api.updateUser(current.id, body) : this.api.createUser(body);

    req.subscribe({
      next: (u) => {
        this.saving.set(false);
        this.toast.success(current ? 'User updated.' : 'User added.');
        this.saved.emit(u);
      },
      error: (err) => {
        this.saving.set(false);
        this.toast.error(err?.error?.message ?? 'Could not save the user.');
      },
    });
  }
}
