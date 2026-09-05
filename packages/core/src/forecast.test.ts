import { describe, expect, it } from 'vitest';
import {
  type BatchActuals,
  type BatchForecast,
  DEFAULT_FORECAST_PROFILE,
  aggregateCalendar,
  deriveActuals,
  learnProfileFromHistory,
  predictBatchTimeline,
  resolveForecastProfile,
} from './forecast';

const iso = (s: string) => new Date(s).toISOString();
const stage = <T extends { stage: string }>(timeline: T[], key: string): T =>
  timeline.find((m) => m.stage === key)!;

describe('resolveForecastProfile', () => {
  it('merges an override onto the defaults', () => {
    const p = resolveForecastProfile({ durations: { colonization: 20 } as never });
    expect(p.durations.colonization).toBe(20);
    expect(p.durations.bulkColonization).toBe(DEFAULT_FORECAST_PROFILE.durations.bulkColonization);
    expect(p.flushes).toBe(3);
  });

  it('clamps flushes to a sane range', () => {
    expect(resolveForecastProfile({ flushes: 99 }).flushes).toBe(8);
    expect(resolveForecastProfile({ flushes: 0 }).flushes).toBe(1);
  });
});

describe('deriveActuals', () => {
  it('takes the earliest inoculation and maps flushes + yields', () => {
    const a = deriveActuals({
      events: [
        { type: 'INOCULATION', occurredAt: iso('2026-01-03') },
        { type: 'INOCULATION', occurredAt: iso('2026-01-01') },
        { type: 'SPAWN_TO_BULK', occurredAt: iso('2026-01-16') },
        { type: 'PINNING', occurredAt: iso('2026-01-28') },
      ],
      harvests: [
        { flushNumber: 1, harvestedAt: iso('2026-02-07'), dryWeightG: 40 },
        { flushNumber: 1, harvestedAt: iso('2026-02-08'), dryWeightG: 5 },
        { flushNumber: 2, harvestedAt: iso('2026-02-20'), dryWeightG: 30 },
      ],
      batch: { startedAt: iso('2026-01-05') },
    });
    expect(a.INOCULATION?.toISOString()).toBe(iso('2026-01-01'));
    expect(a.SPAWN?.toISOString()).toBe(iso('2026-01-16'));
    expect(a.FRUITING?.toISOString()).toBe(iso('2026-01-28'));
    expect(a.flushes[1]?.toISOString()).toBe(iso('2026-02-07')); // earliest of the two
    expect(a.flushYieldG[1]).toBe(45); // summed
    expect(a.flushYieldG[2]).toBe(30);
  });

  it('falls back to batch.startedAt when no inoculation event', () => {
    const a = deriveActuals({ batch: { startedAt: iso('2026-03-01') } });
    expect(a.INOCULATION?.toISOString()).toBe(iso('2026-03-01'));
    expect(a.SPAWN).toBeUndefined();
  });
});

describe('predictBatchTimeline', () => {
  it('projects the default pipeline from inoculation', () => {
    const { timeline, anchorAt } = predictBatchTimeline({
      actuals: { INOCULATION: new Date('2026-01-01'), flushes: {}, flushYieldG: {} },
      profile: DEFAULT_FORECAST_PROFILE,
      now: '2026-01-01',
    });
    expect(anchorAt).toBe(iso('2026-01-01'));
    expect(stage(timeline, 'SPAWN').predictedAt).toBe(iso('2026-01-15')); // +14
    expect(stage(timeline, 'FRUITING').predictedAt).toBe(iso('2026-01-27')); // +12
    expect(stage(timeline, 'FLUSH_1').predictedAt).toBe(iso('2026-02-06')); // +10
    expect(stage(timeline, 'FLUSH_3').predictedAt).toBe(iso('2026-03-02'));
    // With no actual beyond inoculation, projected == baseline.
    expect(stage(timeline, 'FLUSH_1').baselineAt).toBe(stage(timeline, 'FLUSH_1').predictedAt);
    expect(stage(timeline, 'INOCULATION').status).toBe('done');
    expect(stage(timeline, 'SPAWN').status).toBe('upcoming');
  });

  it('re-anchors downstream stages on a late actual and records variance', () => {
    const { timeline } = predictBatchTimeline({
      actuals: {
        INOCULATION: new Date('2026-01-01'),
        SPAWN: new Date('2026-01-20'), // 5 days later than the 01-15 baseline
        flushes: {},
        flushYieldG: {},
      },
      profile: DEFAULT_FORECAST_PROFILE,
      now: '2026-01-21',
    });
    const spawn = stage(timeline, 'SPAWN');
    expect(spawn.status).toBe('done');
    expect(spawn.actualAt).toBe(iso('2026-01-20'));
    expect(spawn.varianceDays).toBe(5); // actual − baseline
    // Fruiting now rolls from the actual spawn (01-20 + 12 = 02-01), not the baseline 01-27.
    expect(stage(timeline, 'FRUITING').predictedAt).toBe(iso('2026-02-01'));
    expect(stage(timeline, 'FRUITING').baselineAt).toBe(iso('2026-01-27'));
  });

  it('flags overdue and due stages relative to now', () => {
    const { timeline } = predictBatchTimeline({
      actuals: { INOCULATION: new Date('2026-01-01'), flushes: {}, flushYieldG: {} },
      profile: DEFAULT_FORECAST_PROFILE,
      now: '2026-01-16', // spawn was due 01-15
    });
    expect(stage(timeline, 'SPAWN').status).toBe('overdue');
  });

  it('marks stages stalled for an ended batch and computes expected yield from goal', () => {
    const { timeline } = predictBatchTimeline({
      actuals: { INOCULATION: new Date('2026-01-01'), flushes: {}, flushYieldG: {} },
      profile: DEFAULT_FORECAST_PROFILE,
      goalDryWeightG: 1000,
      batchStatus: 'ABORTED',
      now: '2026-02-01',
    });
    expect(stage(timeline, 'FLUSH_1').status).toBe('stalled');
    expect(stage(timeline, 'FLUSH_1').expectedYieldG).toBe(450); // 1000 * 0.45
    expect(stage(timeline, 'FLUSH_2').expectedYieldG).toBe(330);
  });
});

describe('aggregateCalendar', () => {
  const mkFlush = (n: number, at: string, yieldG: number | null) => ({
    stage: `FLUSH_${n}`,
    label: `Flush ${n}`,
    flushNumber: n,
    predictedAt: iso(at),
    baselineAt: iso(at),
    actualAt: null,
    varianceDays: null,
    status: 'upcoming' as const,
    expectedYieldG: yieldG,
  });

  it('rolls flushes into weeks, finds the next harvest, and detects a gap', () => {
    const forecasts: BatchForecast[] = [
      {
        batchId: 'a',
        batchName: 'Blue Oyster',
        anchorAt: iso('2026-01-01'),
        ended: false,
        // Mid-week (Wed) dates so week bucketing is stable across time zones:
        // Feb 4 → week of Feb 2, Feb 25 → week of Feb 23.
        timeline: [mkFlush(1, '2026-02-04', 100), mkFlush(2, '2026-02-25', 80)],
      },
      {
        batchId: 'b',
        batchName: 'Lion’s Mane',
        anchorAt: iso('2026-01-10'),
        ended: false,
        timeline: [mkFlush(1, '2026-02-11', 120)], // week of Feb 9
      },
    ];
    const cal = aggregateCalendar(forecasts, {
      from: '2026-02-01',
      to: '2026-03-01',
      now: '2026-02-01',
      profile: DEFAULT_FORECAST_PROFILE,
    });

    expect(cal.milestones.length).toBe(3);
    // Next harvest is the earliest projected flush (Feb 4, batch a).
    expect(cal.nextHarvest?.batchId).toBe('a');
    expect(cal.nextHarvest?.date).toBe(iso('2026-02-04'));
    // Total harvests bucketed equals the number of in-window flushes.
    const bucketed = cal.weeks.reduce((s, w) => s + w.harvestCount, 0);
    expect(bucketed).toBe(3);
    // Weeks of Feb 2 and Feb 23 hold harvests with the week of Feb 16 empty → a gap.
    expect(cal.gaps.length).toBeGreaterThanOrEqual(1);
    // Stagger hint suggests an inoculation date ahead of the gap.
    expect(cal.staggerHint).not.toBeNull();
    expect(new Date(cal.staggerHint!.inoculateBy).getTime()).toBeLessThan(
      new Date(cal.staggerHint!.gapWeekStart).getTime(),
    );
  });

  it('returns no gaps or next harvest when nothing is projected in range', () => {
    const cal = aggregateCalendar([], { from: '2026-02-01', to: '2026-03-01', now: '2026-02-01' });
    expect(cal.milestones).toEqual([]);
    expect(cal.gaps).toEqual([]);
    expect(cal.nextHarvest).toBeNull();
    expect(cal.staggerHint).toBeNull();
    expect(cal.weeks.length).toBeGreaterThan(0);
  });
});

describe('learnProfileFromHistory', () => {
  it('averages stage durations and per-flush yields with a sample count', () => {
    const history: { actuals: BatchActuals; goalDryWeightG?: number | null }[] = [
      {
        actuals: {
          INOCULATION: new Date('2026-01-01'),
          SPAWN: new Date('2026-01-11'), // 10d
          FRUITING: new Date('2026-01-21'), // 10d
          flushes: { 1: new Date('2026-01-29'), 2: new Date('2026-02-10') }, // 8d then 12d
          flushYieldG: { 1: 100, 2: 60 },
        },
        goalDryWeightG: 160,
      },
      {
        actuals: {
          INOCULATION: new Date('2026-02-01'),
          SPAWN: new Date('2026-02-13'), // 12d
          FRUITING: new Date('2026-02-25'), // 12d
          flushes: { 1: new Date('2026-03-07') }, // 10d
          flushYieldG: { 1: 120 },
        },
        goalDryWeightG: 200,
      },
    ];
    const { profile, samples } = learnProfileFromHistory(history);
    expect(samples).toBe(2);
    expect(profile.durations.colonization).toBe(11); // (10 + 12) / 2
    expect(profile.durations.bulkColonization).toBe(11); // (10 + 12) / 2
    expect(profile.durations.firstFlush).toBe(9); // (8 + 10) / 2
    expect(profile.durations.flushGap).toBe(12); // only one sample: 12
    expect(profile.flushYieldG).toEqual([110, 60]); // flush1 (100,120)->110, flush2 (60)->60
    expect(profile.samples).toBe(2);
  });

  it('keeps defaults when there is no usable history', () => {
    const { profile, samples } = learnProfileFromHistory([]);
    expect(samples).toBe(0);
    expect(profile.durations).toEqual(DEFAULT_FORECAST_PROFILE.durations);
    expect(profile.flushYieldG).toBeNull();
  });
});
