import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

// The default landing page for a logged-in user, by role.
function homeFor(auth: AuthService): string {
  return auth.isMerchant() ? '/merchant/scan' : '/my-events';
}

export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (auth.isLoggedIn()) return true;
  return router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
};

export const adminGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (auth.isAdmin()) return true;
  if (auth.isLoggedIn()) return router.createUrlTree([homeFor(auth)]);
  return router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
};

// Admins OR users granted the "confirm registrations" permission.
export const confirmerGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (auth.canConfirm()) return true;
  if (auth.isLoggedIn()) return router.createUrlTree([homeFor(auth)]);
  return router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
};

// Routes hidden from merchant accounts (e.g. Edit account). Merchants can only scan meal stubs,
// so they're bounced to their scanner; everyone else logged-in passes.
export const nonMerchantGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (auth.isLoggedIn() && !auth.isMerchant()) return true;
  if (auth.isLoggedIn()) return router.createUrlTree([homeFor(auth)]);
  return router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
};

// Merchant-only routes (the meal-stub scanner).
export const merchantGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (auth.isMerchant() || auth.isAdmin()) return true;
  if (auth.isLoggedIn()) return router.createUrlTree([homeFor(auth)]);
  return router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
};
