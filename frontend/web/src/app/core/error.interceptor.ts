import { HttpInterceptorFn, HttpErrorResponse, HttpContextToken } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { ToastService } from './toast.service';

/**
 * Opt a single request out of the automatic error toast (e.g. a probe whose
 * failure is expected and handled inline):
 *   http.get(url, { context: new HttpContext().set(SKIP_ERROR_TOAST, true) })
 */
export const SKIP_ERROR_TOAST = new HttpContextToken<boolean>(() => false);

/**
 * Global safety net: any failed HTTP call surfaces as an error toast, so no
 * failure is ever swallowed silently. Components may still add their own,
 * more specific toast — the ToastService de-dupes the pair. The 401 → login
 * redirect stays in auth.interceptor; here we only notify.
 */
export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const toast = inject(ToastService);
  return next(req).pipe(
    catchError((err: HttpErrorResponse) => {
      if (!req.context.get(SKIP_ERROR_TOAST)) {
        // Defer one tick so a component's own error callback (which usually has
        // a more specific message) toasts first; the ToastService then de-dupes
        // this generic fallback away. If no component handles it, this fires.
        setTimeout(() => toast.error(messageFor(err)), 0);
      }
      return throwError(() => err);
    }),
  );
};

function messageFor(err: HttpErrorResponse): string {
  const body = err.error;
  // Prefer a human-readable message the API returned.
  if (typeof body === 'string' && body.trim()) return body;
  if (body?.message && typeof body.message === 'string') return body.message;

  switch (err.status) {
    case 0:
      return 'Network error — please check your connection.';
    case 401:
      return 'Your session has expired. Please sign in again.';
    case 403:
      return "You don't have permission to do that.";
    case 404:
      return 'The requested item could not be found.';
    case 422:
      return 'Some of the information provided is invalid.';
    default:
      return err.status >= 500
        ? 'Something went wrong on the server. Please try again.'
        : 'The request could not be completed. Please try again.';
  }
}
