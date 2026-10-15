// Shared look for toasts and the confirm dialog: one icon + heading per tone.
export type AlertTone = 'success' | 'error' | 'warning' | 'info';

export const ALERT_TONES: Record<AlertTone, { icon: string; title: string }> = {
  success: { icon: 'check_circle', title: 'Success' },
  error: { icon: 'error', title: 'Something went wrong' },
  warning: { icon: 'warning', title: 'Heads up' },
  info: { icon: 'info', title: 'Notice' },
};
