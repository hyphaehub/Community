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

/** Learned spread of one stage duration, for confidence ranges. */
export interface DurationStat {
  /** Standard deviation of the observed gap, in days. */
  stdDevDays: number;
  /** How many gaps informed this stage. */
  samples: number;
}
export type DurationStats = Partial<Record<DurationKey, DurationStat>>;

export interface ForecastProfile {
  durations: StageDurations;
  /** How many flushes to project. */
  flushes: number;
  /** Fraction of the batch goal expected per flush (used when no learned yields). */
  flushYieldSplit: number[];
  /** Learned absolute dry grams per flush (index 0 = flush 1); overrides the split. */
  flushYieldG?: number[] | null;
  /** Per-stage spread learned from history; drives prediction ranges. */
  durationStats?: DurationStats | null;
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

/**
 * Prior spread (days, ±1σ) for each stage before a strain has ≥2 samples of its
 * own. Predictions start at this width and tighten as real history accrues.
 */
export const DEFAULT_DURATION_SPREAD: Record<DurationKey, number> = {
  colonization: 4,
  bulkColonization: 4,
  firstFlush: 3,
  flushGap: 4,
};

/**
 * Empirical-Bayes pseudo-count: a stage's learned mean is pulled toward the prior
 * (workspace/default) by n/(n+K). With K=3, one batch moves the estimate a quarter
 * of the way; it takes real repetition to fully trust a strain's own numbers.
 */
const SHRINK_K = 3;

/** Half-width of a prediction range, in standard deviations (~68% likely window). */
const RANGE_Z = 1;

/** Floor on a learned spread (days): a few identical logs never claim near-zero uncertainty. */
const MIN_LEARNED_SPREAD = 1;

/** Recency half-life (days): a batch this old counts half as much as one finishing today. */
const RECENCY_HALFLIFE_DAYS = 180;

/** Modified z-score (Iglewicz–Hoaglin) above which a sample is treated as an anomaly. */
const OUTLIER_MODZ = 3.5;

/** Trim anomalies only once a stage has at least this many samples. */
const MIN_SAMPLES_FOR_TRIM = 4;

/** Scale factors turning a deviation into a modified z-score (MAD, then mean-abs fallback). */
const MAD_SCALE = 1.4826;
const MEANAD_SCALE = 1.2533;

/**
 * A sample must also deviate from the median by at least this fraction to be trimmed.
 * Guards the degenerate case (most runs identical) where a z-score can't tell a
 * one-day wobble from a true anomaly — a 7% deviation is kept, a 300% one is not.
 */
const MIN_REL_DEVIATION = 0.4;

/**
 * Merge a stored override onto a base profile. Layering is
 * DEFAULT ← workspace default ← per-strain override: callers pass the workspace
 * base as `base` so strain overrides win, then workspace defaults, then built-ins.
 */
export function resolveForecastProfile(
  override?: Partial<ForecastProfile> | null,
  base: ForecastProfile = DEFAULT_FORECAST_PROFILE,
): ForecastProfile {
  const flushes = clampInt(override?.flushes ?? base.flushes, 1, 8);
  return {
    durations: { ...base.durations, ...(override?.durations ?? {}) },
    flushes,
    flushYieldSplit:
      override?.flushYieldSplit && override.flushYieldSplit.length > 0
        ? override.flushYieldSplit
        : base.flushYieldSplit,
    flushYieldG: override?.flushYieldG ?? base.flushYieldG ?? null,
    // Per-key: a strain's own learned spread wins, else the workspace/base spread.
    durationStats: mergeStats(base.durationStats, override?.durationStats),
    samples: override?.samples,
    updatedAt: override?.updatedAt,
  };
}

/** Per-key union of two stats maps (override wins), or null when both are empty. */
function mergeStats(
  base?: DurationStats | null,
  over?: DurationStats | null,
): DurationStats | null {
  if (!base && !over) return null;
  const merged = { ...(base ?? {}), ...(over ?? {}) };
  return Object.keys(merged).length ? merged : null;
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
  /** Earliest end of the likely window (predictedAt − confidence; ISO). */
  predictedFrom: string | null;
  /** Latest end of the likely window (predictedAt + confidence; ISO). */
  predictedTo: string | null;
  /** Half-width of the window in days (0 = known, null = not projected). */
  confidenceDays: number | null;
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
  // `confidence[i]` is the ±days half-window: the variances of the stage durations
  // since the last known date add up (independent gaps), and reset to 0 on an actual.
  const projected: (Date | null)[] = [];
  const confidence: (number | null)[] = [];
  {
    let cursor = anchor;
    let cumVar = 0;
    stages.forEach((s, i) => {
      const actual = actualFor(s);
      if (actual) {
        cursor = actual;
        cumVar = 0;
        projected.push(actual);
        confidence.push(0);
        return;
      }
      if (ended) {
        projected.push(null);
        confidence.push(null);
        return;
      }
      if (i === 0) {
        projected.push(anchor);
        confidence.push(anchor ? 0 : null);
        return;
      }
      cursor = cursor ? addDays(cursor, durationOf(profile, s.durationKey)) : null;
      const sd = stageStdDevDays(profile, s.durationKey);
      cumVar += sd * sd;
      projected.push(cursor);
      confidence.push(cursor ? Math.round(Math.sqrt(cumVar) * RANGE_Z) : null);
    });
  }

  const timeline: ForecastMilestone[] = stages.map((s, i) => {
    const actual = actualFor(s) ?? null;
    const proj = projected[i] ?? null;
    const base = baseline[i] ?? null;
    const conf = confidence[i] ?? null;
    const half = conf ?? 0;
    return {
      stage: s.stage,
      label: s.label,
      flushNumber: s.flushNumber,
      predictedAt: toISO(proj),
      predictedFrom: proj ? toISO(addDays(proj, -half)) : null,
      predictedTo: proj ? toISO(addDays(proj, half)) : null,
      confidenceDays: conf,
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

// ── Reminders (actionable life-stage transitions) ───────────────────────────────
export interface ForecastReminder {
  batchId?: string;
  batchName?: string;
  stage: string;
  flushNumber?: number;
  /** Imperative action, e.g. "Spawn Blue Oyster A to bulk". */
  title: string;
  /** Extra context, e.g. "~120 g dry expected". */
  detail: string | null;
  /** Predicted date this action is due (ISO). */
  date: string;
  status: MilestoneStatus;
  /** Whole days from now to the due date (negative = overdue). */
  daysUntil: number;
}

/** Human, imperative action for a milestone stage. */
export function reminderAction(
  stage: string,
  label: string,
  batchName: string | undefined,
  flushNumber: number | undefined,
  expectedYieldG: number | null,
): { title: string; detail: string | null } {
  const name = batchName ?? 'this batch';
  if (stage === 'SPAWN')
    return {
      title: `Spawn ${name} to bulk`,
      detail: 'Grain should be fully colonized — ready to mix into the monotub.',
    };
  if (stage === 'FRUITING')
    return {
      title: `Start fruiting conditions for ${name}`,
      detail: 'Bulk should be colonized — introduce fresh air, light, and humidity.',
    };
  if (flushNumber != null)
    return {
      title: `Harvest ${name} — flush ${flushNumber}`,
      detail: expectedYieldG != null ? `~${expectedYieldG} g dry expected.` : null,
    };
  return { title: `${label} — ${name}`, detail: null };
}

/**
 * Flatten a set of batch forecasts into actionable reminders: each not-yet-reached
 * life-stage transition (spawn to bulk, start fruiting, each flush) that is overdue
 * or coming up within `horizonDays`. Sorted soonest-first. Pure — feeds the in-app
 * reminders list, the mobile schedule, and the ICS calendar export alike.
 */
export function buildReminders(
  forecasts: BatchForecast[],
  opts: { now?: DateLike; horizonDays?: number; staleDays?: number } = {},
): ForecastReminder[] {
  const now = toDate(opts.now) ?? new Date();
  const horizon = opts.horizonDays ?? 21;
  const stale = opts.staleDays ?? 45;
  const out: ForecastReminder[] = [];
  for (const f of forecasts) {
    if (f.ended) continue;
    for (const m of f.timeline) {
      if (m.actualAt || m.stage === 'INOCULATION') continue; // done or the anchor
      const when = toDate(m.predictedAt);
      if (!when) continue;
      const daysUntil = daysBetween(now, when);
      if (daysUntil > horizon || daysUntil < -stale) continue; // outside the window
      const { title, detail } = reminderAction(
        m.stage,
        m.label,
        f.batchName,
        m.flushNumber,
        m.expectedYieldG,
      );
      out.push({
        batchId: f.batchId,
        batchName: f.batchName,
        stage: m.stage,
        flushNumber: m.flushNumber,
        title,
        detail,
        date: m.predictedAt as string,
        status: m.status,
        daysUntil,
      });
    }
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

// ── iCalendar (.ics) export ─────────────────────────────────────────────────────
function icsEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}
function icsDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`;
}
function icsStamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${icsDate(d)}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

/**
 * Render reminders as an iCalendar feed: one all-day VEVENT per transition with a
 * 1-day-before display alarm. Stable UIDs (batch+stage) so re-importing updates
 * rather than duplicates. `stamp` is the generation time (pass one for tests).
 */
export function remindersToICS(
  reminders: ForecastReminder[],
  opts: { stamp?: DateLike; calendarName?: string } = {},
): string {
  const stamp = icsStamp(toDate(opts.stamp) ?? new Date());
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//HyphaeHub//Cycle Forecast//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsEscape(opts.calendarName ?? 'HyphaeHub grow schedule')}`,
  ];
  for (const rem of reminders) {
    const d = toDate(rem.date);
    if (!d) continue;
    lines.push(
      'BEGIN:VEVENT',
      `UID:${rem.batchId ?? 'batch'}-${rem.stage}@hyphaehub.io`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${icsDate(d)}`,
      `SUMMARY:${icsEscape(rem.title)}`,
    );
    if (rem.detail) lines.push(`DESCRIPTION:${icsEscape(rem.detail)}`);
    lines.push(
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${icsEscape(rem.title)}`,
      'TRIGGER:-P1D',
      'END:VALARM',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}

// ── Learning a profile from completed-batch history ─────────────────────────────
export interface LearnResult {
  profile: ForecastProfile;
  samples: number;
}

/**
 * Refine a forecast profile from completed-batch history. For each stage we collect
 * every observed gap (tagged with the batch's recency), drop clear anomalies, take a
 * recency-weighted mean (recent batches count more, with a half-life), then shrink
 * that toward a STABLE upstream `prior` (DEFAULT for a workspace, the resolved
 * workspace for a strain) by n/(n+K) — never toward the entity's own last output, so
 * re-learning the same history is idempotent. Stages with no new samples fall back to
 * `current` (the entity's existing profile) layered on that prior, so manual edits and
 * earlier learns persist and a stage's center and spread stay on the same layer.
 */
export function learnProfileFromHistory(
  history: { actuals: BatchActuals; goalDryWeightG?: number | null }[],
  current: Partial<ForecastProfile> | null = null,
  prior: ForecastProfile = DEFAULT_FORECAST_PROFILE,
): LearnResult {
  const colonization: Sample[] = [];
  const bulkColonization: Sample[] = [];
  const firstFlush: Sample[] = [];
  const flushGap: Sample[] = [];
  const yieldByFlush: Record<number, Sample[]> = {};
  let maxFlush = 0;
  let samples = 0;
  let maxT = 0;
  const nowMs = Date.now();

  for (const h of history) {
    const a = h.actuals;
    // Recency reference: the most recent thing that happened in this batch, clamped to
    // now so a far-future date typo can't hijack the anchor. No usable date → unknown.
    const ref = maxDate([a.INOCULATION, a.SPAWN, a.FRUITING, ...Object.values(a.flushes)]);
    const t = ref ? Math.min(ref.getTime(), nowMs) : null;
    if (t != null && t > maxT) maxT = t;
    let contributed = false;
    const gap = (from: Date | undefined, to: Date | undefined, sink: Sample[]) => {
      if (from && to) {
        const d = daysBetween(from, to);
        if (d >= 0) {
          sink.push({ v: d, t });
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
      bucket.push({ v: grams, t });
      yieldByFlush[n] = bucket;
      if (n > maxFlush) maxFlush = n;
      contributed = true;
    }
    if (contributed) samples += 1;
  }

  // `current` layered on the stable `prior` is the fallback for stages with no new
  // samples: it keeps manual edits / earlier learns and inherits their spread.
  const fallback = resolveForecastProfile(current, prior);

  // Each stage: drop anomalies + recency-weight (robustStat), shrink toward the STABLE
  // prior by the surviving sample count, and record the (floored) spread for ranges.
  const stats: DurationStats = {};
  const learn = (arr: Sample[], key: DurationKey): number => {
    if (arr.length === 0) {
      const inherited = fallback.durationStats?.[key];
      if (inherited) stats[key] = inherited;
      return round(fallback.durations[key], 1);
    }
    const { mean: sampleMean, stdDev: sd, n } = robustStat(arr, maxT);
    const anchor = prior.durations[key];
    const mean = anchor + (sampleMean - anchor) * (n / (n + SHRINK_K));
    const spread = sd == null ? DEFAULT_DURATION_SPREAD[key] : Math.max(sd, MIN_LEARNED_SPREAD);
    stats[key] = { stdDevDays: round(spread, 1), samples: n };
    return round(mean, 1);
  };

  const durations: StageDurations = {
    colonization: learn(colonization, 'colonization'),
    bulkColonization: learn(bulkColonization, 'bulkColonization'),
    firstFlush: learn(firstFlush, 'firstFlush'),
    flushGap: learn(flushGap, 'flushGap'),
  };

  let flushYieldG: number[] | null = null;
  if (maxFlush > 0) {
    flushYieldG = [];
    for (let n = 1; n <= maxFlush; n++) {
      const bucket = yieldByFlush[n];
      flushYieldG.push(bucket?.length ? round(robustStat(bucket, maxT).mean, 1) : 0);
    }
  }

  return {
    profile: {
      durations,
      flushes: Math.max(fallback.flushes, maxFlush || 0) || fallback.flushes,
      flushYieldSplit: fallback.flushYieldSplit,
      flushYieldG,
      durationStats: Object.keys(stats).length ? stats : null,
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

/**
 * The ±1σ spread (days) to use for a stage's prediction range: the learned spread
 * once a strain has ≥2 samples for that stage, otherwise the generic prior spread.
 */
function stageStdDevDays(profile: ForecastProfile, key?: DurationKey): number {
  if (!key) return 0;
  const stat = profile.durationStats?.[key];
  if (stat && stat.samples >= 2 && stat.stdDevDays > 0) return stat.stdDevDays;
  return DEFAULT_DURATION_SPREAD[key];
}

/** Sample standard deviation (n−1); null for fewer than two values. */
function stdDev(nums: number[]): number | null {
  if (nums.length < 2) return null;
  const m = nums.reduce((a, b) => a + b, 0) / nums.length;
  const v = nums.reduce((a, b) => a + (b - m) * (b - m), 0) / (nums.length - 1);
  return Math.sqrt(v);
}

/** A learning sample: an observed value plus the epoch-ms recency of its batch (null = unknown). */
interface Sample {
  v: number;
  t: number | null;
}

/**
 * Robust center + spread for a set of timestamped samples: drop clear anomalies
 * (Iglewicz–Hoaglin modified z-score, with a mean-absolute-deviation fallback when
 * the median absolute deviation is zero), then take a recency-weighted mean (older
 * batches decay with a half-life) and the plain sample stdDev of what survives.
 */
function robustStat(
  samples: Sample[],
  maxT: number,
): { mean: number; stdDev: number | null; n: number } {
  let kept = samples;
  if (samples.length >= MIN_SAMPLES_FOR_TRIM) {
    const values = samples.map((s) => s.v);
    const med = median(values);
    const devs = values.map((v) => Math.abs(v - med));
    const mad = median(devs);
    const scale = mad > 0 ? MAD_SCALE * mad : MEANAD_SCALE * (avg(devs) ?? 0);
    if (scale > 0) {
      // Anomaly only if it is BOTH a statistical outlier AND a large relative deviation,
      // so a one-day wobble among identical runs is kept while a true outlier is dropped.
      const trimmed = samples.filter((s) => {
        const dev = Math.abs(s.v - med);
        const anomaly = dev / scale > OUTLIER_MODZ && med > 0 && dev / med > MIN_REL_DEVIATION;
        return !anomaly;
      });
      if (trimmed.length > 0) kept = trimmed;
    }
  }
  const halfLifeMs = RECENCY_HALFLIFE_DAYS * DAY_MS;
  let wSum = 0;
  let wvSum = 0;
  for (const s of kept) {
    // Unknown recency → neutral weight; otherwise decay by age behind the most recent batch.
    const w = s.t == null ? 1 : 2 ** (-(maxT - s.t) / halfLifeMs);
    wSum += w;
    wvSum += w * s.v;
  }
  const mean = wSum > 0 ? wvSum / wSum : (avg(kept.map((s) => s.v)) ?? 0);
  return { mean, stdDev: stdDev(kept.map((s) => s.v)), n: kept.length };
}

/** Median of a list (0 for empty). */
function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
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

function maxDate(list: (Date | null | undefined)[]): Date | undefined {
  let max: Date | undefined;
  for (const d of list) {
    if (d && (!max || d > max)) max = d;
  }
  return max;
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
