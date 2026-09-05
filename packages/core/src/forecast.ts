/**
 * Cycle forecasting: predict when each batch will hit each lifecycle stage,
 * compare those predictions against the actual events as they land, and roll
 * every batch's projected harvests up into a production forecast so output gaps
 * are visible. Pure + deterministic — no I/O, so it runs the same in the Worker,
 * the Node server, and unit tests.
 *
 * The model anchors each batch on its inoculation (day 0) and rolls forward by
 * stage durations. Every stage maps to data the app already records, so each has
 * a real "actual" to compare against. As actuals arrive, downstream predictions
 * re-anchor on the latest known actual.
 */
import { daysBetween, round } from './units';

type DateLike = string | number | Date | null | undefined;
const DAY_MS = 86_400_000;

// ── Stages ────────────────────────────────────────────────────────────────────
/** Fixed lead stages before the flushes. Flush stages are generated per profile. */
export const FORECAST_LEAD_STAGES = ['INOCULATION', 'SPAWN', 'FRUITING'] as const;

/** Which duration in a profile governs the gap into each stage. */
export type DurationKey = 'colonization' | 'bulkColonization' | 'firstFlush' | 'flushGap';

export interface StageDurations {
  /** Inoculation → spawn to bulk (grain colonization), days. */
  colonization: number;
  /** Spawn → fruiting conditions (bulk colonization), days. */
  bulkColonization: number;
  /** Fruiting → first harvest, days. */
  firstFlush: number;
  /** Between consecutive flushes, days. */
  flushGap: number;
}

export interface ForecastProfile {
  durations: StageDurations;
  /** How many flushes to project. */
  flushes: number;
  /** Fraction of the batch goal expected per flush (used when no learned yields). */
  flushYieldSplit: number[];
  /** Learned absolute dry grams per flush (index 0 = flush 1); overrides the split. */
  flushYieldG?: number[] | null;
  /** How many completed batches informed a learned profile. */
  samples?: number;
  /** Epoch ms of the last learn-from-history run. */
  updatedAt?: number;
}

/** Generic, species-agnostic starting point. Refined per strain from history. */
export const DEFAULT_FORECAST_PROFILE: ForecastProfile = {
  durations: { colonization: 14, bulkColonization: 12, firstFlush: 10, flushGap: 12 },
  flushes: 3,
  flushYieldSplit: [0.45, 0.33, 0.22],
};

/** Merge a stored per-strain override onto the built-in defaults. */
export function resolveForecastProfile(
  override?: Partial<ForecastProfile> | null,
): ForecastProfile {
  const d = DEFAULT_FORECAST_PROFILE;
  const flushes = clampInt(override?.flushes ?? d.flushes, 1, 8);
  return {
    durations: { ...d.durations, ...(override?.durations ?? {}) },
    flushes,
    flushYieldSplit:
      override?.flushYieldSplit && override.flushYieldSplit.length > 0
        ? override.flushYieldSplit
        : d.flushYieldSplit,
    flushYieldG: override?.flushYieldG ?? null,
    samples: override?.samples,
    updatedAt: override?.updatedAt,
  };
}

export interface StageDescriptor {
  stage: string;
  label: string;
  /** Duration governing the gap from the previous stage (undefined for the anchor). */
  durationKey?: DurationKey;
  /** 1-based flush number for flush stages. */
  flushNumber?: number;
}

/** The ordered stage list for a profile (lead stages + N flush stages). */
export function forecastStages(profile: ForecastProfile): StageDescriptor[] {
  const stages: StageDescriptor[] = [
    { stage: 'INOCULATION', label: 'Inoculation' },
    { stage: 'SPAWN', label: 'Spawn to bulk', durationKey: 'colonization' },
    { stage: 'FRUITING', label: 'Fruiting / pinning', durationKey: 'bulkColonization' },
  ];
  for (let n = 1; n <= profile.flushes; n++) {
    stages.push({
      stage: `FLUSH_${n}`,
      label: `Flush ${n}`,
      durationKey: n === 1 ? 'firstFlush' : 'flushGap',
      flushNumber: n,
    });
  }
  return stages;
}

// ── Deriving actuals from stored rows ──────────────────────────────────────────
export interface ForecastEventInput {
  type: string;
  occurredAt?: DateLike;
}
export interface ForecastHarvestInput {
  flushNumber?: number | null;
  harvestedAt?: DateLike;
  dryWeightG?: number | null;
  wetWeightG?: number | null;
}
export interface ForecastCultureInput {
  type?: string | null;
  inoculatedAt?: DateLike;
  colonizedAt?: DateLike;
  fruitingStartedAt?: DateLike;
}
export interface ForecastBatchInput {
  startedAt?: DateLike;
  status?: string | null;
}

/** The real dates a batch has actually reached, per stage. */
export interface BatchActuals {
  INOCULATION?: Date;
  SPAWN?: Date;
  FRUITING?: Date;
  /** flushNumber → earliest harvest date. */
  flushes: Record<number, Date>;
  /** Dry grams observed per flush number (for learning yields). */
  flushYieldG: Record<number, number>;
}

/** Map stored events / harvests / cultures / batch into stage actuals. */
export function deriveActuals(input: {
  events?: ForecastEventInput[];
  harvests?: ForecastHarvestInput[];
  cultures?: ForecastCultureInput[];
  batch?: ForecastBatchInput;
}): BatchActuals {
  const events = input.events ?? [];
  const harvests = input.harvests ?? [];
  const cultures = input.cultures ?? [];

  const evDates = (type: string) =>
    events.filter((e) => e.type === type).map((e) => toDate(e.occurredAt));

  const inoculation =
    minDate([
      ...evDates('INOCULATION'),
      ...cultures.map((c) => toDate(c.inoculatedAt)),
      toDate(input.batch?.startedAt),
    ]) ?? undefined;

  const spawn =
    minDate([...evDates('SPAWN_TO_BULK'), ...cultures.map((c) => toDate(c.colonizedAt))]) ??
    undefined;

  const fruiting =
    minDate([
      ...evDates('FRUITING_CONDITIONS'),
      ...evDates('PINNING'),
      ...cultures.map((c) => toDate(c.fruitingStartedAt)),
    ]) ?? undefined;

  const flushes: Record<number, Date> = {};
  const flushYieldG: Record<number, number> = {};
  for (const h of harvests) {
    const n = h.flushNumber ?? 1;
    const at = toDate(h.harvestedAt);
    if (at && (!flushes[n] || at < flushes[n])) flushes[n] = at;
    const dry = h.dryWeightG;
    if (typeof dry === 'number' && dry > 0) flushYieldG[n] = (flushYieldG[n] ?? 0) + dry;
  }

  return { INOCULATION: inoculation, SPAWN: spawn, FRUITING: fruiting, flushes, flushYieldG };
}

// ── Predicting one batch's timeline ────────────────────────────────────────────
export type MilestoneStatus = 'done' | 'overdue' | 'due' | 'upcoming' | 'stalled';

export interface ForecastMilestone {
  stage: string;
  label: string;
  flushNumber?: number;
  /** Best-estimate date, re-anchored on the latest actual (ISO). */
  predictedAt: string | null;
  /** Pure prediction from the inoculation anchor, for variance (ISO). */
  baselineAt: string | null;
  /** The real date if this stage has been reached (ISO). */
  actualAt: string | null;
  /** actual − baseline in days (positive = later than planned). */
  varianceDays: number | null;
  status: MilestoneStatus;
  /** Expected dry grams for flush stages (null when unknown / not a flush). */
  expectedYieldG: number | null;
}

const ENDED_BATCH = new Set(['COMPLETED', 'ABORTED', 'ARCHIVED']);

/** Build the predicted + actual timeline for a single batch. */
export function predictBatchTimeline(input: {
  actuals: BatchActuals;
  profile: ForecastProfile;
  goalDryWeightG?: number | null;
  batchStatus?: string | null;
  ended?: boolean;
  now?: DateLike;
}): { anchorAt: string | null; timeline: ForecastMilestone[]; ended: boolean } {
  const { actuals, profile } = input;
  const now = toDate(input.now) ?? new Date();
  const ended = Boolean(input.ended) || ENDED_BATCH.has(String(input.batchStatus ?? ''));
  const stages = forecastStages(profile);
  const anchor = actuals.INOCULATION ?? null;

  const actualFor = (s: StageDescriptor): Date | undefined => {
    if (s.stage === 'INOCULATION') return actuals.INOCULATION;
    if (s.stage === 'SPAWN') return actuals.SPAWN;
    if (s.stage === 'FRUITING') return actuals.FRUITING;
    if (s.flushNumber != null) return actuals.flushes[s.flushNumber];
    return undefined;
  };

  // Baseline: pure roll-forward from the anchor with default durations.
  const baseline: (Date | null)[] = [];
  {
    let cursor = anchor;
    stages.forEach((s, i) => {
      if (i === 0) {
        baseline.push(anchor);
        return;
      }
      cursor = cursor ? addDays(cursor, durationOf(profile, s.durationKey)) : null;
      baseline.push(cursor);
    });
  }

  // Projected: same roll-forward, but re-anchored whenever an actual is known.
  // An ended batch does not project stages it never reached (no future harvests).
  const projected: (Date | null)[] = [];
  {
    let cursor = anchor;
    stages.forEach((s, i) => {
      const actual = actualFor(s);
      if (actual) {
        cursor = actual;
        projected.push(actual);
        return;
      }
      if (ended) {
        projected.push(null);
        return;
      }
      if (i === 0) {
        projected.push(anchor);
        return;
      }
      cursor = cursor ? addDays(cursor, durationOf(profile, s.durationKey)) : null;
      projected.push(cursor);
    });
  }

  const timeline: ForecastMilestone[] = stages.map((s, i) => {
    const actual = actualFor(s) ?? null;
    const proj = projected[i] ?? null;
    const base = baseline[i] ?? null;
    return {
      stage: s.stage,
      label: s.label,
      flushNumber: s.flushNumber,
      predictedAt: toISO(proj),
      baselineAt: toISO(base),
      actualAt: toISO(actual),
      varianceDays: actual && base ? daysBetween(base, actual) : null,
      status: milestoneStatus(actual, proj, ended, now),
      expectedYieldG:
        s.flushNumber != null
          ? expectedFlushYield(profile, s.flushNumber, input.goalDryWeightG)
          : null,
    };
  });

  return { anchorAt: toISO(anchor), timeline, ended };
}

function milestoneStatus(
  actual: Date | null,
  projected: Date | null,
  ended: boolean,
  now: Date,
): MilestoneStatus {
  if (actual) return 'done';
  if (ended) return 'stalled';
  if (!projected) return 'upcoming';
  const p = startOfDay(projected).getTime();
  const t = startOfDay(now).getTime();
  if (p < t) return 'overdue';
  if (p <= t + 3 * DAY_MS) return 'due';
  return 'upcoming';
}

function expectedFlushYield(
  profile: ForecastProfile,
  flushNumber: number,
  goalDryWeightG?: number | null,
): number | null {
  const learned = profile.flushYieldG?.[flushNumber - 1];
  if (typeof learned === 'number' && learned > 0) return round(learned, 1);
  if (goalDryWeightG != null && goalDryWeightG > 0) {
    const split = profile.flushYieldSplit[flushNumber - 1] ?? 0;
    return split > 0 ? round(goalDryWeightG * split, 1) : null;
  }
  return null;
}

// ── Aggregating many batches into a production forecast ─────────────────────────
export interface BatchForecast {
  batchId?: string;
  batchName?: string;
  strainId?: string | null;
  anchorAt: string | null;
  ended: boolean;
  timeline: ForecastMilestone[];
}

export interface CalendarMilestone extends ForecastMilestone {
  batchId?: string;
  batchName?: string;
}

export interface WeekBucket {
  /** Monday of the week (ISO). */
  weekStart: string;
  label: string;
  harvestCount: number;
  /** Summed expected dry grams for flushes projected that week (null if unknown). */
  expectedYieldG: number | null;
  isGap: boolean;
}

export interface NextHarvest {
  batchId?: string;
  batchName?: string;
  stage: string;
  date: string;
  expectedYieldG: number | null;
}

export interface StaggerHint {
  gapWeekStart: string;
  inoculateBy: string;
  pipelineDays: number;
}

export interface CalendarForecast {
  from: string;
  to: string;
  milestones: CalendarMilestone[];
  weeks: WeekBucket[];
  gaps: string[];
  nextHarvest: NextHarvest | null;
  staggerHint: StaggerHint | null;
}

/** Roll a set of per-batch forecasts up into a windowed production calendar. */
export function aggregateCalendar(
  forecasts: BatchForecast[],
  opts: { from: DateLike; to: DateLike; now?: DateLike; profile?: ForecastProfile },
): CalendarForecast {
  const from = startOfDay(toDate(opts.from) ?? new Date());
  const to = endOfDay(toDate(opts.to) ?? addDays(from, 56));
  const now = toDate(opts.now) ?? new Date();

  // Flatten every stage that falls inside the window.
  const milestones: CalendarMilestone[] = [];
  for (const f of forecasts) {
    for (const m of f.timeline) {
      const when = toDate(m.predictedAt);
      if (!when || when < from || when > to) continue;
      milestones.push({ ...m, batchId: f.batchId, batchName: f.batchName });
    }
  }
  milestones.sort((a, b) => (a.predictedAt ?? '').localeCompare(b.predictedAt ?? ''));

  // Weekly buckets (Mon-anchored) across the window.
  const weeks: WeekBucket[] = [];
  const index = new Map<string, number>();
  for (let ws = weekStartOf(from); ws <= to; ws = addDays(ws, 7)) {
    index.set(toISO(ws) as string, weeks.length);
    weeks.push({
      weekStart: toISO(ws) as string,
      label: shortDate(ws),
      harvestCount: 0,
      expectedYieldG: null,
      isGap: false,
    });
  }

  let firstHarvestWeek = -1;
  let lastHarvestWeek = -1;
  for (const m of milestones) {
    if (m.flushNumber == null) continue;
    const when = toDate(m.predictedAt);
    if (!when) continue;
    const key = toISO(weekStartOf(when)) as string;
    const wi = index.get(key);
    if (wi == null) continue;
    const w = weeks[wi];
    if (!w) continue;
    w.harvestCount += 1;
    if (m.expectedYieldG != null)
      w.expectedYieldG = round((w.expectedYieldG ?? 0) + m.expectedYieldG, 1);
    if (firstHarvestWeek < 0) firstHarvestWeek = wi;
    lastHarvestWeek = wi;
  }

  // Gaps: zero-harvest weeks between the first and last projected harvest.
  const gaps: string[] = [];
  if (firstHarvestWeek >= 0) {
    for (let i = firstHarvestWeek; i <= lastHarvestWeek; i++) {
      const w = weeks[i];
      if (w && w.harvestCount === 0) {
        w.isGap = true;
        gaps.push(w.weekStart);
      }
    }
  }

  // Next upcoming harvest across all batches.
  let nextHarvest: NextHarvest | null = null;
  for (const f of forecasts) {
    for (const m of f.timeline) {
      if (m.flushNumber == null || m.actualAt) continue;
      const when = toDate(m.predictedAt);
      if (!when || when < startOfDay(now)) continue;
      if (!nextHarvest || (m.predictedAt as string) < nextHarvest.date) {
        nextHarvest = {
          batchId: f.batchId,
          batchName: f.batchName,
          stage: m.stage,
          date: m.predictedAt as string,
          expectedYieldG: m.expectedYieldG,
        };
      }
    }
  }

  // Stagger hint: the nearest future gap, and when to inoculate to fill it.
  let staggerHint: StaggerHint | null = null;
  const profile = opts.profile ?? DEFAULT_FORECAST_PROFILE;
  const pipelineDays =
    profile.durations.colonization +
    profile.durations.bulkColonization +
    profile.durations.firstFlush;
  const nowWeek = toISO(weekStartOf(now)) as string;
  const nextGap = gaps.find((g) => g >= nowWeek);
  if (nextGap) {
    const gapDate = toDate(nextGap) as Date;
    staggerHint = {
      gapWeekStart: nextGap,
      inoculateBy: toISO(addDays(gapDate, -pipelineDays)) as string,
      pipelineDays,
    };
  }

  return {
    from: toISO(from) as string,
    to: toISO(to) as string,
    milestones,
    weeks,
    gaps,
    nextHarvest,
    staggerHint,
  };
}

// ── Learning a profile from completed-batch history ─────────────────────────────
export interface LearnResult {
  profile: ForecastProfile;
  samples: number;
}

/**
 * Average stage durations and per-flush yields from a strain's completed batches
 * to refine its forecast profile. Only fields with at least one usable sample
 * override the defaults, so a thin history still yields a sensible profile.
 */
export function learnProfileFromHistory(
  history: { actuals: BatchActuals; goalDryWeightG?: number | null }[],
  base: Partial<ForecastProfile> | null = null,
): LearnResult {
  const colonization: number[] = [];
  const bulkColonization: number[] = [];
  const firstFlush: number[] = [];
  const flushGap: number[] = [];
  const yieldByFlush: Record<number, number[]> = {};
  let maxFlush = 0;
  let samples = 0;

  for (const h of history) {
    const a = h.actuals;
    let contributed = false;
    const gap = (from?: Date, to?: Date, sink?: number[]) => {
      if (from && to && sink) {
        const d = daysBetween(from, to);
        if (d >= 0) {
          sink.push(d);
          contributed = true;
        }
      }
    };
    gap(a.INOCULATION, a.SPAWN, colonization);
    gap(a.SPAWN, a.FRUITING, bulkColonization);
    gap(a.FRUITING, a.flushes[1], firstFlush);
    const flushNums = Object.keys(a.flushes)
      .map(Number)
      .sort((x, y) => x - y);
    for (let i = 1; i < flushNums.length; i++) {
      const prev = flushNums[i - 1];
      const cur = flushNums[i];
      if (prev == null || cur == null) continue;
      gap(a.flushes[prev], a.flushes[cur], flushGap);
    }
    for (const n of Object.keys(a.flushYieldG).map(Number)) {
      const grams = a.flushYieldG[n];
      if (grams == null) continue;
      const bucket = yieldByFlush[n] ?? [];
      bucket.push(grams);
      yieldByFlush[n] = bucket;
      if (n > maxFlush) maxFlush = n;
      contributed = true;
    }
    if (contributed) samples += 1;
  }

  const resolved = resolveForecastProfile(base);
  const durations: StageDurations = {
    colonization: avg(colonization) ?? resolved.durations.colonization,
    bulkColonization: avg(bulkColonization) ?? resolved.durations.bulkColonization,
    firstFlush: avg(firstFlush) ?? resolved.durations.firstFlush,
    flushGap: avg(flushGap) ?? resolved.durations.flushGap,
  };

  let flushYieldG: number[] | null = null;
  if (maxFlush > 0) {
    flushYieldG = [];
    for (let n = 1; n <= maxFlush; n++) flushYieldG.push(round(avg(yieldByFlush[n] ?? []) ?? 0, 1));
  }

  return {
    profile: {
      durations: {
        colonization: round(durations.colonization, 1),
        bulkColonization: round(durations.bulkColonization, 1),
        firstFlush: round(durations.firstFlush, 1),
        flushGap: round(durations.flushGap, 1),
      },
      flushes: Math.max(resolved.flushes, maxFlush || 0) || resolved.flushes,
      flushYieldSplit: resolved.flushYieldSplit,
      flushYieldG,
      samples,
      updatedAt: Date.now(),
    },
    samples,
  };
}

// ── Small date / math helpers ───────────────────────────────────────────────────
function durationOf(profile: ForecastProfile, key?: DurationKey): number {
  return key ? profile.durations[key] : 0;
}

function toDate(v: DateLike): Date | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toISO(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

function minDate(list: (Date | null | undefined)[]): Date | undefined {
  let min: Date | undefined;
  for (const d of list) {
    if (d && (!min || d < min)) min = d;
  }
  return min;
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY_MS);
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

/** Monday of the week containing `d`, at 00:00 local. */
function weekStartOf(d: Date): Date {
  const x = startOfDay(d);
  const dow = (x.getDay() + 6) % 7; // 0 = Monday
  return addDays(x, -dow);
}

function shortDate(d: Date): string {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function avg(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function clampInt(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(n)));
}
