import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError, api } from '../lib/api';
import { formatDate } from '../lib/format';
import type { EnvironmentReading } from '../lib/types';
import { Button, Card, EmptyState, Field, Input, Spinner } from './ui';

const cToF = (c: number) => Math.round((c * 9) / 5 + 32);

type Metric = {
  key: 'tempC' | 'humidityPct' | 'co2Ppm';
  label: string;
  unit: string;
  color: string;
  fmt: (v: number) => string;
};
const METRICS: Metric[] = [
  {
    key: 'tempC',
    label: 'Temperature',
    unit: '°C',
    color: '#C77D4A',
    fmt: (v) => `${v}°C · ${cToF(v)}°F`,
  },
  { key: 'humidityPct', label: 'Humidity', unit: '%', color: '#4A90C7', fmt: (v) => `${v}%` },
  { key: 'co2Ppm', label: 'CO₂', unit: 'ppm', color: '#6B8E4E', fmt: (v) => `${v} ppm` },
];

/** A tiny self-scaling SVG line chart for one metric's time series. */
function Sparkline({ points, color }: { points: { t: number; v: number }[]; color: string }) {
  const W = 320;
  const H = 64;
  const pad = 4;
  if (points.length === 0) return null;
  const ts = points.map((p) => p.t);
  const vs = points.map((p) => p.v);
  const tMin = Math.min(...ts);
  const tMax = Math.max(...ts);
  const vMin = Math.min(...vs);
  const vMax = Math.max(...vs);
  const x = (t: number) =>
    tMax === tMin ? W / 2 : pad + ((t - tMin) / (tMax - tMin)) * (W - 2 * pad);
  const y = (v: number) =>
    vMax === vMin ? H / 2 : H - pad - ((v - vMin) / (vMax - vMin)) * (H - 2 * pad);
  const d = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`)
    .join(' ');
  const only = points.length === 1 ? points[0] : undefined;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-16 w-full" preserveAspectRatio="none" role="img">
      <title>Readings over time</title>
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {only && <circle cx={x(only.t)} cy={y(only.v)} r={3} fill={color} />}
    </svg>
  );
}

function MetricCard({ metric, readings }: { metric: Metric; readings: EnvironmentReading[] }) {
  const points = readings
    .map((r) => ({ t: new Date(r.recordedAt).getTime(), v: r[metric.key] as number | null }))
    .filter((p): p is { t: number; v: number } => p.v != null && !Number.isNaN(p.t))
    .sort((a, b) => a.t - b.t);
  const last = points[points.length - 1];
  if (!last) return null;
  const latest = last.v;
  const min = Math.min(...points.map((p) => p.v));
  const max = Math.max(...points.map((p) => p.v));
  const unit = metric.unit === 'ppm' ? ' ppm' : metric.unit;
  return (
    <Card className="p-4">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-cap/80">
          {metric.label}
        </span>
        <span className="text-sm font-semibold text-substrate">{metric.fmt(latest)}</span>
      </div>
      <div className="mt-2">
        <Sparkline points={points} color={metric.color} />
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-ink/50">
        <span>
          low {min}
          {unit}
        </span>
        <span>{points.length} readings</span>
        <span>
          high {max}
          {unit}
        </span>
      </div>
    </Card>
  );
}

/**
 * Manual environment logging (temp / humidity / CO₂) with per-batch time-series
 * charts — the biggest feature hole flagged by market research.
 */
export function EnvironmentPanel({ batchId }: { batchId: string }) {
  const qc = useQueryClient();
  const key = ['environment', batchId] as const;
  const q = useQuery({ queryKey: key, queryFn: () => api.environment.list(batchId) });

  const [temp, setTemp] = useState('');
  const [humidity, setHumidity] = useState('');
  const [co2, setCo2] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      api.environment.create({
        batchId,
        tempC: temp ? Number(temp) : null,
        humidityPct: humidity ? Number(humidity) : null,
        co2Ppm: co2 ? Number(co2) : null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: key });
      setTemp('');
      setHumidity('');
      setCo2('');
      setError(null);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not save the reading.'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.environment.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not delete the reading.'),
  });

  const readings = q.data ?? [];
  const canSubmit = (!!temp || !!humidity || !!co2) && !create.isPending;

  return (
    <div>
      <Card className="mb-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) create.mutate();
          }}
          className="flex flex-wrap items-end gap-3"
        >
          <Field label="Temp °C">
            <Input
              type="number"
              step="0.1"
              value={temp}
              onChange={(e) => setTemp(e.target.value)}
              className="w-24"
              placeholder="21"
            />
          </Field>
          <Field label="Humidity %">
            <Input
              type="number"
              step="1"
              value={humidity}
              onChange={(e) => setHumidity(e.target.value)}
              className="w-24"
              placeholder="90"
            />
          </Field>
          <Field label="CO₂ ppm">
            <Input
              type="number"
              step="10"
              value={co2}
              onChange={(e) => setCo2(e.target.value)}
              className="w-28"
              placeholder="800"
            />
          </Field>
          <Button type="submit" disabled={!canSubmit}>
            {create.isPending ? 'Saving…' : 'Log reading'}
          </Button>
          {error && <p className="w-full text-sm text-red-600">{error}</p>}
        </form>
      </Card>

      {q.isLoading ? (
        <Spinner />
      ) : readings.length === 0 ? (
        <EmptyState
          title="No environment readings yet"
          hint="Log temperature, humidity, and CO₂ to chart conditions against your results."
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            {METRICS.map((m) => (
              <MetricCard key={m.key} metric={m} readings={readings} />
            ))}
          </div>
          <div className="mt-4 space-y-1">
            {readings
              .slice()
              .sort((a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime())
              .slice(0, 8)
              .map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between rounded-lg border border-mycelium bg-white/70 px-3 py-1.5 text-xs"
                >
                  <span className="text-ink/50">{formatDate(r.recordedAt)}</span>
                  <span className="flex items-center gap-3 text-substrate">
                    {r.tempC != null && <span>{r.tempC}°C</span>}
                    {r.humidityPct != null && <span>{r.humidityPct}%</span>}
                    {r.co2Ppm != null && <span>{r.co2Ppm} ppm</span>}
                  </span>
                  <button
                    type="button"
                    onClick={() => remove.mutate(r.id)}
                    className="text-ink/40 hover:text-flush"
                  >
                    delete
                  </button>
                </div>
              ))}
          </div>
        </>
      )}
    </div>
  );
}
