/**
 * Helpers for staying within Cloudflare D1's hard limit of **100 bound
 * parameters per SQL statement**. A multi-row INSERT binds one parameter per
 * column per row (including drizzle `$defaultFn` columns like id/createdAt/
 * updatedAt), so a large `.values([...])` will fail with
 * "D1_ERROR: too many SQL variables" once rows × columns > 100.
 *
 * Split the rows into several INSERTs and run them (plus any related writes) in
 * a single `db.batch([...])`, which is atomic on D1 — the only way to get
 * all-or-nothing behaviour there, since D1 has no interactive `transaction()`.
 */

/** D1's bound-parameter ceiling per statement. */
export const D1_MAX_PARAMS = 100;

/**
 * Max rows per INSERT so that rows × paramsPerRow stays under {@link D1_MAX_PARAMS}
 * with a little headroom. `paramsPerRow` is the number of columns actually bound
 * per row (explicit fields + drizzle default columns).
 */
export function insertChunkSize(paramsPerRow: number): number {
  const safe = Math.floor((D1_MAX_PARAMS - 10) / Math.max(1, paramsPerRow));
  return Math.max(1, safe);
}

/** Split an array into contiguous chunks of at most `size`. */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  const step = Math.max(1, size);
  for (let i = 0; i < items.length; i += step) out.push(items.slice(i, i + step));
  return out;
}
