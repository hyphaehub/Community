import type { MassUnit } from './enums';

/** Exact gram value of one unit of each supported mass unit. */
export const GRAMS_PER: Record<MassUnit, number> = {
  g: 1,
  kg: 1000,
  oz: 28.349523125,
  lb: 453.59237,
};

/** Convert a value in the given unit to grams. */
export function toGrams(value: number, unit: MassUnit): number {
  return value * GRAMS_PER[unit];
}

/** Convert grams to the given unit. */
export function fromGrams(grams: number, unit: MassUnit): number {
  return grams / GRAMS_PER[unit];
}

/** Round to a fixed number of decimals (default 2), avoiding float noise. */
export function round(value: number, decimals = 2): number {
  const f = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * f) / f;
}

/** Human-readable mass, e.g. `formatMass(1234)` → "1.23 kg". */
export function formatMass(grams: number, unit?: MassUnit): string {
  if (unit) return `${round(fromGrams(grams, unit))} ${unit}`;
  if (grams >= 1000) return `${round(grams / 1000)} kg`;
  return `${round(grams)} g`;
}

/** Money: cents → display string. `formatMoney(1299)` → "$12.99". */
export function formatMoney(cents: number, currency = 'USD', locale = 'en-US'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(cents / 100);
}

/** Parse a dollar amount (e.g. "12.99" or 12.99) into integer cents. */
export function toCents(dollars: number | string): number {
  const n = typeof dollars === 'string' ? Number.parseFloat(dollars) : dollars;
  return Math.round(n * 100);
}

/** Whole days between two dates (b − a), floored. */
export function daysBetween(a: Date | string | number, b: Date | string | number): number {
  const start = new Date(a).getTime();
  const end = new Date(b).getTime();
  return Math.floor((end - start) / 86_400_000);
}
