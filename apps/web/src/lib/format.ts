import { formatMass, formatMoney } from '@hyphaehub/core';

export { formatMass, formatMoney };

type DateLike = string | number | Date | null | undefined;

/** Short date, e.g. "Feb 10, 2026". */
export function formatDate(value: DateLike): string {
  if (value == null) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Relative-ish "3 days ago" / "in 2 days". */
export function fromNow(value: DateLike): string {
  if (value == null) return '';
  const d = new Date(value).getTime();
  if (Number.isNaN(d)) return '';
  const diff = Math.round((d - Date.now()) / 86_400_000);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (Math.abs(diff) >= 1) return rtf.format(diff, 'day');
  return 'today';
}

/** Cents → "$1.23" (null-safe). */
export function money(cents: number | null | undefined): string {
  return formatMoney(cents ?? 0);
}

/** Cents-per-gram → "$1.23/g". */
export function perGram(cents: number | null | undefined): string {
  if (cents == null) return '—';
  return `${formatMoney(cents)}/g`;
}
