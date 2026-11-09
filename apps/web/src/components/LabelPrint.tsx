import { QRCodeSVG } from 'qrcode.react';
import { type CSSProperties, useEffect, useMemo, useState } from 'react';
import {
  LABEL_SIZES,
  type LabelData,
  type LabelFields,
  type LabelLayout,
  labelSizeByKey,
  loadLabelPrefs,
  saveLabelPrefs,
} from '../lib/labels';
import { Button, Modal, Select, Toggle, cn } from './ui';

/** One label card. Shared by the on-screen preview and the hidden print area so
 *  what you see is what prints. Sizing comes from CSS vars set by the parent. */
function LabelCard({ data, fields }: { data: LabelData; fields: LabelFields }) {
  return (
    <div className="label-card">
      <div className="label-text">
        <div className="label-title">{data.title}</div>
        {fields.subtitle && data.subtitle && <div className="label-sub">{data.subtitle}</div>}
        {fields.meta && data.meta && <div className="label-meta">{data.meta}</div>}
        {fields.code && <div className="label-code">{data.code}</div>}
      </div>
      {fields.qr && (
        <div className="label-qr">
          <QRCodeSVG
            value={data.url}
            size={160}
            level="M"
            style={{ width: '100%', height: '100%' }}
          />
        </div>
      )}
    </div>
  );
}

const FIELD_TOGGLES: { key: keyof LabelFields; label: string }[] = [
  { key: 'subtitle', label: 'Strain / detail' },
  { key: 'meta', label: 'Date & weights' },
  { key: 'code', label: 'Short code' },
  { key: 'qr', label: 'QR code' },
];

/**
 * Browser-print label sheet. Renders a hidden print area (revealed only by the
 * print stylesheet in index.css) sized to the chosen label stock, so it works
 * with any driver-backed printer (Nelko PM220, Brother, DYMO, Zebra, …) via the
 * OS/browser print dialog. Content, size, and layout are customizable and the
 * choices are remembered across sessions.
 */
export function LabelPrintModal({
  open,
  onClose,
  items,
  title = 'Print labels',
}: {
  open: boolean;
  onClose: () => void;
  items: LabelData[];
  title?: string;
}) {
  const initial = useMemo(() => loadLabelPrefs(), []);
  const [sizeKey, setSizeKey] = useState(initial.sizeKey);
  const [layout, setLayout] = useState<LabelLayout>(initial.layout);
  const [fields, setFields] = useState<LabelFields>(initial.fields);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(items.map((i) => i.key)));

  // Reset the selection whenever the candidate set changes (new context opened).
  const itemsKey = items.map((i) => i.key).join(',');
  useEffect(() => setSelected(new Set(itemsKey ? itemsKey.split(',') : [])), [itemsKey]);

  // Persist customization so the next print starts where this one left off.
  useEffect(() => {
    saveLabelPrefs({ sizeKey, layout, fields });
  }, [sizeKey, layout, fields]);

  const size = labelSizeByKey(sizeKey);
  const chosen = items.filter((i) => selected.has(i.key));
  const qrMm = Math.max(12, Math.min(size.hmm - 8, size.wmm * 0.42));
  const sizeVars = {
    '--label-w': `${size.wmm}mm`,
    '--label-h': `${size.hmm}mm`,
    '--label-qr': `${qrMm}mm`,
  } as CSSProperties;

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function setField(key: keyof LabelFields, value: boolean) {
    setFields((prev) => ({ ...prev, [key]: value }));
  }

  function print() {
    if (chosen.length === 0) return;
    let styleEl = document.getElementById('label-page-style');
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'label-page-style';
      document.head.appendChild(styleEl);
    }
    // One-per-page uses the label as the page; sheet tiles onto standard paper.
    styleEl.textContent =
      layout === 'sheet'
        ? '@page { size: auto; margin: 10mm; }'
        : `@page { size: ${size.page}; margin: 0; }`;
    window.print();
  }

  const preview = chosen[0];

  return (
    <>
      <Modal open={open} onClose={onClose} title={title}>
        <div className="space-y-4">
          <div>
            <div className="mb-2 text-sm font-medium text-ink/80">Labels to print</div>
            <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-mycelium p-2">
              {items.length === 0 ? (
                <p className="p-2 text-xs text-ink/40">Nothing to label yet.</p>
              ) : (
                items.map((i) => (
                  <label
                    key={i.key}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-spore"
                  >
                    <input
                      type="checkbox"
                      className="accent-hyphae-600"
                      checked={selected.has(i.key)}
                      onChange={() => toggle(i.key)}
                    />
                    <span className="truncate text-substrate">{i.title}</span>
                    {i.meta && <span className="truncate text-xs text-ink/40">{i.meta}</span>}
                  </label>
                ))
              )}
            </div>
          </div>

          {/* Live preview — matches what prints, at true label size. */}
          <div>
            <div className="mb-2 text-sm font-medium text-ink/80">Preview</div>
            <div className="flex min-h-[80px] items-center justify-center overflow-auto rounded-lg border border-dashed border-mycelium bg-spore p-4">
              {preview ? (
                <div className="label-preview shadow-sm" style={sizeVars}>
                  <LabelCard data={preview} fields={fields} />
                </div>
              ) : (
                <p className="text-xs text-ink/40">Select a label to preview it.</p>
              )}
            </div>
          </div>

          <div>
            <div className="mb-2 text-sm font-medium text-ink/80">Show on label</div>
            <div className="grid grid-cols-2 gap-2">
              {FIELD_TOGGLES.map((f) => (
                <div
                  key={f.key}
                  className="flex items-center justify-between gap-2 rounded-lg border border-mycelium bg-white px-3 py-2 text-sm"
                >
                  <span className="text-ink/80">{f.label}</span>
                  <Toggle
                    checked={fields[f.key]}
                    onChange={(v) => setField(f.key, v)}
                    label={f.label}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label htmlFor="label-size" className="block">
              <span className="mb-1 block text-sm font-medium text-ink/80">Label size</span>
              <Select id="label-size" value={sizeKey} onChange={(e) => setSizeKey(e.target.value)}>
                {LABEL_SIZES.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </label>
            <label htmlFor="label-layout" className="block">
              <span className="mb-1 block text-sm font-medium text-ink/80">Layout</span>
              <Select
                id="label-layout"
                value={layout}
                onChange={(e) => setLayout(e.target.value as LabelLayout)}
              >
                <option value="page">One label per page (thermal)</option>
                <option value="sheet">Sheet — tile on A4 / Letter</option>
              </Select>
            </label>
          </div>

          <p className="text-xs text-ink/50">
            {layout === 'sheet'
              ? 'Labels tile onto a standard paper size for laser / inkjet sheet stock. Set your printer to 100% scale.'
              : 'Set your printer to this label size and 100% scale. Each label prints on its own page — the right choice for thermal label printers (Nelko, Brother, DYMO, Zebra).'}
          </p>

          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-ink/50">
              {chosen.length} label{chosen.length === 1 ? '' : 's'} selected
            </span>
            <div className="flex gap-2">
              <Button type="button" variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button type="button" onClick={print} disabled={chosen.length === 0}>
                Print
              </Button>
            </div>
          </div>
        </div>
      </Modal>

      {/* Hidden on screen; the print stylesheet reveals just this block. */}
      <div className={cn('label-print-area', layout === 'sheet' && 'label-sheet')} style={sizeVars}>
        {chosen.map((i) => (
          <LabelCard key={i.key} data={i} fields={fields} />
        ))}
      </div>
    </>
  );
}
