import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { apiBase } from '../lib/connection';
import { downloadBlob } from '../lib/download';
import { formatDate } from '../lib/format';
import type { ForecastReminder } from '../lib/types';
import { Badge, Button, Card, EmptyState, Modal, Spinner } from './ui';

const STATUS: Record<string, { label: string; color: 'red' | 'amber' | 'neutral' }> = {
  overdue: { label: 'Overdue', color: 'red' },
  due: { label: 'Due soon', color: 'amber' },
  upcoming: { label: 'Upcoming', color: 'neutral' },
};

/** Human "when" for a reminder relative to today. */
function whenLabel(daysUntil: number): string {
  if (daysUntil < 0) return `${Math.abs(daysUntil)} day${daysUntil === -1 ? '' : 's'} overdue`;
  if (daysUntil === 0) return 'today';
  if (daysUntil === 1) return 'tomorrow';
  return `in ${daysUntil} days`;
}

function ReminderRow({ r }: { r: ForecastReminder }) {
  const meta = STATUS[r.status] ?? { label: 'Upcoming', color: 'neutral' as const };
  const body = (
    <Card className="flex items-center justify-between gap-3 p-3 transition-colors hover:bg-spore">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-substrate">{r.title}</div>
        <div className="truncate text-xs text-ink/50">
          {whenLabel(r.daysUntil)} · {formatDate(r.date)}
          {r.detail ? ` · ${r.detail}` : ''}
        </div>
      </div>
      <Badge color={meta.color}>{meta.label}</Badge>
    </Card>
  );
  return r.batchId ? (
    <Link to={`/batches/${r.batchId}`} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}

/** Add-to-calendar: a one-time .ics download or an auto-updating subscribe link. */
export function CalendarExportButton() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [subUrl, setSubUrl] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const webcal = subUrl ? subUrl.replace(/^https?:\/\//, 'webcal://') : '';

  async function download() {
    setBusy(true);
    setMsg(null);
    try {
      const ics = await api.forecast.calendarIcs();
      downloadBlob('hyphaehub-schedule.ics', new Blob([ics], { type: 'text/calendar' }));
      setMsg('Downloaded — open the file to import these dates.');
    } catch {
      setMsg('Could not build the calendar file.');
    } finally {
      setBusy(false);
    }
  }

  async function subscribe() {
    setBusy(true);
    setMsg(null);
    try {
      const { path } = await api.forecast.subscription();
      setSubUrl((apiBase() || window.location.origin) + path);
    } catch {
      setMsg('Could not create a subscription link.');
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    setBusy(true);
    try {
      const { path } = await api.forecast.rotateSubscription();
      setSubUrl((apiBase() || window.location.origin) + path);
      setMsg('Link reset — the old one no longer works.');
    } catch {
      setMsg('Could not reset the link.');
    } finally {
      setBusy(false);
    }
  }

  function copy() {
    if (subUrl) {
      navigator.clipboard?.writeText(subUrl).then(
        () => setMsg('Link copied.'),
        () => setMsg(null),
      );
    }
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Add to calendar
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Add your grow schedule to a calendar"
      >
        <div className="space-y-5">
          <div>
            <div className="text-sm font-medium text-substrate">Subscribe (auto-updating)</div>
            <p className="mt-1 text-xs text-ink/60">
              A private link your calendar app refreshes on its own, so new spawn, fruiting, and
              harvest dates appear automatically. Keep it secret — anyone with the link can see your
              schedule.
            </p>
            {subUrl ? (
              <div className="mt-2 space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    readOnly
                    value={subUrl}
                    onFocus={(e) => e.currentTarget.select()}
                    className="w-full rounded-lg border border-mycelium bg-spore px-3 py-2 text-xs text-ink"
                  />
                  <Button variant="secondary" onClick={copy}>
                    Copy
                  </Button>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <a href={webcal} className="font-medium text-hyphae-700 hover:underline">
                    Open in calendar app
                  </a>
                  <button
                    type="button"
                    onClick={reset}
                    disabled={busy}
                    className="font-medium text-ink/50 hover:text-flush"
                  >
                    Reset link
                  </button>
                </div>
              </div>
            ) : (
              <Button className="mt-2" variant="secondary" onClick={subscribe} disabled={busy}>
                {busy ? 'Creating…' : 'Create subscription link'}
              </Button>
            )}
          </div>

          <div className="border-t border-mycelium pt-4">
            <div className="text-sm font-medium text-substrate">One-time file (.ics)</div>
            <p className="mt-1 text-xs text-ink/60">
              A snapshot you import once. It won't update as your batches progress.
            </p>
            <Button className="mt-2" variant="secondary" onClick={download} disabled={busy}>
              {busy ? 'Preparing…' : 'Download .ics'}
            </Button>
          </div>

          {msg && <p className="text-xs text-hyphae-700">{msg}</p>}
        </div>
      </Modal>
    </>
  );
}

/**
 * Actionable reminders for the next life-stage transitions across all batches
 * (spawn to bulk, start fruiting, each flush) — overdue or coming up soon.
 */
export function RemindersPanel({
  title = 'Reminders',
  limit,
  horizonDays,
}: {
  title?: string;
  limit?: number;
  horizonDays?: number;
}) {
  const q = useQuery({
    queryKey: ['forecast-reminders', horizonDays ?? 21],
    queryFn: () => api.forecast.reminders(horizonDays),
  });
  const all = q.data?.reminders ?? [];
  const shown = limit ? all.slice(0, limit) : all;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-substrate">{title}</h2>
        {limit && all.length > limit && (
          <Link to="/calendar" className="text-sm font-medium text-hyphae-700 hover:underline">
            View all ({all.length})
          </Link>
        )}
      </div>
      {q.isLoading ? (
        <Spinner />
      ) : shown.length === 0 ? (
        <EmptyState
          title="You're all caught up"
          hint="Reminders for the next spawn, fruiting, and harvest appear here as your batches progress."
        />
      ) : (
        <div className="space-y-1.5">
          {shown.map((r) => (
            <ReminderRow key={`${r.batchId}-${r.stage}`} r={r} />
          ))}
        </div>
      )}
    </div>
  );
}
