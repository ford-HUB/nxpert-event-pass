import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { AuthService } from '../../core/auth.service';

type ModuleCategory = 'Events' | 'Operations' | 'Admin' | 'Account';

interface AppModule {
  title: string;
  subtitle: string;
  icon: string;
  link: string;
  category: ModuleCategory;
}

// Tab order on the launcher; only categories the user actually has modules in are shown.
const CATEGORY_ORDER: ModuleCategory[] = ['Events', 'Operations', 'Admin', 'Account'];

@Component({
  selector: 'app-home',
  imports: [RouterLink, MatIconModule],
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class HomeComponent {
  private readonly auth = inject(AuthService);

  readonly filter = signal<'All' | ModuleCategory>('All');

  // Modules available to the signed-in user, mirroring the role-based navigation.
  readonly modules = computed<AppModule[]>(() => {
    const account: AppModule = {
      title: 'My Account',
      subtitle: 'Profile & Password',
      icon: 'manage_accounts',
      link: '/account',
      category: 'Account',
    };

    if (this.auth.isAdmin()) {
      return [
        { title: 'Dashboard', subtitle: 'Insights & KPI', icon: 'insights', link: '/admin/dashboard', category: 'Operations' },
        { title: 'Events', subtitle: 'Manage & Schedule', icon: 'event', link: '/admin/events', category: 'Events' },
        { title: 'Calendar', subtitle: 'Event Dates & Invitations', icon: 'calendar_month', link: '/calendar', category: 'Events' },
        { title: 'Mail Planner', subtitle: 'Send Days & Reminders', icon: 'schedule_send', link: '/mail-planner', category: 'Events' },
        { title: 'Browse Events', subtitle: 'Open Registrations', icon: 'travel_explore', link: '/events', category: 'Events' },
        { title: 'My Events', subtitle: 'Passes & Tickets', icon: 'confirmation_number', link: '/my-events', category: 'Events' },
        { title: 'Meal Scanner', subtitle: 'Meal Stub Redemption', icon: 'restaurant', link: '/merchant/scan', category: 'Operations' },
        { title: 'Users', subtitle: 'People & Access', icon: 'group', link: '/admin/users', category: 'Admin' },
        { title: 'Settings', subtitle: 'System Config', icon: 'settings', link: '/admin/settings', category: 'Admin' },
        account,
      ];
    }
    if (this.auth.isMerchant()) {
      return [
        { title: 'Meal Scanner', subtitle: 'Meal Stub Redemption', icon: 'restaurant', link: '/merchant/scan', category: 'Operations' },
      ];
    }
    const participant: AppModule[] = [
      { title: 'Browse Events', subtitle: 'Open Registrations', icon: 'travel_explore', link: '/events', category: 'Events' },
      { title: 'My Events', subtitle: 'Passes & Tickets', icon: 'confirmation_number', link: '/my-events', category: 'Events' },
      { title: 'Calendar', subtitle: 'Event Dates & Invitations', icon: 'calendar_month', link: '/calendar', category: 'Events' },
      { title: 'Mail Planner', subtitle: 'Mail Reminders', icon: 'schedule_send', link: '/mail-planner', category: 'Events' },
      account,
    ];
    if (this.auth.canConfirm()) {
      return [
        { title: 'Confirm Registrations', subtitle: 'Review & Approve', icon: 'how_to_reg', link: '/admin/events', category: 'Operations' },
        ...participant,
      ];
    }
    return participant;
  });

  readonly categories = computed(() => {
    const present = new Set(this.modules().map((m) => m.category));
    return CATEGORY_ORDER.filter((c) => present.has(c));
  });

  readonly visible = computed(() => {
    const f = this.filter();
    return f === 'All' ? this.modules() : this.modules().filter((m) => m.category === f);
  });
}
