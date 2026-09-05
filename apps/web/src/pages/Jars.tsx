import { STATUS_LABELS } from '@hyphaehub/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Button, Card, Field, Input, PageHeader, SectionTitle, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { money } from '../lib/format';

export function Jars() {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const jars = useQuery({ queryKey: ['jars'], queryFn: api.jars.list });
  const inventory = useQuery({ queryKey: ['inventory'], queryFn: api.inventory.list });
  const batches = useQuery({ queryKey: ['batches'], queryFn: () => api.batches.list() });

  const [count, setCount] = useState('6');
  const [grainType, setGrainType] = useState('Rye berries');
  const [qty, setQty] = useState('');
  const [invId, setInvId] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [assignBatch, setAssignBatch] = useState('');

  const create = useMutation({
    mutationFn: () =>
      api.jars.create({
        count: Number(count) || 1,
        grainType: grainType || undefined,
        quantity: qty ? Number(qty) : undefined,
        inventoryItemId: invId || undefined,
      }),
    onSuccess: () => {
      setQty('');
      qc.invalidateQueries({ queryKey: ['jars'] });
      qc.invalidateQueries({ queryKey: ['inventory'] });
    },
  });
  const assign = useMutation({
    mutationFn: () => api.jars.assign(assignBatch, selected),
    onSuccess: () => {
      setSelected([]);
      setAssignBatch('');
      qc.invalidateQueries({ queryKey: ['jars'] });
    },
  });
  const remove = useMutation({
    mutationFn: (jarId: string) => api.cultures.remove(jarId),
    onSuccess: () => {
      setSelected([]);
      qc.invalidateQueries({ queryKey: ['jars'] });
    },
  });

  if (me.isLoading) return <Spinner />;
  if (me.data && !me.data.features.jars) return <Navigate to="/" replace />;

  const grainItems = (inventory.data ?? []).filter((i) => i.category === 'GRAIN' || !invId);

  return (
    <div>
      <PageHeader
        title="Jars"
        subtitle="Prep sterilized grain jars before you assign them to a batch. Creating jars draws grain from inventory."
      />

      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        <Card>
          <SectionTitle>Prep new jars</SectionTitle>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <Field label="How many jars">
              <Input type="number" min={1} value={count} onChange={(e) => setCount(e.target.value)} />
            </Field>
            <Field label="Grain type">
              <Input value={grainType} onChange={(e) => setGrainType(e.target.value)} />
            </Field>
            <Field label="Grain per jar" hint="in the inventory item's unit (optional)">
              <Input type="number" min={0} value={qty} onChange={(e) => setQty(e.target.value)} />
            </Field>
            <Field label="Draw from inventory" hint="optional; deducts stock and logs cost">
              <select
                value={invId}
                onChange={(e) => setInvId(e.target.value)}
                className="w-full rounded-lg border border-mycelium bg-white px-3 py-2 text-sm"
              >
                <option value="">— none —</option>
                {grainItems.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name} ({i.quantityOnHand} {i.unit} left)
                  </option>
                ))}
              </select>
            </Field>
            <Button type="submit" className="w-full" disabled={create.isPending}>
              {create.isPending ? 'Prepping…' : 'Prep jars'}
            </Button>
            {create.error && (
              <p className="text-xs text-flush">
                {create.error instanceof Error ? create.error.message : 'Could not create jars'}
              </p>
            )}
          </form>
        </Card>

        <div>
          <SectionTitle>
            Unassigned jars ({jars.data?.length ?? 0})
            {(() => {
              const pending = (jars.data ?? []).reduce((s, j) => s + (j.costCents ?? 0), 0);
              return pending > 0 ? (
                <span className="ml-2 text-xs font-normal text-ink/50">
                  · {money(pending)} grain cost, posts to a batch on assign
                </span>
              ) : null;
            })()}
          </SectionTitle>
          {jars.isLoading ? (
            <Spinner />
          ) : (jars.data ?? []).length === 0 ? (
            <Card>
              <p className="text-sm text-ink/60">No jars in the pool. Prep some to get started.</p>
            </Card>
          ) : (
            <>
              <Card className="mb-4 space-y-1 p-0">
                {(jars.data ?? []).map((j) => {
                  const on = selected.includes(j.id);
                  return (
                    <label
                      key={j.id}
                      className="flex items-center gap-3 border-b border-mycelium/60 px-4 py-2.5 text-sm last:border-0"
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() =>
                          setSelected(on ? selected.filter((x) => x !== j.id) : [...selected, j.id])
                        }
                        className="h-4 w-4 accent-hyphae-600"
                      />
                      <span className="flex-1 font-medium text-substrate">{j.label}</span>
                      <span className="text-ink/60">{j.substrateType ?? 'grain'}</span>
                      <span className="text-xs text-ink/50">{STATUS_LABELS[j.status]}</span>
                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm(`Delete “${j.label}”? This cannot be undone.`))
                            remove.mutate(j.id);
                        }}
                        className="text-xs font-medium text-ink/40 hover:text-flush"
                      >
                        delete
                      </button>
                    </label>
                  );
                })}
              </Card>
              {selected.length > 0 && (
                <Card className="flex flex-wrap items-center gap-3">
                  <span className="text-sm text-ink/70">Assign {selected.length} to:</span>
                  <select
                    value={assignBatch}
                    onChange={(e) => setAssignBatch(e.target.value)}
                    className="rounded-lg border border-mycelium bg-white px-3 py-2 text-sm"
                  >
                    <option value="">— choose batch —</option>
                    {(batches.data ?? []).map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                  <Button
                    variant="secondary"
                    disabled={!assignBatch || assign.isPending}
                    onClick={() => assign.mutate()}
                  >
                    {assign.isPending ? 'Assigning…' : 'Assign'}
                  </Button>
                </Card>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
