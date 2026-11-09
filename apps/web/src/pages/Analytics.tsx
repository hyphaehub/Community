import {
  CONTAMINANT_TYPE_LABELS,
  CONTAMINATION_CAUSE_LABELS,
  CULTURE_TYPE_LABELS,
} from '@hyphaehub/core';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { AiScanner } from '../components/AiScanner';
import { Card, EmptyState, PageHeader, Spinner, Stat } from '../components/ui';
import { api } from '../lib/api';
import { formatDate } from '../lib/format';
import type { ContaminationBreakdown, ContaminationReport } from '../lib/types';

const pct = (r: number) => `${(r * 100).toFixed(r >= 0.1 ? 0 : 1)}%`;

/** Rate color: calm under 10%, amber to 25%, flush above. */
function rateColor(rate: number): string {
  if (rate >= 0.25) return 'bg-red-500';
  if (rate >= 0.1) return 'bg-amber-500';
  return 'bg-hyphae-500';
}

function RateBars({
  title,
  rows,
  labelOf,
  hint,
}: {
  title: string;
  rows: ContaminationBreakdown[];
  labelOf?: (key: string, label: string) => string;
  hint?: string;
}) {
  const shown = rows.filter((r) => r.total > 0).slice(0, 12);
  return (
    <Card>
      <div className="mb-3">
        <h2 className="text-base font-semibold text-substrate">{title}</h2>
        {hint && <p className="text-xs text-ink/50">{hint}</p>}
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-ink/40">No data yet.</p>
      ) : (
        <div className="space-y-2.5">
          {shown.map((r) => (
            <div key={r.key}>
              <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
                <span className="truncate text-substrate">
                  {labelOf ? labelOf(r.key, r.label) : r.label}
                </span>
                <span className="shrink-0 text-xs text-ink/50">
                  {r.contaminated}/{r.total} ·{' '}
                  <span className="font-medium text-ink/70">{pct(r.rate)}</span>
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-mycelium">
                <div
                  className={`h-full rounded-full ${rateColor(r.rate)}`}
                  style={{ width: `${Math.max(r.rate * 100, r.contaminated > 0 ? 3 : 0)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function Tally({
  title,
  rows,
  labelOf,
}: {
  title: string;
  rows: { key: string; count: number }[];
  labelOf: (key: string) => string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <Card>
      <h2 className="mb-3 text-base font-semibold text-substrate">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-ink/40">No contaminations logged yet.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.key} className="flex items-center gap-3">
              <span className="w-40 shrink-0 truncate text-sm text-substrate">
                {labelOf(r.key)}
              </span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-mycelium">
                <div
                  className="h-full rounded-full bg-cap"
                  style={{ width: `${(r.count / max) * 100}%` }}
                />
              </div>
              <span className="w-6 shrink-0 text-right text-xs text-ink/60">{r.count}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function RecentRow({ rec }: { rec: ContaminationReport['recent'][number] }) {
  const inner = (
    <div className="flex items-center justify-between px-4 py-2.5">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-substrate">{rec.label}</div>
        <div className="truncate text-xs text-ink/50">
          {CULTURE_TYPE_LABELS[rec.type as keyof typeof CULTURE_TYPE_LABELS] ?? rec.type}
          {rec.contaminantType
            ? ` · ${CONTAMINANT_TYPE_LABELS[rec.contaminantType as keyof typeof CONTAMINANT_TYPE_LABELS] ?? rec.contaminantType}`
            : ''}
          {rec.contaminationCause
            ? ` · ${CONTAMINATION_CAUSE_LABELS[rec.contaminationCause as keyof typeof CONTAMINATION_CAUSE_LABELS] ?? rec.contaminationCause}`
            : ''}
        </div>
      </div>
      <span className="shrink-0 text-xs text-ink/50">{formatDate(rec.contaminatedAt)}</span>
    </div>
  );
  return rec.batchId ? (
    <Link to={`/batches/${rec.batchId}`} className="block hover:bg-spore">
      {inner}
    </Link>
  ) : (
    inner
  );
}

export function Analytics() {
  const q = useQuery({ queryKey: ['report-contamination'], queryFn: api.reports.contamination });
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const aiEnabled = me.data?.features?.aiDiagnosis === true;

  return (
    <div>
      <PageHeader
        title="Contamination insights"
        subtitle="Where contamination strikes across your grows — so you can fix the cause, not chase symptoms."
      />

      {aiEnabled && (
        <Card className="mb-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-substrate">AI contamination scanner</h2>
              <p className="text-xs text-ink/50">
                Upload a photo of a suspect jar, plate, or tub — the AI flags likely contamination
                and what to do.
              </p>
            </div>
          </div>
          <div className="mt-3">
            <AiScanner compact />
          </div>
        </Card>
      )}
      {q.isLoading ? (
        <Spinner />
      ) : !q.data || q.data.overall.total === 0 ? (
        <EmptyState
          title="No culture data yet"
          hint="Once you add cultures and mark any contaminations, your rates and patterns show up here."
        />
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Overall contam rate" value={pct(q.data.overall.rate)} />
            <Stat label="Contaminated" value={q.data.overall.contaminated} />
            <Stat label="Total cultures" value={q.data.overall.total} />
            <Stat
              label="Clean run rate"
              value={pct(1 - q.data.overall.rate)}
              sub="cultures that stayed clean"
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <RateBars
              title="By stage"
              hint="Which lifecycle step loses the most"
              rows={q.data.byStage}
              labelOf={(key, label) =>
                CULTURE_TYPE_LABELS[key as keyof typeof CULTURE_TYPE_LABELS] ?? label
              }
            />
            <RateBars title="By strain" hint="Genetics that struggle" rows={q.data.byStrain} />
            <RateBars
              title="By substrate"
              hint="Recipes / grain that fail"
              rows={q.data.bySubstrate}
            />
            <div className="grid gap-4">
              <Tally
                title="Contaminant types"
                rows={q.data.byContaminant}
                labelOf={(k) =>
                  CONTAMINANT_TYPE_LABELS[k as keyof typeof CONTAMINANT_TYPE_LABELS] ?? k
                }
              />
              <Tally
                title="Suspected causes"
                rows={q.data.byCause}
                labelOf={(k) =>
                  CONTAMINATION_CAUSE_LABELS[k as keyof typeof CONTAMINATION_CAUSE_LABELS] ?? k
                }
              />
            </div>
          </div>

          {q.data.recent.length > 0 && (
            <div>
              <h2 className="mb-3 text-lg font-semibold text-substrate">Recent contaminations</h2>
              <Card className="divide-y divide-mycelium p-0">
                {q.data.recent.map((rec) => (
                  <RecentRow key={rec.id} rec={rec} />
                ))}
              </Card>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
