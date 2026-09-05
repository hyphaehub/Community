import { describe, expect, it } from 'vitest';
import {
  biologicalEfficiency,
  computeBatchSummary,
  costPerDryGramCents,
  rollupCosts,
  sumCents,
  yieldTotals,
} from './cost';
import { checkLimit } from './tiers';
import {
  formatMass,
  formatMoney,
  fromGrams,
  gramsToUnit,
  parseMassUnit,
  toCents,
  toGrams,
} from './units';

describe('units', () => {
  it('converts mass units through grams', () => {
    expect(toGrams(1, 'kg')).toBe(1000);
    expect(toGrams(1, 'lb')).toBeCloseTo(453.59237, 5);
    expect(fromGrams(28.349523125, 'oz')).toBeCloseTo(1, 6);
  });

  it('parses free-form unit strings to a mass unit', () => {
    expect(parseMassUnit('kg')).toBe('kg');
    expect(parseMassUnit('Kilograms')).toBe('kg');
    expect(parseMassUnit(' LB ')).toBe('lb');
    expect(parseMassUnit('pounds')).toBe('lb');
    expect(parseMassUnit('grams')).toBe('g');
    expect(parseMassUnit('bag')).toBeNull();
    expect(parseMassUnit(null)).toBeNull();
  });

  it('converts grams into an inventory unit (null for non-mass units)', () => {
    expect(gramsToUnit(6000, 'kg')).toBeCloseTo(6, 6); // 6 jars × 1000 g → 6 kg
    expect(gramsToUnit(907.18474, 'lb')).toBeCloseTo(2, 6);
    expect(gramsToUnit(500, 'g')).toBe(500);
    expect(gramsToUnit(500, 'bag')).toBeNull();
  });

  it('formats mass and money', () => {
    expect(formatMass(1500)).toBe('1.5 kg');
    expect(formatMass(42)).toBe('42 g');
    expect(formatMoney(1299)).toBe('$12.99');
    expect(toCents('12.99')).toBe(1299);
    expect(toCents(4.2)).toBe(420);
  });
});

describe('cost rollup', () => {
  it('sums cents', () => {
    expect(sumCents([{ amountCents: 500 }, { amountCents: 250 }])).toBe(750);
    expect(sumCents([])).toBe(0);
  });

  it('breaks down by category', () => {
    const { totalCents, byCategory } = rollupCosts([
      { amountCents: 1000, category: 'MATERIALS' },
      { amountCents: 500, category: 'CONSUMABLE' },
      { amountCents: 300, category: 'MATERIALS' },
    ]);
    expect(totalCents).toBe(1800);
    expect(byCategory.MATERIALS).toBe(1300);
    expect(byCategory.CONSUMABLE).toBe(500);
  });
});

describe('yield metrics', () => {
  it('aggregates wet/dry across flushes', () => {
    const y = yieldTotals([
      { wetWeightG: 400, dryWeightG: 40, flushNumber: 1 },
      { wetWeightG: 300, dryWeightG: 30, flushNumber: 2 },
    ]);
    expect(y.totalWetG).toBe(700);
    expect(y.totalDryG).toBe(70);
    expect(y.flushCount).toBe(2);
    expect(y.dryRatio).toBe(0.1);
  });

  it('computes biological efficiency (fresh / dry substrate)', () => {
    // 1400 g fresh from 2000 g dry substrate = 70% BE
    expect(biologicalEfficiency(1400, 2000)).toBe(70);
    expect(biologicalEfficiency(1400, 0)).toBeNull();
    expect(biologicalEfficiency(1400, null)).toBeNull();
  });

  it('computes cost per dry gram, guarding divide-by-zero', () => {
    expect(costPerDryGramCents(7000, 70)).toBe(100); // $1.00/g
    expect(costPerDryGramCents(7000, 0)).toBeNull();
  });
});

describe('computeBatchSummary', () => {
  it('produces the full headline rollup', () => {
    const summary = computeBatchSummary({
      costs: [
        { amountCents: 1500, category: 'MATERIALS' },
        { amountCents: 500, category: 'CONSUMABLE' },
      ],
      harvests: [
        { wetWeightG: 500, dryWeightG: 50, flushNumber: 1, harvestedAt: '2026-02-10' },
        { wetWeightG: 300, dryWeightG: 30, flushNumber: 2, harvestedAt: '2026-02-24' },
      ],
      drySubstrateG: 1600,
      startedAt: '2026-01-01',
    });

    expect(summary.cost.totalCents).toBe(2000);
    expect(summary.yield.totalWetG).toBe(800);
    expect(summary.yield.totalDryG).toBe(80);
    expect(summary.efficiency.biologicalEfficiency).toBe(50); // 800/1600*100
    expect(summary.efficiency.costPerDryGramCents).toBe(25); // 2000/80
    expect(summary.timeline.daysToFirstHarvest).toBe(40); // Jan 1 → Feb 10
  });

  it('is null-safe with no data', () => {
    const summary = computeBatchSummary({ costs: [], harvests: [] });
    expect(summary.cost.totalCents).toBe(0);
    expect(summary.efficiency.biologicalEfficiency).toBeNull();
    expect(summary.efficiency.costPerDryGramCents).toBeNull();
    expect(summary.timeline.daysToFirstHarvest).toBeNull();
  });
});

describe('tier limits', () => {
  it('enforces the FREE active-batch cap', () => {
    expect(checkLimit('FREE', 'maxActiveBatches', 2).allowed).toBe(true);
    expect(checkLimit('FREE', 'maxActiveBatches', 3).allowed).toBe(false);
  });

  it('treats null limits as unlimited', () => {
    expect(checkLimit('PRO', 'maxActiveBatches', 9999).allowed).toBe(true);
  });
});
