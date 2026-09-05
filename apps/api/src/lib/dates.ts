/** Convert an ISO string / number / Date into a Date, or undefined when null-ish. */
export function toDate(value: string | number | Date | null | undefined): Date | undefined {
  if (value == null) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/**
 * Return a copy of `obj` with the given keys coerced from ISO strings to Date
 * instances (invalid/null → undefined). The return type reflects the coercion so
 * the result drops straight into Drizzle inserts/updates.
 */
export function withDates<T extends Record<string, unknown>, K extends keyof T>(
  obj: T,
  keys: K[],
): Omit<T, K> & { [P in K]: Date | undefined } {
  const out: Record<string, unknown> = { ...obj };
  for (const k of keys) {
    out[k as string] = toDate(obj[k] as string | number | Date | null | undefined);
  }
  return out as Omit<T, K> & { [P in K]: Date | undefined };
}
