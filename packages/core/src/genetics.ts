import {
  type CultureType,
  LIBRARY_VIABILITY_DAYS,
  type LibraryFormat,
  type SourceType,
} from './enums';

const DAY_MS = 86_400_000;

/** The culture type a stored library item of a given format represents. */
export function cultureTypeForLibraryFormat(format: LibraryFormat): CultureType {
  switch (format) {
    case 'LIQUID_CULTURE':
      return 'LIQUID_CULTURE';
    case 'AGAR_PLATE':
    case 'AGAR_SLANT':
    case 'CRYO':
      return 'AGAR';
    case 'GRAIN':
      return 'GRAIN';
    default:
      // SPORE_PRINT, SPORE_SYRINGE, OTHER → an origin culture.
      return 'SOURCE';
  }
}

/** A sensible library storage format for a drawn culture type (for viability tracking). */
export function libraryFormatForCultureType(type: CultureType): LibraryFormat {
  switch (type) {
    case 'LIQUID_CULTURE':
      return 'LIQUID_CULTURE';
    case 'AGAR':
      return 'AGAR_PLATE';
    case 'GRAIN':
      return 'GRAIN';
    default:
      return 'OTHER';
  }
}

/** The SOURCE origin kind for a library format, or null when it is not a source. */
export function sourceTypeForLibraryFormat(format: LibraryFormat): SourceType | null {
  switch (format) {
    case 'SPORE_SYRINGE':
      return 'SPORE_SYRINGE';
    case 'SPORE_PRINT':
      return 'SPORE_PRINT';
    case 'LIQUID_CULTURE':
      return 'LIQUID_CULTURE';
    case 'AGAR_PLATE':
    case 'AGAR_SLANT':
    case 'CRYO':
      return 'AGAR_CULTURE';
    case 'OTHER':
      return 'OTHER';
    default:
      return null;
  }
}

/** A parent → child lineage edge. */
export interface LineageEdge {
  parentCultureId: string;
  childCultureId: string;
}

/**
 * Generation (transfer count from the origin) for each culture in a lineage
 * graph. Roots (no parent within the set) are generation 0; a child is
 * max(parents) + 1. Pure + deterministic; tolerant of DAGs via relaxation.
 */
export function computeGenerations(
  cultureIds: string[],
  edges: LineageEdge[],
): Map<string, number> {
  const ids = new Set(cultureIds);
  const gen = new Map<string, number>();
  for (const id of cultureIds) gen.set(id, 0);
  // Only consider edges whose both ends are in the set.
  const inEdges = edges.filter((e) => ids.has(e.parentCultureId) && ids.has(e.childCultureId));
  // Relax up to N times (longest path ≤ number of nodes).
  for (let i = 0; i < cultureIds.length; i++) {
    let changed = false;
    for (const e of inEdges) {
      const cand = (gen.get(e.parentCultureId) ?? 0) + 1;
      if (cand > (gen.get(e.childCultureId) ?? 0)) {
        gen.set(e.childCultureId, cand);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return gen;
}

/**
 * When a stored culture should be refreshed (re-transferred to a new master)
 * before viability lapses. Null when the format keeps effectively indefinitely
 * (e.g. cryo) or the base date is unknown.
 */
export function reviveByDate(
  format: LibraryFormat,
  storedAt?: string | number | Date | null,
  lastRevivedAt?: string | number | Date | null,
): Date | null {
  const days = LIBRARY_VIABILITY_DAYS[format];
  if (days == null) return null;
  const base = lastRevivedAt ?? storedAt;
  if (base == null) return null;
  const t = new Date(base).getTime();
  if (Number.isNaN(t)) return null;
  return new Date(t + days * DAY_MS);
}

export type ReviveStatus = 'ok' | 'due' | 'overdue' | 'indefinite';

/** Freshness of a stored culture relative to its revive-by date. */
export function reviveStatus(
  format: LibraryFormat,
  storedAt?: string | number | Date | null,
  lastRevivedAt?: string | number | Date | null,
  now: Date = new Date(),
  dueWindowDays = 21,
): { status: ReviveStatus; reviveBy: Date | null } {
  const reviveBy = reviveByDate(format, storedAt, lastRevivedAt);
  if (!reviveBy) return { status: 'indefinite', reviveBy: null };
  const diffDays = (reviveBy.getTime() - now.getTime()) / DAY_MS;
  if (diffDays < 0) return { status: 'overdue', reviveBy };
  if (diffDays <= dueWindowDays) return { status: 'due', reviveBy };
  return { status: 'ok', reviveBy };
}
