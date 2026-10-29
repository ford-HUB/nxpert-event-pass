export const ALL_USERS = '@n-pax';

export function invitationErrorMessage(error: { status?: number; error?: unknown }): string {
  const body = error.error;
  const draft = ' Your draft has been kept.';
  if (body && typeof body === 'object') {
    const problem = body as { message?: unknown; errors?: Record<string, unknown> };
    if (typeof problem.message === 'string' && problem.message.trim()) return problem.message + draft;
    const details = Object.values(problem.errors ?? {}).flat().filter((v): v is string => typeof v === 'string');
    if (details.length) return details.join(' ') + draft;
  }
  switch (error.status) {
    case 404:
    case 405:
      return 'The invitation composer endpoint is unavailable on the API server. Deploy the updated backend, then reload this page.' + draft;
    case 0:
      return 'Cannot reach the email API. Check the connection and server availability.' + draft;
    case 401:
      return 'Your session has expired. Sign in again before sending invitations.' + draft;
    case 403:
      return 'Only an administrator can send event invitations.' + draft;
    case 413:
      return 'The server rejected the message size. Use smaller images or update the server upload limit.' + draft;
    case 400:
    case 422:
      return 'The server rejected the invitation. Check the recipients, subject and image limits.' + draft;
    default:
      return `The API could not process the invitation${error.status ? ` (HTTP ${error.status})` : ''}. Check the server logs before retrying.` + draft;
  }
}

export function recipientAddress(value: string): string | null {
  const address = value.trim().toLowerCase();
  if (address === ALL_USERS) return address;
  return address.length <= 256 && /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(address) ? address : null;
}

export function expandRecipients(to: string[], cc: string[], directory: string[]): { to: string[]; cc: string[] } {
  const users = directory.map(recipientAddress).filter((e): e is string => !!e && e !== ALL_USERS);
  const expand = (entries: string[]) => [...new Set(entries.flatMap(e => e === ALL_USERS ? users : [e]))];
  const primary = expand(to);
  return { to: primary, cc: expand(cc).filter(e => !primary.includes(e)) };
}
