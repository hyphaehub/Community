import { formatMass, formatMoney } from '@hyphaehub/core';

export { formatMass, formatMoney };

export function money(cents: number | null | undefined): string {
  return formatMoney(cents ?? 0);
}

export function perGram(cents: number | null | undefined): string {
  return cents == null ? '—' : `${formatMoney(cents)}/g`;
}

export function formatDate(value: string | number | null | undefined): string {
  if (value == null) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
