import { biologicalEfficiency } from '@hyphaehub/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CultureStatusBadge } from '../components/status';
import {
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  PageHeader,
  Spinner,
  Stat,
} from '../components/ui';
import { ApiError, api } from '../lib/api';
import { formatDate, formatMass } from '../lib/format';
import type { Culture, Harvest } from '../lib/types';

const TERMINAL = new Set(['SPENT', 'CONTAMINATED', 'STORED']);

function daysSince(d: string | number | Date | null | undefined): number | null {
  if (d == null) return null;
  const t = new Date(d).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

export function Tubs() {
  const [showAll, setShowAll] = useState(false);
  const [harvestFor, setHarvestFor] = useState<Culture | null>(null);

  const tubs = useQuery({
    queryKey: ['cultures', 'BULK'],
    queryFn: () => api.cultures.list({ type: 'BULK' }),
  });
  const batches = useQuery({ queryKey: ['batches'], queryFn: () => api.batches.list() });
  const strains = useQuery({ queryKey: ['strains'], queryFn: () => api.strains.list() });
  const harvests = useQuery({ queryKey: ['harvests'], queryFn: () => api.harvests.list() });

  const batchName = (id: string | null) => batches.data?.find((b) => b.id === id)?.name;
  const strainName = (id: string | null) => strains.data?.find((s) => s.id === id)?.commonName;
  const harvestsByTub = (() => {
    const m = new Map<string, Harvest[]>();
    for (const h of harvests.data ?? []) {
      const list = m.get(h.cultureId) ?? [];
      list.push(h);
      m.set(h.cultureId, list);
    }
    return m;
  })();

  if (tubs.isLoading) return <Spinner />;

  const all = tubs.data ?? [];
  const active = all.filter((t) => !TERMINAL.has(t.status));
  const shown = showAll ? all : active;
  const fruiting = active.filter(
    (t) => t.status === 'FRUITING' || t.status === 'HARVESTING',
  ).length;
  const totalDry = (harvests.data ?? [])
    .filter((h) => all.some((t) => t.id === h.cultureId))
    .reduce((s, h) => s + (h.dryWeightG ?? 0), 0);

  return (
    <div>
      <PageHeader
        title="Tubs"
        subtitle="Every fruiting tub across your grows — colonization, flushes, and yield at a glance."
        action={
          <Button variant="secondary" onClick={() => setShowAll((v) => !v)}>
            {showAll ? 'Show active only' : `Show all (${all.length})`}
          </Button>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Active tubs" value={active.length} />
        <Stat label="Fruiting now" value={fruiting} />
        <Stat label="Dry harvested" value={formatMass(totalDry)} sub="from tubs" />
        <Stat label="Total tubs" value={all.length} />
      </div>

      {shown.length === 0 ? (
        <EmptyState
          title={showAll ? 'No tubs yet' : 'No active tubs'}
          hint="Combine grain jars into a bulk tub from a batch to start fruiting."
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {shown.map((t) => {
            const hs = harvestsByTub.get(t.id) ?? [];
            const dry = hs.reduce((s, h) => s + (h.dryWeightG ?? 0), 0);
            const wet = hs.reduce((s, h) => s + (h.wetWeightG ?? 0), 0);
            const be =
              t.drySubstrateG && wet > 0 ? biologicalEfficiency(wet, t.drySubstrateG) : null;
            const stageDays = daysSince(t.fruitingStartedAt ?? t.colonizedAt ?? t.createdAt);
            return (
              <Card key={t.id}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-substrate">{t.label}</div>
                    <div className="truncate text-xs text-ink/50">
                      {strainName(t.strainId) ?? 'No strain'}
                      {t.substrateType ? ` · ${t.substrateType}` : ''}
                      {batchName(t.batchId) ? (
                        <>
                          {' · '}
                          <Link
                            to={`/batches/${t.batchId}`}
                            className="text-hyphae-700 hover:underline"
                          >
                            {batchName(t.batchId)}
                          </Link>
                        </>
                      ) : null}
                    </div>
                  </div>
                  <CultureStatusBadge status={t.status} />
                </div>

                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-spore/60 py-2">
                    <div className="text-sm font-semibold text-substrate">
                      {t.colonizationPct != null ? `${t.colonizationPct}%` : '—'}
                    </div>
                    <div className="text-[11px] text-ink/50">colonized</div>
                  </div>
                  <div className="rounded-lg bg-spore/60 py-2">
                    <div className="text-sm font-semibold text-substrate">
                      {hs.length} · {formatMass(dry)}
                    </div>
                    <div className="text-[11px] text-ink/50">flushes · dry</div>
                  </div>
                  <div className="rounded-lg bg-spore/60 py-2">
                    <div className="text-sm font-semibold text-substrate">
                      {be != null ? `${be}%` : stageDays != null ? `${stageDays}d` : '—'}
                    </div>
                    <div className="text-[11px] text-ink/50">
                      {be != null ? 'bio. eff.' : 'in stage'}
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex items-center gap-3">
                  {!TERMINAL.has(t.status) && (
                    <Button onClick={() => setHarvestFor(t)}>Log harvest</Button>
                  )}
                  {t.batchId && (
                    <Link
                      to={`/batches/${t.batchId}`}
                      className="text-sm font-medium text-ink/50 hover:text-hyphae-700"
                    >
                      Open batch →
                    </Link>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {harvestFor && (
        <HarvestModal
          tub={harvestFor}
          nextFlush={
            (harvestsByTub.get(harvestFor.id) ?? []).reduce(
              (max, h) => Math.max(max, h.flushNumber ?? 0),
              0,
            ) + 1
          }
          onClose={() => setHarvestFor(null)}
        />
      )}
    </div>
  );
}

function HarvestModal({
  tub,
  nextFlush,
  onClose,
}: {
  tub: Culture;
  nextFlush: number;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: (v: { flushNumber: number; wetWeightG: number; dryWeightG?: number }) =>
      api.harvests.create({ ...v, cultureId: tub.id, batchId: tub.batchId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['harvests'] });
      qc.invalidateQueries({ queryKey: ['cultures', 'BULK'] });
      qc.invalidateQueries({ queryKey: ['batch', tub.batchId] });
      onClose();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not log harvest.'),
  });
  return (
    <Modal open onClose={onClose} title={`Log harvest: ${tub.label}`}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          create.mutate({
            flushNumber: Number(f.get('flush')),
            wetWeightG: Number(f.get('wet')),
            dryWeightG: f.get('dry') ? Number(f.get('dry')) : undefined,
          });
        }}
        className="space-y-4"
      >
        <div className="grid grid-cols-3 gap-3">
          <Field label="Flush #">
            <Input name="flush" type="number" min={1} defaultValue={nextFlush} />
          </Field>
          <Field label="Wet (g)">
            <Input name="wet" type="number" step="0.1" required />
          </Field>
          <Field label="Dry (g)">
            <Input name="dry" type="number" step="0.1" placeholder="later" />
          </Field>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? 'Saving…' : 'Log harvest'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
