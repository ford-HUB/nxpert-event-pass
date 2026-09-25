import { ChangeDetectorRef, Component, Input, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatRadioModule } from '@angular/material/radio';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { FormFieldDef } from '../../core/models';

/**
 * Renders an event's custom registration fields and collects the answers.
 * The parent reads validity via isValid() and the normalized answers via collect().
 */
@Component({
  selector: 'app-dynamic-fields',
  imports: [
    FormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatRadioModule,
    MatCheckboxModule,
    MatButtonModule,
    MatIconModule,
  ],
  templateUrl: './dynamic-fields.html',
  styleUrl: './dynamic-fields.scss',
})
export class DynamicFieldsComponent implements OnInit {
  private cdr = inject(ChangeDetectorRef);

  @Input() fields: FormFieldDef[] = [];
  // Existing answers to prefill (e.g. when editing a registration). Keyed by field key.
  @Input() initial: Record<string, string> = {};

  // Working answers, keyed by field key. Values are string | number | boolean.
  // Image fields store a data URL (data:image/...;base64,...).
  model: Record<string, unknown> = {};

  // Per-field upload error messages for image fields, keyed by field key.
  imageErrors: Record<string, string> = {};

  // Per-select search text (drives the in-panel filter), keyed by field key.
  searchText: Record<string, string> = {};
  // Per-select custom value when the "Other" option is chosen, keyed by field key.
  otherText: Record<string, string> = {};

  ngOnInit(): void {
    for (const f of this.fields) {
      const raw = this.initial[f.key];
      if (raw === undefined || raw === null) continue;
      if (f.type === 'checkbox') {
        this.model[f.key] = raw === 'Yes' || raw === 'true';
      } else if (f.type === 'multiselect') {
        this.model[f.key] = raw.split(',').map((s) => s.trim()).filter(Boolean);
      } else if (f.type === 'select') {
        // A saved value that isn't one of the options is a custom "Other" answer — restore it
        // into the Other text field and select the Other option.
        const opts = f.options || [];
        const other = this.otherOption(f);
        if (!opts.includes(raw) && other) {
          this.model[f.key] = other;
          this.otherText[f.key] = raw;
        } else {
          this.model[f.key] = raw;
        }
      } else {
        this.model[f.key] = raw;
      }
    }
  }

  // ---- Conditional visibility (radio-driven) ----
  // A field with a showWhenField rule shows only while that controlling field's answer equals
  // showWhenValue. A rule pointing at a missing field is ignored (treated as always visible).
  isVisible(f: FormFieldDef): boolean {
    const key = f.showWhenField;
    if (!key) return true;
    if (!this.fields.some((x) => x.key === key)) return true; // dangling rule → show
    return this.model[key] === f.showWhenValue;
  }

  // True when a category group has at least one currently-visible field (so we can hide the heading).
  groupHasVisible(fields: FormFieldDef[]): boolean {
    return fields.some((f) => this.isVisible(f));
  }

  // Discard answers to fields hidden by the current selection — called when a value changes so a
  // field that was filled then hidden doesn't keep (or later resubmit) a stale answer.
  pruneHidden(): void {
    for (const f of this.fields) {
      if (this.isVisible(f)) continue;
      delete this.model[f.key];
      delete this.otherText[f.key];
      delete this.searchText[f.key];
      delete this.imageErrors[f.key];
    }
  }

  // ---- Searchable select ----
  // Options filtered by the field's search text (case-insensitive substring).
  filteredOptions(f: FormFieldDef): string[] {
    const opts = f.options || [];
    const q = (this.searchText[f.key] || '').trim().toLowerCase();
    return q ? opts.filter((o) => o.toLowerCase().includes(q)) : opts;
  }

  // Focus the search box when the panel opens; clear the filter when it closes.
  onSelectToggle(f: FormFieldDef, opened: boolean): void {
    if (opened) {
      setTimeout(() => {
        const el = document.querySelector<HTMLInputElement>('.dyn-select-panel .dyn-search-input');
        el?.focus();
      });
    } else {
      this.searchText[f.key] = '';
    }
  }

  // ---- "Other" option ----
  private isOtherLabel(v: string): boolean {
    const n = (v || '').trim().toLowerCase();
    return n === 'other' || n === 'others' || n.startsWith('other ') || n.startsWith('others ');
  }

  private otherOption(f: FormFieldDef): string | null {
    return (f.options || []).find((o) => this.isOtherLabel(o)) ?? null;
  }

  // True when the field's selected value is an "Other" option (so the specify box shows).
  isOtherSelected(f: FormFieldDef): boolean {
    const v = this.model[f.key];
    return typeof v === 'string' && this.isOtherLabel(v);
  }

  // Fields grouped by category (in first-seen order). Uncategorized fields have category ''.
  get groups(): { category: string; fields: FormFieldDef[] }[] {
    const map = new Map<string, FormFieldDef[]>();
    const order: string[] = [];
    for (const f of this.fields) {
      const cat = (f.category ?? '').trim();
      if (!map.has(cat)) {
        map.set(cat, []);
        order.push(cat);
      }
      map.get(cat)!.push(f);
    }
    return order.map((cat) => ({ category: cat, fields: map.get(cat)! }));
  }

  // ---- Image fields ----
  imageValue(key: string): string | null {
    const v = this.model[key];
    return typeof v === 'string' && v.startsWith('data:image/') ? v : null;
  }

  onImageSelected(f: FormFieldDef, event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // allow re-picking the same file
    if (!file) return;

    this.imageErrors[f.key] = '';
    if (!file.type.startsWith('image/')) {
      this.imageErrors[f.key] = 'Please choose an image file.';
      this.cdr.detectChanges();
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      this.imageErrors[f.key] = 'Image is too large (max 8 MB before compression).';
      this.cdr.detectChanges();
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        // Downscale to keep the stored data URL small.
        const maxDim = 1024;
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
        this.model[f.key] = canvas.toDataURL('image/jpeg', 0.85);
        this.cdr.detectChanges();
      };
      img.onerror = () => {
        this.imageErrors[f.key] = 'Could not read that image.';
        this.cdr.detectChanges();
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  }

  clearImage(f: FormFieldDef): void {
    this.model[f.key] = '';
    this.imageErrors[f.key] = '';
  }

  private hasValue(f: FormFieldDef): boolean {
    const v = this.model[f.key];
    if (f.type === 'checkbox') return v === true;
    if (f.type === 'multiselect') return Array.isArray(v) && v.length > 0;
    // "Other" needs the specify text to count as answered.
    if (f.type === 'select' && this.isOtherSelected(f)) {
      return (this.otherText[f.key] || '').trim() !== '';
    }
    return v !== undefined && v !== null && String(v).trim() !== '';
  }

  /** True when every required, currently-visible field has an answer. */
  isValid(): boolean {
    return this.fields.every((f) => !this.isVisible(f) || !f.required || this.hasValue(f));
  }

  /** Normalized answers ready to send to the API (all strings; checkboxes → Yes/No). */
  collect(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const f of this.fields) {
      if (!this.isVisible(f)) continue; // hidden by its condition → discard
      const v = this.model[f.key];
      if (f.type === 'checkbox') {
        if (v === true) out[f.key] = 'Yes';
        continue;
      }
      if (f.type === 'multiselect') {
        const arr = Array.isArray(v) ? (v as string[]) : v ? [String(v)] : [];
        if (arr.length) out[f.key] = arr.join(', ');
        continue;
      }
      // "Other" selected → submit the typed custom value instead of the "Other" label.
      if (f.type === 'select' && this.isOtherSelected(f)) {
        const t = (this.otherText[f.key] || '').trim();
        if (t) out[f.key] = t;
        continue;
      }
      if (v === undefined || v === null || String(v).trim() === '') continue;
      out[f.key] = String(v);
    }
    return out;
  }
}
