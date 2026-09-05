import type { ForecastMilestone } from './types';

/** A flush milestone (a harvest) vs. a lifecycle milestone (spawn, fruiting…). */
export function isHarvestStage(m: Pick<ForecastMilestone, 'flushNumber'>): boolean {
  return m.flushNumber != null;
}

type BadgeColor = 'neutral' | 'green' | 'amber' | 'red' | 'blue' | 'brown';

/** Display metadata for a milestone status. */
export const STATUS_META: Record<string, { label: string; badge: BadgeColor }> = {
  done: { label: 'Logged', badge: 'green' },
  overdue: { label: 'Overdue', badge: 'red' },
  due: { label: 'Due soon', badge: 'amber' },
  upcoming: { label: 'Upcoming', badge: 'neutral' },
  stalled: { label: 'Ended', badge: 'neutral' },
};

/** Human phrase for an estimate-vs-actual variance in days (+ = late). */
export function varianceLabel(days: number | null): string | null {
  if (days == null) return null;
  if (days === 0) return 'on time';
  if (days > 0) return `${days}d late`;
  return `${Math.abs(days)}d early`;
}

/** Local YYYY-MM-DD key for bucketing a date onto a calendar day. */
export function dayKey(value: string | number | Date): string {
  return new Date(value).toLocaleDateString('en-CA'); // en-CA renders as YYYY-MM-DD
}
