import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BatchStatusBadge } from '../components/status';
import { Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, Textarea } from '../components/ui';
import { api } from '../lib/api';
import { ApiError } from '../lib/api';
import { formatDate } from '../lib/format';

export function Batches() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const batches = useQuery({ queryKey: ['batches'], queryFn: () => api.batches.list() });
  const strains = useQuery({ queryKey: ['strains'], queryFn: () => api.strains.list() });

  const [name, setName] = useState('');
  const [strainId, setStrainId] = useState('');
  const [goal, setGoal] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      api.batches.create({
        name,
        strainId: strainId || null,
        goalDryWeightG: goal ? Number(goal) : null,
        notes: notes || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['batches'] });
      qc.invalidateQueries({ queryKey: ['me'] });
      setOpen(false);
      setName('');
      setStrainId('');
      setGoal('');
      setNotes('');
      setError(null);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Failed to create batch'),
  });

  return (
    <div>
      <PageHeader
        title="Batches"
        subtitle="Each batch is a named run. It anchors cost and yield."
        action={<Button onClick={() => setOpen(true)}>+ New batch</Button>}
      />

      {batches.isLoading ? (
        <Spinner />
      ) : (batches.data?.length ?? 0) === 0 ? (
        <EmptyState
          title="No batches yet"
          hint="A batch groups a whole run: source → jars → tubs → harvests."
          action={<Button onClick={() => setOpen(true)}>Start your first batch</Button>}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {batches.data?.map((b) => (
            <Link key={b.id} to={`/batches/${b.id}`}>
              <Card className="h-full transition-colors hover:border-hyphae-300">
                <div className="flex items-start justify-between">
                  <div className="font-semibold text-substrate">{b.name}</div>
                  <BatchStatusBadge status={b.status} />
                </div>
                <div className="mt-2 text-xs text-ink/50">Started {formatDate(b.startedAt)}</div>
                {b.goalDryWeightG != null && (
                  <div className="mt-1 text-xs text-ink/50">Goal: {b.goalDryWeightG} g dry</div>
                )}
              </Card>
            </Link>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="New batch">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
          className="space-y-4"
        >
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. Blue Oyster, Summer #1" />
          </Field>
          <Field label="Strain">
            <Select value={strainId} onChange={(e) => setStrainId(e.target.value)}>
              <option value="">— none —</option>
              {strains.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.commonName}
                  {s.species ? ` (${s.species})` : ''}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Goal dry weight (g)" hint="Optional target for the run">
            <Input type="number" value={goal} onChange={(e) => setGoal(e.target.value)} min={0} />
          </Field>
          <Field label="Notes">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </Field>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Creating…' : 'Create batch'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
