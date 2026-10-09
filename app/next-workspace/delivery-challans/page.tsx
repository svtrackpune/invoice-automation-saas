'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase, type BusinessContext } from '@/lib/supabase';
import { PageHeader } from '@/components/ui/finops/PageHeader';

type Customer = { id: string; display_name: string };
type Product = {
  id: string;
  name: string;
  sku: string | null;
  unit: string | null;
  hsn_sac: string | null;
  sales_price: number;
  inventory_tracked: boolean;
};
type Line = {
  product_service_id: string;
  description: string;
  quantity: string;
  unit: string;
  unit_price: string;
  hsn_sac: string;
  batch_number: string;
  serial_number: string;
};
type ChallanRow = {
  id: string;
  challan_number: string;
  challan_date: string;
  status: string;
  total: number;
  customer_id: string;
  converted_invoice_id: string | null;
  customers: { display_name: string } | null;
};
type ConversionResult = {
  success: boolean;
  invoice_id: string;
  invoice_number: string;
  challan_id: string;
};

const blank = (): Line => ({
  product_service_id: '',
  description: '',
  quantity: '1',
  unit: '',
  unit_price: '0',
  hsn_sac: '',
  batch_number: '',
  serial_number: ''
});
const today = () => new Date().toISOString().slice(0, 10);

export default function DeliveryChallans() {
  const [ctx, setCtx] = useState<BusinessContext | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [locations, setLocations] = useState<Array<{ id: string; name: string; is_default: boolean }>>([]);
  const [rows, setRows] = useState<ChallanRow[]>([]);
  const [customer, setCustomer] = useState('');
  const [locationId, setLocationId] = useState('');
  const [date, setDate] = useState(today());
  const [transporter, setTransporter] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [eway, setEway] = useState('');
  const [lines, setLines] = useState<Line[]>([blank()]);
  const [busy, setBusy] = useState(false);
  const [convertingId, setConvertingId] = useState<string | null>(null);
  const [confirmRow, setConfirmRow] = useState<ChallanRow | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<{ text: string; invoiceId?: string; invoiceNumber?: string }>({
    text: ''
  });

  async function load() {
    const c = await supabase.rpc('get_my_business_context');
    const b = (c.data || [])[0] as BusinessContext | undefined;
    if (!b) return;
    setCtx(b);

    const [cu, pr, lo, dc] = await Promise.all([
      supabase
        .from('customers')
        .select('id,display_name')
        .eq('business_id', b.business_id)
        .eq('is_active', true)
        .order('display_name'),
      supabase
        .from('products_services')
        .select('id,name,sku,unit,hsn_sac,sales_price,inventory_tracked')
        .eq('business_id', b.business_id)
        .eq('is_active', true)
        .eq('item_type', 'product')
        .order('name'),
      supabase
        .from('inventory_locations')
        .select('id,name,is_default')
        .eq('business_id', b.business_id)
        .eq('is_active', true)
        .order('name'),
      supabase
        .from('delivery_challans')
        .select(
          'id,challan_number,challan_date,status,total,customer_id,converted_invoice_id,customers(display_name)'
        )
        .eq('business_id', b.business_id)
        .order('challan_date', { ascending: false })
        .limit(50)
    ]);

    if (cu.error) setError(cu.error.message);
    if (pr.error) setError(pr.error.message);
    if (lo.error) setError(lo.error.message);
    if (dc.error) setError(dc.error.message);

    setCustomers(cu.data || []);
    setProducts(pr.data || []);
    setLocations(lo.data || []);
    setRows((dc.data || []) as unknown as ChallanRow[]);

    if (!locationId && lo.data?.length) {
      setLocationId((lo.data.find((x) => x.is_default) || lo.data[0]).id);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const total = useMemo(
    () => lines.reduce((sum, line) => sum + Number(line.quantity || 0) * Number(line.unit_price || 0), 0),
    [lines]
  );

  function choose(i: number, id: string) {
    const p = products.find((x) => x.id === id);
    setLines((current) =>
      current.map((line, index) =>
        index === i
          ? {
              ...line,
              product_service_id: id,
              description: p?.name || '',
              unit: p?.unit || '',
              unit_price: String(p?.sales_price || 0),
              hsn_sac: p?.hsn_sac || ''
            }
          : line
      )
    );
  }

  async function create() {
    if (
      !ctx ||
      !customer ||
      !locationId ||
      !lines.length ||
      lines.some((line) => !line.description.trim() || Number(line.quantity) <= 0)
    ) {
      return;
    }

    setBusy(true);
    setError('');
    const r = await supabase.rpc('create_delivery_challan', {
      p_business_id: ctx.business_id,
      p_customer_id: customer,
      p_challan_date: date,
      p_location_id: locationId,
      p_items: lines.map((line) => ({
        ...line,
        quantity: Number(line.quantity),
        unit_price: Number(line.unit_price)
      })),
      p_transporter_name: transporter || null,
      p_vehicle_number: vehicle || null,
      p_eway_bill_number: eway || null
    });

    if (r.error) {
      setError(r.error.message);
    } else {
      setNotice({ text: 'Delivery challan created and stock dispatched.' });
      setLines([blank()]);
      setCustomer('');
      await load();
    }
    setBusy(false);
  }

  function askConvert(row: ChallanRow) {
    if (!['dispatched', 'delivered'].includes(row.status) || row.converted_invoice_id) return;
    setConfirmRow(row);
  }

  async function convert() {
    if (!ctx || !confirmRow) return;
    setConvertingId(confirmRow.id);
    setError('');
    const row = confirmRow;

    const { data, error: rpcError } = await supabase.rpc('convert_delivery_challan_to_invoice', {
      p_business_id: ctx.business_id,
      p_challan_id: row.id
    });

    if (rpcError) {
      setError(rpcError.message);
    } else {
      const result = data as ConversionResult;
      setNotice({
        text: `Invoice ${result.invoice_number} created —`,
        invoiceId: result.invoice_id,
        invoiceNumber: result.invoice_number
      });
      setConfirmRow(null);
      await load();
    }
    setConvertingId(null);
  }

  return (
    <main className="min-h-screen bg-slate-50 p-4 sm:p-7">
      <div className="mx-auto max-w-7xl">
        <PageHeader breadcrumbs={[{label:'Workspace',href:'/next-workspace'},{label:'Sales & billing'},{label:'Delivery Challans'}]} title="Delivery Challans" subtitle="Dispatch physical stock without creating tax liability." badge={{label:'Physical operations',variant:'treasury'}} actions={<button type="button" className="rounded-xl border border-finops-neutral-border bg-white px-4 py-2 text-sm" onClick={() => { window.location.href = '/next-workspace'; }}>Back</button>}/>

        {error && <div className="mb-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
        {notice.text && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">
            <span>{notice.text}</span>
            {notice.invoiceId && (
              <a
                href={'/next-workspace/documents?type=invoice&id=' + notice.invoiceId}
                className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-bold text-white"
              >
                View Invoice {notice.invoiceNumber}
              </a>
            )}
          </div>
        )}

        <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
          <section className="rounded-2xl border bg-white p-5">
            <h2 className="font-semibold">New delivery challan</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <select
                className="rounded-xl border p-3 text-sm"
                value={customer}
                onChange={(e) => setCustomer(e.target.value)}
              >
                <option value="">Select customer…</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.display_name}
                  </option>
                ))}
              </select>
              <input
                type="date"
                className="rounded-xl border p-3 text-sm"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
              <select
                className="rounded-xl border p-3 text-sm"
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
              >
                <option value="">Stock location…</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
              <input
                className="rounded-xl border p-3 text-sm"
                placeholder="Transporter"
                value={transporter}
                onChange={(e) => setTransporter(e.target.value)}
              />
              <input
                className="rounded-xl border p-3 text-sm"
                placeholder="Vehicle number"
                value={vehicle}
                onChange={(e) => setVehicle(e.target.value)}
              />
              <input
                className="rounded-xl border p-3 text-sm"
                placeholder="E-way bill number"
                value={eway}
                onChange={(e) => setEway(e.target.value)}
              />
            </div>

            <div className="mt-5 space-y-2">
              {lines.map((line, i) => (
                <div
                  key={i}
                  className="grid gap-2 rounded-xl border p-3 md:grid-cols-[1.7fr_.6fr_.8fr_.8fr_32px]"
                >
                  <select
                    className="rounded-lg border p-2 text-sm"
                    value={line.product_service_id}
                    onChange={(e) => choose(i, e.target.value)}
                  >
                    <option value="">Select product…</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                        {p.sku ? ' · ' + p.sku : ''}
                      </option>
                    ))}
                  </select>
                  <input
                    className="rounded-lg border p-2 text-sm"
                    placeholder="Qty"
                    type="number"
                    min="0.01"
                    value={line.quantity}
                    onChange={(e) =>
                      setLines((current) =>
                        current.map((x, n) => (n === i ? { ...x, quantity: e.target.value } : x))
                      )
                    }
                  />
                  <input
                    className="rounded-lg border p-2 text-sm"
                    placeholder="Rate"
                    type="number"
                    min="0"
                    value={line.unit_price}
                    onChange={(e) =>
                      setLines((current) =>
                        current.map((x, n) => (n === i ? { ...x, unit_price: e.target.value } : x))
                      )
                    }
                  />
                  <input
                    className="rounded-lg border p-2 text-sm"
                    placeholder="Batch / serial"
                    value={line.batch_number || line.serial_number}
                    onChange={(e) =>
                      setLines((current) =>
                        current.map((x, n) => (n === i ? { ...x, batch_number: e.target.value } : x))
                      )
                    }
                  />
                  <button
                    type="button"
                    className="rounded-lg border text-slate-500"
                    onClick={() => setLines((current) => current.filter((_, n) => n !== i))}
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="rounded-lg border px-3 py-2 text-xs font-semibold"
                onClick={() => setLines((current) => [...current, blank()])}
              >
                + Add item
              </button>
            </div>

            <div className="mt-5 flex items-center justify-between border-t pt-4">
              <b>Total value ₹{total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</b>
              <button
                type="button"
                disabled={busy || !customer || !locationId}
                onClick={() => void create()}
                className="rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
              >
                {busy ? 'Creating…' : 'Dispatch challan'}
              </button>
            </div>
          </section>

          <section className="rounded-2xl border bg-white p-5">
            <h2 className="font-semibold">Recent challans</h2>
            <div className="mt-3 space-y-2">
              {rows.map((row) => {
                const eligible = ['dispatched', 'delivered'].includes(row.status) && !row.converted_invoice_id;
                return (
                  <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3 text-sm">
                    <div>
                      <b>{row.challan_number}</b>
                      <span className="ml-2 text-xs text-slate-500">
                        {row.customers?.display_name || 'Customer'} · {row.challan_date}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold uppercase">
                        {row.status}
                      </span>
                      <button
                        type="button"
                        className="rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1.5 text-[10px] font-semibold text-violet-700 hover:bg-violet-100"
                        onClick={() =>
                          (window.location.href =
                            '/next-workspace/documents?type=delivery_challan&id=' + row.id)
                        }
                      >
                        View / Print
                      </button>
                      {eligible && (
                        <button
                          type="button"
                          disabled={convertingId === row.id}
                          className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                          onClick={() => askConvert(row)}
                        >
                          {convertingId === row.id ? 'Converting…' : 'Convert to Tax Invoice'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
              {!rows.length && <p className="py-8 text-center text-sm text-slate-400">No delivery challans yet.</p>}
            </div>
          </section>
        </div>
      </div>

      {confirmRow && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-4">
          <div className="w-full max-w-md rounded-2xl border bg-white p-5 shadow-2xl">
            <h2 className="text-lg font-semibold">Convert {confirmRow.challan_number} to Tax Invoice?</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              This creates the tax invoice from the dispatched challan. The dispatched quantities are already
              reflected in stock, so this conversion will <b>not re-deduct inventory</b>.
            </p>
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              Invoice creation and challan conversion are atomic. A second conversion is blocked by the
              challan lock and conversion marker.
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-xl border bg-white px-4 py-2 text-sm"
                onClick={() => setConfirmRow(null)}
                disabled={convertingId === confirmRow.id}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                onClick={() => void convert()}
                disabled={convertingId === confirmRow.id}
              >
                {convertingId === confirmRow.id ? 'Converting…' : 'Confirm & Create Tax Invoice'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
