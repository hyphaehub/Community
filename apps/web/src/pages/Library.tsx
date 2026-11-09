import { LIBRARY_FORMATS, LIBRARY_FORMAT_LABELS } from '@hyphaehub/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
} from '../components/ui';
import { ApiError, api } from '../lib/api';
import { formatDate } from '../lib/format';
import type { LibraryCulture } from '../lib/types';

const REVIVE = {
  ok: { label: 'Fresh', color: 'green' },
  due: { label: 'Refresh soon', color: 'amber' },
  overdue: { label: 'Overdue', color: 'red' },
  indefinite: { label: 'Stable', color: 'neutral' },
} as const satisfies Record<
  string,
  { label: string; color: 'green' | 'amber' | 'red' | 'neutral' }
>;

/** Sort overdue → due → ok → indefinite, then soonest revive-by first. */
const RANK: Record<string, number> = { overdue: 0, due: 1, ok: 2, indefinite: 3 };

/** What you can draw from a source, and the container + stock format each implies. */
const DRAW_TYPES = [
  { value: 'GRAIN', label: 'Grain jars', container: 'JAR', format: 'GRAIN' },
  {
    value: 'LIQUID_CULTURE',
    label: 'Liquid culture',
    container: 'VESSEL',
    format: 'LIQUID_CULTURE',
  },
  { value: 'AGAR', label: 'Agar plate', container: 'PLATE', format: 'AGAR_PLATE' },
] as const;

export function Library() {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [drawFor, setDrawFor] = useState<LibraryCulture | null>(null);
  const [editFor, setEditFor] = useState<LibraryCulture | null>(null);
  const q = useQuery({ queryKey: ['library'], queryFn: api.library.list });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['library'] });
    qc.invalidateQueries({ queryKey: ['cultures'] });
    qc.invalidateQueries({ queryKey: ['batches'] });
    qc.invalidateQueries({ queryKey: ['strain-overview'] });
  };

  const revive = useMutation({
    mutationFn: (id: string) => api.library.revive(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['library'] });
      qc.invalidateQueries({ queryKey: ['strain-overview'] });
    },
  });
  const retire = useMutation({
    mutationFn: (id: string) => api.library.remove(id),
    onSuccess: refresh,
  });

  if (q.isLoading) return <Spinner />;
  if (q.isError)
    return (
      <EmptyState
        title="Couldn't load your library"
        hint="Something went wrong reaching the server. Check your connection and try again."
        action={
          <Button onClick={() => qc.invalidateQueries({ queryKey: ['library'] })}>Retry</Button>
        }
      />
    );
  const rows = (q.data ?? [])
    .slice()
    .sort(
      (a, b) =>
        (RANK[a.reviveStatus] ?? 9) - (RANK[b.reviveStatus] ?? 9) ||
        (a.reviveBy ?? '').localeCompare(b.reviveBy ?? ''),
    );
  const overdue = rows.filter((r) => r.reviveStatus === 'overdue').length;
  const due = rows.filter((r) => r.reviveStatus === 'due').length;

  return (
    <div>
      <PageHeader
        title="Culture library"
        subtitle="Your kept genetics and purchased sources — spore syringes, agar, LC, cryo, prints — with viability so a line never lapses."
        action={<Button onClick={() => setAddOpen(true)}>+ Add to library</Button>}
      />

      {rows.length === 0 ? (
        <EmptyState
          title="Your vault is empty"
          hint="Add a purchased source (a spore syringe, LC, or print) with “Add to library”, or use “Store to library” on a healthy culture inside a batch."
          action={<Button onClick={() => setAddOpen(true)}>+ Add to library</Button>}
        />
      ) : (
        <>
          <div className="mb-6 grid grid-cols-3 gap-4">
            <Stat label="Stored cultures" value={rows.length} />
            <Stat label="Refresh soon" value={due} />
            <Stat label="Overdue" value={overdue} />
          </div>
          {(overdue > 0 || due > 0) && (
            <p className="mb-4 text-sm text-ink/60">
              {overdue > 0
                ? `${overdue} culture${overdue === 1 ? '' : 's'} overdue for a refresh. `
                : ''}
              Transfer to a fresh plate/slant before viability lapses, then mark it revived to reset
              the clock.
            </p>
          )}
          <Card className="divide-y divide-mycelium p-0">
            {rows.map((r) => (
              <LibRow
                key={r.id}
                r={r}
                onUse={() => setDrawFor(r)}
                onEdit={() => setEditFor(r)}
                onRevive={() => revive.mutate(r.id)}
                onRetire={() => retire.mutate(r.id)}
              />
            ))}
          </Card>
        </>
      )}

      {addOpen && <AddStockModal onClose={() => setAddOpen(false)} onSaved={refresh} />}
      {editFor && (
        <EditLibraryModal source={editFor} onClose={() => setEditFor(null)} onSaved={refresh} />
      )}
      {drawFor && <DrawModal source={drawFor} onClose={() => setDrawFor(null)} onDrawn={refresh} />}
    </div>
  );
}

function LibRow({
  r,
  onUse,
  onEdit,
  onRevive,
  onRetire,
}: {
  r: LibraryCulture;
  onUse: () => void;
  onEdit: () => void;
  onRevive: () => void;
  onRetire: () => void;
}) {
  const meta = REVIVE[r.reviveStatus] ?? REVIVE.indefinite;
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-substrate">{r.label}</div>
        <div className="truncate text-xs text-ink/50">
          {r.strainName ?? 'No strain'}
          {r.libraryFormat ? ` · ${LIBRARY_FORMAT_LABELS[r.libraryFormat] ?? r.libraryFormat}` : ''}
          {r.storageLocation ? ` · ${r.storageLocation}` : ''}
          {r.reviveBy ? ` · refresh by ${formatDate(r.reviveBy)}` : ''}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <Badge color={meta.color}>{meta.label}</Badge>
        <button
          type="button"
          onClick={onUse}
          className="text-xs font-medium text-hyphae-700 hover:underline"
        >
          Use
        </button>
        <button
          type="button"
          onClick={onEdit}
          className="text-xs font-medium text-hyphae-700 hover:underline"
        >
          edit
        </button>
        <button
          type="button"
          onClick={onRevive}
          className="text-xs font-medium text-hyphae-700 hover:underline"
        >
          revived
        </button>
        <button
          type="button"
          onClick={() => {
            if (window.confirm(`Retire “${r.label}” from the library? This cannot be undone.`))
              onRetire();
          }}
          className="text-xs text-ink/40 hover:text-flush"
        >
          retire
        </button>
      </div>
    </div>
  );
}

function AddStockModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const strains = useQuery({ queryKey: ['strains'], queryFn: () => api.strains.list() });
  const create = useMutation({
    mutationFn: (b: Parameters<typeof api.library.create>[0]) => api.library.create(b),
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not add.'),
  });
  return (
    <Modal open onClose={onClose} title="Add to library">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          create.mutate({
            label: String(f.get('label') || '').trim(),
            strainId: String(f.get('strainId') || '') || null,
            format: String(f.get('format')) as never,
            storageLocation: String(f.get('storageLocation') || '') || null,
            storedAt: String(f.get('storedAt') || '') || null,
            note: String(f.get('note') || '') || null,
          });
        }}
        className="space-y-4"
      >
        <p className="text-sm text-ink/60">
          Put a purchased or gifted source into your library — a spore syringe, bought liquid
          culture, agar, or print. You can draw jars and cultures from it later.
        </p>
        <Field label="Label">
          <Input name="label" required placeholder="e.g. Golden Teacher spore syringe" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Strain (optional)">
            <Select name="strainId" defaultValue="">
              <option value="">— no strain —</option>
              {(strains.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.commonName}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Format">
            <Select name="format" defaultValue="SPORE_SYRINGE">
              {LIBRARY_FORMATS.map((fmt) => (
                <option key={fmt} value={fmt}>
                  {LIBRARY_FORMAT_LABELS[fmt] ?? fmt}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Storage location (optional)">
            <Input name="storageLocation" placeholder="e.g. Fridge, shelf 2" />
          </Field>
          <Field label="Acquired (optional)">
            <Input name="storedAt" type="date" />
          </Field>
        </div>
        <Field label="Note (optional)">
          <Textarea name="note" rows={2} placeholder="Vendor, lot, anything worth remembering…" />
        </Field>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? 'Adding…' : 'Add to library'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** A stored timestamp → `YYYY-MM-DD` for a native date input (local calendar day), or '' when unset. */
function toDateInput(value: string | number | Date | null | undefined): string {
  if (value == null) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

function EditLibraryModal({
  source,
  onClose,
  onSaved,
}: { source: LibraryCulture; onClose: () => void; onSaved: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const update = useMutation({
    mutationFn: (b: Parameters<typeof api.library.update>[1]) => api.library.update(source.id, b),
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not save changes.'),
  });
  return (
    <Modal open onClose={onClose} title={`Edit ${source.label}`}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          update.mutate({
            format: String(f.get('format')) as never,
            storageMethod: String(f.get('storageMethod') || '') || null,
            storageLocation: String(f.get('storageLocation') || '') || null,
            storedAt: String(f.get('storedAt') || '') || null,
            lastRevivedAt: String(f.get('lastRevivedAt') || '') || null,
            note: String(f.get('note') || '') || null,
          });
        }}
        className="space-y-4"
      >
        <p className="text-sm text-ink/60">
          Correct how this culture is stored — its format, storage method and location, and the
          dates it was stored and last revived.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Format">
            <Select name="format" defaultValue={source.libraryFormat ?? 'AGAR_PLATE'}>
              {LIBRARY_FORMATS.map((fmt) => (
                <option key={fmt} value={fmt}>
                  {LIBRARY_FORMAT_LABELS[fmt] ?? fmt}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Storage method (optional)">
            <Input
              name="storageMethod"
              defaultValue={source.storageMethod ?? ''}
              placeholder="e.g. Agar slant, cryo, distilled water"
            />
          </Field>
          <Field label="Storage location (optional)">
            <Input
              name="storageLocation"
              defaultValue={source.storageLocation ?? ''}
              placeholder="e.g. Fridge, shelf 2"
            />
          </Field>
          <Field label="Stored (optional)">
            <Input name="storedAt" type="date" defaultValue={toDateInput(source.storedAt)} />
          </Field>
          <Field label="Last revived (optional)">
            <Input
              name="lastRevivedAt"
              type="date"
              defaultValue={toDateInput(source.lastRevivedAt)}
            />
          </Field>
        </div>
        <Field label="Note (optional)">
          <Textarea
            name="note"
            rows={2}
            defaultValue={source.notes ?? ''}
            placeholder="Vendor, lot, anything worth remembering…"
          />
        </Field>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={update.isPending}>
            {update.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

type Dest = 'new-batch' | 'existing' | 'library';

function DrawModal({
  source,
  onClose,
  onDrawn,
}: { source: LibraryCulture; onClose: () => void; onDrawn: () => void }) {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState<(typeof DRAW_TYPES)[number]['value']>('GRAIN');
  const [dest, setDest] = useState<Dest>('new-batch');
  const batches = useQuery({ queryKey: ['batches'], queryFn: () => api.batches.list() });
  const spec = DRAW_TYPES.find((t) => t.value === type) ?? DRAW_TYPES[0];

  const draw = useMutation({
    mutationFn: (b: Parameters<typeof api.library.draw>[1]) => api.library.draw(source.id, b),
    onSuccess: (res, variables) => {
      onDrawn();
      onClose();
      // Drew into a grow? Jump to that batch (new batch id from the response, else the chosen one).
      const batchId = res.batch?.id ?? variables.batchId ?? null;
      if (variables.destination === 'batch' && batchId) navigate(`/batches/${batchId}`);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not create.'),
  });

  return (
    <Modal open onClose={onClose} title={`Use ${source.label}`}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const count = Math.max(1, Number(f.get('count')) || 1);
          const base = {
            count,
            type,
            containerType: spec.container as never,
          };
          if (dest === 'library') {
            draw.mutate({
              ...base,
              destination: 'library',
              libraryFormat: spec.format as never,
              storageLocation: String(f.get('storageLocation') || '') || null,
            });
          } else if (dest === 'new-batch') {
            draw.mutate({
              ...base,
              destination: 'batch',
              newBatchName: (
                String(f.get('newBatchName') || '').trim() || `${source.label} grow`
              ).slice(0, 120),
            });
          } else {
            draw.mutate({
              ...base,
              destination: 'batch',
              batchId: String(f.get('batchId') || '') || null,
            });
          }
        }}
        className="space-y-4"
      >
        <p className="text-sm text-ink/60">
          Create new cultures from this source. It stays in your library, so you can draw from it
          again (jars now, a liquid culture later).
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Make">
            <Select
              name="type"
              value={type}
              onChange={(e) => setType(e.target.value as typeof type)}
            >
              {DRAW_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="How many">
            <Input name="count" type="number" min={1} max={100} defaultValue={4} />
          </Field>
        </div>

        <Field label="Where">
          <Select name="dest" value={dest} onChange={(e) => setDest(e.target.value as Dest)}>
            <option value="new-batch">Into a new grow batch</option>
            <option value="existing">Into an existing batch</option>
            <option value="library">Keep in the library as stock</option>
          </Select>
        </Field>

        {dest === 'new-batch' && (
          <Field label="New batch name">
            <Input name="newBatchName" placeholder={`${source.label} grow`} />
          </Field>
        )}
        {dest === 'existing' && (
          <Field label="Batch">
            <Select name="batchId" defaultValue="" required>
              <option value="">— choose a batch —</option>
              {(batches.data ?? []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {dest === 'library' && (
          <Field label="Storage location (optional)">
            <Input name="storageLocation" placeholder="e.g. Fridge, shelf 2" />
          </Field>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={draw.isPending}>
            {draw.isPending ? 'Creating…' : 'Create'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
