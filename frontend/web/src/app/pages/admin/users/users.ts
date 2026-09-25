import { Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { BreakpointObserver } from '@angular/cdk/layout';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { ApiService } from '../../../core/api.service';
import { ToastService } from '../../../core/toast.service';
import { UserDto } from '../../../core/models';
import { UserFormDialogComponent } from './user-form-dialog';
import { UserImportDialogComponent } from './user-import-dialog';
import { UserImportResult } from '../../../core/models';

@Component({
  selector: 'app-users',
  imports: [
    FormsModule,
    MatCardModule,
    MatTableModule,
    MatPaginatorModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatTooltipModule,
    MatProgressSpinnerModule,
    MatDialogModule,
  ],
  templateUrl: './users.html',
  styles: [
    `
      .count-line { margin: 0 0 12px; }
      .table-wrap { overflow-x: auto; }
      table { width: 100%; min-width: 900px; }
      /* Mobile: compact table (fewer columns) with expandable detail rows. */
      .detail-row { display: none; }
      @media (max-width: 768px) {
        table { min-width: 0; }
        .detail-row { display: table-row; }
      }
      .detail-cell { padding: 0 !important; border-bottom: none; }
      .u-detail { max-height: 0; overflow: hidden; transition: max-height 0.2s ease; }
      .u-detail.open { max-height: 480px; padding: 6px 16px 14px; }
      .u-dl { margin: 0; display: grid; gap: 6px; }
      .u-dl > div { display: flex; justify-content: space-between; gap: 16px; }
      .u-dl dt { margin: 0; color: var(--mat-sys-on-surface-variant); font-size: 13px; }
      .u-dl dd { margin: 0; font-weight: 600; font-size: 13px; text-align: right; }
      .u-name { font-weight: 600; display: inline-flex; align-items: center; gap: 6px; }
      .face-badge { color: var(--mat-sys-primary); }
      .u-sub { font-size: 12px; }
      .role-pill {
        padding: 2px 10px;
        border-radius: 999px;
        font-size: 12px;
        font-weight: 600;
        background: var(--mat-sys-surface-container-high);
      }
      .role-pill.admin {
        background: color-mix(in srgb, var(--mat-sys-primary) 18%, transparent);
        color: var(--mat-sys-primary);
      }
      .grant-chip {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 13px;
        font-weight: 600;
      }
      .grant-chip.yes { color: #1e8e3e; }
      .grant-chip.no { color: var(--mat-sys-on-surface-variant); }
      .notify-chip {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 13px;
        color: var(--mat-sys-on-surface-variant);
      }
      .notify-chip.viber { color: #7360f2; font-weight: 600; }
      .actions-cell { text-align: right; white-space: nowrap; }
      mat-paginator { background: transparent; }
      .expand-cell { width: 44px; }
      .expand-btn mat-icon { transition: transform 0.2s ease; }
      .expand-btn.open mat-icon { transform: rotate(180deg); }
      tr.mat-mdc-row:not(.detail-row) { cursor: default; }
    `,
  ],
})
export class UsersComponent implements OnInit {
  private api = inject(ApiService);
  private dialog = inject(MatDialog);
  private toast = inject(ToastService);

  private breakpoints = inject(BreakpointObserver);

  loading = signal(true);
  users = signal<UserDto[]>([]);
  search = signal('');

  // Pagination state.
  pageIndex = signal(0);
  pageSize = signal(10);
  readonly pageSizeOptions = [10, 25, 50, 100];

  // Which row's detail panel is open (mobile). Only one at a time.
  expandedId = signal<number | null>(null);

  // Reactive viewport flag: on narrow screens we drop to a compact column set
  // and reveal the hidden fields through an expandable detail row.
  isMobile = toSignal(
    this.breakpoints.observe('(max-width: 768px)').pipe(map((r) => r.matches)),
    { initialValue: false },
  );

  // Full column set (desktop) vs. compact set (mobile). The `expand` toggle and
  // `actions` bookend the compact view; everything else lives in the detail row.
  readonly desktopColumns = [
    'name',
    'username',
    'email',
    'senate',
    'organization',
    'role',
    'level',
    'notify',
    'grant',
    'actions',
  ];
  readonly mobileColumns = ['expand', 'name', 'role', 'actions'];

  displayedColumns = computed(() => (this.isMobile() ? this.mobileColumns : this.desktopColumns));

  filtered = computed(() => {
    const q = this.search().trim().toLowerCase();
    const list = this.users();
    if (!q) return list;
    return list.filter(
      (u) =>
        u.fullName.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        (u.username ?? '').toLowerCase().includes(q) ||
        (u.senateNo ?? '').toLowerCase().includes(q) ||
        (u.level ?? '').toLowerCase().includes(q) ||
        (u.organization ?? '').toLowerCase().includes(q),
    );
  });

  // The current page slice, derived from the filtered list + paginator state.
  paged = computed(() => {
    const list = this.filtered();
    const start = this.pageIndex() * this.pageSize();
    return list.slice(start, start + this.pageSize());
  });

  confirmerCount = computed(() => this.users().filter((u) => u.canConfirmRegistrations).length);

  constructor() {
    // A new search shrinks the list, so jump back to the first page to avoid
    // landing on an out-of-range (blank) page.
    effect(() => {
      this.search();
      this.pageIndex.set(0);
    });
  }

  onPage(e: PageEvent): void {
    this.pageIndex.set(e.pageIndex);
    this.pageSize.set(e.pageSize);
  }

  toggleExpand(u: UserDto): void {
    this.expandedId.update((id) => (id === u.id ? null : u.id));
  }

  isExpanded(u: UserDto): boolean {
    return this.expandedId() === u.id;
  }

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.api.listUsers().subscribe({
      next: (u) => {
        this.users.set(u);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  add(): void {
    this.dialog
      .open(UserFormDialogComponent, { data: null, width: '520px' })
      .afterClosed()
      .subscribe((res) => {
        if (res) {
          this.toast.success('User added.');
          this.load();
        }
      });
  }

  importUsers(): void {
    this.dialog
      .open(UserImportDialogComponent, { width: '600px', autoFocus: false })
      .afterClosed()
      .subscribe((res: UserImportResult | null | undefined) => {
        if (res && res.created > 0) {
          this.toast.success(`Imported ${res.created} user${res.created === 1 ? '' : 's'}.`);
          this.load();
        }
      });
  }

  edit(user: UserDto): void {
    this.dialog
      .open(UserFormDialogComponent, { data: user, width: '520px' })
      .afterClosed()
      .subscribe((res) => {
        if (res) {
          this.toast.success('User updated.');
          this.load();
        }
      });
  }

  remove(user: UserDto): void {
    if (!confirm(`Delete ${user.fullName}? This cannot be undone.`)) return;
    this.api.deleteUser(user.id).subscribe({
      next: () => {
        this.toast.success('User deleted.');
        this.load();
      },
      error: (err) => this.toast.error(err?.error?.message ?? 'Could not delete user.'),
    });
  }
}
