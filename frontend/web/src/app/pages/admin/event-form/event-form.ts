import { ChangeDetectorRef, Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSelectModule } from '@angular/material/select';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { ApiService } from '../../../core/api.service';
import { ToastService } from '../../../core/toast.service';
import { EventFormat, EventUpsert, FieldType, SessionUpsert } from '../../../core/models';

interface BuilderField {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  optionsText: string; // comma-separated, for select/radio
  category: string; // optional group name
  // Conditional visibility: show this field only when the radio field with key showWhenKey has
  // value showWhenValue. Empty showWhenKey = always shown.
  showWhenKey: string;
  showWhenValue: string;
}

interface BuilderMeal {
  id: number; // 0 for a new stub
  name: string;
  denomination: number | null;
  quantity: number | null;
  color: string;
  day: number; // used for event-level (per-day) stubs; 0 for sub-event stubs
  validFrom: Date | null;
  validTo: Date | null;
}

// Preset swatch colours offered in the stub colour picker.
const MEAL_COLORS = ['#1a73e8', '#188038', '#e8710a', '#d93025', '#8430ce', '#00838f', '#5f6368'];

interface BuilderSession {
  id: number; // 0 for a new sub-event
  title: string;
  description: string;
  startDate: Date | null;
  startTime: string;
  endDate: Date | null;
  endTime: string;
  venue: string;
  meetingUrl: string; // optional; falls back to the event's link
  capacity: number | null;
  poster: string | null;
  meals: BuilderMeal[];
}

const FIELD_TYPES: { value: FieldType; label: string }[] = [
  { value: 'text', label: 'Text field' },
  { value: 'textarea', label: 'Text area' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'time', label: 'Time' },
  { value: 'select', label: 'Dropdown' },
  { value: 'multiselect', label: 'Multi-select' },
  { value: 'radio', label: 'Radio buttons' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'image', label: 'Image upload' },
];

const pad = (n: number) => String(n).padStart(2, '0');

// The API stores wall-clock "yyyy-MM-ddTHH:mm". Split it into a calendar Date (date only)
// and an "HH:mm" time string, and recombine on save.
function splitDateTime(iso: string): { date: Date | null; time: string } {
  if (!iso) return { date: null, time: '' };
  const [datePart, timePart = ''] = iso.split('T');
  const [y, m, d] = datePart.split('-').map(Number);
  return { date: new Date(y, m - 1, d), time: timePart.slice(0, 5) };
}

function combine(date: Date | null, time: string): string {
  if (!date || !time) return '';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${time}`;
}

@Component({
  selector: 'app-event-form',
  imports: [
    FormsModule,
    RouterLink,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatSlideToggleModule,
    MatSelectModule,
    MatDatepickerModule,
    MatButtonToggleModule,
  ],
  templateUrl: './event-form.html',
})
export class EventFormComponent implements OnInit {
  private api = inject(ApiService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private toast = inject(ToastService);
  private cdr = inject(ChangeDetectorRef);

  id: number | null = null;
  saving = signal(false);
  loading = signal(false);

  title = '';
  description = '';
  startDate: Date | null = null;
  startTime = '';
  endDate: Date | null = null;
  endTime = '';
  venue = '';
  // Attendance format + online meeting link (Online / Hybrid send a calendar invite on confirm).
  format: EventFormat = 'InPerson';
  meetingUrl = '';
  readonly formats: { value: EventFormat; label: string; icon: string }[] = [
    { value: 'InPerson', label: 'In person', icon: 'place' },
    { value: 'Online', label: 'Online', icon: 'videocam' },
    { value: 'Hybrid', label: 'Hybrid', icon: 'devices' },
  ];
  isPublicLinkEnabled = true;
  status = 'Published';
  capacity: number | null = null;
  registeredCount = 0; // for edit: capacity can't be set below this
  bannerImage: string | null = null;
  bannerError = signal<string | null>(null);
  welcomeMessage = '';
  registrationFees = '';
  notifyOnKitClaim = false;

  // Schedule-of-activities grid (Day / Time / Activity rows)
  scheduleRows: { day: string; time: string; activity: string }[] = [];

  addScheduleRow(): void {
    const lastDay = this.scheduleRows.at(-1)?.day ?? '';
    this.scheduleRows.push({ day: lastDay, time: '', activity: '' });
  }

  removeScheduleRow(i: number): void {
    this.scheduleRows.splice(i, 1);
  }

  // Read the chosen image, downscale it (max 1400px wide) and store it as a compact JPEG
  // data URL so the payload stays small.
  onBannerSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // allow re-selecting the same file later
    if (!file) return;

    this.bannerError.set(null);
    if (!file.type.startsWith('image/')) {
      this.bannerError.set('Please choose an image file.');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      this.bannerError.set('Image is too large (max 8 MB before compression).');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const maxW = 1400;
        const scale = Math.min(1, maxW / img.width);
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
        this.bannerImage = canvas.toDataURL('image/jpeg', 0.85);
        this.cdr.detectChanges();
      };
      img.onerror = () => {
        this.bannerError.set('Could not read that image.');
        this.cdr.detectChanges();
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  }

  removeBanner(): void {
    this.bannerImage = null;
    this.bannerError.set(null);
  }

  // Sub-events (sessions) builder
  builderSessions: BuilderSession[] = [];

  addSession(): void {
    // Default a new sub-event to the event's day, 09:00–12:00.
    this.builderSessions.push({
      id: 0,
      title: '',
      description: '',
      startDate: this.startDate,
      startTime: '09:00',
      endDate: this.startDate,
      endTime: '12:00',
      venue: '',
      meetingUrl: '',
      capacity: null,
      poster: null,
      meals: [],
    });
  }

  readonly mealColors = MEAL_COLORS;

  addMeal(s: BuilderSession): void {
    // Default a sub-event stub's validity to the sub-event's own dates.
    s.meals.push({
      id: 0, name: '', denomination: null, quantity: 1, color: MEAL_COLORS[0], day: 0,
      validFrom: s.startDate, validTo: s.endDate,
    });
  }

  removeMeal(s: BuilderSession, i: number): void {
    s.meals.splice(i, 1);
  }

  // ---- Event-level (per-day) meal stubs — used when the event has no sub-events ----
  eventDays: number[] = [];
  eventMeals: BuilderMeal[] = [];

  addEventDay(): void {
    const next = this.eventDays.length ? Math.max(...this.eventDays) + 1 : 1;
    this.eventDays.push(next);
    this.addEventMeal(next);
  }
  removeEventDay(day: number): void {
    this.eventDays = this.eventDays.filter((d) => d !== day);
    this.eventMeals = this.eventMeals.filter((m) => m.day !== day);
  }
  addEventMeal(day: number): void {
    const color = MEAL_COLORS[(day - 1) % MEAL_COLORS.length];
    // Default a per-day stub's validity to that day's date (event start + day-1).
    const b = this.startDate;
    const d = b ? new Date(b.getFullYear(), b.getMonth(), b.getDate() + (day - 1)) : null;
    this.eventMeals.push({ id: 0, name: '', denomination: null, quantity: 1, color, day, validFrom: d, validTo: d });
  }
  removeEventMeal(m: BuilderMeal): void {
    this.eventMeals = this.eventMeals.filter((x) => x !== m);
  }
  stubsForDay(day: number): BuilderMeal[] {
    return this.eventMeals.filter((m) => m.day === day);
  }

  removeSession(i: number): void {
    this.builderSessions.splice(i, 1);
  }

  // Read a sub-event poster, downscale it (max 1000px) to a compact JPEG data URL.
  onSessionPosterSelected(event: Event, s: BuilderSession): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !file.type.startsWith('image/')) return;
    if (file.size > 8 * 1024 * 1024) {
      this.toast.warning('Poster image is too large (max 8 MB).');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const maxW = 1000;
        const scale = Math.min(1, maxW / img.width);
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
        s.poster = canvas.toDataURL('image/jpeg', 0.85);
        this.cdr.detectChanges();
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  }

  removeSessionPoster(s: BuilderSession): void {
    s.poster = null;
  }

  private sessionValid(s: BuilderSession): boolean {
    if (!s.title.trim() || !s.startDate || !s.startTime || !s.endDate || !s.endTime) return false;
    const start = new Date(combine(s.startDate, s.startTime)).getTime();
    const end = new Date(combine(s.endDate, s.endTime)).getTime();
    return end > start;
  }

  get sessionsValid(): boolean {
    return this.builderSessions.every((s) => this.sessionValid(s));
  }

  // Custom registration-form builder
  readonly fieldTypes = FIELD_TYPES;
  builderFields: BuilderField[] = [];

  needsOptions(type: FieldType): boolean {
    return type === 'select' || type === 'multiselect' || type === 'radio';
  }

  addField(): void {
    // Default a new field into the last-used category so grouped fields stay together.
    const lastCategory = this.builderFields.at(-1)?.category ?? '';
    this.builderFields.push({
      key: 'f_' + Math.random().toString(36).slice(2, 8),
      label: '',
      type: 'text',
      required: false,
      optionsText: '',
      category: lastCategory,
      showWhenKey: '',
      showWhenValue: '',
    });
  }

  // Distinct non-empty category names entered so far (for the datalist suggestions).
  get categoryNames(): string[] {
    const seen = new Set<string>();
    for (const b of this.builderFields) {
      const c = b.category.trim();
      if (c) seen.add(c);
    }
    return [...seen];
  }

  removeField(i: number): void {
    this.builderFields.splice(i, 1);
  }

  private optionsOf(b: BuilderField): string[] {
    return b.optionsText.split(',').map((s) => s.trim()).filter(Boolean);
  }

  // ---- Conditional visibility (a field can be shown only when a radio field above it has a value) ----
  // Radio fields defined before row `i` that have a label and at least one option — the eligible
  // "show when" controllers for that row (kept above to avoid circular references).
  controllersBefore(i: number): BuilderField[] {
    return this.builderFields
      .slice(0, i)
      .filter((b) => b.type === 'radio' && b.label.trim() !== '' && this.optionsOf(b).length > 0);
  }

  // The options of the controller a row points at (for the value dropdown).
  controllerValues(b: BuilderField): string[] {
    const ctrl = this.builderFields.find((x) => x.key === b.showWhenKey);
    return ctrl ? this.optionsOf(ctrl) : [];
  }

  // When the controller changes, reset a value that no longer belongs to it.
  onShowWhenKeyChange(b: BuilderField): void {
    if (!b.showWhenKey) { b.showWhenValue = ''; return; }
    if (!this.controllerValues(b).includes(b.showWhenValue)) b.showWhenValue = '';
  }

  // A condition is valid when a controller (still an eligible radio) and one of its values are chosen.
  private conditionValid(b: BuilderField): boolean {
    if (!b.showWhenKey) return false;
    return this.controllerValues(b).includes(b.showWhenValue);
  }

  get builderValid(): boolean {
    return this.builderFields.every(
      (b) =>
        b.label.trim() !== '' &&
        (!this.needsOptions(b.type) || this.optionsOf(b).length > 0) &&
        // A controller chosen without a value is an incomplete condition.
        (!b.showWhenKey || this.controllerValues(b).includes(b.showWhenValue)),
    );
  }

  get isEdit(): boolean {
    return this.id !== null;
  }

  // End must be strictly after start (only meaningful once all four parts are set).
  get endAfterStart(): boolean {
    if (!this.startDate || !this.startTime || !this.endDate || !this.endTime) return true;
    const s = new Date(combine(this.startDate, this.startTime)).getTime();
    const e = new Date(combine(this.endDate, this.endTime)).getTime();
    return e > s;
  }

  // Capacity is optional (blank = unlimited); if set it must be ≥ 1 and ≥ people already registered.
  get capacityValid(): boolean {
    if (this.capacity == null || (this.capacity as unknown as string) === '') return true;
    return this.capacity >= 1 && this.capacity >= this.registeredCount;
  }

  // Online / Hybrid: has a meeting link + calendar invite. In person / Hybrid: has a venue.
  get hasOnline(): boolean {
    return this.format === 'Online' || this.format === 'Hybrid';
  }
  get hasVenue(): boolean {
    return this.format !== 'Online';
  }

  isUrl(v: string): boolean {
    try {
      const u = new URL(v.trim());
      return u.protocol === 'https:' || u.protocol === 'http:';
    } catch {
      return false;
    }
  }

  // Links are optional (can be added later) but must be real web addresses when given.
  get meetingLinksValid(): boolean {
    if (!this.hasOnline) return true;
    const ok = (v: string) => !v.trim() || this.isUrl(v);
    return ok(this.meetingUrl) && this.builderSessions.every((s) => ok(s.meetingUrl));
  }

  // No usable link anywhere yet → confirmations would go out without a join link.
  get missingMeetingLink(): boolean {
    if (!this.hasOnline || this.meetingUrl.trim()) return false;
    const sessions = this.builderSessions.filter((s) => s.title.trim());
    return sessions.length === 0 || sessions.some((s) => !s.meetingUrl.trim());
  }

  get isValid(): boolean {
    return (
      !!(this.title && (this.venue.trim() || !this.hasVenue) && this.startDate && this.startTime && this.endDate && this.endTime) &&
      this.endAfterStart &&
      this.capacityValid &&
      this.builderValid &&
      this.sessionsValid &&
      this.meetingLinksValid
    );
  }

  ngOnInit(): void {
    const idParam = this.route.snapshot.paramMap.get('id');
    if (idParam) {
      this.id = +idParam;
      this.loading.set(true);
      this.api.getEvent(this.id).subscribe({
        next: (e) => {
          this.title = e.title;
          this.description = e.description;
          const s = splitDateTime(e.startsAt);
          const en = splitDateTime(e.endsAt);
          this.startDate = s.date;
          this.startTime = s.time;
          this.endDate = en.date;
          this.endTime = en.time;
          this.format = e.format ?? 'InPerson';
          this.meetingUrl = e.meetingUrl ?? '';
          // Online-only events store "Online" as the venue; show an empty field instead.
          this.venue = this.format === 'Online' && e.venue === 'Online' ? '' : e.venue;
          this.isPublicLinkEnabled = e.isPublicLinkEnabled;
          this.status = e.status;
          this.capacity = e.capacity;
          this.registeredCount = e.registeredCount;
          this.bannerImage = e.bannerImage;
          this.welcomeMessage = e.welcomeMessage ?? '';
          this.registrationFees = e.registrationFees ?? '';
          this.notifyOnKitClaim = e.notifyOnKitClaim;
          this.scheduleRows = (e.schedule || []).map((s) => ({
            day: s.day ?? '',
            time: s.time ?? '',
            activity: s.activity,
          }));
          this.builderFields = (e.formFields || []).map((f) => ({
            key: f.key,
            label: f.label,
            type: f.type,
            required: f.required,
            optionsText: (f.options || []).join(', '),
            category: f.category ?? '',
            showWhenKey: f.showWhenField ?? '',
            showWhenValue: f.showWhenValue ?? '',
          }));
          this.builderSessions = (e.sessions || []).map((s) => {
            const ss = splitDateTime(s.startsAt);
            const se = splitDateTime(s.endsAt);
            return {
              id: s.id,
              title: s.title,
              description: s.description ?? '',
              startDate: ss.date,
              startTime: ss.time,
              endDate: se.date,
              endTime: se.time,
              venue: s.venue ?? '',
              meetingUrl: s.meetingUrl ?? '',
              capacity: s.capacity,
              poster: s.posterImage,
              meals: (s.meals || []).map((m) => ({
                id: m.id,
                name: m.name,
                denomination: m.denomination,
                quantity: m.quantity,
                color: m.color ?? MEAL_COLORS[0],
                day: 0,
                validFrom: splitDateTime(m.validFrom).date,
                validTo: splitDateTime(m.validTo).date,
              })),
            };
          });
          // Event-level (per-day) meal stubs.
          this.eventMeals = (e.meals || []).map((m) => ({
            id: m.id,
            name: m.name,
            denomination: m.denomination,
            quantity: m.quantity,
            color: m.color ?? MEAL_COLORS[0],
            day: m.day > 0 ? m.day : 1,
            validFrom: splitDateTime(m.validFrom).date,
            validTo: splitDateTime(m.validTo).date,
          }));
          this.eventDays = [...new Set(this.eventMeals.map((m) => m.day))].sort((a, b) => a - b);
          this.loading.set(false);
          // Zoneless: data arrived in an async callback and the template doesn't read
          // loading(), so nothing schedules change detection — nudge it so the fields render.
          this.cdr.detectChanges();
        },
        error: () => this.loading.set(false),
      });
    } else {
      // Sensible defaults for a new event: tomorrow, 09:00–12:00.
      const d = new Date();
      d.setDate(d.getDate() + 1);
      this.startDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      this.endDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      this.startTime = '09:00';
      this.endTime = '12:00';
    }
  }

  save(): void {
    if (!this.isValid) return;
    const body: EventUpsert = {
      title: this.title.trim(),
      description: this.description,
      startsAt: combine(this.startDate, this.startTime),
      endsAt: combine(this.endDate, this.endTime),
      venue: this.format === 'Online' ? this.venue.trim() || 'Online' : this.venue,
      format: this.format,
      meetingUrl: this.hasOnline ? this.meetingUrl.trim() || null : null,
      isPublicLinkEnabled: this.isPublicLinkEnabled,
      status: this.status,
      capacity: this.capacity && this.capacity > 0 ? this.capacity : null,
      formFields: this.builderFields
        .filter((b) => b.label.trim())
        .map((b) => ({
          key: b.key,
          label: b.label.trim(),
          type: b.type,
          required: b.required,
          options: this.needsOptions(b.type) ? this.optionsOf(b) : null,
          category: b.category.trim() || null,
          // Only persist a valid condition (controller still exists as a radio, value chosen).
          showWhenField: this.conditionValid(b) ? b.showWhenKey : null,
          showWhenValue: this.conditionValid(b) ? b.showWhenValue : null,
        })),
      bannerImage: this.bannerImage,
      welcomeMessage: this.welcomeMessage.trim() || null,
      registrationFees: this.registrationFees.trim() || null,
      schedule: this.scheduleRows
        .filter((r) => r.activity.trim())
        .map((r) => ({
          day: r.day.trim() || null,
          time: r.time.trim() || null,
          activity: r.activity.trim(),
        })),
      sessions: this.builderSessions
        .filter((s) => s.title.trim())
        .map<SessionUpsert>((s) => ({
          id: s.id,
          title: s.title.trim(),
          description: s.description.trim() || null,
          startsAt: combine(s.startDate, s.startTime),
          endsAt: combine(s.endDate, s.endTime),
          venue: s.venue.trim() || null,
          meetingUrl: this.hasOnline ? s.meetingUrl.trim() || null : null,
          capacity: s.capacity && s.capacity > 0 ? s.capacity : null,
          posterImage: s.poster,
          meals: s.meals
            .filter((m) => m.name.trim())
            .map((m) => ({
              id: m.id,
              name: m.name.trim(),
              denomination: Number(m.denomination) || 0,
              quantity: Number(m.quantity) > 0 ? Number(m.quantity) : 1,
              color: m.color || null,
              day: 0,
              validFrom: m.validFrom ? combine(m.validFrom, '00:00') : null,
              validTo: m.validTo ? combine(m.validTo, '00:00') : null,
            })),
        })),
      notifyOnKitClaim: this.notifyOnKitClaim,
      // Event-level (per-day) meal stubs.
      meals: this.eventMeals
        .filter((m) => m.name.trim())
        .map((m) => ({
          id: m.id,
          name: m.name.trim(),
          denomination: Number(m.denomination) || 0,
          quantity: Number(m.quantity) > 0 ? Number(m.quantity) : 1,
          color: m.color || null,
          day: m.day > 0 ? m.day : 1,
          validFrom: m.validFrom ? combine(m.validFrom, '00:00') : null,
          validTo: m.validTo ? combine(m.validTo, '00:00') : null,
        })),
    };
    this.saving.set(true);
    const req = this.isEdit ? this.api.updateEvent(this.id!, body) : this.api.createEvent(body);
    req.subscribe({
      next: (e) => {
        this.saving.set(false);
        this.toast.success(this.isEdit ? 'Event updated.' : 'Event created.');
        this.router.navigate(['/admin/events', e.id]);
      },
      error: () => {
        this.saving.set(false);
        this.toast.error('Could not save the event.');
      },
    });
  }
}
