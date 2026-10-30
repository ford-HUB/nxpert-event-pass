import { Routes } from '@angular/router';
import { authGuard, adminGuard, confirmerGuard, merchantGuard, nonMerchantGuard } from './core/guards';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'login' },
  {
    path: 'login',
    loadComponent: () => import('./pages/login/login').then((m) => m.LoginComponent),
  },
  {
    path: 'register',
    loadComponent: () => import('./pages/register/register').then((m) => m.RegisterComponent),
  },
  {
    path: 'verify/:token',
    loadComponent: () => import('./pages/verify/verify').then((m) => m.VerifyComponent),
  },
  {
    path: 'e/:slug',
    loadComponent: () =>
      import('./pages/public-event/public-event').then((m) => m.PublicEventComponent),
  },
  {
    // Public token magic-link: edit a registration's response without an account.
    path: 'r/:token',
    loadComponent: () =>
      import('./pages/registration-edit/registration-edit').then((m) => m.RegistrationEditComponent),
  },
  {
    // Module launcher: role-based cards for every area the user can open.
    path: 'home',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/home/home').then((m) => m.HomeComponent),
  },
  {
    path: 'admin/dashboard',
    canActivate: [adminGuard],
    loadComponent: () =>
      import('./pages/admin/dashboard/dashboard').then((m) => m.DashboardComponent),
  },
  {
    path: 'events',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/events-browse/events-browse').then((m) => m.EventsBrowseComponent),
  },
  {
    // Event calendar (merchants only scan meal stubs).
    path: 'calendar',
    canActivate: [nonMerchantGuard],
    loadComponent: () => import('./pages/calendar/calendar').then((m) => m.CalendarComponent),
  },
  {
    // Mail Planner: send plans for admins, reminders on received mails for everyone.
    path: 'mail-planner',
    canActivate: [nonMerchantGuard],
    loadComponent: () =>
      import('./pages/mail-planner/mail-planner').then((m) => m.MailPlannerComponent),
  },
  {
    path: 'my-events',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/my-events/my-events').then((m) => m.MyEventsComponent),
  },
  {
    path: 'account',
    canActivate: [nonMerchantGuard],
    loadComponent: () => import('./pages/account/account').then((m) => m.AccountComponent),
  },
  {
    path: 'admin/users',
    canActivate: [adminGuard],
    loadComponent: () => import('./pages/admin/users/users').then((m) => m.UsersComponent),
  },
  {
    path: 'admin/settings',
    canActivate: [adminGuard],
    loadComponent: () => import('./pages/admin/settings/settings').then((m) => m.SettingsComponent),
  },
  {
    path: 'admin/events',
    canActivate: [confirmerGuard],
    loadComponent: () =>
      import('./pages/admin/events-list/events-list').then((m) => m.EventsListComponent),
  },
  {
    path: 'admin/events/new',
    canActivate: [adminGuard],
    loadComponent: () =>
      import('./pages/admin/event-form/event-form').then((m) => m.EventFormComponent),
  },
  {
    path: 'admin/events/:id/edit',
    canActivate: [adminGuard],
    loadComponent: () =>
      import('./pages/admin/event-form/event-form').then((m) => m.EventFormComponent),
  },
  {
    path: 'admin/events/:id',
    canActivate: [confirmerGuard],
    loadComponent: () =>
      import('./pages/admin/event-detail/event-detail').then((m) => m.EventDetailComponent),
  },
  {
    // Door TV for camera check-in through the face recognition engine.
    path: 'scanner/:eventId/tv',
    canActivate: [adminGuard],
    loadComponent: () => import('./pages/face-tv/face-tv').then((m) => m.FaceTvComponent),
  },
  {
    path: 'scanner/:eventId',
    canActivate: [adminGuard],
    loadComponent: () => import('./pages/scanner/scanner').then((m) => m.ScannerComponent),
  },
  {
    path: 'merchant/scan',
    canActivate: [merchantGuard],
    loadComponent: () => import('./pages/merchant/meal-scanner').then((m) => m.MealScannerComponent),
  },
  { path: '**', redirectTo: 'login' },
];
