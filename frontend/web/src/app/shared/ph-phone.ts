// Philippine mobile-number helpers shared across forms.
// Canonical display format: "+63 9XX XXX XXXX" (10 subscriber digits, always starting with 9).

// Formats arbitrary input into the PH mobile mask. Accepts local (09xx…), +63/63-prefixed,
// or bare subscriber digits; empty stays empty. Does not force a leading 9 — validation does that.
export function formatPhMobile(value: string | null | undefined): string {
  let d = (value ?? '').replace(/\D/g, '');
  if (d.startsWith('63')) d = d.slice(2);
  else if (d.startsWith('0')) d = d.slice(1);
  d = d.slice(0, 10);
  if (d.length === 0) return '';
  let out = '+63 ' + d.slice(0, 3);
  if (d.length > 3) out += ' ' + d.slice(3, 6);
  if (d.length > 6) out += ' ' + d.slice(6, 10);
  return out;
}

// True when the value is a complete PH mobile number: "+63 9XX XXX XXXX" (starts with +639).
export function isCompletePhMobile(value: string | null | undefined): boolean {
  return /^\+63 9\d{2} \d{3} \d{4}$/.test((value ?? '').trim());
}
