import { STRAIN_CATEGORIES } from '@hyphaehub/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge, Button, Card, Field, Input, Modal, PageHeader, Select, Spinner } from '../components/ui';
import { api, ApiError } from '../lib/api';

export function Strains() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newCat, setNewCat] = useState('');
  const [catError, setCatError] = useState<string | null>(null);

  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const strains = useQuery({ queryKey: ['strains'], queryFn: () => api.strains.list() });
  const cats = useQuery({ queryKey: ['strain-categories'], queryFn: () => api.strains.categories() });

  const canManage =
    me.data?.role === 'OWNER' || me.data?.role === 'ADMIN' || me.data?.isSuperAdmin === true;
  const categoryOptions = cats.data?.all ?? [...STRAIN_CATEGORIES];

  const create = useMutation({
    mutationFn: (d: { commonName: string; species: string; category: string }) =>
      api.strains.create({ commonName: d.commonName, species: d.species || null, category: d.category }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['strains'] });
      setOpen(false);
      setError(null);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Failed'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.strains.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['strains'] }),
  });
  const addCat = useMutation({
    mutationFn: (name: string) => api.strains.addCategory(name),
    onSuccess: () => {
      setNewCat('');
      setCatError(null);
      qc.invalidateQueries({ queryKey: ['strain-categories'] });
    },
    onError: (e) => setCatError(e instanceof ApiError ? e.message : 'Failed'),
  });
  const removeCat = useMutation({
    mutationFn: (id: string) => api.strains.removeCategory(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['strain-categories'] }),
  });

  return (
    <div>
      <PageHeader
        title="Strains"
        subtitle="Your genetics catalog, plus a built-in library of common cultivars."
        action={<Button onClick={() => setOpen(true)}>+ Add strain</Button>}
      />

      <Card className="mb-6">
        <div className="mb-2 text-sm font-medium text-substrate">Categories</div>
        <div className="flex flex-wrap gap-2">
          {(cats.data?.builtin ?? STRAIN_CATEGORIES).map((b) => (
            <Badge key={b} color="brown">
              {b.toLowerCase()}
            </Badge>
          ))}
          {(cats.data?.custom ?? []).map((cc) => (
            <span
              key={cc.id}
              className="inline-flex items-center gap-1 rounded-full bg-hyphae-100 px-2.5 py-0.5 text-xs font-medium text-hyphae-800"
            >
              {cc.name}
              {canManage && (
                <button
                  type="button"
                  onClick={() => removeCat.mutate(cc.id)}
                  className="text-hyphae-800/60 hover:text-flush"
                  aria-label={`Remove ${cc.name}`}
                >
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (newCat.trim()) addCat.mutate(newCat.trim());
          }}
        >
          <Input
            value={newCat}
            onChange={(e) => setNewCat(e.target.value)}
            placeholder="Add a category (e.g. Medicinal)"
          />
          <Button type="submit" variant="secondary" disabled={addCat.isPending}>
            Add
          </Button>
        </form>
        {catError && <p className="mt-1 text-xs text-flush">{catError}</p>}
      </Card>

      {strains.isLoading ? (
        <Spinner />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {strains.data?.map((s) => (
            <Card key={s.id}>
              <div className="flex items-start justify-between">
                <div className="font-semibold text-substrate">{s.commonName}</div>
                {s.isPreset ? <Badge>preset</Badge> : <Badge color="green">custom</Badge>}
              </div>
              {s.species && <div className="mt-1 text-xs italic text-ink/50">{s.species}</div>}
              <div className="mt-2 flex items-center justify-between">
                <Badge color="brown">{s.category.toLowerCase()}</Badge>
                {!s.isPreset && (
                  <button
                    type="button"
                    onClick={() => remove.mutate(s.id)}
                    className="text-xs text-ink/40 hover:text-flush"
                  >
                    delete
                  </button>
                )}
              </div>
            </Card>
          ))}
          {strains.data?.length === 0 && (
            <Card>
              <p className="text-sm text-ink/60">
                No strains yet{me.data?.features?.hideDefaultStrains ? ' (presets hidden)' : ''}. Add one to get
                started.
              </p>
            </Card>
          )}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Add a strain">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            create.mutate({
              commonName: String(f.get('commonName')),
              species: String(f.get('species') || ''),
              category: String(f.get('category')),
            });
          }}
          className="space-y-4"
        >
          <Field label="Common name">
            <Input name="commonName" required placeholder="e.g. Blue Oyster" />
          </Field>
          <Field label="Species (Latin)">
            <Input name="species" placeholder="e.g. Pleurotus ostreatus" />
          </Field>
          <Field label="Category">
            <Select name="category" defaultValue={categoryOptions[0] ?? 'GOURMET'}>
              {categoryOptions.map((c) => (
                <option key={c} value={c}>
                  {c.toLowerCase()}
                </option>
              ))}
            </Select>
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
