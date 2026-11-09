import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../lib/api';
import { useInstanceConfig } from '../lib/auth';
import { formatDate } from '../lib/format';
import type { LogEntry, Photo } from '../lib/types';
import { Button, Card, EmptyState, Field, Input, Spinner, Textarea } from './ui';

/** Today's date as yyyy-mm-dd for the date input default (local time). */
function todayInput(): string {
  const d = new Date();
  const off = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - off).toISOString().slice(0, 10);
}

/**
 * Turn a yyyy-mm-dd calendar date into an ISO instant at LOCAL noon, so the
 * stored day matches the day shown by formatDate() in the viewer's timezone
 * (parsing a bare date as `new Date(str)` would pin it to UTC midnight and shift
 * a day earlier for western-hemisphere users).
 */
function localNoonISO(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  if (y === undefined || m === undefined || d === undefined) return new Date().toISOString();
  const dt = new Date(y, m - 1, d, 12, 0, 0, 0);
  return Number.isNaN(dt.getTime()) ? new Date().toISOString() : dt.toISOString();
}

/** Turn a stored ISO instant into a yyyy-mm-dd value for a <input type="date"> (local time). */
function isoToDateInput(iso: string | Date): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return todayInput();
  const off = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - off).toISOString().slice(0, 10);
}

/**
 * An authenticated photo thumbnail. The Blob is cached by react-query (safe to
 * keep), but the object URL is minted per-mount and revoked on unmount — caching
 * the URL itself would hand a revoked URL to <img> on the next mount.
 */
function PhotoThumb({ photo, logEntryId }: { photo: Photo; logEntryId: string }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['photo-blob', photo.id],
    queryFn: () => api.photos.blob(photo.id),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!q.data) {
      setUrl(null);
      return;
    }
    const u = URL.createObjectURL(q.data);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [q.data]);

  const remove = useMutation({
    mutationFn: () => api.photos.remove(photo.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['log-photos', logEntryId] }),
  });

  function onDelete() {
    if (window.confirm('Delete this photo? This cannot be undone.')) remove.mutate();
  }

  if (!url) {
    return <div className="h-40 w-full animate-pulse rounded-lg bg-mycelium/40" />;
  }
  return (
    <div className="group relative">
      <a href={url} target="_blank" rel="noopener noreferrer">
        <img
          src={url}
          alt={photo.caption ?? 'Log photo'}
          className="max-h-64 w-auto rounded-lg border border-mycelium object-cover"
        />
      </a>
      <button
        type="button"
        onClick={onDelete}
        disabled={remove.isPending}
        aria-label="Delete photo"
        title="Delete photo"
        className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/55 text-sm leading-none text-white opacity-0 transition-opacity hover:bg-flush focus:opacity-100 group-hover:opacity-100 disabled:opacity-50"
      >
        ×
      </button>
    </div>
  );
}

function LogPhotos({ logEntryId }: { logEntryId: string }) {
  const q = useQuery({
    queryKey: ['log-photos', logEntryId],
    queryFn: () => api.photos.list({ logEntryId }),
  });
  if (!q.data?.length) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {q.data.map((p) => (
        <PhotoThumb key={p.id} photo={p} logEntryId={logEntryId} />
      ))}
    </div>
  );
}

function batchName(batches: { id: string; name: string }[] | undefined, id: string | null) {
  return id ? batches?.find((b) => b.id === id)?.name : undefined;
}

/**
 * The grow journal for a scope: workspace-wide (no `batchId`) or one batch.
 * Renders an add form (text + optional date + optional batch + optional photo)
 * and the entry timeline. On instances without object storage, the photo field
 * is hidden and text entries still save.
 */
export function LogFeed({ batchId }: { batchId?: string }) {
  const qc = useQueryClient();
  const config = useInstanceConfig();
  const photosEnabled = config.data?.photosEnabled ?? false;

  const listKey = ['logs', batchId ?? 'all'] as const;
  const logs = useQuery({ queryKey: listKey, queryFn: () => api.logs.list(batchId) });
  // Only the workspace-wide journal needs the batch picker.
  const batches = useQuery({
    queryKey: ['batches'],
    queryFn: () => api.batches.list(),
    enabled: !batchId,
  });

  const [body, setBody] = useState('');
  const [occurredAt, setOccurredAt] = useState(todayInput());
  const [pickBatch, setPickBatch] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function resetForm() {
    setBody('');
    setOccurredAt(todayInput());
    setPickBatch('');
    setFile(null);
    if (fileRef.current) fileRef.current.value = '';
  }

  const create = useMutation({
    mutationFn: async () => {
      const entry = await api.logs.create({
        body: body.trim(),
        batchId: batchId ?? (pickBatch || null),
        occurredAt: localNoonISO(occurredAt),
      });
      // Attach the photo after the entry exists. A photo failure is non-fatal —
      // the text entry is already saved — so surface it without discarding it.
      let photoError: string | null = null;
      if (file && photosEnabled) {
        try {
          const photo = await api.photos.upload(file, { logEntryId: entry.id });
          qc.invalidateQueries({ queryKey: ['log-photos', entry.id] });
          void photo;
        } catch (e) {
          photoError = e instanceof ApiError ? e.message : 'The photo could not be uploaded.';
        }
      }
      return { photoError };
    },
    onSuccess: ({ photoError }) => {
      // Invalidate every scope (global + each batch) so a batch-scoped add also
      // refreshes the global journal and vice-versa.
      qc.invalidateQueries({ queryKey: ['logs'] });
      resetForm();
      setError(photoError ? `Entry saved, but the photo failed: ${photoError}` : null);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not save the entry.'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.logs.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['logs'] }),
  });

  return (
    <div>
      <Card className="mb-5">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (body.trim()) create.mutate();
          }}
          className="space-y-3"
        >
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="What happened? Observations, tweaks, conditions…"
            rows={3}
            required
          />
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Date">
              <Input
                type="date"
                value={occurredAt}
                onChange={(e) => setOccurredAt(e.target.value)}
              />
            </Field>
            {!batchId && (
              <Field label="Batch (optional)">
                <select
                  value={pickBatch}
                  onChange={(e) => setPickBatch(e.target.value)}
                  className="w-full rounded-lg border border-mycelium bg-white px-3 py-2 text-sm text-ink outline-none focus:border-hyphae-400 focus:ring-2 focus:ring-hyphae-200"
                >
                  <option value="">— none —</option>
                  {batches.data?.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {photosEnabled && (
              <Field label="Photo (optional)">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="block w-full text-sm text-ink/70 file:mr-3 file:rounded-lg file:border file:border-mycelium file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-ink hover:file:bg-spore"
                />
              </Field>
            )}
            <Button type="submit" disabled={create.isPending || !body.trim()}>
              {create.isPending ? 'Saving…' : 'Add entry'}
            </Button>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </form>
      </Card>

      {logs.isLoading ? (
        <Spinner />
      ) : logs.data?.length === 0 ? (
        <EmptyState
          title="No journal entries yet"
          hint={
            batchId
              ? 'Log observations, tweaks, and conditions as this batch progresses.'
              : 'Capture anything worth remembering — even notes not tied to a batch.'
          }
        />
      ) : (
        <div className="space-y-3">
          {logs.data?.map((entry) => (
            <LogRow
              key={entry.id}
              entry={entry}
              batchLabel={!batchId ? batchName(batches.data, entry.batchId) : undefined}
              onDelete={() => remove.mutate(entry.id)}
              deleting={remove.isPending}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function LogRow({
  entry,
  batchLabel,
  onDelete,
  deleting,
}: {
  entry: LogEntry;
  batchLabel?: string;
  onDelete: () => void;
  deleting: boolean;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draftBody, setDraftBody] = useState(entry.body);
  const [draftDate, setDraftDate] = useState(() => isoToDateInput(entry.occurredAt));
  const [editError, setEditError] = useState<string | null>(null);

  function startEdit() {
    setDraftBody(entry.body);
    setDraftDate(isoToDateInput(entry.occurredAt));
    setEditError(null);
    setEditing(true);
  }

  const save = useMutation({
    mutationFn: () =>
      api.logs.update(entry.id, {
        body: draftBody.trim(),
        occurredAt: localNoonISO(draftDate),
      }),
    onSuccess: () => {
      // Match the create/remove mutations: refresh every logs scope.
      qc.invalidateQueries({ queryKey: ['logs'] });
      setEditing(false);
      setEditError(null);
    },
    onError: (e) => setEditError(e instanceof ApiError ? e.message : 'Could not save the entry.'),
  });

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-ink/50">
          <span className="font-medium text-ink/70">{formatDate(entry.occurredAt)}</span>
          {batchLabel && entry.batchId && (
            <Link to={`/batches/${entry.batchId}`} className="text-hyphae-700 hover:underline">
              {batchLabel}
            </Link>
          )}
        </div>
        <div className="flex items-center gap-3">
          {!editing && (
            <button
              type="button"
              onClick={startEdit}
              className="text-xs text-ink/40 hover:text-hyphae-700"
            >
              edit
            </button>
          )}
          <button
            type="button"
            onClick={onDelete}
            disabled={deleting}
            className="text-xs text-ink/40 hover:text-flush"
          >
            delete
          </button>
        </div>
      </div>
      {editing ? (
        <div className="mt-2 space-y-3">
          <Textarea
            value={draftBody}
            onChange={(e) => setDraftBody(e.target.value)}
            rows={3}
            required
          />
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Date">
              <Input type="date" value={draftDate} onChange={(e) => setDraftDate(e.target.value)} />
            </Field>
            <Button
              type="button"
              onClick={() => save.mutate()}
              disabled={save.isPending || !draftBody.trim()}
            >
              {save.isPending ? 'Saving…' : 'Save'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setEditing(false);
                setEditError(null);
              }}
              disabled={save.isPending}
            >
              Cancel
            </Button>
          </div>
          {editError && <p className="text-sm text-red-600">{editError}</p>}
        </div>
      ) : (
        <p className="mt-2 whitespace-pre-wrap text-sm text-substrate">{entry.body}</p>
      )}
      <LogPhotos logEntryId={entry.id} />
    </Card>
  );
}
