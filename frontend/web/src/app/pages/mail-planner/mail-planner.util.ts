import { MailChannel, MailKind, PlanSend } from './mail-planner.model';

export const BODY_MAX = 4000;
export const SUBJECT_MAX = 200;
export const EVENT_NAME_MAX = 200;
// Same cap as InviteRequest: at most 200 typed-in addresses per plan.
export const EXTRA_EMAILS_MAX = 200;
// Same cap as the server (MailPlansController.MaxCc).
export const CC_MAX = 50;
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const MAIL_KINDS: MailKind[] = ['Reminder', 'Announcement', 'Follow-up'];
export const MAIL_CHANNELS: MailChannel[] = ['Email', 'Viber', 'Both'];

export const KIND_ICONS: Record<MailKind, string> = {
  Reminder: 'alarm',
  Announcement: 'campaign',
  'Follow-up': 'reply',
};

export const CHANNEL_ICONS: Record<MailChannel, string> = {
  Email: 'alternate_email',
  Viber: 'chat',
  Both: 'forum',
};

export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** `d` moved by `days`; with `hour`, also set to that hour on the hour. */
export function shift(d: Date, days: number, hour?: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + days);
  if (hour !== undefined) next.setHours(hour, 0, 0, 0);
  return next;
}

/** A plan's days in send order. */
export function sortedSends(sends: PlanSend[]): PlanSend[] {
  return [...sends].sort((a, b) => a.at.getTime() - b.at.getTime());
}
