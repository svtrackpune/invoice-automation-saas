'use client';

type Product = {
  name: string;
  track_batches?: boolean;
  track_serials?: boolean;
};

type Line = {
  quantity: number;
  batch_number: string;
  serial_number: string;
};

type Props = {
  open: boolean;
  product: Product | null;
  line: Line | null;
  options: { batch: string[]; serial: string[] };
  busy?: boolean;
  onChange: (key: 'batch_number' | 'serial_number', value: string) => void;
  onClose: () => void;
};

export default function InventoryTrackingModal({ open, product, line, options, busy = false, onChange, onClose }: Props) {
  if (!open || !product || !line) return null;

  const serialInvalid = product.track_serials && line.quantity !== 1;
  const missingBatch = product.track_batches && !line.batch_number.trim();
  const missingSerial = product.track_serials && !line.serial_number.trim();
  const invalid = serialInvalid || missingBatch || missingSerial;

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/45 p-4" role="dialog" aria-modal="true" aria-labelledby="inventory-tracking-title">
      <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[.16em] text-violet-600">Inventory tracking</p>
            <h2 id="inventory-tracking-title" className="mt-1 text-xl font-semibold text-slate-900">Batch / Serial details</h2>
            <p className="mt-1 text-xs text-slate-500">{product.name}</p>
          </div>
          <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-xl bg-slate-100 text-slate-600" aria-label="Close tracking details">×</button>
        </div>

        {busy ? (
          <div className="py-10 text-center text-sm text-slate-500">Loading previously used tracking values…</div>
        ) : (
          <div className="mt-6 space-y-5">
            {product.track_batches && (
              <div>
                <label className="block text-xs font-semibold text-slate-700">
                  Batch number *
                  <input
                    className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                    value={line.batch_number}
                    onChange={(e) => onChange('batch_number', e.target.value)}
                    placeholder="Enter or scan batch number"
                  />
                </label>
                {options.batch.length > 0 && (
                  <select
                    defaultValue=""
                    onChange={(e) => { if (e.target.value) onChange('batch_number', e.target.value); }}
                    className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                  >
                    <option value="">Choose a previously used batch…</option>
                    {options.batch.map((value) => <option key={value} value={value}>{value}</option>)}
                  </select>
                )}
              </div>
            )}

            {product.track_serials && (
              <div>
                <label className="block text-xs font-semibold text-slate-700">
                  Serial number *
                  <input
                    className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                    value={line.serial_number}
                    onChange={(e) => onChange('serial_number', e.target.value)}
                    placeholder="Enter or scan serial number"
                  />
                </label>
                {options.serial.length > 0 && (
                  <select
                    defaultValue=""
                    onChange={(e) => { if (e.target.value) onChange('serial_number', e.target.value); }}
                    className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                  >
                    <option value="">Choose a previously used serial…</option>
                    {options.serial.map((value) => <option key={value} value={value}>{value}</option>)}
                  </select>
                )}
                <p className="mt-2 text-[11px] text-slate-400">Serial-tracked products must be invoiced one unit per line.</p>
              </div>
            )}

            {!product.track_batches && !product.track_serials && (
              <div className="rounded-xl bg-slate-50 p-4 text-xs leading-5 text-slate-500">
                This product is inventory-tracked, but the product master does not require batch or serial identifiers.
              </div>
            )}

            {invalid && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Complete the required tracking information before saving the invoice.
              </div>
            )}

            <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
              <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
