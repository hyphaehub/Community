import {
  CONTAINER_TYPES,
  COST_CATEGORIES,
  CULTURE_TYPE_LABELS,
  EVENT_LABELS,
  EVENT_TYPES,
  SOURCE_TYPES,
  toCents,
} from '@hyphaehub/core';
import type {
  CombineCulturesInput,
  ContainerType,
  CostCategory,
  CostEntryCreateInput,
  CultureCreateInput,
  EventCreateInput,
  EventType,
  HarvestCreateInput,
  SourceType,
  SplitCultureInput,
} from '@hyphaehub/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Icon } from '../components/icons';
import { BatchStatusBadge, CultureStatusBadge } from '../components/status';
import {
  Badge,
  Button,
  Card,
  cn,
  EmptyState,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Spinner,
  Stat,
  Textarea,
} from '../components/ui';
import { LabelPrintModal } from '../components/LabelPrint';
import { api, ApiError } from '../lib/api';
import type { BatchForecastResponse, Culture } from '../lib/types';
import { isHarvestStage, STATUS_META, varianceLabel } from '../lib/forecast';
import { batchLabelData, cultureLabelData } from '../lib/labels';
import { formatDate, formatMass, money, perGram } from '../lib/format';

type ModalState =
  | { kind: 'none' }
  | { kind: 'source' }
  | { kind: 'combine' }
  | { kind: 'cost' }
  | { kind: 'split'; culture: Culture }
  | { kind: 'event'; culture: Culture }
  | { kind: 'harvest'; culture: Culture };

export function BatchDetail() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [modal, setModal] = useState<ModalState>({ kind: 'none' });
  const [labelOpen, setLabelOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const batch = useQuery({ queryKey: ['batch', id], queryFn: () => api.batches.get(id) });
  const events = useQuery({ queryKey: ['events'], queryFn: () => api.events.list() });
  const forecast = useQuery({
    queryKey: ['forecast-batch', id],
    queryFn: () => api.forecast.batch(id),
    enabled: !!id,
  });

  const learn = useMutation({
    mutationFn: (strainId: string) => api.forecast.learnStrain(strainId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['forecast-batch', id] });
      qc.invalidateQueries({ queryKey: ['strains'] });
    },
  });

  function refresh() {
    qc.invalidateQueries({ queryKey: ['batch', id] });
    qc.invalidateQueries({ queryKey: ['events'] });
    qc.invalidateQueries({ queryKey: ['cultures'] });
    qc.invalidateQueries({ queryKey: ['harvests'] });
    qc.invalidateQueries({ queryKey: ['costs'] });
    qc.invalidateQueries({ queryKey: ['me'] });
  }

  const act = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => {
      refresh();
      setModal({ kind: 'none' });
      setError(null);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Something went wrong'),
  });

  function deleteCulture(c: Culture) {
    if (window.confirm(`Delete “${c.label}”? This cannot be undone.`)) {
      act.mutate(() => api.cultures.remove(c.id));
    }
  }

  if (batch.isLoading) return <Spinner />;
  if (batch.isError || !batch.data)
    return <EmptyState title="Batch not found" action={<Link to="/batches">Back to batches</Link>} />;

  const { batch: b, strain, cultures, harvests, costs, summary } = batch.data;
  const sources = cultures.filter((c) => ['SOURCE', 'AGAR', 'LIQUID_CULTURE'].includes(c.type));
  const grain = cultures.filter((c) => c.type === 'GRAIN');
  const tubs = cultures.filter((c) => c.type === 'BULK');
  const batchEvents = (events.data ?? []).filter((e) => e.batchId === b.id);
  const labelItems = [
    batchLabelData(b, strain?.commonName),
    ...cultures.map((c) => cultureLabelData(c, strain?.commonName)),
  ];

  return (
    <div>
      <div className="mb-2">
        <Link to="/batches" className="text-sm text-hyphae-700 hover:underline">
          ← Batches
        </Link>
      </div>
      <PageHeader
        title={b.name}
        subtitle={
          <span className="flex items-center gap-2">
            <BatchStatusBadge status={b.status} />
            {strain && <span>{strain.commonName}</span>}
            <span>· started {formatDate(b.startedAt)}</span>
          </span>
        }
        action={
          <div className="flex gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                if (
                  window.confirm(
                    `Delete the entire batch “${b.name}” and all its cultures, harvests, and costs? This cannot be undone.`,
                  )
                ) {
                  api.batches.remove(b.id).then(() => {
                    qc.invalidateQueries({ queryKey: ['batches'] });
                    navigate('/batches');
                  });
                }
              }}
            >
              Delete batch
            </Button>
            <Button variant="secondary" onClick={() => setLabelOpen(true)}>
              Print labels
            </Button>
            <Button variant="secondary" onClick={() => setModal({ kind: 'cost' })}>
              + Cost
            </Button>
            <Button onClick={() => setModal({ kind: 'source' })}>+ Source</Button>
          </div>
        }
      />

      {/* Summary */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
        <Stat label="Total cost" value={money(summary.cost.totalCents)} />
        <Stat label="Wet yield" value={formatMass(summary.yield.totalWetG)} />
        <Stat label="Dry yield" value={formatMass(summary.yield.totalDryG)} />
        <Stat
          label="Bio. efficiency"
          value={summary.efficiency.biologicalEfficiency != null ? `${summary.efficiency.biologicalEfficiency}%` : '—'}
        />
        <Stat label="Cost / dry g" value={perGram(summary.efficiency.costPerDryGramCents)} />
        <Stat
          label="Days to harvest"
          value={summary.timeline.daysToFirstHarvest ?? '—'}
          sub={`${summary.yield.flushCount} flushes`}
        />
      </div>

      {/* Predicted timeline */}
      {forecast.data && (
        <PredictedTimeline
          data={forecast.data}
          hasStrain={!!b.strainId}
          learning={learn.isPending}
          onLearn={() => b.strainId && learn.mutate(b.strainId)}
          learnResult={learn.data}
        />
      )}

      {/* Lineage */}
      <div className="mt-8 grid gap-4 lg:grid-cols-3">
        <LineageColumn
          title="Source"
          hint="Where the run begins"
          cultures={sources}
          empty="Add a source (spore, LC, agar, or clone) to begin."
          onSplit={(c) => setModal({ kind: 'split', culture: c })}
          onEvent={(c) => setModal({ kind: 'event', culture: c })}
          onDelete={deleteCulture}
        />
        <LineageColumn
          title="Grain spawn"
          hint="Jars from your source"
          cultures={grain}
          empty="Split a source into grain jars."
          action={
            grain.length > 0 ? (
              <Button variant="ghost" onClick={() => setModal({ kind: 'combine' })}>
                <Icon name="combine" size={16} /> Combine → tub
              </Button>
            ) : undefined
          }
          onSplit={(c) => setModal({ kind: 'split', culture: c })}
          onEvent={(c) => setModal({ kind: 'event', culture: c })}
          onDelete={deleteCulture}
        />
        <LineageColumn
          title="Fruiting tubs"
          hint="Combined jars, fruiting & harvest"
          cultures={tubs}
          empty="Combine grain jars into a tub."
          onHarvest={(c) => setModal({ kind: 'harvest', culture: c })}
          onEvent={(c) => setModal({ kind: 'event', culture: c })}
          onDelete={deleteCulture}
        />
      </div>

      {/* Harvests + Costs + Timeline */}
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="mb-3 text-lg font-semibold text-substrate">Harvests</h2>
          {harvests.length === 0 ? (
            <EmptyState title="No harvests yet" hint="Log a flush from a fruiting tub." />
          ) : (
            <Card className="divide-y divide-mycelium p-0">
              {harvests.map((h) => (
                <div key={h.id} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <div className="text-sm font-medium text-substrate">Flush {h.flushNumber}</div>
                    <div className="text-xs text-ink/50">{formatDate(h.harvestedAt)}</div>
                  </div>
                  <div className="text-right text-sm">
                    <div className="text-substrate">{formatMass(h.wetWeightG)} wet</div>
                    <div className="text-ink/50">
                      {h.dryWeightG != null ? `${formatMass(h.dryWeightG)} dry` : 'drying…'}
                    </div>
                  </div>
                </div>
              ))}
            </Card>
          )}
        </div>

        <div>
          <h2 className="mb-3 text-lg font-semibold text-substrate">Costs</h2>
          {costs.length === 0 ? (
            <EmptyState title="No costs logged" hint="Split/combine can log costs automatically." />
          ) : (
            <Card className="divide-y divide-mycelium p-0">
              {costs.map((cost) => (
                <div key={cost.id} className="flex items-center justify-between px-4 py-3 text-sm">
                  <div>
                    <div className="text-substrate">{cost.description}</div>
                    <div className="text-xs text-ink/50">{cost.category.toLowerCase()}</div>
                  </div>
                  <div className="font-medium text-substrate">{money(cost.amountCents)}</div>
                </div>
              ))}
            </Card>
          )}
        </div>
      </div>

      <div className="mt-8">
        <h2 className="mb-3 text-lg font-semibold text-substrate">Timeline</h2>
        {batchEvents.length === 0 ? (
          <EmptyState title="No events yet" hint="Log inoculation, colonization, fruiting, and more." />
        ) : (
          <ol className="relative space-y-3 border-l border-mycelium pl-6">
            {batchEvents.map((e) => (
              <li key={e.id} className="relative">
                <span className="absolute -left-[27px] top-1 h-3 w-3 rounded-full bg-hyphae-400" />
                <div className="text-sm font-medium text-substrate">{EVENT_LABELS[e.type]}</div>
                <div className="text-xs text-ink/50">
                  {formatDate(e.occurredAt)}
                  {e.note ? `: ${e.note}` : ''}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>

      {/* ── Modals ── */}
      <SourceModal
        open={modal.kind === 'source'}
        onClose={() => setModal({ kind: 'none' })}
        error={error}
        pending={act.isPending}
        onSubmit={(data) =>
          act.mutate(() => api.cultures.create({ ...data, batchId: b.id, strainId: b.strainId }))
        }
      />

      <SplitModal
        state={modal}
        onClose={() => setModal({ kind: 'none' })}
        error={error}
        pending={act.isPending}
        onSubmit={(cultureId, data) => act.mutate(() => api.cultures.split(cultureId, { ...data, batchId: b.id }))}
      />

      <CombineModal
        open={modal.kind === 'combine'}
        grain={grain}
        onClose={() => setModal({ kind: 'none' })}
        error={error}
        pending={act.isPending}
        onSubmit={(data) => act.mutate(() => api.cultures.combine({ ...data, batchId: b.id }))}
      />

      <HarvestModal
        state={modal}
        onClose={() => setModal({ kind: 'none' })}
        error={error}
        pending={act.isPending}
        onSubmit={(cultureId, data) => act.mutate(() => api.harvests.create({ ...data, cultureId, batchId: b.id }))}
      />

      <EventModal
        state={modal}
        onClose={() => setModal({ kind: 'none' })}
        error={error}
        pending={act.isPending}
        onSubmit={(cultureId, data) => act.mutate(() => api.events.create({ ...data, cultureId }))}
      />

      <CostModal
        open={modal.kind === 'cost'}
        onClose={() => setModal({ kind: 'none' })}
        error={error}
        pending={act.isPending}
        onSubmit={(data) => act.mutate(() => api.costs.create({ ...data, batchId: b.id }))}
      />

      <LabelPrintModal
        open={labelOpen}
        onClose={() => setLabelOpen(false)}
        items={labelItems}
        title={`Print labels · ${b.name}`}
      />
    </div>
  );
}

// ── Predicted timeline ────────────────────────────────────────────────────────
function PredictedTimeline({
  data,
  hasStrain,
  learning,
  onLearn,
  learnResult,
}: {
  data: BatchForecastResponse;
  hasStrain: boolean;
  learning: boolean;
  onLearn: () => void;
  learnResult?: { samples: number; saved: boolean };
}) {
  const samples = data.profile.samples ?? 0;
  return (
    <div className="mt-8">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-substrate">Predicted timeline</h2>
          <p className="text-xs text-ink/50">
            {samples > 0
              ? `Estimates tuned from ${samples} completed run${samples === 1 ? '' : 's'}.`
              : 'Using generic estimates. They sharpen as your batches finish.'}
          </p>
        </div>
        {hasStrain && (
          <Button variant="secondary" onClick={onLearn} disabled={learning}>
            {learning ? 'Updating…' : 'Update estimates from history'}
          </Button>
        )}
      </div>
      {learnResult && (
        <p className="mb-2 text-xs text-ink/50">
          {learnResult.samples === 0
            ? 'No completed runs for this strain yet. Keep logging and try again.'
            : learnResult.saved
              ? `Updated from ${learnResult.samples} run${learnResult.samples === 1 ? '' : 's'}.`
              : 'Learned from history, but preset strains cannot be tuned. Add your own strain to save estimates.'}
        </p>
      )}
      <Card className="divide-y divide-mycelium p-0">
        {data.timeline.map((m) => {
          const meta = STATUS_META[m.status] ?? { label: m.status, badge: 'neutral' as const };
          const variance = varianceLabel(m.varianceDays);
          return (
            <div key={m.stage} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="text-sm font-medium text-substrate">{m.label}</div>
                <div className="text-xs text-ink/50">
                  {m.actualAt
                    ? `Logged ${formatDate(m.actualAt)}`
                    : m.predictedAt
                      ? `Projected ${formatDate(m.predictedAt)}`
                      : 'Not scheduled'}
                  {isHarvestStage(m) && m.expectedYieldG != null
                    ? ` · ~${formatMass(m.expectedYieldG)} dry`
                    : ''}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {variance && m.actualAt && (
                  <span
                    className={cn(
                      'text-xs',
                      m.varianceDays && m.varianceDays > 0 ? 'text-amber-700' : 'text-hyphae-700',
                    )}
                  >
                    {variance}
                  </span>
                )}
                <Badge color={meta.badge}>{meta.label}</Badge>
              </div>
            </div>
          );
        })}
      </Card>
    </div>
  );
}

// ── Lineage column ────────────────────────────────────────────────────────────
function LineageColumn({
  title,
  hint,
  cultures,
  empty,
  action,
  onSplit,
  onEvent,
  onHarvest,
  onDelete,
}: {
  title: string;
  hint: string;
  cultures: Culture[];
  empty: string;
  action?: React.ReactNode;
  onSplit?: (c: Culture) => void;
  onEvent?: (c: Culture) => void;
  onHarvest?: (c: Culture) => void;
  onDelete?: (c: Culture) => void;
}) {
  return (
    <div className="rounded-2xl border border-mycelium bg-parchment p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-substrate">{title}</h3>
          <p className="text-xs text-ink/50">{hint}</p>
        </div>
        {action}
      </div>
      {cultures.length === 0 ? (
        <p className="rounded-lg border border-dashed border-mycelium p-4 text-center text-xs text-ink/40">
          {empty}
        </p>
      ) : (
        <div className="space-y-2">
          {cultures.map((c) => (
            <div key={c.id} className="rounded-xl border border-mycelium bg-white p-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium text-substrate">{c.label}</div>
                <CultureStatusBadge status={c.status} />
              </div>
              <div className="mt-1 text-xs text-ink/50">
                {CULTURE_TYPE_LABELS[c.type]}
                {c.substrateType ? ` · ${c.substrateType}` : ''}
                {c.colonizationPct != null ? ` · ${c.colonizationPct}%` : ''}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {onSplit && (
                  <button
                    type="button"
                    onClick={() => onSplit(c)}
                    className="inline-flex items-center gap-1 text-xs font-medium text-hyphae-700 hover:underline"
                  >
                    <Icon name="split" size={13} /> Split
                  </button>
                )}
                {onHarvest && (
                  <button
                    type="button"
                    onClick={() => onHarvest(c)}
                    className="text-xs font-medium text-flush hover:underline"
                  >
                    Log harvest
                  </button>
                )}
                {onEvent && (
                  <button
                    type="button"
                    onClick={() => onEvent(c)}
                    className="text-xs font-medium text-ink/50 hover:underline"
                  >
                    Log event
                  </button>
                )}
                {onDelete && (
                  <button
                    type="button"
                    onClick={() => onDelete(c)}
                    className="ml-auto text-xs font-medium text-ink/40 hover:text-flush hover:underline"
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Modal forms (FormData-based) ─────────────────────────────────────────────
function FormActions({ onClose, pending, label }: { onClose: () => void; pending: boolean; label: string }) {
  return (
    <div className="flex justify-end gap-2">
      <Button type="button" variant="secondary" onClick={onClose}>
        Cancel
      </Button>
      <Button type="submit" disabled={pending}>
        {pending ? 'Saving…' : label}
      </Button>
    </div>
  );
}

function SourceModal({ open, onClose, onSubmit, error, pending }: {
  open: boolean;
  onClose: () => void;
  onSubmit: (d: CultureCreateInput) => void;
  error: string | null;
  pending: boolean;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Add a source">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          onSubmit({
            type: 'SOURCE',
            label: String(f.get('label')),
            sourceType: String(f.get('sourceType')) as SourceType,
            containerType: String(f.get('containerType')) as ContainerType,
            status: 'COLONIZED',
          });
        }}
        className="space-y-4"
      >
        <Field label="Label">
          <Input name="label" required placeholder="e.g. GT Liquid Culture" />
        </Field>
        <Field label="Source type">
          <Select name="sourceType" defaultValue="LIQUID_CULTURE">
            {SOURCE_TYPES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, ' ').toLowerCase()}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Container">
          <Select name="containerType" defaultValue="SYRINGE">
            {CONTAINER_TYPES.map((c) => (
              <option key={c} value={c}>
                {c.toLowerCase()}
              </option>
            ))}
          </Select>
        </Field>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <FormActions onClose={onClose} pending={pending} label="Add source" />
      </form>
    </Modal>
  );
}

function SplitModal({ state, onClose, onSubmit, error, pending }: {
  state: ModalState;
  onClose: () => void;
  onSubmit: (cultureId: string, d: SplitCultureInput) => void;
  error: string | null;
  pending: boolean;
}) {
  if (state.kind !== 'split') return null;
  const c = state.culture;
  return (
    <Modal open onClose={onClose} title={`Split “${c.label}”`}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          onSubmit(c.id, {
            count: Number(f.get('count')),
            type: 'GRAIN',
            labelPrefix: String(f.get('labelPrefix') || `${c.label} Jar`),
            substrateType: String(f.get('substrateType') || ''),
            quantity: f.get('quantity') ? Number(f.get('quantity')) : undefined,
            quantityUnit: String(f.get('quantityUnit') || 'quart'),
            status: 'COLONIZED',
            costPerChildCents: f.get('cost') ? toCents(String(f.get('cost'))) : undefined,
          });
        }}
        className="space-y-4"
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="How many jars">
            <Input name="count" type="number" min={1} max={100} defaultValue={4} required />
          </Field>
          <Field label="Label prefix">
            <Input name="labelPrefix" defaultValue={`${c.label} Jar`} />
          </Field>
        </div>
        <Field label="Grain / substrate">
          <Input name="substrateType" placeholder="e.g. Rye berries" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Qty each">
            <Input name="quantity" type="number" step="0.1" defaultValue={1} />
          </Field>
          <Field label="Unit">
            <Input name="quantityUnit" defaultValue="quart" />
          </Field>
        </div>
        <Field label="Cost per jar ($)" hint="Auto-logged to the batch">
          <Input name="cost" type="number" step="0.01" min={0} placeholder="3.00" />
        </Field>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <FormActions onClose={onClose} pending={pending} label="Create jars" />
      </form>
    </Modal>
  );
}

function CombineModal({ open, grain, onClose, onSubmit, error, pending }: {
  open: boolean;
  grain: Culture[];
  onClose: () => void;
  onSubmit: (d: CombineCulturesInput) => void;
  error: string | null;
  pending: boolean;
}) {
  const available = grain.filter((c) => c.status !== 'SPENT');
  return (
    <Modal open={open} onClose={onClose} title="Combine jars into a tub">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const parentIds = f.getAll('parentIds').map(String);
          onSubmit({
            parentIds,
            label: String(f.get('label')),
            containerType: String(f.get('containerType')) as ContainerType,
            substrateType: String(f.get('substrateType') || ''),
            drySubstrateG: f.get('drySubstrateG') ? Number(f.get('drySubstrateG')) : undefined,
            substrateCostCents: f.get('cost') ? toCents(String(f.get('cost'))) : undefined,
          });
        }}
        className="space-y-4"
      >
        <Field label="Jars to combine">
          <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-mycelium p-2">
            {available.length === 0 ? (
              <p className="p-2 text-xs text-ink/40">No available jars.</p>
            ) : (
              available.map((c) => (
                <label key={c.id} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-spore">
                  <input type="checkbox" name="parentIds" value={c.id} className="accent-hyphae-600" />
                  {c.label}
                </label>
              ))
            )}
          </div>
        </Field>
        <Field label="Tub label">
          <Input name="label" required placeholder="e.g. Monotub A" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Container">
            <Select name="containerType" defaultValue="MONOTUB">
              {CONTAINER_TYPES.map((c) => (
                <option key={c} value={c}>
                  {c.toLowerCase()}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Substrate">
            <Input name="substrateType" placeholder="e.g. CVG" />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Dry substrate (g)" hint="for bio. efficiency">
            <Input name="drySubstrateG" type="number" step="1" placeholder="1600" />
          </Field>
          <Field label="Substrate cost ($)">
            <Input name="cost" type="number" step="0.01" placeholder="8.00" />
          </Field>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <FormActions onClose={onClose} pending={pending} label="Create tub" />
      </form>
    </Modal>
  );
}

function HarvestModal({ state, onClose, onSubmit, error, pending }: {
  state: ModalState;
  onClose: () => void;
  onSubmit: (cultureId: string, d: Omit<HarvestCreateInput, 'cultureId'>) => void;
  error: string | null;
  pending: boolean;
}) {
  if (state.kind !== 'harvest') return null;
  const c = state.culture;
  return (
    <Modal open onClose={onClose} title={`Log harvest: ${c.label}`}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          onSubmit(c.id, {
            flushNumber: Number(f.get('flushNumber')),
            wetWeightG: Number(f.get('wetWeightG')),
            dryWeightG: f.get('dryWeightG') ? Number(f.get('dryWeightG')) : undefined,
          });
        }}
        className="space-y-4"
      >
        <div className="grid grid-cols-3 gap-3">
          <Field label="Flush #">
            <Input name="flushNumber" type="number" min={1} defaultValue={1} />
          </Field>
          <Field label="Wet (g)">
            <Input name="wetWeightG" type="number" step="0.1" required />
          </Field>
          <Field label="Dry (g)">
            <Input name="dryWeightG" type="number" step="0.1" placeholder="later" />
          </Field>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <FormActions onClose={onClose} pending={pending} label="Log harvest" />
      </form>
    </Modal>
  );
}

function EventModal({ state, onClose, onSubmit, error, pending }: {
  state: ModalState;
  onClose: () => void;
  onSubmit: (cultureId: string, d: Omit<EventCreateInput, 'cultureId'>) => void;
  error: string | null;
  pending: boolean;
}) {
  if (state.kind !== 'event') return null;
  const c = state.culture;
  return (
    <Modal open onClose={onClose} title={`Log event: ${c.label}`}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const pct = f.get('pct');
          onSubmit(c.id, {
            type: String(f.get('type')) as EventType,
            note: String(f.get('note') || ''),
            data: pct ? { colonizationPct: Number(pct) } : undefined,
          });
        }}
        className="space-y-4"
      >
        <Field label="Event">
          <Select name="type" defaultValue="COLONIZATION_CHECK">
            {EVENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {EVENT_LABELS[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Colonization %" hint="For a colonization check">
          <Input name="pct" type="number" min={0} max={100} placeholder="e.g. 100" />
        </Field>
        <Field label="Note">
          <Textarea name="note" rows={2} />
        </Field>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <FormActions onClose={onClose} pending={pending} label="Log event" />
      </form>
    </Modal>
  );
}

function CostModal({ open, onClose, onSubmit, error, pending }: {
  open: boolean;
  onClose: () => void;
  onSubmit: (d: Omit<CostEntryCreateInput, 'batchId'>) => void;
  error: string | null;
  pending: boolean;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Add a cost">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          onSubmit({
            description: String(f.get('description')),
            category: String(f.get('category')) as CostCategory,
            amountCents: toCents(String(f.get('amount'))),
          });
        }}
        className="space-y-4"
      >
        <Field label="Description">
          <Input name="description" required placeholder="e.g. Grain, coir, gypsum" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category">
            <Select name="category" defaultValue="MATERIALS">
              {COST_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c.toLowerCase()}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Amount ($)">
            <Input name="amount" type="number" step="0.01" min={0} required />
          </Field>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <FormActions onClose={onClose} pending={pending} label="Add cost" />
      </form>
    </Modal>
  );
}
