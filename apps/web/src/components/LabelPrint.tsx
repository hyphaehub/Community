import { QRCodeSVG } from 'qrcode.react';
import { type CSSProperties, useEffect, useState } from 'react';
import { LABEL_SIZES, type LabelData, labelSizeByKey } from '../lib/labels';
import { Button, Modal, Select, cn } from './ui';

/**
 * Browser-print label sheet. Renders a hidden print area (revealed only by the
 * print stylesheet in index.css) sized to the chosen label stock, so it works
 * with any driver-backed printer (Nelko PM220, Brother, DYMO, Zebra, …) via the
 * OS/browser print dialog.
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
  const [sizeKey, setSizeKey] = useState(LABEL_SIZES[0]?.key ?? '2x1');
  const [selected, setSelected] = useState<Set<string>>(() => new Set(items.map((i) => i.key)));

  // Reset the selection whenever the candidate set changes (new batch opened).
  const itemsKey = items.map((i) => i.key).join(',');
  useEffect(() => setSelected(new Set(itemsKey ? itemsKey.split(',') : [])), [itemsKey]);

  const size = labelSizeByKey(sizeKey);
  const chosen = items.filter((i) => selected.has(i.key));
  const qrMm = Math.max(12, Math.min(size.hmm - 8, size.wmm * 0.42));

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function print() {
    if (chosen.length === 0) return;
    let styleEl = document.getElementById('label-page-style');
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'label-page-style';
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = `@page { size: ${size.page}; margin: 0; }`;
    window.print();
  }

  return (
    <>
      <Modal open={open} onClose={onClose} title={title}>
        <div className="space-y-4">
          <div>
            <div className="mb-2 text-sm font-medium text-ink/80">Labels to print</div>
            <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-mycelium p-2">
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

          <label htmlFor="label-size" className="block">
            <span className="mb-1 block text-sm font-medium text-ink/80">Label size</span>
            <Select id="label-size" value={sizeKey} onChange={(e) => setSizeKey(e.target.value)}>
              {LABEL_SIZES.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </Select>
            <span className="mt-1 block text-xs text-ink/50">
              Set your printer to this label size and 100% scale. Each label prints on its own page.
            </span>
          </label>

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
      <div
        className="label-print-area"
        style={
          {
            '--label-w': `${size.wmm}mm`,
            '--label-h': `${size.hmm}mm`,
            '--label-qr': `${qrMm}mm`,
          } as CSSProperties
        }
      >
        {chosen.map((i) => (
          <div key={i.key} className={cn('label-card')}>
            <div className="label-text">
              <div className="label-title">{i.title}</div>
              {i.subtitle && <div className="label-sub">{i.subtitle}</div>}
              {i.meta && <div className="label-meta">{i.meta}</div>}
              <div className="label-code">{i.code}</div>
            </div>
            <div className="label-qr">
              <QRCodeSVG
                value={i.url}
                size={160}
                level="M"
                style={{ width: '100%', height: '100%' }}
              />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
