import { INVENTORY_CATEGORIES, toCents } from '@hyphaehub/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
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
  cn,
} from '../components/ui';
import { ApiError, api } from '../lib/api';
import { money } from '../lib/format';
import type { InventoryItem } from '../lib/types';

type ModalState =
  | { kind: 'none' }
  | { kind: 'add' }
  | { kind: 'edit'; item: InventoryItem }
  | { kind: 'restock'; item: InventoryItem };

const isLow = (it: InventoryItem) =>
  it.lowStockThreshold != null && it.quantityOnHand <= it.lowStockThreshold;

export function Inventory() {
  const qc = useQueryClient();
  const [modal, setModal] = useState<ModalState>({ kind: 'none' });
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [cat, setCat] = useState('ALL');
  const items = useQuery({ queryKey: ['inventory'], queryFn: () => api.inventory.list() });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['inventory'] });
  const close = () => {
    setModal({ kind: 'none' });
    setError(null);
  };
  const onErr = (e: unknown) =>
    setError(e instanceof ApiError ? e.message : 'Something went wrong');

  const create = useMutation({
    mutationFn: (d: Record<string, unknown>) => api.inventory.create(d as never),
    onSuccess: () => {
      invalidate();
      close();
    },
    onError: onErr,
  });
  const update = useMutation({
    mutationFn: (v: { id: string; d: Record<string, unknown> }) =>
      api.inventory.update(v.id, v.d as never),
    onSuccess: () => {
      invalidate();
      close();
    },
    onError: onErr,
  });
  const adjust = useMutation({
    mutationFn: (v: { id: string; delta: number }) => api.inventory.adjust(v.id, v.delta),
    onSuccess: () => {
      invalidate();
      close();
    },
    onError: onErr,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.inventory.remove(id),
    onSuccess: invalidate,
  });

  const all = items.data ?? [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all.filter(
      (it) =>
        (cat === 'ALL' || it.category === cat) &&
        (!q || it.name.toLowerCase().includes(q) || (it.supplier ?? '').toLowerCase().includes(q)),
    );
  }, [all, search, cat]);

  const totalValue = all.reduce((s, it) => s + it.quantityOnHand * it.unitCostCents, 0);
  const lowCount = all.filter(isLow).length;

  return (
    <div>
      <PageHeader
        title="Inventory"
        subtitle="Consumables and supplies, with unit costs that feed your batch cost tracking."
        action={<Button onClick={() => setModal({ kind: 'add' })}>+ Add item</Button>}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Items" value={all.length} />
        <Stat label="Inventory value" value={money(totalValue)} sub="qty × unit cost" />
        <Stat label="Low stock" value={lowCount} sub={lowCount ? 'need reorder' : 'all stocked'} />
        <Stat label="Categories" value={new Set(all.map((i) => i.category)).size} />
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search name or supplier…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select value={cat} onChange={(e) => setCat(e.target.value)} className="max-w-[180px]">
          <option value="ALL">All categories</option>
          {INVENTORY_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c.toLowerCase()}
            </option>
          ))}
        </Select>
      </div>

      <div className="mt-4">
        {items.isLoading ? (
          <Spinner />
        ) : all.length === 0 ? (
          <EmptyState
            title="No inventory yet"
            hint="Track grain, substrate, jars, and supplies."
            action={<Button onClick={() => setModal({ kind: 'add' })}>Add item</Button>}
          />
        ) : filtered.length === 0 ? (
          <EmptyState title="No matches" hint="Try a different search or category." />
        ) : (
          <Card className="divide-y divide-mycelium p-0">
            {filtered.map((it) => (
              <div key={it.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-[180px] flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-substrate">{it.name}</span>
                    {isLow(it) && <Badge color="red">low</Badge>}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-ink/50">
                    <Badge color="brown">{it.category.toLowerCase()}</Badge>
                    <span className={cn(isLow(it) && 'font-medium text-flush')}>
                      {it.quantityOnHand} {it.unit} on hand
                    </span>
                    {it.supplier && <span>· {it.supplier}</span>}
                  </div>
                </div>
                <div className="text-right text-sm">
                  <div className="text-substrate">
                    {money(it.unitCostCents)}/{it.unit}
                  </div>
                  <div className="text-xs text-ink/50">
                    {money(it.quantityOnHand * it.unitCostCents)} value
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setModal({ kind: 'restock', item: it })}
                    className="text-xs font-medium text-hyphae-700 hover:underline"
                  >
                    Restock
                  </button>
                  <button
                    type="button"
                    onClick={() => setModal({ kind: 'edit', item: it })}
                    className="text-xs font-medium text-ink/60 hover:text-hyphae-700 hover:underline"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(`Delete “${it.name}”? This cannot be undone.`))
                        remove.mutate(it.id);
                    }}
                    className="text-xs font-medium text-ink/40 hover:text-flush hover:underline"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </Card>
        )}
      </div>

      {/* Add / Edit */}
      <ItemFormModal
        state={modal}
        error={error}
        pending={create.isPending || update.isPending}
        onClose={close}
        onSubmit={(data) => {
          if (modal.kind === 'edit') update.mutate({ id: modal.item.id, d: data });
          else create.mutate(data);
        }}
      />

      {/* Restock */}
      <RestockModal
        state={modal}
        error={error}
        pending={adjust.isPending}
        onClose={close}
        onSubmit={(delta) =>
          modal.kind === 'restock' && adjust.mutate({ id: modal.item.id, delta })
        }
      />
    </div>
  );
}

// ── Add / Edit form ────────────────────────────────────────────────────────────
function ItemFormModal({
  state,
  error,
  pending,
  onClose,
  onSubmit,
}: {
  state: ModalState;
  error: string | null;
  pending: boolean;
  onClose: () => void;
  onSubmit: (data: Record<string, unknown>) => void;
}) {
  if (state.kind !== 'add' && state.kind !== 'edit') return null;
  const item = state.kind === 'edit' ? state.item : null;

  return (
    <Modal open onClose={onClose} title={item ? `Edit ${item.name}` : 'Add inventory item'}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const threshold = String(f.get('threshold') || '').trim();
          onSubmit({
            name: String(f.get('name')),
            category: String(f.get('category')),
            unit: String(f.get('unit') || 'unit'),
            unitCostCents: toCents(String(f.get('cost') || '0')),
            quantityOnHand: Number(f.get('qty') || 0),
            lowStockThreshold: threshold === '' ? null : Number(threshold),
            supplier: String(f.get('supplier') || '') || null,
            notes: String(f.get('notes') || '') || null,
          });
        }}
        className="space-y-4"
      >
        <Field label="Name">
          <Input name="name" required defaultValue={item?.name} placeholder="e.g. Rye berries" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category">
            <Select name="category" defaultValue={item?.category ?? 'GRAIN'}>
              {INVENTORY_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c.toLowerCase()}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Unit" hint="e.g. kg, lb, oz, g, bag">
            <Input name="unit" defaultValue={item?.unit ?? 'lb'} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Unit cost ($)">
            <Input
              name="cost"
              type="number"
              step="0.01"
              min={0}
              defaultValue={item ? (item.unitCostCents / 100).toString() : ''}
            />
          </Field>
          <Field label="Qty on hand">
            <Input name="qty" type="number" step="0.01" defaultValue={item?.quantityOnHand ?? 0} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Reorder at" hint="low-stock alert (optional)">
            <Input
              name="threshold"
              type="number"
              step="0.01"
              min={0}
              defaultValue={item?.lowStockThreshold ?? ''}
            />
          </Field>
          <Field label="Supplier">
            <Input name="supplier" defaultValue={item?.supplier ?? ''} />
          </Field>
        </div>
        <Field label="Notes">
          <Input name="notes" defaultValue={item?.notes ?? ''} />
        </Field>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? 'Saving…' : item ? 'Save changes' : 'Add'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ── Restock / adjust ─────────────────────────────────────────────────────────
function RestockModal({
  state,
  error,
  pending,
  onClose,
  onSubmit,
}: {
  state: ModalState;
  error: string | null;
  pending: boolean;
  onClose: () => void;
  onSubmit: (delta: number) => void;
}) {
  if (state.kind !== 'restock') return null;
  const it = state.item;
  return (
    <Modal open onClose={onClose} title={`Restock ${it.name}`}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const amount = Number(f.get('amount') || 0);
          if (amount !== 0) onSubmit(amount);
        }}
        className="space-y-4"
      >
        <p className="text-sm text-ink/60">
          On hand:{' '}
          <span className="font-medium text-substrate">
            {it.quantityOnHand} {it.unit}
          </span>
        </p>
        <Field label={`Add ${it.unit}`} hint="use a negative number to record usage">
          <Input name="amount" type="number" step="0.01" autoFocus placeholder="e.g. 25" />
        </Field>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? 'Updating…' : 'Update stock'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
