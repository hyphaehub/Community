import { CONTAMINANT_TYPE_LABELS } from '@hyphaehub/core';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { ApiError, api } from '../lib/api';
import type { AiDiagnosis } from '../lib/types';
import { Badge, Button } from './ui';

function contaminantLabel(key: string): string {
  if (key === 'NONE') return 'No contamination';
  if (key === 'UNKNOWN') return 'Unclear';
  return CONTAMINANT_TYPE_LABELS[key as keyof typeof CONTAMINANT_TYPE_LABELS] ?? key;
}

/**
 * AI contamination scanner: upload a culture photo, get a diagnosis (healthy vs
 * likely contaminant + confidence + guidance). `onApply` receives the detected
 * contaminant so a caller can pre-fill a form. AI results are advisory.
 */
export function AiScanner({
  onApply,
  compact,
}: {
  onApply?: (contaminant: string) => void;
  compact?: boolean;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const [result, setResult] = useState<AiDiagnosis | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const previewUrl = useRef<string | null>(null);

  // Revoke the last preview object URL on unmount.
  useEffect(
    () => () => {
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    },
    [],
  );

  const scan = useMutation({
    mutationFn: (file: File) => api.ai.diagnose(file),
    onSuccess: (d) => {
      setResult(d);
      if (
        onApply &&
        !d.healthy &&
        d.likelyContaminant !== 'NONE' &&
        d.likelyContaminant !== 'UNKNOWN'
      ) {
        onApply(d.likelyContaminant);
      }
    },
  });

  function onPick(file: File | null) {
    setResult(null);
    scan.reset();
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    const url = file ? URL.createObjectURL(file) : null;
    previewUrl.current = url;
    setPreview(url);
    // Reset the input so re-picking the same file fires onChange again (retry).
    if (fileRef.current) fileRef.current.value = '';
    if (file) scan.mutate(file);
  }

  const err = scan.error;
  const confColor = { high: 'green', medium: 'amber', low: 'neutral' } as const;

  return (
    <div className={compact ? '' : 'rounded-2xl border border-mycelium bg-white/70 p-4'}>
      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => onPick(e.target.files?.[0] ?? null)}
        />
        <Button variant="secondary" type="button" onClick={() => fileRef.current?.click()}>
          {scan.isPending ? 'Analyzing…' : preview ? 'Scan another photo' : '📷 Scan a photo'}
        </Button>
        {!result && !scan.isPending && (
          <span className="text-xs text-ink/50">Upload a photo of the culture for an AI read.</span>
        )}
      </div>

      {preview && (
        <div className="mt-3 flex items-start gap-3">
          <img
            src={preview}
            alt="Scan preview"
            className="h-24 w-24 shrink-0 rounded-lg border border-mycelium object-cover"
          />
          <div className="min-w-0 flex-1">
            {scan.isPending && <p className="text-sm text-ink/50">Analyzing the image…</p>}
            {err && (
              <p className="text-sm text-red-600">
                {err instanceof ApiError ? err.message : 'Could not analyze this image.'}
              </p>
            )}
            {result && (
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  {result.healthy ? (
                    <Badge color="green">Looks healthy</Badge>
                  ) : (
                    <Badge color="red">{contaminantLabel(result.likelyContaminant)}</Badge>
                  )}
                  <Badge color={confColor[result.confidence]}>{result.confidence} confidence</Badge>
                </div>
                {result.summary && <p className="mt-2 text-sm text-substrate">{result.summary}</p>}
                {result.recommendation && (
                  <p className="mt-1 text-sm text-ink/70">
                    <span className="font-medium">Next:</span> {result.recommendation}
                  </p>
                )}
                <p className="mt-2 text-[11px] text-ink/40">
                  AI estimate — always confirm with your own eyes before acting.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
