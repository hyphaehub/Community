import { SOURCE_FORMS, SOURCE_FORM_LABELS, STRAIN_CATEGORIES } from '@hyphaehub/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { LabelPrintModal } from '../components/LabelPrint';
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Spinner,
} from '../components/ui';
import { ApiError, api } from '../lib/api';
import { formatMass } from '../lib/format';
import { strainLabelData } from '../lib/labels';

export function Strains() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [labelOpen, setLabelOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newCat, setNewCat] = useState('');
  const [catError, setCatError] = useState<string | null>(null);

  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const strains = useQuery({ queryKey: ['strains'], queryFn: () => api.strains.list() });
  const cats = useQuery({
    queryKey: ['strain-categories'],
    queryFn: () => api.strains.categories(),
  });
  const leaders = useQuery({ queryKey: ['report-strains'], queryFn: api.reports.strains });

  const canManage =
    me.data?.role === 'OWNER' || me.data?.role === 'ADMIN' || me.data?.isSuperAdmin === true;
  const categoryOptions = cats.data?.all ?? [...STRAIN_CATEGORIES];

  const create = useMutation({
    mutationFn: (d: Record<string, unknown>) => api.strains.create(d as never),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['strains'] });
      setOpen(false);
      setError(null);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Failed'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.strains.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['strains'] });
      qc.invalidateQueries({ queryKey: ['report-strains'] });
    },
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
        title="Genetics"
        subtitle="Your strains and the living lines you keep — click any strain for its lineage, performance, and stored stock."
        action={
          <div className="flex gap-2">
            {(strains.data?.length ?? 0) > 0 && (
              <Button variant="secondary" onClick={() => setLabelOpen(true)}>
                Print labels
              </Button>
            )}
            <Button onClick={() => setOpen(true)}>+ Add strain</Button>
          </div>
        }
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

      {(leaders.data?.strains.length ?? 0) > 0 && (
        <Card className="mb-6">
          <div className="mb-3 text-sm font-medium text-substrate">
            Top performers <span className="text-xs font-normal text-ink/50">· by dry yield</span>
          </div>
          <div className="space-y-1">
            {leaders.data?.strains.slice(0, 6).map((s, i) => (
              <Link
                key={s.strainId}
                to={`/strains/${s.strainId}`}
                className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-spore"
              >
                <span className="min-w-0 truncate text-substrate">
                  <span className="text-ink/40">{i + 1}.</span> {s.name}
                </span>
                <span className="flex shrink-0 items-center gap-3 text-xs text-ink/60">
                  <span className="font-medium text-substrate">{formatMass(s.totalDryG)}</span>
                  {s.biologicalEfficiency != null && <span>{s.biologicalEfficiency}% BE</span>}
                  <span className={s.contamRate >= 0.25 ? 'text-flush' : ''}>
                    {(s.contamRate * 100).toFixed(0)}% contam
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </Card>
      )}

      {strains.isLoading ? (
        <Spinner />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {strains.data?.map((s) => (
            <Link key={s.id} to={`/strains/${s.id}`} className="block">
              <Card className="h-full transition-colors hover:border-hyphae-300">
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
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (
                          window.confirm(
                            `Delete the strain “${s.commonName}”? Cultures keep their history but lose this genetics link.`,
                          )
                        )
                          remove.mutate(s.id);
                      }}
                      className="text-xs text-ink/40 hover:text-flush"
                    >
                      delete
                    </button>
                  )}
                </div>
              </Card>
            </Link>
          ))}
          {strains.data?.length === 0 && (
            <Card>
              <p className="text-sm text-ink/60">
                No strains yet{me.data?.features?.hideDefaultStrains ? ' (presets hidden)' : ''}.
                Add one to get started.
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
              species: String(f.get('species') || '') || null,
              category: String(f.get('category')),
              vendor: String(f.get('vendor') || '') || null,
              sourceForm: String(f.get('sourceForm') || '') || null,
              acquiredAt: String(f.get('acquiredAt') || '') || null,
            });
          }}
          className="space-y-4"
        >
          <Field label="Common name">
            <Input name="commonName" required placeholder="e.g. Blue Oyster" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Species (Latin)">
              <Input name="species" placeholder="Pleurotus ostreatus" />
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
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Source form" hint="how you got it">
              <Select name="sourceForm" defaultValue="">
                <option value="">— unknown —</option>
                {SOURCE_FORMS.map((sf) => (
                  <option key={sf} value={sf}>
                    {SOURCE_FORM_LABELS[sf]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Vendor (optional)">
              <Input name="vendor" placeholder="e.g. Spore vendor" />
            </Field>
          </div>
          <Field label="Acquired (optional)">
            <Input name="acquiredAt" type="date" />
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

      <LabelPrintModal
        open={labelOpen}
        onClose={() => setLabelOpen(false)}
        items={(strains.data ?? []).map(strainLabelData)}
        title="Print strain labels"
      />
    </div>
  );
}
