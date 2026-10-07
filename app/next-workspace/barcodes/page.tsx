'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import JsBarcode from 'jsbarcode';
import { supabase, type BusinessContext } from '@/lib/supabase';

type Item = {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  sales_price: number;
  category_id: string | null;
};

type BarcodeTemplate = {
  id: string;
  name: string;
  media_type: 'thermal_roll' | 'sheet_a4';
  label_width_mm: number;
  label_height_mm: number;
  labels_across: number;
  labels_down: number;
  page_margin_top_mm: number;
  page_margin_left_mm: number;
  gap_horizontal_mm: number;
  gap_vertical_mm: number;
  show_company_name: boolean;
  show_item_name: boolean;
  show_selling_price: boolean;
  show_mrp: boolean;
  show_category: boolean;
  show_batch_no: boolean;
  barcode_format: string;
};

type PresetKey = 'thermal-50x25' | 'thermal-38x25' | 'a4-24-up' | 'a4-40-up';

type Preset = BarcodeTemplate & {
  key: PresetKey;
  description: string;
  page_width_mm: number;
  page_height_mm: number;
  page_padding_top_mm: number;
  page_padding_left_mm: number;
  page_padding_bottom_mm: number;
  page_padding_right_mm: number;
};

const PRESETS: Preset[] = [
  {
    key: 'thermal-50x25',
    name: 'Thermal Roll · 50×25 mm',
    description: 'Standard 50 mm thermal roll label',
    media_type: 'thermal_roll',
    label_width_mm: 50,
    label_height_mm: 25,
    labels_across: 1,
    labels_down: 1,
    page_margin_top_mm: 0,
    page_margin_left_mm: 0,
    gap_horizontal_mm: 0,
    gap_vertical_mm: 0,
    show_company_name: true,
    show_item_name: true,
    show_selling_price: true,
    show_mrp: false,
    show_category: false,
    show_batch_no: false,
    barcode_format: 'CODE128',
    page_width_mm: 50,
    page_height_mm: 25,
    page_padding_top_mm: 0,
    page_padding_left_mm: 0,
    page_padding_bottom_mm: 0,
    page_padding_right_mm: 0
  },
  {
    key: 'thermal-38x25',
    name: 'Thermal Roll · 38×25 mm',
    description: 'Compact 38 mm thermal roll label',
    media_type: 'thermal_roll',
    label_width_mm: 38,
    label_height_mm: 25,
    labels_across: 1,
    labels_down: 1,
    page_margin_top_mm: 0,
    page_margin_left_mm: 0,
    gap_horizontal_mm: 0,
    gap_vertical_mm: 0,
    show_company_name: true,
    show_item_name: true,
    show_selling_price: true,
    show_mrp: false,
    show_category: false,
    show_batch_no: false,
    barcode_format: 'CODE128',
    page_width_mm: 38,
    page_height_mm: 25,
    page_padding_top_mm: 0,
    page_padding_left_mm: 0,
    page_padding_bottom_mm: 0,
    page_padding_right_mm: 0
  },
  {
    key: 'a4-24-up',
    name: 'A4 Sticker · 24-Up',
    description: '3 columns × 8 rows · 64×33.9 mm',
    media_type: 'sheet_a4',
    label_width_mm: 64,
    label_height_mm: 33.9,
    labels_across: 3,
    labels_down: 8,
    page_margin_top_mm: 0,
    page_margin_left_mm: 0,
    gap_horizontal_mm: 0,
    gap_vertical_mm: 0,
    show_company_name: true,
    show_item_name: true,
    show_selling_price: true,
    show_mrp: true,
    show_category: false,
    show_batch_no: false,
    barcode_format: 'CODE128',
    page_width_mm: 210,
    page_height_mm: 297,
    page_padding_top_mm: 12.9,
    page_padding_left_mm: 9,
    page_padding_bottom_mm: 12.9,
    page_padding_right_mm: 9
  },
  {
    key: 'a4-40-up',
    name: 'A4 Sticker · 40-Up',
    description: '4 columns × 10 rows · 48.5×25.4 mm',
    media_type: 'sheet_a4',
    label_width_mm: 48.5,
    label_height_mm: 25.4,
    labels_across: 4,
    labels_down: 10,
    page_margin_top_mm: 0,
    page_margin_left_mm: 0,
    gap_horizontal_mm: 0,
    gap_vertical_mm: 0,
    show_company_name: true,
    show_item_name: true,
    show_selling_price: true,
    show_mrp: false,
    show_category: false,
    show_batch_no: false,
    barcode_format: 'CODE128',
    page_width_mm: 210,
    page_height_mm: 297,
    page_padding_top_mm: 21.5,
    page_padding_left_mm: 8,
    page_padding_bottom_mm: 21.5,
    page_padding_right_mm: 8
  }
];

function BarcodeSvg({ value }: { value: string }) {
  const ref = useRef<SVGSVGElement | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!ref.current) return;
    ref.current.innerHTML = '';
    try {
      JsBarcode(ref.current, value, {
        format: 'CODE128',
        width: 1.25,
        height: 32,
        displayValue: false,
        margin: 0,
        background: '#ffffff',
        lineColor: '#000000'
      });
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [value]);

  if (failed) {
    return <div className="text-[8px] font-semibold text-rose-600">Barcode value is not valid.</div>;
  }

  return <svg ref={ref} className="mx-auto block h-auto max-w-full" role="img" aria-label={'Barcode ' + value} />;
}

function chunk<T>(items: T[], size: number): T[][] {
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += size) pages.push(items.slice(i, i + size));
  return pages;
}

export default function Barcodes() {
  const [ctx, setCtx] = useState<BusinessContext | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [templates, setTemplates] = useState<BarcodeTemplate[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [qty, setQty] = useState(1);
  const [presetKey, setPresetKey] = useState<PresetKey>('thermal-50x25');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [company, setCompany] = useState('Business');

  const preset = PRESETS.find((x) => x.key === presetKey) ?? PRESETS[0];

  async function load() {
    const c = await supabase.rpc('get_my_business_context');
    const b = (c.data || [])[0] as BusinessContext | undefined;
    if (!b) return;

    setCtx(b);
    const [i, t, br] = await Promise.all([
      supabase
        .from('products_services')
        .select('id,name,sku,barcode,sales_price,category_id')
        .eq('business_id', b.business_id)
        .eq('is_active', true)
        .order('name'),
      supabase
        .from('barcode_print_templates')
        .select('*')
        .eq('business_id', b.business_id)
        .order('name'),
      supabase.from('businesses').select('name').eq('id', b.business_id).single()
    ]);

    if (i.error) setError(i.error.message);
    if (t.error) setError(t.error.message);
    if (br.error) setError(br.error.message);

    setItems((i.data || []) as Item[]);
    setTemplates((t.data || []) as BarcodeTemplate[]);
    setCompany(br.data?.name || 'Business');
  }

  useEffect(() => {
    void load();
  }, []);

  async function savePreset(target: Preset = preset) {
    if (!ctx) return;
    setBusy(true);
    setError('');
    setNotice('');
    const { error: upsertError } = await supabase.from('barcode_print_templates').upsert(
      {
        business_id: ctx.business_id,
        name: target.name,
        media_type: target.media_type,
        label_width_mm: target.label_width_mm,
        label_height_mm: target.label_height_mm,
        labels_across: target.labels_across,
        labels_down: target.labels_down,
        page_margin_top_mm: target.page_margin_top_mm,
        page_margin_left_mm: target.page_margin_left_mm,
        gap_horizontal_mm: target.gap_horizontal_mm,
        gap_vertical_mm: target.gap_vertical_mm,
        show_company_name: target.show_company_name,
        show_item_name: target.show_item_name,
        show_selling_price: target.show_selling_price,
        show_mrp: target.show_mrp,
        show_category: target.show_category,
        show_batch_no: target.show_batch_no,
        barcode_format: target.barcode_format
      },
      { onConflict: 'business_id,name' }
    );

    if (upsertError) setError(upsertError.message);
    else {
      setNotice(target.name + ' saved.');
      await load();
    }
    setBusy(false);
  }

  async function saveAllPresets() {
    for (const target of PRESETS) await savePreset(target);
  }

  function print() {
    window.print();
  }

  const selectedCopies = useMemo(
    () =>
      selected.flatMap((id) =>
        Array.from({ length: qty }, () => items.find((x) => x.id === id)).filter(
          (item): item is Item => Boolean(item)
        )
      ),
    [items, qty, selected]
  );

  const valuesForPrint = selectedCopies.map((item) => ({
    item,
    barcodeValue: (item.barcode || item.sku || item.id.slice(0, 12)).trim()
  }));

  const isSheet = preset.media_type === 'sheet_a4';
  const labelsPerPage = preset.labels_across * preset.labels_down;
  const printPages = isSheet ? chunk(valuesForPrint, labelsPerPage) : valuesForPrint.map((x) => [x]);

  const existingTemplate = templates.find(
    (t) =>
      t.media_type === preset.media_type &&
      Number(t.label_width_mm) === preset.label_width_mm &&
      Number(t.label_height_mm) === preset.label_height_mm &&
      t.labels_across === preset.labels_across &&
      t.labels_down === preset.labels_down
  );

  return (
    <main className="min-h-screen bg-slate-50 p-4 sm:p-7">
      <div className="mx-auto max-w-7xl">
        <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-600">
              Physical operations
            </p>
            <h1 className="mt-1 text-3xl font-semibold">Barcode Printing</h1>
            <p className="mt-1 text-sm text-slate-500">
              Optical-grade SVG barcodes with exact thermal and A4 sticker-sheet geometry.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-xl border bg-white px-4 py-2 text-sm"
              onClick={() => void savePreset()}
              disabled={busy}
            >
              {existingTemplate ? 'Save preset' : '+ Save preset'}
            </button>
            <button
              type="button"
              className="rounded-xl border bg-white px-4 py-2 text-sm"
              onClick={() => void saveAllPresets()}
              disabled={busy}
            >
              Sync 4 presets
            </button>
            <button
              type="button"
              className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white"
              onClick={print}
              disabled={!selectedCopies.length}
            >
              Print labels
            </button>
          </div>
        </header>

        {error && <div className="mb-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
        {notice && (
          <div className="mb-3 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</div>
        )}

        <div className="grid gap-5 lg:grid-cols-[1fr_460px]">
          <section className="rounded-2xl border bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <b>Catalog</b>
              <div className="flex items-center gap-3 text-xs">
                <label>
                  Copies
                  <input
                    className="ml-2 w-20 rounded border p-2"
                    type="number"
                    min="1"
                    max="500"
                    value={qty}
                    onChange={(e) => setQty(Math.max(1, Math.min(500, Number(e.target.value) || 1)))}
                  />
                </label>
                <label>
                  Preset
                  <select
                    className="ml-2 rounded border p-2"
                    value={presetKey}
                    onChange={(e) => setPresetKey(e.target.value as PresetKey)}
                  >
                    {PRESETS.map((x) => (
                      <option key={x.key} value={x.key}>
                        {x.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            <div className="mt-3 rounded-xl border border-indigo-100 bg-indigo-50/50 p-3 text-xs text-slate-700">
              <b>{preset.name}</b>
              <span className="ml-2 text-slate-500">{preset.description}</span>
            </div>

            <div className="mt-3 divide-y">
              {items.map((x) => (
                <label key={x.id} className="flex items-center gap-3 py-3 text-sm">
                  <input
                    type="checkbox"
                    checked={selected.includes(x.id)}
                    onChange={(e) =>
                      setSelected((s) =>
                        e.target.checked ? [...s, x.id] : s.filter((id) => id !== x.id)
                      )
                    }
                  />
                  <span className="flex-1">
                    <b>{x.name}</b>
                    <span className="ml-2 text-xs text-slate-400">
                      {x.sku || 'No SKU'} · {x.barcode || 'No barcode'}
                    </span>
                  </span>
                  <span>₹{Number(x.sales_price || 0).toLocaleString('en-IN')}</span>
                </label>
              ))}
              {!items.length && <p className="py-10 text-center text-sm text-slate-400">No active catalog items.</p>}
            </div>
          </section>

          <section className="rounded-2xl border bg-white p-4">
            <b>Print preview</b>
            <p className="mt-1 text-xs text-slate-500">
              {selectedCopies.length} label{selectedCopies.length === 1 ? '' : 's'} queued.
            </p>

            <div className="mt-4 overflow-auto rounded-xl border bg-slate-100 p-4">
              <div className="barcode-screen-preview">
                {!selectedCopies.length && (
                  <p className="py-12 text-center text-sm text-slate-400">Select items to preview labels.</p>
                )}

                {selectedCopies.length > 0 &&
                  (isSheet ? (
                    <div
                      className="a4-preview-page"
                      style={{
                        width: '210mm',
                        minHeight: '297mm',
                        padding: `${preset.page_padding_top_mm}mm ${preset.page_padding_right_mm}mm ${preset.page_padding_bottom_mm}mm ${preset.page_padding_left_mm}mm`,
                        display: 'grid',
                        gridTemplateColumns: `repeat(${preset.labels_across}, ${preset.label_width_mm}mm)`,
                        gridAutoRows: `${preset.label_height_mm}mm`,
                        gap: `${preset.gap_vertical_mm}mm ${preset.gap_horizontal_mm}mm`
                      }}
                    >
                      {valuesForPrint.slice(0, labelsPerPage).map(({ item, barcodeValue }, index) => (
                        <div key={item.id + '-' + index} className="barcode-label preview-label">
                          {preset.show_company_name && <div className="truncate text-[7px] font-bold">{company}</div>}
                          {preset.show_item_name && (
                            <div className="truncate text-[8px] font-semibold" title={item.name}>
                              {item.name}
                            </div>
                          )}
                          <div className="barcode-svg-wrap">
                            <BarcodeSvg value={barcodeValue} />
                          </div>
                          <div className="font-mono text-[7px]">{barcodeValue}</div>
                          {preset.show_selling_price && (
                            <div className="text-[7px] font-bold">₹{Number(item.sales_price || 0).toLocaleString('en-IN')}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="thermal-preview-stack">
                      {valuesForPrint.slice(0, 5).map(({ item, barcodeValue }, index) => (
                        <div key={item.id + '-' + index} className="barcode-label preview-label thermal-preview-label">
                          {preset.show_company_name && <div className="truncate text-[7px] font-bold">{company}</div>}
                          {preset.show_item_name && <div className="truncate text-[8px] font-semibold">{item.name}</div>}
                          <div className="barcode-svg-wrap">
                            <BarcodeSvg value={barcodeValue} />
                          </div>
                          <div className="font-mono text-[7px]">{barcodeValue}</div>
                          {preset.show_selling_price && (
                            <div className="text-[7px] font-bold">₹{Number(item.sales_price || 0).toLocaleString('en-IN')}</div>
                          )}
                        </div>
                      ))}
                      {valuesForPrint.length > 5 && (
                        <p className="pt-2 text-center text-[10px] text-slate-500">
                          + {valuesForPrint.length - 5} more labels in print output
                        </p>
                      )}
                    </div>
                  ))}
              </div>
            </div>

            {printPages.length > 1 && (
              <p className="mt-2 text-[10px] text-slate-500">
                This job will span {printPages.length} physical pages.
              </p>
            )}
          </section>
        </div>
      </div>

      <style jsx global>{`
        .barcode-screen-preview { min-width: fit-content; }
        .a4-preview-page { transform-origin: top left; }
        .preview-label {
          box-sizing: border-box;
          display: flex;
          flex-direction: column;
          justify-content: center;
          overflow: hidden;
          background: #fff;
          text-align: center;
          padding: 2mm;
        }
        .barcode-svg-wrap { width: 100%; margin: 1mm 0; }
        .barcode-svg-wrap svg { width: 100%; max-height: 12mm; }
        .thermal-preview-label { width: `${preset.label_width_mm}mm`; height: `${preset.label_height_mm}mm`; }
        .thermal-preview-stack { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
        @media print {
          @page { size: ${preset.page_width_mm}mm ${preset.page_height_mm}mm; margin: 0; }
          html, body { margin: 0 !important; padding: 0 !important; }
          body * { visibility: hidden; }
          .barcode-print-area, .barcode-print-area * { visibility: visible; }
          .barcode-print-area {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: ${preset.page_width_mm}mm !important;
            margin: 0 !important;
            padding: 0 !important;
            background: #fff !important;
          }
          .barcode-print-page {
            box-sizing: border-box;
            width: ${preset.page_width_mm}mm !important;
            min-height: ${preset.page_height_mm}mm !important;
            margin: 0 !important;
            padding: ${preset.page_padding_top_mm}mm ${preset.page_padding_right_mm}mm ${preset.page_padding_bottom_mm}mm ${preset.page_padding_left_mm}mm !important;
            break-after: page;
            page-break-after: always;
            background: #fff !important;
          }
          .barcode-print-page:last-child { break-after: auto; page-break-after: auto; }
          .barcode-print-grid {
            display: grid !important;
            grid-template-columns: repeat(${preset.labels_across}, ${preset.label_width_mm}mm) !important;
            grid-template-rows: repeat(${preset.labels_down}, ${preset.label_height_mm}mm) !important;
            gap: ${preset.gap_vertical_mm}mm ${preset.gap_horizontal_mm}mm !important;
          }
          .barcode-label {
            box-sizing: border-box !important;
            width: ${preset.label_width_mm}mm !important;
            height: ${preset.label_height_mm}mm !important;
            margin: 0 !important;
            padding: 2mm !important;
            overflow: hidden !important;
            background: #fff !important;
            border: 0 !important;
            break-inside: avoid;
            page-break-inside: avoid;
          }
          .barcode-label .barcode-svg-wrap svg { width: 100% !important; max-height: 13mm !important; }
          .barcode-thermal-page {
            display: flex !important;
            align-items: flex-start !important;
            justify-content: flex-start !important;
            padding: 0 !important;
          }
          .barcode-thermal-page .barcode-label {
            padding: 1mm !important;
            break-after: page;
            page-break-after: always;
          }
          .barcode-thermal-page:last-child .barcode-label {
            break-after: auto;
            page-break-after: auto;
          }
          .barcode-screen-preview, .barcode-screen-preview * { visibility: hidden !important; }
        }
      `}</style>

      <div className="barcode-print-area" aria-hidden="true">
        {isSheet
          ? printPages.map((page, pageIndex) => (
              <div key={pageIndex} className="barcode-print-page barcode-print-grid">
                {page.map(({ item, barcodeValue }, index) => (
                  <div key={item.id + '-' + pageIndex + '-' + index} className="barcode-label">
                    {preset.show_company_name && <div className="truncate text-[7px] font-bold">{company}</div>}
                    {preset.show_item_name && <div className="truncate text-[8px] font-semibold">{item.name}</div>}
                    <div className="barcode-svg-wrap"><BarcodeSvg value={barcodeValue} /></div>
                    <div className="font-mono text-[7px]">{barcodeValue}</div>
                    {preset.show_selling_price && <div className="text-[7px] font-bold">₹{Number(item.sales_price || 0).toLocaleString('en-IN')}</div>}
                  </div>
                ))}
              </div>
            ))
          : printPages.map((page, pageIndex) => (
              <div key={pageIndex} className="barcode-print-page barcode-thermal-page">
                {page.map(({ item, barcodeValue }) => (
                  <div key={item.id + '-' + pageIndex} className="barcode-label">
                    {preset.show_company_name && <div className="truncate text-[7px] font-bold">{company}</div>}
                    {preset.show_item_name && <div className="truncate text-[8px] font-semibold">{item.name}</div>}
                    <div className="barcode-svg-wrap"><BarcodeSvg value={barcodeValue} /></div>
                    <div className="font-mono text-[7px]">{barcodeValue}</div>
                    {preset.show_selling_price && <div className="text-[7px] font-bold">₹{Number(item.sales_price || 0).toLocaleString('en-IN')}</div>}
                  </div>
                ))}
              </div>
            ))}
      </div>
    </main>
  );
}
