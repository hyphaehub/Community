import { COST_CATEGORIES, toCents } from '@hyphaehub/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Navigate } from 'react-router-dom';
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
} from '../components/ui';
import { ApiError, api } from '../lib/api';
import { formatDate, money } from '../lib/format';
import type { CostEntry } from '../lib/types';

/** Shared add/edit form — same fields and validation for both flows. */
function CostForm({
  batches,
  error,
  pending,
  submitLabel,
  initial,
  onSubmit,
  onCancel,
}: {
  batches: { id: string; name: string }[] | undefined;
  error: string | null;
  pending: boolean;
  submitLabel: string;
  initial?: Pick<CostEntry, 'description' | 'category' | 'amountCents' | 'batchId'>;
  onSubmit: (body: Record<string, unknown>) => void;
  onCancel: () => void;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        onSubmit({
          description: String(f.get('description')),
          category: String(f.get('category')),
          amountCents: toCents(String(f.get('amount'))),
          batchId: String(f.get('batchId') || '') || null,
        });
      }}
      className="space-y-4"
    >
      <Field label="Description">
        <Input name="description" required defaultValue={initial?.description} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Category">
          <Select name="category" defaultValue={initial?.category ?? 'MATERIALS'}>
            {COST_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c.toLowerCase()}
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
            defaultValue={initial ? (initial.amountCents / 100).toFixed(2) : undefined}
          />
        </Field>
      </div>
      <Field label="Batch (optional)">
        <Select name="batchId" defaultValue={initial?.batchId ?? ''}>
          <option value="">— none —</option>
          {batches?.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
      </Field>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

export function Costs() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<CostEntry | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const costs = useQuery({ queryKey: ['costs'], queryFn: () => api.costs.list() });
  const batches = useQuery({ queryKey: ['batches'], queryFn: () => api.batches.list() });

  const create = useMutation({
    mutationFn: (d: Record<string, unknown>) => api.costs.create(d as never),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['costs'] });
      setOpen(false);
      setError(null);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Failed'),
  });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api.costs.update(id, body as never),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['costs'] });
      setEditing(null);
      setEditError(null);
    },
    onError: (e) => setEditError(e instanceof ApiError ? e.message : 'Failed'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.costs.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['costs'] }),
  });

  const batchName = (id: string | null) => batches.data?.find((b) => b.id === id)?.name;

  if (me.data && me.data.features?.costs === false) return <Navigate to="/" replace />;

  return (
    <div>
      <PageHeader
        title="Costs"
        subtitle="Every expense across your grow. Batch costs roll up into cost-per-gram."
        action={<Button onClick={() => setOpen(true)}>+ Add cost</Button>}
      />

      {costs.isLoading ? (
        <Spinner />
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Total spend" value={money(costs.data?.totalCents)} />
            {Object.entries(costs.data?.byCategory ?? {})
              .slice(0, 3)
              .map(([cat, amt]) => (
                <Stat key={cat} label={cat.toLowerCase()} value={money(amt)} />
              ))}
          </div>

          {(costs.data?.entries.length ?? 0) === 0 ? (
            <EmptyState
              title="No costs logged"
              hint="Add materials, utilities, or equipment."
              action={<Button onClick={() => setOpen(true)}>Add cost</Button>}
            />
          ) : (
            <Card className="divide-y divide-mycelium p-0">
              {costs.data?.entries.map((c) => (
                <div key={c.id} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <div className="text-sm font-medium text-substrate">{c.description}</div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-ink/50">
                      <Badge color="brown">{c.category.toLowerCase()}</Badge>
                      {batchName(c.batchId) && <span>{batchName(c.batchId)}</span>}
                      <span>{formatDate(c.occurredAt)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="font-medium text-substrate">{money(c.amountCents)}</div>
                    <button
                      type="button"
                      onClick={() => {
                        setEditError(null);
                        setEditing(c);
                      }}
                      className="text-xs text-ink/40 hover:text-substrate"
                    >
                      edit
                    </button>
                    <button
                      type="button"
                      onClick={() => remove.mutate(c.id)}
                      className="text-xs text-ink/40 hover:text-flush"
                    >
                      delete
                    </button>
                  </div>
                </div>
              ))}
            </Card>
          )}
        </>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Add a cost">
        <CostForm
          batches={batches.data}
          error={error}
          pending={create.isPending}
          submitLabel="Add"
          onSubmit={(body) => create.mutate(body)}
          onCancel={() => setOpen(false)}
        />
      </Modal>

      <Modal open={!!editing} onClose={() => setEditing(null)} title="Edit cost">
        {editing && (
          <CostForm
            key={editing.id}
            batches={batches.data}
            error={editError}
            pending={update.isPending}
            submitLabel="Save"
            initial={{
              description: editing.description,
              category: editing.category,
              amountCents: editing.amountCents,
              batchId: editing.batchId,
            }}
            onSubmit={(body) => update.mutate({ id: editing.id, body })}
            onCancel={() => setEditing(null)}
          />
        )}
      </Modal>
    </div>
  );
}
