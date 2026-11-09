import {
  CULTURE_TYPE_LABELS,
  LIBRARY_FORMAT_LABELS,
  SOURCE_FORMS,
  SOURCE_FORM_LABELS,
} from '@hyphaehub/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CultureStatusBadge } from '../components/status';
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
import { formatDate, formatMass } from '../lib/format';
import type { GenCulture, Strain } from '../lib/types';

const pct = (r: number) => `${(r * 100).toFixed(r >= 0.1 ? 0 : 1)}%`;

export function StrainDetail() {
  const { id = '' } = useParams();
  const [edit, setEdit] = useState(false);
  const q = useQuery({
    queryKey: ['strain-overview', id],
    queryFn: () => api.strains.overview(id),
  });

  if (q.isLoading) return <Spinner />;
  if (q.isError || !q.data)
    return (
      <EmptyState title="Strain not found" action={<Link to="/strains">Back to genetics</Link>} />
    );

  const { strain, performance: p, cultures, batches, library } = q.data;

  // Group cultures into generation tiers for a lineage view.
  const tiers = new Map<number, GenCulture[]>();
  for (const cu of cultures) {
    const list = tiers.get(cu.generation) ?? [];
    list.push(cu);
    tiers.set(cu.generation, list);
  }
  const genKeys = [...tiers.keys()].sort((a, b) => a - b);

  return (
    <div>
      <div className="mb-2">
        <Link to="/strains" className="text-sm text-hyphae-700 hover:underline">
          ← Genetics
        </Link>
      </div>
      <PageHeader
        title={strain.commonName}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {strain.species && <span className="italic">{strain.species}</span>}
            <Badge color="brown">{strain.category.toLowerCase()}</Badge>
            {strain.isPreset ? <Badge>preset</Badge> : <Badge color="green">custom</Badge>}
          </span>
        }
        action={
          !strain.isPreset ? (
            <Button variant="secondary" onClick={() => setEdit(true)}>
              Edit genetics
            </Button>
          ) : undefined
        }
      />

      {/* Provenance */}
      {(strain.sourceForm ||
        strain.vendor ||
        strain.vendorStrainName ||
        strain.acquiredAt ||
        strain.sequencingNote) && (
        <Card className="mb-6">
          <h2 className="mb-2 text-sm font-semibold text-substrate">Provenance</h2>
          <div className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            {strain.sourceForm && (
              <Row
                label="Source"
                value={SOURCE_FORM_LABELS[strain.sourceForm] ?? strain.sourceForm}
              />
            )}
            {strain.vendor && <Row label="Vendor" value={strain.vendor} />}
            {strain.vendorStrainName && (
              <Row label="Vendor's name" value={strain.vendorStrainName} />
            )}
            {strain.acquiredAt && <Row label="Acquired" value={formatDate(strain.acquiredAt)} />}
          </div>
          {strain.sequencingNote && (
            <p className="mt-2 text-xs text-ink/60">
              <span className="font-medium">Sequencing/ID:</span> {strain.sequencingNote}
            </p>
          )}
        </Card>
      )}

      {/* Performance */}
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
        <Stat label="Batches" value={p.batches} />
        <Stat label="Cultures" value={p.cultures} />
        <Stat label="Dry yield" value={formatMass(p.totalDryG)} />
        <Stat
          label="Bio. efficiency"
          value={p.biologicalEfficiency != null ? `${p.biologicalEfficiency}%` : '—'}
        />
        <Stat label="Contam rate" value={pct(p.contamRate)} sub={`${p.contaminated} lost`} />
        <Stat label="Max generation" value={p.maxGeneration} sub="transfers deep" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Lineage by generation */}
        <div>
          <h2 className="mb-3 text-lg font-semibold text-substrate">Lineage</h2>
          {cultures.length === 0 ? (
            <EmptyState
              title="No cultures yet"
              hint="Cultures of this strain appear here as a family tree by generation."
            />
          ) : (
            <div className="space-y-3">
              {genKeys.map((g) => (
                <div key={g}>
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-ink/40">
                    Generation {g}
                    {g === 0 ? ' · source' : ''}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(tiers.get(g) ?? []).map((cu) => (
                      <CultureChip key={cu.id} cu={cu} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Library + batches */}
        <div className="space-y-6">
          <div>
            <h2 className="mb-3 text-lg font-semibold text-substrate">Library stock</h2>
            {library.length === 0 ? (
              <EmptyState
                title="No stored stock"
                hint="Store an agar plate, LC, or print to keep this genetics line alive."
              />
            ) : (
              <Card className="divide-y divide-mycelium p-0">
                {library.map((cu) => (
                  <div
                    key={cu.id}
                    className="flex items-center justify-between px-4 py-2.5 text-sm"
                  >
                    <span className="text-substrate">{cu.label}</span>
                    <span className="text-xs text-ink/50">
                      {cu.libraryFormat
                        ? (LIBRARY_FORMAT_LABELS[cu.libraryFormat] ?? cu.libraryFormat)
                        : 'stored'}
                      {cu.storedAt ? ` · ${formatDate(cu.storedAt)}` : ''}
                    </span>
                  </div>
                ))}
              </Card>
            )}
            <Link
              to="/library"
              className="mt-2 inline-block text-sm text-hyphae-700 hover:underline"
            >
              Manage library →
            </Link>
          </div>

          <div>
            <h2 className="mb-3 text-lg font-semibold text-substrate">Batches</h2>
            {batches.length === 0 ? (
              <p className="text-sm text-ink/50">No batches have used this strain yet.</p>
            ) : (
              <Card className="divide-y divide-mycelium p-0">
                {batches.map((b) => (
                  <Link
                    key={b.id}
                    to={`/batches/${b.id}`}
                    className="flex items-center justify-between px-4 py-2.5 text-sm hover:bg-spore"
                  >
                    <span className="text-substrate">{b.name}</span>
                    <span className="text-xs text-ink/50">
                      {b.status.toLowerCase()}
                      {b.startedAt ? ` · ${formatDate(b.startedAt)}` : ''}
                    </span>
                  </Link>
                ))}
              </Card>
            )}
          </div>
        </div>
      </div>

      {edit && <EditGeneticsModal strain={strain} onClose={() => setEdit(false)} />}
    </div>
  );
}

function CultureChip({ cu }: { cu: GenCulture }) {
  const chip = (
    <div className="rounded-lg border border-mycelium bg-white px-3 py-1.5">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-substrate">{cu.label}</span>
        <CultureStatusBadge status={cu.status} />
      </div>
      <div className="text-[11px] text-ink/50">{CULTURE_TYPE_LABELS[cu.type] ?? cu.type}</div>
    </div>
  );
  return cu.batchId ? (
    <Link to={`/batches/${cu.batchId}`} className="hover:opacity-80">
      {chip}
    </Link>
  ) : (
    chip
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-ink/50">{label}</span>
      <span className="text-right font-medium text-substrate">{value}</span>
    </div>
  );
}

function toDateInput(v: string | number | Date | null | undefined): string {
  if (v == null) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  const off = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - off).toISOString().slice(0, 10);
}

function EditGeneticsModal({ strain, onClose }: { strain: Strain; onClose: () => void }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (b: Record<string, unknown>) => api.strains.update(strain.id, b as never),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['strain-overview', strain.id] });
      qc.invalidateQueries({ queryKey: ['strains'] });
      onClose();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not save.'),
  });
  return (
    <Modal open onClose={onClose} title={`Edit genetics: ${strain.commonName}`}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          save.mutate({
            vendor: String(f.get('vendor') || '') || null,
            vendorStrainName: String(f.get('vendorStrainName') || '') || null,
            sourceForm: String(f.get('sourceForm') || '') || null,
            acquiredAt: String(f.get('acquiredAt') || '') || null,
            sequencingNote: String(f.get('sequencingNote') || '') || null,
          });
        }}
        className="space-y-4"
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="Source form">
            <Select name="sourceForm" defaultValue={strain.sourceForm ?? ''}>
              <option value="">— unknown —</option>
              {SOURCE_FORMS.map((sf) => (
                <option key={sf} value={sf}>
                  {SOURCE_FORM_LABELS[sf]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Acquired">
            <Input name="acquiredAt" type="date" defaultValue={toDateInput(strain.acquiredAt)} />
          </Field>
          <Field label="Vendor">
            <Input
              name="vendor"
              defaultValue={strain.vendor ?? ''}
              placeholder="e.g. Spore vendor"
            />
          </Field>
          <Field label="Vendor's catalog name">
            <Input
              name="vendorStrainName"
              defaultValue={strain.vendorStrainName ?? ''}
              placeholder="e.g. GT"
            />
          </Field>
        </div>
        <Field label="Sequencing / ID note (optional)">
          <Textarea
            name="sequencingNote"
            rows={2}
            defaultValue={strain.sequencingNote ?? ''}
            placeholder="ITS result, species-ID evidence…"
          />
        </Field>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
