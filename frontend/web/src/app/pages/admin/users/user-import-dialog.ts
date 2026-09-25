import { Component, inject, signal } from '@angular/core';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { ApiService } from '../../../core/api.service';
import { UserImportResult, UserImportRow } from '../../../core/models';

// Header aliases → the UserImportRow field they map to (headers are normalized first).
const HEADER_MAP: Record<string, keyof UserImportRow> = {
  firstname: 'firstName',
  first: 'firstName',
  givenname: 'firstName',
  middleinitial: 'middleInitial',
  middle: 'middleInitial',
  mi: 'middleInitial',
  lastname: 'lastName',
  last: 'lastName',
  surname: 'lastName',
  familyname: 'lastName',
  email: 'email',
  emailaddress: 'email',
  username: 'username',
  user: 'username',
  login: 'username',
  senateno: 'senateNo',
  senate: 'senateNo',
  senatenumber: 'senateNo',
  level: 'level',
  membership: 'level',
  membershiplevel: 'level',
  organization: 'organization',
  org: 'organization',
  company: 'organization',
  phone: 'phone',
  phonenumber: 'phone',
  mobile: 'phone',
  contact: 'phone',
  contactnumber: 'phone',
  role: 'role',
  notificationchannel: 'notificationChannel',
  channel: 'notificationChannel',
  notify: 'notificationChannel',
  notification: 'notificationChannel',
  passvia: 'notificationChannel',
};

const TEMPLATE_HEADERS =
  'First Name,Middle Initial,Last Name,Email,Username,Senate No,Level,Organization,Phone,Role,Notification Channel';
const TEMPLATE_SAMPLE =
  'Juan,D,Dela Cruz,juan.delacruz@example.com,,12345,Senator,Acme Corp,+639171234567,Participant,Email';

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[\s._#-]+/g, '');
}

// Parse CSV text into rows of string cells (handles quoted fields, embedded commas/newlines).
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  const s = text.replace(/\r\n?/g, '\n');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += c;
    }
  }
  // flush trailing cell/row
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** Modal to bulk-import user accounts from a CSV file. Each new account gets the default password. */
@Component({
  selector: 'app-user-import-dialog',
  imports: [MatDialogModule, MatButtonModule, MatIconModule, MatProgressBarModule],
  templateUrl: './user-import-dialog.html',
  styles: [
    `
      .import-body { min-width: min(520px, 82vw); }
      .drop-hint {
        border: 1px dashed var(--mat-sys-outline);
        border-radius: 10px;
        padding: 18px;
        text-align: center;
      }
      .file-row {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        margin-top: 10px;
      }
      .file-name { font-weight: 600; }
      .cols { font-size: 12.5px; color: var(--mat-sys-on-surface-variant); margin: 8px 0 0; }
      .preview-table { width: 100%; border-collapse: collapse; font-size: 12.5px; margin-top: 12px; }
      .preview-table th, .preview-table td {
        text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--mat-sys-outline-variant);
        white-space: nowrap;
      }
      .preview-wrap { overflow-x: auto; max-height: 220px; overflow-y: auto; }
      .summary { display: flex; gap: 16px; flex-wrap: wrap; margin: 4px 0 8px; }
      .summary .stat { font-weight: 700; font-size: 18px; }
      .summary .stat small { display: block; font-weight: 500; font-size: 12px; color: var(--mat-sys-on-surface-variant); }
      .stat.created { color: #1e8e3e; }
      .stat.skipped { color: #b8860b; }
      .stat.failed { color: var(--mat-sys-error); }
      .err-list { margin: 6px 0 0; padding: 0; list-style: none; max-height: 200px; overflow-y: auto; }
      .err-list li { font-size: 12.5px; padding: 3px 0; border-bottom: 1px solid var(--mat-sys-outline-variant); }
      .err-list .err-row { color: var(--mat-sys-on-surface-variant); }
      .note { font-size: 12.5px; color: var(--mat-sys-on-surface-variant); }
    `,
  ],
})
export class UserImportDialogComponent {
  private api = inject(ApiService);
  private ref = inject(MatDialogRef<UserImportDialogComponent>);

  fileName = signal<string | null>(null);
  rows = signal<UserImportRow[]>([]);
  parseError = signal<string | null>(null);
  importing = signal(false);
  result = signal<UserImportResult | null>(null);

  // First few parsed rows, for a preview.
  preview = () => this.rows().slice(0, 5);

  async onFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    this.parseError.set(null);
    this.result.set(null);
    this.rows.set([]);
    this.fileName.set(file.name);

    try {
      const text = await file.text();
      const table = parseCsv(text).filter((r) => r.some((c) => c.trim().length > 0));
      if (table.length < 2) {
        this.parseError.set('The file needs a header row and at least one data row.');
        return;
      }
      const headers = table[0].map(normalizeHeader);
      const fields = headers.map((h) => HEADER_MAP[h] ?? null);
      if (!fields.includes('firstName') || !fields.includes('lastName') || !fields.includes('email')) {
        this.parseError.set('The header row must include First Name, Last Name, and Email columns.');
        return;
      }
      const parsed: UserImportRow[] = table.slice(1).map((cells) => {
        const r: UserImportRow = {};
        fields.forEach((field, i) => {
          if (field) {
            const v = (cells[i] ?? '').trim();
            if (v) r[field] = v;
          }
        });
        return r;
      });
      this.rows.set(parsed);
    } catch {
      this.parseError.set('Could not read that file. Please upload a valid CSV.');
    }
  }

  downloadTemplate(): void {
    const blob = new Blob([`${TEMPLATE_HEADERS}\n${TEMPLATE_SAMPLE}\n`], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'user-import-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  runImport(): void {
    if (this.rows().length === 0 || this.importing()) return;
    this.importing.set(true);
    this.api.importUsers(this.rows()).subscribe({
      next: (res) => {
        this.importing.set(false);
        this.result.set(res);
      },
      error: (err) => {
        this.importing.set(false);
        this.parseError.set(err?.error?.message ?? 'Import failed. Please try again.');
      },
    });
  }

  // Close, telling the parent to reload when anything was created.
  done(): void {
    this.ref.close(this.result());
  }

  cancel(): void {
    this.ref.close(null);
  }
}
