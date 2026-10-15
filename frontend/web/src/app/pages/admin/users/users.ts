import { Component, ElementRef, OnInit, computed, effect, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { ApiService } from '../../../core/api.service';
import { ToastService } from '../../../core/toast.service';
import { ConfirmService } from '../../../core/confirm.service';
import { UserDto, UserImportResult } from '../../../core/models';
import { UserFormPanelComponent } from './user-form-panel';
import { UserImportDialogComponent } from './user-import-dialog';

type RoleFilter = 'All' | 'Admin' | 'Participant' | 'Merchant' | 'Confirmers';

// User Master: list of users on the left, the selected (or new) record's form on the right.
@Component({
  selector: 'app-users',
  imports: [
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatTooltipModule,
    MatProgressSpinnerModule,
    MatProgressBarModule,
    MatDialogModule,
    UserFormPanelComponent,
  ],
  templateUrl: './users.html',
  styleUrl: './users.scss',
})
export class UsersComponent implements OnInit {
  private api = inject(ApiService);
  private dialog = inject(MatDialog);
  private toast = inject(ToastService);
  private confirmer = inject(ConfirmService);

  private readonly panel = viewChild.required(UserFormPanelComponent);
  private readonly formPane = viewChild<ElementRef<HTMLElement>>('formPane');

  loading = signal(true);
  users = signal<UserDto[]>([]);
  search = signal('');
  roleFilter = signal<RoleFilter>('All');
  readonly roleFilters: RoleFilter[] = ['All', 'Admin', 'Participant', 'Merchant', 'Confirmers'];

  /** The row shown in the form; null = a new, unsaved record. */
  selected = signal<UserDto | null>(null);

  pageIndex = signal(0);
  readonly pageSize = 15;

  filtered = computed(() => {
    const q = this.search().trim().toLowerCase();
    const rf = this.roleFilter();
    return this.users().filter((u) => {
      if (rf === 'Confirmers' && !(u.canConfirmRegistrations || u.role === 'Admin' || u.role === 'SuperAdmin')) return false;
      if (rf === 'Admin' && u.role !== 'Admin' && u.role !== 'SuperAdmin') return false;
      if ((rf === 'Participant' || rf === 'Merchant') && u.role !== rf) return false;
      if (!q) return true;
      return (
        u.fullName.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        (u.username ?? '').toLowerCase().includes(q) ||
        (u.senateNo ?? '').toLowerCase().includes(q) ||
        (u.level ?? '').toLowerCase().includes(q) ||
        (u.organization ?? '').toLowerCase().includes(q)
      );
    });
  });

  pageCount = computed(() => Math.max(1, Math.ceil(this.filtered().length / this.pageSize)));

  paged = computed(() => {
    const start = this.pageIndex() * this.pageSize;
    return this.filtered().slice(start, start + this.pageSize);
  });

  // Blank rows pad the grid to a full page so the list keeps its shape, as in the concept.
  fillerRows = computed(() => Array.from({ length: Math.max(0, this.pageSize - this.paged().length) }));

  constructor() {
    // A new search/filter shrinks the list, so jump back to the first page.
    effect(() => {
      this.search();
      this.roleFilter();
      this.pageIndex.set(0);
    });
  }

  ngOnInit(): void {
    this.load();
  }

  load(selectId?: number): void {
    this.loading.set(true);
    this.api.listUsers().subscribe({
      next: (list) => {
        this.users.set(list);
        this.loading.set(false);
        const id = selectId ?? this.selected()?.id;
        this.selected.set(id != null ? (list.find((u) => u.id === id) ?? null) : null);
      },
      error: () => this.loading.set(false),
    });
  }

  // Leaving a record with unsaved edits asks first.
  private async confirmDiscard(): Promise<boolean> {
    if (!this.panel().isDirty()) return true;
    return this.confirmer.confirm({
      title: 'Discard changes?',
      message: 'You have unsaved changes to this user. They will be lost if you continue.',
      confirmText: 'Discard',
      cancelText: 'Keep editing',
      tone: 'warning',
    });
  }

  async select(u: UserDto): Promise<void> {
    if (this.selected()?.id === u.id || !(await this.confirmDiscard())) return;
    this.selected.set(u);
    // On stacked (mobile) layout, bring the form into view.
    if (window.matchMedia('(max-width: 900px)').matches) {
      this.formPane()?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  async newUser(): Promise<void> {
    if (!(await this.confirmDiscard())) return;
    this.selected.set(null);
  }

  save(): void {
    this.panel().save();
  }

  onSaved(u: UserDto): void {
    this.load(u.id);
  }

  async refresh(): Promise<void> {
    if (!(await this.confirmDiscard())) return;
    this.load();
  }

  async remove(): Promise<void> {
    const u = this.selected();
    if (!u) return;
    const ok = await this.confirmer.confirm({
      title: 'Delete user?',
      message: `${u.fullName} will be permanently removed. This cannot be undone.`,
      confirmText: 'Delete',
      tone: 'error',
    });
    if (!ok) return;
    this.api.deleteUser(u.id).subscribe({
      next: () => {
        this.toast.success('User deleted.');
        this.selected.set(null);
        this.load();
      },
      error: (err) => this.toast.error(err?.error?.message ?? 'Could not delete user.'),
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

  // Export the filtered list as CSV.
  exportCsv(): void {
    const rows = this.filtered();
    if (!rows.length) {
      this.toast.info('No users to export.');
      return;
    }
    const header = ['Name', 'Username', 'Email', 'ID No.', 'Chapter', 'Role', 'Designation', 'Phone', 'Pass via', 'Can confirm'];
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = rows.map((u) =>
      [u.fullName, u.username, u.email, u.senateNo, u.organization, u.role, u.level, u.phone,
        u.notificationChannel, u.canConfirmRegistrations ? 'Yes' : 'No'].map(esc).join(','),
    );
    const blob = new Blob(['﻿' + [header.map(esc).join(','), ...lines].join('\r\n')], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `users-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  prevPage(): void {
    this.pageIndex.update((p) => Math.max(0, p - 1));
  }

  nextPage(): void {
    this.pageIndex.update((p) => Math.min(this.pageCount() - 1, p + 1));
  }
}
