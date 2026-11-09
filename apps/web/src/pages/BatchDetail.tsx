import {
  CONTAINER_TYPES,
  CONTAMINANT_TYPE_LABELS,
  CONTAMINATION_CAUSE_LABELS,
  COST_CATEGORIES,
  CULTURE_TYPE_LABELS,
  EVENT_LABELS,
  EVENT_TYPES,
  LIBRARY_FORMATS,
  LIBRARY_FORMAT_LABELS,
  SOURCE_TYPES,
  toCents,
} from '@hyphaehub/core';
import type {
  BatchUpdateInput,
  CombineCulturesInput,
  ContainerType,
  ContaminationInput,
  CostCategory,
  CostEntryCreateInput,
  CostEntryUpdateInput,
  CultureCreateInput,
  CultureUpdateInput,
  EventCreateInput,
  EventType,
  HarvestCreateInput,
  HarvestUpdateInput,
  LibraryStoreInput,
  SourceType,
  SplitCultureInput,
} from '@hyphaehub/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AiScanner } from '../components/AiScanner';
import { EnvironmentPanel } from '../components/EnvironmentPanel';
import { LabelPrintModal } from '../components/LabelPrint';
import { LogFeed } from '../components/LogEntries';
import { Icon } from '../components/icons';
import { BatchStatusBadge, CultureStatusBadge } from '../components/status';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Spinner,
  Stat,
  Textarea,
  cn,
} from '../components/ui';
import { ApiError, api } from '../lib/api';
import { STATUS_META, isHarvestStage, varianceLabel } from '../lib/forecast';
import { formatDate, formatMass, money, perGram } from '../lib/format';
import { batchLabelData, cultureLabelData, harvestLabelData } from '../lib/labels';
import type {
  Batch,
  BatchForecastResponse,
  CostEntry,
  Culture,
  CultureDetail,
  Harvest,
  Strain,
} from '../lib/types';

type ModalState =
  | { kind: 'none' }
  | { kind: 'source' }
  | { kind: 'combine' }
  | { kind: 'cost' }
  | { kind: 'editBatch' }
  | { kind: 'split'; culture: Culture }
  | { kind: 'event'; culture: Culture }
  | { kind: 'harvest'; culture: Culture }
  | { kind: 'contaminate'; culture: Culture }
  | { kind: 'store'; culture: Culture }
  | { kind: 'editCulture'; culture: Culture }
  | { kind: 'cultureDetail'; culture: Culture }
  | { kind: 'editHarvest'; harvest: Harvest }
  | { kind: 'editCost'; cost: CostEntry };

export function BatchDetail() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [modal, setModal] = useState<ModalState>({ kind: 'none' });
  const [labelOpen, setLabelOpen] = useState(false);
  const [harvestLabelOpen, setHarvestLabelOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const showCosts = me.data?.features?.costs !== false;
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
    qc.invalidateQueries({ queryKey: ['batches'] });
    qc.invalidateQueries({ queryKey: ['events'] });
    qc.invalidateQueries({ queryKey: ['cultures'] });
    qc.invalidateQueries({ queryKey: ['harvests'] });
    qc.invalidateQueries({ queryKey: ['costs'] });
    qc.invalidateQueries({ queryKey: ['report-contamination'] });
    qc.invalidateQueries({ queryKey: ['library'] });
    qc.invalidateQueries({ queryKey: ['strain-overview'] });
    qc.invalidateQueries({ queryKey: ['report-strains'] });
    qc.invalidateQueries({ queryKey: ['me'] });
  }

  // Close any modal and drop a stale error so it can't leak into the next one.
  const closeModal = () => {
    setModal({ kind: 'none' });
    setError(null);
  };

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
    return (
      <EmptyState title="Batch not found" action={<Link to="/batches">Back to batches</Link>} />
    );

  const { batch: b, strain, cultures, harvests, costs, summary } = batch.data;
  const sources = cultures.filter((c) => ['SOURCE', 'AGAR', 'LIQUID_CULTURE'].includes(c.type));
  const grain = cultures.filter((c) => c.type === 'GRAIN');
  const tubs = cultures.filter((c) => c.type === 'BULK');
  const batchEvents = (events.data ?? []).filter((e) => e.batchId === b.id);
  const labelItems = [
    batchLabelData(b, strain?.commonName),
    ...cultures.map((c) => cultureLabelData(c, strain?.commonName)),
  ];
  const harvestLabelItems = harvests.map((h) => harvestLabelData(h, b, strain?.commonName));

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
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setModal({ kind: 'editBatch' })}>
              Edit
            </Button>
            {b.status === 'ACTIVE' && (
              <Button
                variant="secondary"
                disabled={act.isPending}
                onClick={() => act.mutate(() => api.batches.update(b.id, { status: 'COMPLETED' }))}
              >
                Mark complete
              </Button>
            )}
            {b.status !== 'ARCHIVED' && (
              <Button
                variant="ghost"
                disabled={act.isPending}
                onClick={() => act.mutate(() => api.batches.update(b.id, { status: 'ARCHIVED' }))}
              >
                Archive
              </Button>
            )}
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
            {showCosts && (
              <Button variant="secondary" onClick={() => setModal({ kind: 'cost' })}>
                + Cost
              </Button>
            )}
            <Button onClick={() => setModal({ kind: 'source' })}>+ Source</Button>
          </div>
        }
      />

      {/* Summary */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
        {showCosts && <Stat label="Total cost" value={money(summary.cost.totalCents)} />}
        <Stat label="Wet yield" value={formatMass(summary.yield.totalWetG)} />
        <Stat label="Dry yield" value={formatMass(summary.yield.totalDryG)} />
        <Stat
          label="Bio. efficiency"
          value={
            summary.efficiency.biologicalEfficiency != null
              ? `${summary.efficiency.biologicalEfficiency}%`
              : '—'
          }
        />
        {showCosts && (
          <Stat label="Cost / dry g" value={perGram(summary.efficiency.costPerDryGramCents)} />
        )}
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
          onContaminate={(c) => setModal({ kind: 'contaminate', culture: c })}
          onStore={(c) => setModal({ kind: 'store', culture: c })}
          onDelete={deleteCulture}
          onEdit={(c) => setModal({ kind: 'editCulture', culture: c })}
          onDetails={(c) => setModal({ kind: 'cultureDetail', culture: c })}
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
          onContaminate={(c) => setModal({ kind: 'contaminate', culture: c })}
          onStore={(c) => setModal({ kind: 'store', culture: c })}
          onDelete={deleteCulture}
          onEdit={(c) => setModal({ kind: 'editCulture', culture: c })}
          onDetails={(c) => setModal({ kind: 'cultureDetail', culture: c })}
        />
        <LineageColumn
          title="Fruiting tubs"
          hint="Combined jars, fruiting & harvest"
          cultures={tubs}
          empty="Combine grain jars into a tub."
          onHarvest={(c) => setModal({ kind: 'harvest', culture: c })}
          onEvent={(c) => setModal({ kind: 'event', culture: c })}
          onContaminate={(c) => setModal({ kind: 'contaminate', culture: c })}
          onStore={(c) => setModal({ kind: 'store', culture: c })}
          onDelete={deleteCulture}
          onEdit={(c) => setModal({ kind: 'editCulture', culture: c })}
          onDetails={(c) => setModal({ kind: 'cultureDetail', culture: c })}
        />
      </div>

      {/* Harvests + Costs + Timeline */}
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <div>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-substrate">Harvests</h2>
            {harvests.length > 0 && (
              <button
                type="button"
                onClick={() => setHarvestLabelOpen(true)}
                className="text-xs font-medium text-hyphae-700 hover:underline"
              >
                Print labels
              </button>
            )}
          </div>
          {harvests.length === 0 ? (
            <EmptyState title="No harvests yet" hint="Log a flush from a fruiting tub." />
          ) : (
            <Card className="divide-y divide-mycelium p-0">
              {harvests.map((h) => (
                <div key={h.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div>
                    <div className="text-sm font-medium text-substrate">Flush {h.flushNumber}</div>
                    <div className="text-xs text-ink/50">{formatDate(h.harvestedAt)}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right text-sm">
                      <div className="text-substrate">{formatMass(h.wetWeightG)} wet</div>
                      <div className="text-ink/50">
                        {h.dryWeightG != null ? `${formatMass(h.dryWeightG)} dry` : 'drying…'}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <button
                        type="button"
                        onClick={() => setModal({ kind: 'editHarvest', harvest: h })}
                        className="text-xs font-medium text-hyphae-700 hover:underline"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (
                            window.confirm(`Delete flush ${h.flushNumber}? This cannot be undone.`)
                          ) {
                            act.mutate(() => api.harvests.remove(h.id));
                          }
                        }}
                        className="text-xs font-medium text-ink/40 hover:text-flush hover:underline"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </Card>
          )}
        </div>

        {showCosts && (
          <div>
            <h2 className="mb-3 text-lg font-semibold text-substrate">Costs</h2>
            {costs.length === 0 ? (
              <EmptyState
                title="No costs logged"
                hint="Split/combine can log costs automatically."
              />
            ) : (
              <Card className="divide-y divide-mycelium p-0">
                {costs.map((cost) => (
                  <div
                    key={cost.id}
                    className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
                  >
                    <div>
                      <div className="text-substrate">{cost.description}</div>
                      <div className="text-xs text-ink/50">{cost.category.toLowerCase()}</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="font-medium text-substrate">{money(cost.amountCents)}</div>
                      <button
                        type="button"
                        onClick={() => setModal({ kind: 'editCost', cost })}
                        className="text-xs font-medium text-hyphae-700 hover:underline"
                      >
                        Edit
                      </button>
                    </div>
                  </div>
                ))}
              </Card>
            )}
          </div>
        )}
      </div>

      <div className="mt-8">
        <h2 className="mb-3 text-lg font-semibold text-substrate">Timeline</h2>
        {batchEvents.length === 0 ? (
          <EmptyState
            title="No events yet"
            hint="Log inoculation, colonization, fruiting, and more."
          />
        ) : (
          <ol className="relative space-y-3 border-l border-mycelium pl-6">
            {batchEvents.map((e) => (
              <li key={e.id} className="relative flex items-start justify-between gap-2">
                <span className="absolute -left-[27px] top-1 h-3 w-3 rounded-full bg-hyphae-400" />
                <div>
                  <div className="text-sm font-medium text-substrate">{EVENT_LABELS[e.type]}</div>
                  <div className="text-xs text-ink/50">
                    {formatDate(e.occurredAt)}
                    {e.note ? `: ${e.note}` : ''}
                  </div>
                </div>
                <button
                  type="button"
                  aria-label="Delete event"
                  title="Delete event"
                  onClick={() => {
                    if (window.confirm('Delete this timeline event? This cannot be undone.')) {
                      act.mutate(() => api.events.remove(e.id));
                    }
                  }}
                  className="shrink-0 text-sm leading-none text-ink/30 hover:text-flush"
                >
                  ✕
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>

      {/* Environment */}
      <div className="mt-8">
        <h2 className="mb-3 text-lg font-semibold text-substrate">Environment</h2>
        <EnvironmentPanel batchId={b.id} />
      </div>

      {/* Journal */}
      <div className="mt-8">
        <h2 className="mb-3 text-lg font-semibold text-substrate">Journal</h2>
        <LogFeed batchId={b.id} />
      </div>

      {/* ── Modals ── */}
      <SourceModal
        open={modal.kind === 'source'}
        onClose={closeModal}
        error={error}
        pending={act.isPending}
        onSubmit={(data) =>
          act.mutate(() => api.cultures.create({ ...data, batchId: b.id, strainId: b.strainId }))
        }
      />

      <SplitModal
        state={modal}
        onClose={closeModal}
        error={error}
        pending={act.isPending}
        onSubmit={(cultureId, data) =>
          act.mutate(() => api.cultures.split(cultureId, { ...data, batchId: b.id }))
        }
      />

      <CombineModal
        open={modal.kind === 'combine'}
        grain={grain}
        onClose={closeModal}
        error={error}
        pending={act.isPending}
        onSubmit={(data) => act.mutate(() => api.cultures.combine({ ...data, batchId: b.id }))}
      />

      <HarvestModal
        state={modal}
        onClose={closeModal}
        error={error}
        pending={act.isPending}
        onSubmit={(cultureId, data) =>
          act.mutate(() => api.harvests.create({ ...data, cultureId, batchId: b.id }))
        }
      />

      <EventModal
        state={modal}
        onClose={closeModal}
        error={error}
        pending={act.isPending}
        onSubmit={(cultureId, data) => act.mutate(() => api.events.create({ ...data, cultureId }))}
      />

      <ContaminateModal
        state={modal}
        onClose={closeModal}
        error={error}
        pending={act.isPending}
        aiEnabled={me.data?.features?.aiDiagnosis === true}
        onSubmit={(cultureId, data) => act.mutate(() => api.cultures.contaminate(cultureId, data))}
      />

      <StoreModal
        state={modal}
        onClose={closeModal}
        error={error}
        pending={act.isPending}
        onSubmit={(cultureId, data) => act.mutate(() => api.library.store(cultureId, data))}
      />

      <CostModal
        open={modal.kind === 'cost'}
        onClose={closeModal}
        error={error}
        pending={act.isPending}
        onSubmit={(data) => act.mutate(() => api.costs.create({ ...data, batchId: b.id }))}
      />

      <EditBatchModal
        open={modal.kind === 'editBatch'}
        batch={b}
        strain={strain}
        onClose={closeModal}
        error={error}
        pending={act.isPending}
        onSubmit={(data) => act.mutate(() => api.batches.update(b.id, data))}
      />

      <EditCultureModal
        state={modal}
        onClose={closeModal}
        error={error}
        pending={act.isPending}
        onSubmit={(cultureId, data) => act.mutate(() => api.cultures.update(cultureId, data))}
      />

      <CultureDetailModal state={modal} strainName={strain?.commonName} onClose={closeModal} />

      <EditHarvestModal
        state={modal}
        onClose={closeModal}
        error={error}
        pending={act.isPending}
        onSubmit={(harvestId, data) => act.mutate(() => api.harvests.update(harvestId, data))}
      />

      <EditCostModal
        state={modal}
        onClose={closeModal}
        error={error}
        pending={act.isPending}
        onSubmit={(costId, data) => act.mutate(() => api.costs.update(costId, data))}
      />

      <LabelPrintModal
        open={labelOpen}
        onClose={() => setLabelOpen(false)}
        items={labelItems}
        title={`Print labels · ${b.name}`}
      />

      <LabelPrintModal
        open={harvestLabelOpen}
        onClose={() => setHarvestLabelOpen(false)}
        items={harvestLabelItems}
        title={`Harvest labels · ${b.name}`}
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
                <div
                  className="text-xs text-ink/50"
                  title={
                    !m.actualAt && m.predictedFrom && m.predictedTo && m.confidenceDays
                      ? `Likely ${formatDate(m.predictedFrom)} – ${formatDate(m.predictedTo)}`
                      : undefined
                  }
                >
                  {m.actualAt
                    ? `Logged ${formatDate(m.actualAt)}`
                    : m.predictedAt
                      ? `Projected ${formatDate(m.predictedAt)}${
                          m.confidenceDays && m.confidenceDays > 0 ? ` · ±${m.confidenceDays}d` : ''
                        }`
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
  onContaminate,
  onStore,
  onDelete,
  onEdit,
  onDetails,
}: {
  title: string;
  hint: string;
  cultures: Culture[];
  empty: string;
  action?: React.ReactNode;
  onSplit?: (c: Culture) => void;
  onEvent?: (c: Culture) => void;
  onHarvest?: (c: Culture) => void;
  onContaminate?: (c: Culture) => void;
  onStore?: (c: Culture) => void;
  onDelete?: (c: Culture) => void;
  onEdit?: (c: Culture) => void;
  onDetails?: (c: Culture) => void;
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
                {onDetails && (
                  <button
                    type="button"
                    onClick={() => onDetails(c)}
                    className="text-xs font-medium text-ink/50 hover:underline"
                  >
                    Details
                  </button>
                )}
                {onEdit && (
                  <button
                    type="button"
                    onClick={() => onEdit(c)}
                    className="text-xs font-medium text-hyphae-700 hover:underline"
                  >
                    Edit
                  </button>
                )}
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
                {onContaminate && c.status !== 'CONTAMINATED' && (
                  <button
                    type="button"
                    onClick={() => onContaminate(c)}
                    className="text-xs font-medium text-cap hover:underline"
                  >
                    Contaminated
                  </button>
                )}
                {onStore && c.status !== 'STORED' && c.status !== 'CONTAMINATED' && (
                  <button
                    type="button"
                    onClick={() => onStore(c)}
                    title="Store this culture to your library"
                    className="inline-flex items-center gap-1 text-xs font-medium text-hyphae-700 hover:underline"
                  >
                    <Icon name="vault" size={13} /> Store to library
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
function FormActions({
  onClose,
  pending,
  label,
}: { onClose: () => void; pending: boolean; label: string }) {
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

function SourceModal({
  open,
  onClose,
  onSubmit,
  error,
  pending,
}: {
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

function SplitModal({
  state,
  onClose,
  onSubmit,
  error,
  pending,
}: {
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

function CombineModal({
  open,
  grain,
  onClose,
  onSubmit,
  error,
  pending,
}: {
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
                <label
                  key={c.id}
                  className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-spore"
                >
                  <input
                    type="checkbox"
                    name="parentIds"
                    value={c.id}
                    className="accent-hyphae-600"
                  />
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

function HarvestModal({
  state,
  onClose,
  onSubmit,
  error,
  pending,
}: {
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

function EventModal({
  state,
  onClose,
  onSubmit,
  error,
  pending,
}: {
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

function ContaminateModal({
  state,
  onClose,
  onSubmit,
  error,
  pending,
  aiEnabled,
}: {
  state: ModalState;
  onClose: () => void;
  onSubmit: (cultureId: string, d: ContaminationInput) => void;
  error: string | null;
  pending: boolean;
  aiEnabled: boolean;
}) {
  if (state.kind !== 'contaminate') return null;
  const c = state.culture;
  return (
    <ContaminateForm
      culture={c}
      onClose={onClose}
      onSubmit={onSubmit}
      error={error}
      pending={pending}
      aiEnabled={aiEnabled}
    />
  );
}

function ContaminateForm({
  culture: c,
  onClose,
  onSubmit,
  error,
  pending,
  aiEnabled,
}: {
  culture: Culture;
  onClose: () => void;
  onSubmit: (cultureId: string, d: ContaminationInput) => void;
  error: string | null;
  pending: boolean;
  aiEnabled: boolean;
}) {
  const [contaminantType, setContaminantType] = useState<string>('TRICHODERMA');
  const [contaminationCause, setContaminationCause] = useState<string>('');
  const [note, setNote] = useState<string>('');
  return (
    <Modal open onClose={onClose} title={`Mark contaminated: ${c.label}`}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(c.id, {
            contaminantType: contaminantType as ContaminationInput['contaminantType'],
            contaminationCause:
              (contaminationCause as ContaminationInput['contaminationCause']) || null,
            note: note.trim() || null,
          });
        }}
        className="space-y-4"
      >
        {aiEnabled && (
          <div className="rounded-xl border border-hyphae-200 bg-hyphae-50/60 p-3">
            <div className="mb-1 text-sm font-medium text-substrate">Not sure what it is?</div>
            <AiScanner compact onApply={(v) => setContaminantType(v)} />
          </div>
        )}
        <p className="text-sm text-ink/60">
          Logging the contaminant and suspected cause powers your{' '}
          <span className="font-medium text-substrate">contamination insights</span> — so you can
          fix the root cause instead of guessing.
        </p>
        <Field label="Contaminant">
          <Select value={contaminantType} onChange={(e) => setContaminantType(e.target.value)}>
            {Object.entries(CONTAMINANT_TYPE_LABELS).map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Suspected cause (optional)">
          <Select
            value={contaminationCause}
            onChange={(e) => setContaminationCause(e.target.value)}
          >
            <option value="">— unknown —</option>
            {Object.entries(CONTAMINATION_CAUSE_LABELS).map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Note (optional)">
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="What did you notice? Any hunch on how it got in?"
          />
        </Field>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <FormActions onClose={onClose} pending={pending} label="Mark contaminated" />
      </form>
    </Modal>
  );
}

function StoreModal({
  state,
  onClose,
  onSubmit,
  error,
  pending,
}: {
  state: ModalState;
  onClose: () => void;
  onSubmit: (cultureId: string, d: LibraryStoreInput) => void;
  error: string | null;
  pending: boolean;
}) {
  if (state.kind !== 'store') return null;
  const c = state.culture;
  const defaultFormat =
    c.type === 'LIQUID_CULTURE'
      ? 'LIQUID_CULTURE'
      : c.type === 'AGAR'
        ? 'AGAR_PLATE'
        : c.type === 'GRAIN'
          ? 'GRAIN'
          : 'AGAR_PLATE';
  return (
    <Modal open onClose={onClose} title={`Store to library: ${c.label}`}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          onSubmit(c.id, {
            format: String(f.get('format')) as LibraryStoreInput['format'],
            storageMethod: String(f.get('method') || '') || null,
            storageLocation: String(f.get('location') || '') || null,
          });
        }}
        className="space-y-4"
      >
        <p className="text-sm text-ink/60">
          Keep this genetics line alive as stored stock — it moves to your{' '}
          <span className="font-medium text-substrate">Library</span> with a revive-by date.
        </p>
        <Field label="Format">
          <Select name="format" defaultValue={defaultFormat}>
            {Object.entries(LIBRARY_FORMAT_LABELS).map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Storage method (optional)">
            <Input name="method" placeholder="e.g. 4°C fridge" />
          </Field>
          <Field label="Location (optional)">
            <Input name="location" placeholder="e.g. Door, box A" />
          </Field>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <FormActions onClose={onClose} pending={pending} label="Store to library" />
      </form>
    </Modal>
  );
}

function CostModal({
  open,
  onClose,
  onSubmit,
  error,
  pending,
}: {
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

// ── Date helpers (edit forms) ─────────────────────────────────────────────────
/** A stored timestamp → `yyyy-mm-dd` for a date <Input>, in the viewer's tz. */
function toDateInput(v: string | number | Date | null | undefined): string {
  if (v == null) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  const off = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - off).toISOString().slice(0, 10);
}

/** A `yyyy-mm-dd` input value → ISO instant at LOCAL noon (stable across tz). */
function dateInputToIso(ymd: string): string | null {
  if (!ymd) return null;
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return null;
  const dt = new Date(y, m - 1, d, 12, 0, 0, 0);
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
}

// ── Edit batch (name / strain / dates) ───────────────────────────────────────
function EditBatchModal({
  open,
  batch,
  strain,
  onClose,
  onSubmit,
  error,
  pending,
}: {
  open: boolean;
  batch: Batch;
  strain: Strain | null;
  onClose: () => void;
  onSubmit: (d: BatchUpdateInput) => void;
  error: string | null;
  pending: boolean;
}) {
  if (!open) return null;
  return (
    <EditBatchForm
      batch={batch}
      strain={strain}
      onClose={onClose}
      onSubmit={onSubmit}
      error={error}
      pending={pending}
    />
  );
}

function EditBatchForm({
  batch,
  strain,
  onClose,
  onSubmit,
  error,
  pending,
}: {
  batch: Batch;
  strain: Strain | null;
  onClose: () => void;
  onSubmit: (d: BatchUpdateInput) => void;
  error: string | null;
  pending: boolean;
}) {
  const strains = useQuery({ queryKey: ['strains'], queryFn: api.strains.list });
  // Keep the current strain selectable even if the list hasn't loaded / omits it.
  const options = strains.data ?? (strain ? [strain] : []);
  return (
    <Modal open onClose={onClose} title={`Edit batch: ${batch.name}`}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          onSubmit({
            name: String(f.get('name')),
            strainId: String(f.get('strainId') || '') || null,
            startedAt: dateInputToIso(String(f.get('startedAt') || '')),
            completedAt: dateInputToIso(String(f.get('completedAt') || '')),
          });
        }}
        className="space-y-4"
      >
        <Field label="Name">
          <Input name="name" required defaultValue={batch.name} />
        </Field>
        <Field label="Strain">
          <Select name="strainId" defaultValue={batch.strainId ?? ''}>
            <option value="">— none —</option>
            {options.map((s) => (
              <option key={s.id} value={s.id}>
                {s.commonName}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Started">
            <Input name="startedAt" type="date" defaultValue={toDateInput(batch.startedAt)} />
          </Field>
          <Field label="Completed">
            <Input name="completedAt" type="date" defaultValue={toDateInput(batch.completedAt)} />
          </Field>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <FormActions onClose={onClose} pending={pending} label="Save batch" />
      </form>
    </Modal>
  );
}

// ── Edit culture (label / substrate / container / quantity / notes) ──────────
function EditCultureModal({
  state,
  onClose,
  onSubmit,
  error,
  pending,
}: {
  state: ModalState;
  onClose: () => void;
  onSubmit: (cultureId: string, d: CultureUpdateInput) => void;
  error: string | null;
  pending: boolean;
}) {
  if (state.kind !== 'editCulture') return null;
  const c = state.culture;
  return (
    <Modal open onClose={onClose} title={`Edit culture: ${c.label}`}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          onSubmit(c.id, {
            label: String(f.get('label')),
            substrateType: String(f.get('substrateType') || '') || null,
            containerType: (String(f.get('containerType') || '') || null) as ContainerType | null,
            quantity: f.get('quantity') ? Number(f.get('quantity')) : null,
            notes: String(f.get('notes') || '') || null,
          });
        }}
        className="space-y-4"
      >
        <Field label="Label">
          <Input name="label" required defaultValue={c.label} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Substrate">
            <Input
              name="substrateType"
              defaultValue={c.substrateType ?? ''}
              placeholder="e.g. Rye berries"
            />
          </Field>
          <Field label="Container">
            <Select name="containerType" defaultValue={c.containerType ?? ''}>
              <option value="">— none —</option>
              {CONTAINER_TYPES.map((ct) => (
                <option key={ct} value={ct}>
                  {ct.toLowerCase()}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Quantity">
          <Input name="quantity" type="number" step="0.1" min={0} defaultValue={c.quantity ?? ''} />
        </Field>
        <Field label="Notes">
          <Textarea name="notes" rows={2} defaultValue={c.notes ?? ''} />
        </Field>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <FormActions onClose={onClose} pending={pending} label="Save culture" />
      </form>
    </Modal>
  );
}

// ── Culture details (events + harvests + lineage in one view) ────────────────
function CultureDetailModal({
  state,
  strainName,
  onClose,
}: {
  state: ModalState;
  strainName?: string;
  onClose: () => void;
}) {
  if (state.kind !== 'cultureDetail') return null;
  return <CultureDetailView culture={state.culture} strainName={strainName} onClose={onClose} />;
}

function CultureDetailView({
  culture,
  strainName,
  onClose,
}: {
  culture: Culture;
  strainName?: string;
  onClose: () => void;
}) {
  const detail = useQuery<CultureDetail>({
    queryKey: ['culture', culture.id],
    queryFn: () => api.cultures.get(culture.id),
  });
  const d = detail.data;
  return (
    <Modal open onClose={onClose} title={culture.label}>
      <div className="space-y-5">
        <div className="text-sm text-ink/60">
          {CULTURE_TYPE_LABELS[culture.type]}
          {strainName ? ` · ${strainName}` : ''}
          {culture.substrateType ? ` · ${culture.substrateType}` : ''}
        </div>

        {detail.isLoading && <Spinner />}
        {detail.isError && <p className="text-sm text-red-600">Could not load culture details.</p>}

        {d && (
          <>
            <section>
              <h3 className="mb-2 text-sm font-semibold text-substrate">Lineage</h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-xs font-medium uppercase tracking-wide text-ink/40">
                    Parents
                  </div>
                  {d.parents.length === 0 ? (
                    <p className="text-xs text-ink/40">—</p>
                  ) : (
                    d.parents.map((p) => (
                      <div key={p.id} className="text-substrate">
                        {p.label}
                        <span className="text-ink/40"> · {CULTURE_TYPE_LABELS[p.type]}</span>
                      </div>
                    ))
                  )}
                </div>
                <div>
                  <div className="text-xs font-medium uppercase tracking-wide text-ink/40">
                    Children
                  </div>
                  {d.children.length === 0 ? (
                    <p className="text-xs text-ink/40">—</p>
                  ) : (
                    d.children.map((ch) => (
                      <div key={ch.id} className="text-substrate">
                        {ch.label}
                        <span className="text-ink/40"> · {CULTURE_TYPE_LABELS[ch.type]}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </section>

            <section>
              <h3 className="mb-2 text-sm font-semibold text-substrate">Harvests</h3>
              {d.harvests.length === 0 ? (
                <p className="text-xs text-ink/40">No harvests from this culture.</p>
              ) : (
                <div className="space-y-1 text-sm">
                  {d.harvests.map((h) => (
                    <div key={h.id} className="flex justify-between gap-3">
                      <span className="text-substrate">
                        Flush {h.flushNumber} · {formatDate(h.harvestedAt)}
                      </span>
                      <span className="text-ink/60">
                        {formatMass(h.wetWeightG)} wet
                        {h.dryWeightG != null ? ` · ${formatMass(h.dryWeightG)} dry` : ''}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section>
              <h3 className="mb-2 text-sm font-semibold text-substrate">Event timeline</h3>
              {d.events.length === 0 ? (
                <p className="text-xs text-ink/40">No events logged.</p>
              ) : (
                <ol className="relative space-y-2 border-l border-mycelium pl-5">
                  {d.events.map((ev) => (
                    <li key={ev.id} className="relative">
                      <span className="absolute -left-[23px] top-1 h-2.5 w-2.5 rounded-full bg-hyphae-400" />
                      <div className="text-sm font-medium text-substrate">
                        {EVENT_LABELS[ev.type]}
                      </div>
                      <div className="text-xs text-ink/50">
                        {formatDate(ev.occurredAt)}
                        {ev.note ? `: ${ev.note}` : ''}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </>
        )}

        <div className="flex justify-end">
          <Button type="button" variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Edit harvest (dry weight recorded after drying) ──────────────────────────
function EditHarvestModal({
  state,
  onClose,
  onSubmit,
  error,
  pending,
}: {
  state: ModalState;
  onClose: () => void;
  onSubmit: (harvestId: string, d: HarvestUpdateInput) => void;
  error: string | null;
  pending: boolean;
}) {
  if (state.kind !== 'editHarvest') return null;
  const h = state.harvest;
  return (
    <Modal open onClose={onClose} title={`Edit flush ${h.flushNumber}`}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          onSubmit(h.id, {
            dryWeightG: f.get('dryWeightG') ? Number(f.get('dryWeightG')) : null,
            driedAt: dateInputToIso(String(f.get('driedAt') || '')),
          });
        }}
        className="space-y-4"
      >
        <p className="text-sm text-ink/60">
          Record the dry weight once this flush finishes drying.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Dry weight (g)">
            <Input
              name="dryWeightG"
              type="number"
              step="0.1"
              min={0}
              defaultValue={h.dryWeightG ?? ''}
            />
          </Field>
          <Field label="Dried on">
            <Input name="driedAt" type="date" defaultValue={toDateInput(h.driedAt)} />
          </Field>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <FormActions onClose={onClose} pending={pending} label="Save harvest" />
      </form>
    </Modal>
  );
}

// ── Edit cost (reuses the add-cost fields + date) ────────────────────────────
function EditCostModal({
  state,
  onClose,
  onSubmit,
  error,
  pending,
}: {
  state: ModalState;
  onClose: () => void;
  onSubmit: (costId: string, d: CostEntryUpdateInput) => void;
  error: string | null;
  pending: boolean;
}) {
  if (state.kind !== 'editCost') return null;
  const cost = state.cost;
  return (
    <Modal open onClose={onClose} title="Edit cost">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          onSubmit(cost.id, {
            description: String(f.get('description')),
            category: String(f.get('category')) as CostCategory,
            amountCents: toCents(String(f.get('amount'))),
            occurredAt: dateInputToIso(String(f.get('occurredAt') || '')),
          });
        }}
        className="space-y-4"
      >
        <Field label="Description">
          <Input name="description" required defaultValue={cost.description} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category">
            <Select name="category" defaultValue={cost.category}>
              {COST_CATEGORIES.map((ct) => (
                <option key={ct} value={ct}>
                  {ct.toLowerCase()}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Amount ($)">
            <Input
              name="amount"
              type="number"
              step="0.01"
              min={0}
              required
              defaultValue={cost.amountCents / 100}
            />
          </Field>
        </div>
        <Field label="Date">
          <Input name="occurredAt" type="date" defaultValue={toDateInput(cost.occurredAt)} />
        </Field>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <FormActions onClose={onClose} pending={pending} label="Save cost" />
      </form>
    </Modal>
  );
}
