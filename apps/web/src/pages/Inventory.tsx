import { INVENTORY_CATEGORIES, toCents } from '@hyphaehub/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { money } from '../lib/format';

export function Inventory() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const items = useQuery({ queryKey: ['inventory'], queryFn: () => api.inventory.list() });

  const create = useMutation({
    mutationFn: (d: Record<string, unknown>) => api.inventory.create(d as never),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory'] });
      setOpen(false);
      setError(null);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Failed'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.inventory.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inventory'] }),
  });

  return (
    <div>
      <PageHeader
        title="Inventory"
        subtitle="Consumables and supplies, with unit costs to feed your batch cost tracking."
        action={<Button onClick={() => setOpen(true)}>+ Add item</Button>}
      />

      {items.isLoading ? (
        <Spinner />
      ) : (items.data?.length ?? 0) === 0 ? (
        <EmptyState title="No inventory yet" hint="Track grain, substrate, jars, and supplies." action={<Button onClick={() => setOpen(true)}>Add item</Button>} />
      ) : (
        <Card className="divide-y divide-mycelium p-0">
          {items.data?.map((it) => (
            <div key={it.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <div className="font-medium text-substrate">{it.name}</div>
                <div className="text-xs text-ink/50">
                  <Badge color="brown">{it.category.toLowerCase()}</Badge>{' '}
                  {it.quantityOnHand} {it.unit} on hand
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-sm text-substrate">{money(it.unitCostCents)}/{it.unit}</div>
                <button type="button" onClick={() => remove.mutate(it.id)} className="text-xs text-ink/40 hover:text-flush">
                  delete
                </button>
              </div>
            </div>
          ))}
        </Card>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Add inventory item">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            create.mutate({
              name: String(f.get('name')),
              category: String(f.get('category')),
              unit: String(f.get('unit') || 'unit'),
              unitCostCents: toCents(String(f.get('cost') || '0')),
              quantityOnHand: Number(f.get('qty') || 0),
              supplier: String(f.get('supplier') || '') || null,
            });
          }}
          className="space-y-4"
        >
          <Field label="Name">
            <Input name="name" required placeholder="e.g. Rye berries" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Category">
              <Select name="category" defaultValue="GRAIN">
                {INVENTORY_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c.toLowerCase()}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Unit">
              <Input name="unit" defaultValue="lb" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Unit cost ($)">
              <Input name="cost" type="number" step="0.01" min={0} />
            </Field>
            <Field label="Qty on hand">
              <Input name="qty" type="number" step="0.1" defaultValue={0} />
            </Field>
          </div>
          <Field label="Supplier">
            <Input name="supplier" />
          </Field>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              Add
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
