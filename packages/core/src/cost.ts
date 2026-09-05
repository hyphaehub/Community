import type { CostCategory } from './enums';
import { daysBetween, round } from './units';

/** A single cost line item (money stored as integer cents). */
export interface CostLine {
  amountCents: number;
  category?: CostCategory;
}

/** A harvested flush. `dryWeightG` is null until the flush has been dried. */
export interface HarvestLine {
  wetWeightG: number;
  dryWeightG?: number | null;
  flushNumber?: number | null;
  harvestedAt?: string | Date | number | null;
}

/** Sum of a set of cost lines, in cents. */
export function sumCents(lines: CostLine[]): number {
  return lines.reduce((acc, l) => acc + (l.amountCents || 0), 0);
}

/** Total cost plus a breakdown by category. */
export function rollupCosts(lines: CostLine[]): {
  totalCents: number;
  byCategory: Partial<Record<CostCategory, number>>;
} {
  const byCategory: Partial<Record<CostCategory, number>> = {};
  let totalCents = 0;
  for (const line of lines) {
    const amount = line.amountCents || 0;
    totalCents += amount;
    const cat = line.category ?? 'OTHER';
    byCategory[cat] = (byCategory[cat] ?? 0) + amount;
  }
  return { totalCents, byCategory };
}

export interface YieldTotals {
  totalWetG: number;
  totalDryG: number;
  harvestCount: number;
  /** Number of distinct flushes recorded. */
  flushCount: number;
  /** Dried mass / fresh mass (e.g. ~0.10 for many species). Null if no wet mass. */
  dryRatio: number | null;
}

/** Aggregate wet/dry weights across all flushes of a batch or tub. */
export function yieldTotals(harvests: HarvestLine[]): YieldTotals {
  let totalWetG = 0;
  let totalDryG = 0;
  const flushes = new Set<number>();
  for (const h of harvests) {
    totalWetG += h.wetWeightG || 0;
    totalDryG += h.dryWeightG || 0;
    if (h.flushNumber != null) flushes.add(h.flushNumber);
  }
  return {
    totalWetG: round(totalWetG),
    totalDryG: round(totalDryG),
    harvestCount: harvests.length,
    flushCount: flushes.size || harvests.length,
    dryRatio: totalWetG > 0 ? round(totalDryG / totalWetG, 4) : null,
  };
}

/**
 * Biological efficiency (%): fresh mushroom mass harvested relative to the dry
 * weight of the substrate. Returns null if substrate weight is unknown/zero.
 */
export function biologicalEfficiency(totalWetG: number, drySubstrateG?: number | null): number | null {
  if (!drySubstrateG || drySubstrateG <= 0) return null;
  return round((totalWetG / drySubstrateG) * 100, 1);
}

/** Cost per gram of dried yield, in cents. Null when no dry yield yet. */
export function costPerDryGramCents(totalCents: number, totalDryG: number): number | null {
  if (totalDryG <= 0) return null;
  return round(totalCents / totalDryG, 2);
}

/** Cost per gram of fresh yield, in cents. Null when no wet yield. */
export function costPerWetGramCents(totalCents: number, totalWetG: number): number | null {
  if (totalWetG <= 0) return null;
  return round(totalCents / totalWetG, 2);
}

export interface BatchSummaryInput {
  costs: CostLine[];
  harvests: HarvestLine[];
  /** Dry substrate weight (grams) for biological-efficiency calc. */
  drySubstrateG?: number | null;
  /** When the run started (for days-to-harvest). */
  startedAt?: string | Date | number | null;
}

export interface BatchSummary {
  cost: { totalCents: number; byCategory: Partial<Record<CostCategory, number>> };
  yield: YieldTotals;
  efficiency: {
    biologicalEfficiency: number | null;
    costPerDryGramCents: number | null;
    costPerWetGramCents: number | null;
  };
  timeline: { daysToFirstHarvest: number | null };
}

/**
 * The headline rollup for a batch: total cost, aggregate yield, efficiency
 * metrics, and time-to-harvest. Pure and null-safe.
 */
export function computeBatchSummary(input: BatchSummaryInput): BatchSummary {
  const cost = rollupCosts(input.costs);
  const y = yieldTotals(input.harvests);

  const firstHarvestAt = input.harvests
    .map((h) => h.harvestedAt)
    .filter((d): d is string | Date | number => d != null)
    .map((d) => new Date(d).getTime())
    .sort((a, b) => a - b)[0];

  const daysToFirstHarvest =
    input.startedAt != null && firstHarvestAt != null
      ? Math.max(0, daysBetween(input.startedAt, firstHarvestAt))
      : null;

  return {
    cost,
    yield: y,
    efficiency: {
      biologicalEfficiency: biologicalEfficiency(y.totalWetG, input.drySubstrateG),
      costPerDryGramCents: costPerDryGramCents(cost.totalCents, y.totalDryG),
      costPerWetGramCents: costPerWetGramCents(cost.totalCents, y.totalWetG),
    },
    timeline: { daysToFirstHarvest },
  };
}
