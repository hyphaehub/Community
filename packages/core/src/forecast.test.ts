import { describe, expect, it } from 'vitest';
import {
  type BatchActuals,
  type BatchForecast,
  DEFAULT_FORECAST_PROFILE,
  type ForecastProfile,
  aggregateCalendar,
  buildReminders,
  deriveActuals,
  learnProfileFromHistory,
  predictBatchTimeline,
  remindersToICS,
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
    predictedFrom: iso(at),
    predictedTo: iso(at),
    confidenceDays: null,
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
    // Empirical-Bayes (K=3): each mean is pulled toward its default prior by n/(n+K)=2/5,
    // not taken raw. e.g. colonization = 14 + (11 − 14)·0.4 = 12.8.
    expect(profile.durations.colonization).toBeCloseTo(12.8, 5); // mean 11, prior 14
    expect(profile.durations.bulkColonization).toBeCloseTo(11.6, 5); // mean 11, prior 12
    expect(profile.durations.firstFlush).toBeCloseTo(9.6, 5); // mean 9, prior 10
    expect(profile.durations.flushGap).toBe(12); // one sample of 12, prior 12
    // flush1 (100, 120) is recency-weighted toward the more recent batch's 120 → 110.5.
    expect(profile.flushYieldG).toEqual([110.5, 60]);
    expect(profile.samples).toBe(2);
  });

  it('keeps defaults when there is no usable history', () => {
    const { profile, samples } = learnProfileFromHistory([]);
    expect(samples).toBe(0);
    expect(profile.durations).toEqual(DEFAULT_FORECAST_PROFILE.durations);
    expect(profile.flushYieldG).toBeNull();
    expect(profile.durationStats ?? null).toBeNull();
  });

  it('pulls a lone noisy sample only partway toward the prior, and widens, not snaps', () => {
    // prior colonization = 14; one 30-day batch → 14 + (30 − 14)·(1/4) = 18 (not 30).
    const { profile } = learnProfileFromHistory([
      {
        actuals: {
          INOCULATION: new Date('2026-01-01'),
          SPAWN: new Date('2026-01-31'),
          flushes: {},
          flushYieldG: {},
        },
      },
    ]);
    expect(profile.durations.colonization).toBeCloseTo(18, 5);
    // One sample has no observable spread, so the generic prior spread is kept.
    expect(profile.durationStats?.colonization).toEqual({ stdDevDays: 4, samples: 1 });
  });

  it('trusts the strain more as samples accumulate', () => {
    const nine = Array.from({ length: 9 }, () => ({
      actuals: {
        INOCULATION: new Date('2026-01-01'),
        SPAWN: new Date('2026-01-31'),
        flushes: {},
        flushYieldG: {},
      } as BatchActuals,
    }));
    const { profile } = learnProfileFromHistory(nine);
    // 14 + (30 − 14)·(9/12) = 26 — closer to 30 than one sample, still shy of it.
    expect(profile.durations.colonization).toBeCloseTo(26, 5);
  });

  it('records the observed spread once there are ≥2 samples', () => {
    const mk = (spawn: string): BatchActuals => ({
      INOCULATION: new Date('2026-01-01'),
      SPAWN: new Date(spawn),
      flushes: {},
      flushYieldG: {},
    });
    const { profile } = learnProfileFromHistory([
      { actuals: mk('2026-01-29') }, // 28d
      { actuals: mk('2026-01-31') }, // 30d
      { actuals: mk('2026-02-02') }, // 32d
    ]);
    // mean 30, n=3 → 14 + 16·(3/6) = 22; sample sd of [28,30,32] = 2.
    expect(profile.durations.colonization).toBeCloseTo(22, 5);
    expect(profile.durationStats?.colonization).toEqual({ stdDevDays: 2, samples: 3 });
  });
});

describe('prediction confidence ranges (predictBatchTimeline)', () => {
  const DAY = 86_400_000;
  const onlyInoc: BatchActuals = {
    INOCULATION: new Date('2026-03-01'),
    flushes: {},
    flushYieldG: {},
  };
  const now = new Date('2026-03-02');

  it('widens the window the further out a stage is projected', () => {
    const { timeline } = predictBatchTimeline({
      actuals: onlyInoc,
      profile: DEFAULT_FORECAST_PROFILE,
      now,
    });
    expect(stage(timeline, 'INOCULATION').confidenceDays).toBe(0); // the known anchor
    expect(stage(timeline, 'SPAWN').confidenceDays).toBe(4); // √(4²)
    expect(stage(timeline, 'FRUITING').confidenceDays).toBe(6); // √(4²+4²)=5.66→6
    expect(stage(timeline, 'FLUSH_1').confidenceDays).toBeGreaterThanOrEqual(
      stage(timeline, 'FRUITING').confidenceDays as number,
    );
    // from/to bracket the point estimate by exactly the half-width.
    const spawn = stage(timeline, 'SPAWN');
    const at = new Date(spawn.predictedAt as string).getTime();
    expect(spawn.predictedFrom).toBe(new Date(at - 4 * DAY).toISOString());
    expect(spawn.predictedTo).toBe(new Date(at + 4 * DAY).toISOString());
  });

  it('resets the window at each logged actual', () => {
    const withSpawn: BatchActuals = {
      INOCULATION: new Date('2026-03-01'),
      SPAWN: new Date('2026-03-16'),
      flushes: {},
      flushYieldG: {},
    };
    const { timeline } = predictBatchTimeline({
      actuals: withSpawn,
      profile: DEFAULT_FORECAST_PROFILE,
      now,
    });
    expect(stage(timeline, 'SPAWN').confidenceDays).toBe(0); // observed
    expect(stage(timeline, 'FRUITING').confidenceDays).toBe(4); // only bulkColonization, re-anchored
  });

  it('tightens once a strain has learned a smaller spread', () => {
    const mk = (spawn: string): BatchActuals => ({
      INOCULATION: new Date('2026-01-01'),
      SPAWN: new Date(spawn),
      flushes: {},
      flushYieldG: {},
    });
    const { profile } = learnProfileFromHistory([
      { actuals: mk('2026-01-14') }, // 13d
      { actuals: mk('2026-01-15') }, // 14d
    ]);
    const { timeline } = predictBatchTimeline({ actuals: onlyInoc, profile, now });
    // learned sd of [13,14] ≈ 0.7 → half-window well under the default 4.
    expect(stage(timeline, 'SPAWN').confidenceDays as number).toBeLessThan(4);
  });
});

describe('learning layering & idempotency', () => {
  const colon = (spawn: string): BatchActuals => ({
    INOCULATION: new Date('2026-01-01'),
    SPAWN: new Date(spawn),
    flushes: {},
    flushYieldG: {},
  });

  it('is idempotent: re-learning the same history with the prior result as current does not drift', () => {
    const hist = [{ actuals: colon('2026-01-31') }]; // one 30d colonization
    const first = learnProfileFromHistory(hist); // current=null, prior=DEFAULT → 18
    const second = learnProfileFromHistory(hist, first.profile); // feed result back as current
    const third = learnProfileFromHistory(hist, second.profile);
    expect(first.profile.durations.colonization).toBeCloseTo(18, 5);
    expect(second.profile.durations.colonization).toBeCloseTo(18, 5); // no drift toward 30
    expect(third.profile.durations.colonization).toBeCloseTo(18, 5);
  });

  it('shrinks a strain toward the workspace base, not the global default', () => {
    const workspace = resolveForecastProfile({ durations: { colonization: 24 } as never });
    const hist = [{ actuals: colon('2026-01-27') }, { actuals: colon('2026-01-27') }]; // 26d, 26d
    const { profile } = learnProfileFromHistory(hist, null, workspace);
    // prior = workspace 24 (not DEFAULT 14): 24 + (26 − 24)·(2/5) = 24.8
    expect(profile.durations.colonization).toBeCloseTo(24.8, 5);
  });

  it('keeps an existing value for a stage with no new samples (manual edit survives a learn)', () => {
    const current = resolveForecastProfile({ durations: { bulkColonization: 20 } as never });
    const hist = [{ actuals: colon('2026-01-15') }]; // only colonization data, no bulk gap
    const { profile } = learnProfileFromHistory(hist, current);
    expect(profile.durations.bulkColonization).toBeCloseTo(20, 5); // preserved, not reverted to 12
  });

  it('gives a consistent strain a tight floored window, not the wide default', () => {
    const hist = [
      { actuals: colon('2026-01-15') },
      { actuals: colon('2026-01-15') },
      { actuals: colon('2026-01-15') },
    ]; // three identical 14d colonizations → sample sd 0
    const { profile } = learnProfileFromHistory(hist);
    expect(profile.durationStats?.colonization).toEqual({ stdDevDays: 1, samples: 3 }); // floored, not 4
  });

  it('layers durationStats per key: a strain stat wins, the workspace fills the rest', () => {
    const base: ForecastProfile = {
      ...DEFAULT_FORECAST_PROFILE,
      durationStats: {
        colonization: { stdDevDays: 3, samples: 5 },
        bulkColonization: { stdDevDays: 2, samples: 4 },
      },
    };
    const resolved = resolveForecastProfile(
      { durationStats: { colonization: { stdDevDays: 1, samples: 2 } } },
      base,
    );
    expect(resolved.durationStats?.colonization).toEqual({ stdDevDays: 1, samples: 2 }); // override wins
    expect(resolved.durationStats?.bulkColonization).toEqual({ stdDevDays: 2, samples: 4 }); // base fills
  });

  it('reports null confidence for ended and un-anchored batches', () => {
    const ended = predictBatchTimeline({
      actuals: { INOCULATION: new Date('2026-03-01'), flushes: {}, flushYieldG: {} },
      profile: DEFAULT_FORECAST_PROFILE,
      batchStatus: 'ABORTED',
      now: new Date('2026-03-10'),
    });
    expect(stage(ended.timeline, 'SPAWN').confidenceDays).toBeNull();
    expect(stage(ended.timeline, 'SPAWN').predictedFrom).toBeNull();
    const noAnchor = predictBatchTimeline({
      actuals: { flushes: {}, flushYieldG: {} },
      profile: DEFAULT_FORECAST_PROFILE,
      now: new Date('2026-03-10'),
    });
    expect(stage(noAnchor.timeline, 'SPAWN').confidenceDays).toBeNull();
  });
});

describe('robust learning: recency weighting + outlier trimming', () => {
  const colon = (inoc: string, spawn: string): BatchActuals => ({
    INOCULATION: new Date(inoc),
    SPAWN: new Date(spawn),
    flushes: {},
    flushYieldG: {},
  });

  it('rejects a lone anomalous run so it does not drag the estimate', () => {
    const hist = [
      { actuals: colon('2026-01-01', '2026-01-15') }, // 14d
      { actuals: colon('2026-01-01', '2026-01-15') }, // 14d
      { actuals: colon('2026-01-01', '2026-01-15') }, // 14d
      { actuals: colon('2026-01-01', '2026-01-15') }, // 14d
      { actuals: colon('2026-01-01', '2026-03-02') }, // 60d — a stall/anomaly
    ];
    const { profile } = learnProfileFromHistory(hist);
    // Without trimming the mean would be ~23 → shrink ~19.75; trimmed it stays ~14.
    expect(profile.durations.colonization).toBeLessThan(16);
    expect(profile.durations.colonization).toBeGreaterThan(13);
    expect(profile.durationStats?.colonization?.samples).toBe(4); // the anomaly is gone
  });

  it('weights recent batches more than old ones', () => {
    // Same three values, opposite time order. Old batches are >2 years back (well past
    // the 180-day half-life), so the recent batch dominates.
    const recentLow = [
      { actuals: colon('2023-01-01', '2023-01-21') }, // old, 20d
      { actuals: colon('2023-06-01', '2023-06-21') }, // old, 20d
      { actuals: colon('2026-01-01', '2026-01-11') }, // recent, 10d
    ];
    const recentHigh = [
      { actuals: colon('2023-01-01', '2023-01-11') }, // old, 10d
      { actuals: colon('2023-06-01', '2023-06-11') }, // old, 10d
      { actuals: colon('2026-01-01', '2026-01-21') }, // recent, 20d
    ];
    const low = learnProfileFromHistory(recentLow).profile.durations.colonization;
    const high = learnProfileFromHistory(recentHigh).profile.durations.colonization;
    expect(high).toBeGreaterThan(low); // the recent value pulls the estimate its way
  });

  it('keeps a normal one-day wobble even when most runs are identical', () => {
    const hist = [
      { actuals: colon('2026-01-01', '2026-01-15') }, // 14d
      { actuals: colon('2026-01-01', '2026-01-15') }, // 14d
      { actuals: colon('2026-01-01', '2026-01-15') }, // 14d
      { actuals: colon('2026-01-01', '2026-01-15') }, // 14d
      { actuals: colon('2026-01-01', '2026-01-16') }, // 15d — ordinary variation, not an anomaly
    ];
    const { profile } = learnProfileFromHistory(hist);
    expect(profile.durationStats?.colonization?.samples).toBe(5); // nothing trimmed
  });

  it('applies the same robustness to per-flush yields', () => {
    const mk = (g: number): BatchActuals => ({
      INOCULATION: new Date('2026-01-01'),
      flushes: { 1: new Date('2026-01-20') },
      flushYieldG: { 1: g },
    });
    const hist = [
      { actuals: mk(100) },
      { actuals: mk(100) },
      { actuals: mk(100) },
      { actuals: mk(100) },
      { actuals: mk(500) },
    ];
    const { profile } = learnProfileFromHistory(hist);
    expect(profile.flushYieldG?.[0]).toBeCloseTo(100, 0); // the 500g anomaly is dropped
  });
});

describe('buildReminders + remindersToICS', () => {
  const now = new Date('2026-02-01T00:00:00Z');
  const actuals = deriveActuals({ cultures: [{ inoculatedAt: iso('2026-02-01') }] });
  const { anchorAt, timeline, ended } = predictBatchTimeline({
    actuals,
    profile: DEFAULT_FORECAST_PROFILE,
    now,
  });
  const forecast: BatchForecast = {
    batchId: 'b1',
    batchName: 'Blue Oyster A',
    strainId: null,
    anchorAt,
    ended,
    timeline,
  };

  it('surfaces upcoming spawn-to-bulk as an actionable reminder', () => {
    const rem = buildReminders([forecast], { now, horizonDays: 21 });
    const spawn = rem.find((r) => r.stage === 'SPAWN');
    expect(spawn).toBeTruthy();
    expect(spawn?.title).toBe('Spawn Blue Oyster A to bulk');
    expect(spawn?.daysUntil).toBe(14); // default colonization
    expect(rem.some((r) => r.stage === 'FRUITING')).toBe(false); // 26d, beyond horizon
    expect(rem.some((r) => r.stage === 'INOCULATION')).toBe(false); // the anchor is not a task
  });

  it('excludes reminders for ended batches', () => {
    expect(buildReminders([{ ...forecast, ended: true }], { now })).toHaveLength(0);
  });

  it('renders an ICS calendar with a VEVENT + alarm per reminder', () => {
    const ics = remindersToICS(buildReminders([forecast], { now, horizonDays: 60 }), {
      stamp: now,
      calendarName: 'Test',
    });
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('SUMMARY:Spawn Blue Oyster A to bulk');
    expect(ics).toContain('DTSTART;VALUE=DATE:20260215'); // 2026-02-01 + 14d
    expect(ics).toContain('UID:b1-SPAWN@hyphaehub.io');
    expect(ics).toContain('BEGIN:VALARM');
  });
});
