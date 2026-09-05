import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, Card, EmptyState, PageHeader, Spinner, Stat } from '../components/ui';
import { cn } from '../components/ui';
import { api } from '../lib/api';
import { STATUS_META, dayKey, isHarvestStage } from '../lib/forecast';
import { formatDate, formatMass } from '../lib/format';
import type { CalendarResponse } from '../lib/types';

type CalMilestone = CalendarResponse['milestones'][number];

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_MS = 86_400_000;

export function Calendar() {
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const [month, setMonth] = useState(() => startOfMonth(new Date()));

  // Fixed forward window powers the production-forecast panel (next harvest, weekly output, gaps).
  const panel = useQuery({ queryKey: ['forecast-panel'], queryFn: () => api.forecast.calendar() });

  // Month window powers the grid; refetched as you page months.
  const gridFrom = startOfWeekMon(month);
  const gridTo = addDays(gridFrom, 42);
  const grid = useQuery({
    queryKey: ['forecast-month', month.getFullYear(), month.getMonth()],
    queryFn: () => api.forecast.calendar(gridFrom.toISOString(), gridTo.toISOString()),
  });

  const byDay = useMemo(() => {
    const map = new Map<string, CalMilestone[]>();
    for (const m of grid.data?.milestones ?? []) {
      if (!m.predictedAt) continue;
      const key = dayKey(m.predictedAt);
      (map.get(key) ?? map.set(key, []).get(key)!).push(m);
    }
    return map;
  }, [grid.data]);

  if (me.isLoading) return <Spinner />;
  if (me.data && me.data.features?.forecast === false) {
    return (
      <EmptyState
        title="Forecasting is turned off"
        hint="Enable “Cycle forecast & calendar” in Settings to plan your cycles."
      />
    );
  }

  const days = buildMonthDays(month);
  const today = new Date();
  const p = panel.data;

  return (
    <div>
      <PageHeader
        title="Calendar"
        subtitle="Predicted cycles for every batch, and a forecast to keep output steady."
        action={
          <Link
            to="/batches"
            className="rounded-lg bg-hyphae-600 px-4 py-2 text-sm font-medium text-spore hover:bg-hyphae-700"
          >
            + New batch
          </Link>
        }
      />

      {/* Headline forecast stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat
          label="Next harvest"
          value={p?.nextHarvest ? formatDate(p.nextHarvest.date) : '—'}
          sub={p?.nextHarvest?.batchName ?? 'No harvest projected'}
        />
        <Stat
          label="This week"
          value={thisWeekYield(p)}
          sub={`${thisWeekCount(p)} harvest${thisWeekCount(p) === 1 ? '' : 's'} due`}
        />
        <Stat
          label="Batches in play"
          value={(p?.batches ?? []).filter((b) => !b.ended).length}
          sub="being forecast"
        />
        <Stat
          label="Output gaps"
          value={(p?.gaps ?? []).length}
          sub={(p?.gaps ?? []).length ? 'weeks with no harvest' : 'steady pipeline'}
        />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        {/* Month grid */}
        <div className="lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-substrate">
              {month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
            </h2>
            <div className="flex items-center gap-1">
              <IconBtn label="Previous month" onClick={() => setMonth(addMonths(month, -1))}>
                ‹
              </IconBtn>
              <Button variant="secondary" onClick={() => setMonth(startOfMonth(new Date()))}>
                Today
              </Button>
              <IconBtn label="Next month" onClick={() => setMonth(addMonths(month, 1))}>
                ›
              </IconBtn>
            </div>
          </div>

          <Card className="p-3">
            <div className="grid grid-cols-7 gap-px text-center text-xs font-medium text-ink/50">
              {WEEKDAYS.map((d) => (
                <div key={d} className="pb-2">
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {days.map((day) => {
                const key = dayKey(day);
                const items = byDay.get(key) ?? [];
                const inMonth = day.getMonth() === month.getMonth();
                const isToday = sameDay(day, today);
                return (
                  <div
                    key={key}
                    className={cn(
                      'min-h-[74px] rounded-lg border p-1.5 text-left',
                      inMonth ? 'border-mycelium bg-white/70' : 'border-transparent bg-transparent',
                      isToday && 'ring-2 ring-hyphae-400',
                    )}
                  >
                    <div
                      className={cn('text-xs font-medium', inMonth ? 'text-ink/70' : 'text-ink/30')}
                    >
                      {day.getDate()}
                    </div>
                    <div className="mt-1 space-y-0.5">
                      {items.slice(0, 3).map((m, i) => (
                        <DayPill key={`${m.batchId}-${m.stage}-${i}`} m={m} />
                      ))}
                      {items.length > 3 && (
                        <div className="text-[10px] font-medium text-ink/40">
                          +{items.length - 3} more
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <Legend />
          </Card>
        </div>

        {/* Production forecast panel */}
        <div className="space-y-6">
          <div>
            <h2 className="mb-3 text-lg font-semibold text-substrate">Production forecast</h2>
            {panel.isLoading ? (
              <Spinner />
            ) : (
              <div className="space-y-4">
                <NextHarvestCard p={p} />
                <WeeklyOutput p={p} />
                <StaggerCard p={p} />
              </div>
            )}
          </div>

          <UpcomingList p={p} />
        </div>
      </div>
    </div>
  );
}

// ── Grid pieces ─────────────────────────────────────────────────────────────
function DayPill({ m }: { m: CalMilestone }) {
  const harvest = isHarvestStage(m);
  const title = `${m.label}${m.batchName ? ` · ${m.batchName}` : ''} · ${STATUS_META[m.status]?.label ?? m.status}`;
  return (
    <div
      title={title}
      className={cn(
        'flex items-center gap-1 truncate rounded px-1 py-0.5 text-[10px] font-medium',
        dayPillClass(m.status, harvest),
      )}
    >
      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', dotClass(m.status, harvest))} />
      <span className="truncate">{harvest ? `F${m.flushNumber}` : shortStage(m.stage)}</span>
      {m.batchName && <span className="truncate text-ink/40">{m.batchName}</span>}
    </div>
  );
}

function dotClass(status: string, harvest: boolean): string {
  if (status === 'overdue') return 'bg-red-500';
  if (status === 'due') return 'bg-amber-500';
  if (status === 'done') return harvest ? 'bg-flush' : 'bg-hyphae-600';
  return harvest ? 'bg-flush/50' : 'bg-hyphae-500/50';
}

function dayPillClass(status: string, harvest: boolean): string {
  if (status === 'overdue') return 'bg-red-50 text-red-700';
  if (status === 'due') return 'bg-amber-50 text-amber-800';
  if (harvest) return 'bg-flush/10 text-cap';
  return 'bg-hyphae-50 text-hyphae-800';
}

function Legend() {
  const items = [
    { c: 'bg-hyphae-600', t: 'Lifecycle' },
    { c: 'bg-flush', t: 'Harvest' },
    { c: 'bg-amber-500', t: 'Due soon' },
    { c: 'bg-red-500', t: 'Overdue' },
  ];
  return (
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-mycelium pt-3 text-xs text-ink/50">
      {items.map((i) => (
        <span key={i.t} className="flex items-center gap-1.5">
          <span className={cn('h-2 w-2 rounded-full', i.c)} /> {i.t}
        </span>
      ))}
    </div>
  );
}

// ── Panel pieces ────────────────────────────────────────────────────────────
function NextHarvestCard({ p }: { p?: CalendarResponse }) {
  if (!p?.nextHarvest) {
    return (
      <Card className="p-4">
        <div className="text-xs font-medium uppercase tracking-wide text-cap/80">Next harvest</div>
        <div className="mt-1 text-sm text-ink/60">
          Nothing projected yet. Start a batch to see its cycle.
        </div>
      </Card>
    );
  }
  const n = p.nextHarvest;
  return (
    <Card className="border-flush/30 bg-flush/5 p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-cap/80">Next harvest</div>
      <div className="mt-1 flex items-baseline justify-between gap-2">
        <div className="text-lg font-bold text-substrate">{formatDate(n.date)}</div>
        <div className="text-sm text-ink/60">{daysUntil(n.date)}</div>
      </div>
      <div className="mt-0.5 text-sm text-ink/70">
        {n.batchId ? (
          <Link to={`/batches/${n.batchId}`} className="hover:underline">
            {n.batchName}
          </Link>
        ) : (
          n.batchName
        )}
        {n.expectedYieldG != null && ` · ~${formatMass(n.expectedYieldG)} dry`}
      </div>
    </Card>
  );
}

function WeeklyOutput({ p }: { p?: CalendarResponse }) {
  const weeks = useMemo(() => upcomingWeeks(p), [p]);
  if (weeks.length === 0) return null;
  const max = Math.max(1, ...weeks.map((w) => w.expectedYieldG ?? w.harvestCount));
  const anyYield = weeks.some((w) => w.expectedYieldG != null);
  return (
    <Card className="p-4">
      <div className="mb-3 text-xs font-medium uppercase tracking-wide text-cap/80">
        Expected output {anyYield ? '(dry weight)' : '(harvests)'}
      </div>
      <div className="flex items-end justify-between gap-1.5" style={{ height: 96 }}>
        {weeks.map((w) => {
          const val = w.expectedYieldG ?? w.harvestCount;
          const h = Math.round((val / max) * 76);
          return (
            <div
              key={w.weekStart}
              className="flex flex-1 flex-col items-center gap-1"
              title={weekTitle(w)}
            >
              <div className="flex w-full flex-1 items-end">
                <div
                  className={cn(
                    'w-full rounded-t',
                    w.isGap ? 'bg-red-200' : val > 0 ? 'bg-hyphae-500' : 'bg-mycelium',
                  )}
                  style={{ height: Math.max(w.isGap ? 6 : val > 0 ? 6 : 2, h) }}
                />
              </div>
              <div className="text-[10px] text-ink/50">{w.label}</div>
            </div>
          );
        })}
      </div>
      {p?.gaps?.length ? (
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-red-50 p-2 text-xs text-red-700">
          <span className="h-2 w-2 shrink-0 translate-y-1 rounded-full bg-red-400" />
          <span>
            {p.gaps.length} week{p.gaps.length === 1 ? '' : 's'} with no projected harvest. Stagger
            a new batch to fill the gap.
          </span>
        </div>
      ) : null}
    </Card>
  );
}

function StaggerCard({ p }: { p?: CalendarResponse }) {
  if (!p?.staggerHint) return null;
  const s = p.staggerHint;
  return (
    <Card className="p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-cap/80">
        Keep output steady
      </div>
      <p className="mt-1 text-sm text-ink/70">
        To harvest in the week of{' '}
        <span className="font-medium text-substrate">{formatDate(s.gapWeekStart)}</span>, start
        (inoculate) a new batch by{' '}
        <span className="font-medium text-substrate">{formatDate(s.inoculateBy)}</span>.
      </p>
      <p className="mt-1 text-xs text-ink/50">
        Based on a {s.pipelineDays}-day pipeline to first flush.
      </p>
    </Card>
  );
}

function UpcomingList({ p }: { p?: CalendarResponse }) {
  const now = Date.now();
  const upcoming = (p?.milestones ?? [])
    .filter(
      (m) => !m.actualAt && m.predictedAt && new Date(m.predictedAt).getTime() >= now - DAY_MS,
    )
    .slice(0, 10);
  const overdue = (p?.milestones ?? []).filter((m) => m.status === 'overdue');

  return (
    <div>
      <h2 className="mb-3 text-lg font-semibold text-substrate">Upcoming</h2>
      {overdue.length > 0 && (
        <div className="mb-3 space-y-1.5">
          {overdue.map((m, i) => (
            <MilestoneRow key={`od-${m.batchId}-${m.stage}-${i}`} m={m} />
          ))}
        </div>
      )}
      {upcoming.length === 0 ? (
        <EmptyState
          title="Nothing scheduled"
          hint="Predicted stages for your batches will appear here."
        />
      ) : (
        <div className="space-y-1.5">
          {upcoming.map((m, i) => (
            <MilestoneRow key={`up-${m.batchId}-${m.stage}-${i}`} m={m} />
          ))}
        </div>
      )}
    </div>
  );
}

function MilestoneRow({ m }: { m: CalMilestone }) {
  const meta = STATUS_META[m.status] ?? { label: m.status, badge: 'neutral' as const };
  return (
    <Card className="flex items-center justify-between gap-3 p-3">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-substrate">
          {m.label}
          {m.batchName ? ` · ${m.batchName}` : ''}
        </div>
        <div className="text-xs text-ink/50">
          {formatDate(m.predictedAt)}
          {m.expectedYieldG != null && ` · ~${formatMass(m.expectedYieldG)} dry`}
        </div>
      </div>
      <div className="shrink-0">
        {m.batchId ? (
          <Link to={`/batches/${m.batchId}`}>
            <Badge color={meta.badge}>{meta.label}</Badge>
          </Link>
        ) : (
          <Badge color={meta.badge}>{meta.label}</Badge>
        )}
      </div>
    </Card>
  );
}

function IconBtn({
  label,
  onClick,
  children,
}: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex h-9 w-9 items-center justify-center rounded-lg border border-mycelium bg-white text-lg text-ink/60 hover:bg-spore"
    >
      {children}
    </button>
  );
}

// ── Small helpers ───────────────────────────────────────────────────────────
function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}
function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY_MS);
}
function startOfWeekMon(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (x.getDay() + 6) % 7;
  return addDays(x, -dow);
}
function sameDay(a: Date, b: Date): boolean {
  return a.toDateString() === b.toDateString();
}
function buildMonthDays(month: Date): Date[] {
  const start = startOfWeekMon(startOfMonth(month));
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}
function shortStage(stage: string): string {
  if (stage === 'INOCULATION') return 'Inoc';
  if (stage === 'SPAWN') return 'Spawn';
  if (stage === 'FRUITING') return 'Fruit';
  return stage;
}
function daysUntil(iso: string): string {
  const d = Math.round((new Date(iso).getTime() - Date.now()) / DAY_MS);
  if (d <= 0) return 'today';
  if (d === 1) return 'tomorrow';
  return `in ${d} days`;
}
function upcomingWeeks(p?: CalendarResponse) {
  if (!p) return [];
  const monday = startOfWeekMon(new Date()).toISOString().slice(0, 10);
  return p.weeks.filter((w) => w.weekStart.slice(0, 10) >= monday).slice(0, 8);
}
function weekTitle(w: {
  label: string;
  harvestCount: number;
  expectedYieldG: number | null;
}): string {
  const yieldPart = w.expectedYieldG != null ? ` · ~${formatMass(w.expectedYieldG)} dry` : '';
  return `Week of ${w.label}: ${w.harvestCount} harvest${w.harvestCount === 1 ? '' : 's'}${yieldPart}`;
}
function thisWeekYield(p?: CalendarResponse): string {
  const w = upcomingWeeks(p)[0];
  if (!w) return '—';
  return w.expectedYieldG != null ? formatMass(w.expectedYieldG) : String(w.harvestCount);
}
function thisWeekCount(p?: CalendarResponse): number {
  return upcomingWeeks(p)[0]?.harvestCount ?? 0;
}
