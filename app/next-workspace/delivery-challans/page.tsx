'use client';

import { FormInput as MMFormInputControl, FormSelect as MMFormSelectControl } from '@/components/moneymatters/ui';
import { useEffect, useMemo, useState } from 'react';
import { supabase, type BusinessContext } from '@/lib/supabase';
import { PageHeader } from '@/components/ui/finops/PageHeader';
import { StatCard } from '@/components/ui/finops/StatCard';
import { formatMoney } from '@/lib/i18n';
import ItemServiceModal from '../invoices/new/ItemServiceModal';

type Customer = { id: string; display_name: string };
type BusinessTaxProfile = { gstin: string | null; tax_regime: string | null; gst_registration_type: string | null };
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
  eway_bill_number: string | null;
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
  const [taxProfile, setTaxProfile] = useState<BusinessTaxProfile | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [locations, setLocations] = useState<Array<{ id: string; name: string; is_default: boolean }>>([]);
  const [rows, setRows] = useState<ChallanRow[]>([]);
  const [customer, setCustomer] = useState('');
  const [locationId, setLocationId] = useState('');
  const [showItemModal, setShowItemModal] = useState(false);
  const [showChallanModal, setShowChallanModal] = useState(false);
  const [locationBusy, setLocationBusy] = useState(false);
  const [date, setDate] = useState(today());
  const [transporter, setTransporter] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [lines, setLines] = useState<Line[]>([blank()]);
  const [busy, setBusy] = useState(false);
  const [convertingId, setConvertingId] = useState<string | null>(null);
  const [confirmRow, setConfirmRow] = useState<ChallanRow | null>(null);
  const [ewayTarget, setEwayTarget] = useState<ChallanRow | null>(null);
  const [ewayValue, setEwayValue] = useState('');
  const [ewaySaving, setEwaySaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<{ text: string; invoiceId?: string; invoiceNumber?: string }>({
    text: ''
  });

  async function load() {
    const c = await supabase.rpc('get_my_business_context');
    const b = (c.data || [])[0] as BusinessContext | undefined;
    if (!b) return;
    setCtx(b);

    const [cu, pr, lo, dc, tax] = await Promise.all([
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
          'id,challan_number,challan_date,status,total,customer_id,converted_invoice_id,eway_bill_number,customers!delivery_challans_customer_id_fkey(display_name)'
        )
        .eq('business_id', b.business_id)
        .order('challan_date', { ascending: false })
        .limit(50),
      supabase.rpc('get_delivery_challan_eway_tax_profile', { p_business_id: b.business_id })
    ]);

    if (cu.error) setError(cu.error.message);
    if (pr.error) setError(pr.error.message);
    if (lo.error) setError(lo.error.message);
    if (dc.error) setError(dc.error.message);

    setCustomers(cu.data || []);
    setProducts(pr.data || []);
    setLocations(lo.data || []);
    setRows((dc.data || []) as unknown as ChallanRow[]);
    setTaxProfile((tax.data || null) as BusinessTaxProfile | null);
    if (tax.error) setError('Could not verify the business GST profile: ' + tax.error.message);

    if (!locationId && lo.data?.length) {
      setLocationId((lo.data.find((x) => x.is_default) || lo.data[0]).id);
    }
  }

  async function addLocation() {
    if (!ctx || locationBusy) return;
    const name = window.prompt('Stock location name', locations.length ? '' : 'Main Store');
    if (!name?.trim()) return;
    setLocationBusy(true);
    setError('');
    try {
      const { data, error: locationError } = await supabase.from('inventory_locations').insert({
        business_id: ctx.business_id,
        name: name.trim(),
        is_default: locations.length === 0,
        is_active: true,
        address: {}
      }).select('id,name,is_default').single();
      if (locationError) { setError(locationError.message); return; }
      if (!data) { setError('The stock location was not returned after creation.'); return; }
      setLocations((current) => [...current, data].sort((a, b) => a.name.localeCompare(b.name)));
      setLocationId(data.id);
      setNotice({ text: 'Stock location "' + data.name + '" created.' });
    } catch (locationError) {
      setError(locationError instanceof Error ? locationError.message : 'Could not create the stock location.');
    } finally {
      setLocationBusy(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const total = useMemo(
    () => lines.reduce((sum, line) => sum + Number(line.quantity || 0) * Number(line.unit_price || 0), 0),
    [lines]
  );
  const gstin = String(taxProfile?.gstin || '').trim().toUpperCase();
  const registrationType = String(taxProfile?.gst_registration_type || '').trim().toUpperCase();
  const isGstRegistered = String(taxProfile?.tax_regime || '').trim().toUpperCase() === 'GST'
    && ['REGULAR', 'CASUAL', 'NON_RESIDENT', 'SEZ', 'COMPOSITION'].includes(registrationType)
    && /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/.test(gstin);

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
      p_eway_bill_number: null
    });

    if (r.error) {
      setError(r.error.message);
    } else {
      setNotice({ text: 'Delivery challan created and stock dispatched. Use the E-way Bill action in Recent Challans to record a bill after generating it for this challan number, if required.' });
      setLines([blank()]);
      setCustomer('');
      setTransporter('');
      setVehicle('');
      setDate(today());
      setShowChallanModal(false);
      await load();
    }
    setBusy(false);
  }

  function editEwayBill(row: ChallanRow) {
    setError('');
    setEwayTarget(row);
    setEwayValue(String(row.eway_bill_number || '').trim());
  }

  async function saveEwayBill() {
    if (!ctx || !ewayTarget || ewaySaving) return;
    const billNumber = ewayValue.trim();
    if (!/^[0-9]{12}$/.test(billNumber)) {
      setError('E-way Bill Number must contain exactly 12 digits.');
      return;
    }
    setEwaySaving(true);
    setError('');
    try {
      const { data, error: rpcError } = await supabase.rpc('record_delivery_challan_eway_bill', {
        p_business_id: ctx.business_id,
        p_challan_id: ewayTarget.id,
        p_eway_bill_number: billNumber
      });
      if (rpcError) {
        setError(rpcError.message);
        return;
      }
      const result = data as { success?: boolean; changed?: boolean; challan_number?: string; eway_bill_number?: string };
      setNotice({
        text: result.changed === false
          ? 'E-way Bill ' + billNumber + ' is already recorded for ' + ewayTarget.challan_number + '.'
          : 'E-way Bill ' + billNumber + ' recorded for ' + (result.challan_number || ewayTarget.challan_number) + '.'
      });
      setEwayTarget(null);
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not record the E-way Bill.');
    } finally {
      setEwaySaving(false);
    }
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
        <PageHeader breadcrumbs={[{label:'Workspace',href:'/next-workspace'},{label:'Sales & billing'},{label:'Delivery Challans'}]} title="Delivery Challans" subtitle="Rule 55 goods transport, approval dispatch, and delivery tracking" badge={{label:'LOGISTICS & DISPATCH',variant:'inflow'}} actions={<div className="flex flex-wrap items-center gap-2"><button type="button" className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-violet-700" onClick={() => { setError(''); setShowChallanModal(true); }}><span aria-hidden="true">＋</span> New Challan</button><button type="button" className="rounded-xl border border-finops-neutral-border bg-white px-4 py-2 text-sm" onClick={() => { window.location.href = '/next-workspace'; }}>Back</button></div>}/>

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

        <section className="mb-5 grid gap-3 sm:grid-cols-3">
          <StatCard title="Dispatched" value={String(rows.filter((row) => ['dispatched', 'delivered'].includes(String(row.status).toLowerCase())).length)} tone="inflow" className="min-h-[104px] p-4" />
          <StatCard title="Awaiting Invoicing" value={String(rows.filter((row) => ['dispatched', 'delivered'].includes(String(row.status).toLowerCase()) && !row.converted_invoice_id).length)} tone="pending" className="min-h-[104px] p-4" />
          <StatCard title="Returned" value={String(rows.filter((row) => String(row.status).toLowerCase() === 'returned').length)} tone="neutral" className="min-h-[104px] p-4" />
        </section>
        <div className="space-y-5">
          {showChallanModal && (
            <div className="fixed inset-0 z-[60] flex items-center justify-center overflow-x-hidden overflow-y-auto bg-slate-950/55 p-3 sm:p-6" role="dialog" aria-modal="true" aria-labelledby="new-challan-modal-title" tabIndex={-1} onKeyDown={(event) => { if (event.key === 'Escape' && !busy) setShowChallanModal(false); }} onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setShowChallanModal(false); }}>
              <section className="max-h-[calc(100dvh-2rem)] w-[calc(100vw-1.5rem)] max-w-5xl min-w-0 overflow-x-hidden overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl sm:p-6">
                <div className="-mx-4 -mt-4 mb-5 flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-4 py-4 sm:-mx-6 sm:-mt-6 sm:px-6">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-violet-700">Logistics & dispatch</p>
                    <h2 id="new-challan-modal-title" className="mt-1 text-lg font-semibold text-slate-950 sm:text-xl">New delivery challan</h2>
                    <p className="mt-1 text-xs text-slate-500">Enter dispatch details and items, then create the challan.</p>
                  </div>
                  <button type="button" aria-label="Close new delivery challan" className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-xl text-slate-500 hover:bg-slate-50 disabled:opacity-50" onClick={() => setShowChallanModal(false)} disabled={busy}>×</button>
                </div>
                {error && <div role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
            <div className="mt-4 grid min-w-0 grid-cols-1 gap-x-4 gap-y-4 md:grid-cols-2">
              <label className="block min-w-0">
                <span className="mb-1.5 block text-xs font-semibold text-slate-700">Customer <span className="text-rose-500">*</span></span>
                <MMFormSelectControl
                  aria-label="Customer"
                  className="mt-1 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-800 shadow-sm outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                  value={customer}
                  onChange={(e) => setCustomer(e.target.value)}
                >
                  <option value="">Select customer…</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.display_name}
                    </option>
                  ))}
                </MMFormSelectControl>
              </label>

              <label className="block min-w-0">
                <span className="mb-1.5 block text-xs font-semibold text-slate-700">Challan date <span className="text-rose-500">*</span></span>
                <MMFormInputControl
                  aria-label="Challan date"
                  type="date"
                  className="mt-1 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-800 shadow-sm outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </label>

              <div className="min-w-0">
                <label htmlFor="delivery-challan-stock-location" className="mb-1.5 block text-xs font-semibold text-slate-700">
                  Stock location <span className="text-rose-500">*</span>
                </label>
                <div className="flex min-w-0 items-stretch gap-2">
                  <MMFormSelectControl
                    id="delivery-challan-stock-location"
                    aria-label="Stock location"
                    className="mt-1 w-full min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-800 shadow-sm outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                    value={locationId}
                    onChange={(e) => setLocationId(e.target.value)}
                  >
                    <option value="">Select stock location…</option>
                    {locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </MMFormSelectControl>
                  <button
                    type="button"
                    className="mt-1 inline-flex min-h-[46px] shrink-0 items-center justify-center gap-1 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-violet-200 hover:bg-violet-50 hover:text-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 disabled:opacity-50"
                    onClick={() => void addLocation()}
                    disabled={locationBusy || !ctx}
                    title="Create a stock location"
                  >
                    <span aria-hidden="true" className="text-base leading-none">＋</span>
                    {locationBusy ? 'Saving…' : 'Location'}
                  </button>
                </div>
              </div>

              <label className="block min-w-0">
                <span className="mb-1.5 block text-xs font-semibold text-slate-700">Transporter <span className="font-normal text-slate-400">(optional)</span></span>
                <MMFormInputControl
                  aria-label="Transporter"
                  className="mt-1 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-800 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                  placeholder="Transporter name"
                  value={transporter}
                  onChange={(e) => setTransporter(e.target.value)}
                />
              </label>

              <label className="block min-w-0 md:col-span-2">
                <span className="mb-1.5 block text-xs font-semibold text-slate-700">Vehicle number <span className="font-normal text-slate-400">(optional)</span></span>
                <MMFormInputControl
                  aria-label="Vehicle number"
                  className="mt-1 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-800 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                  placeholder="Vehicle registration number"
                  value={vehicle}
                  onChange={(e) => setVehicle(e.target.value)}
                />
              </label>

              {isGstRegistered ? (
                <div className="md:col-span-2 rounded-xl border border-violet-200 bg-violet-50 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-violet-900">GST e-Way Bill</p>
                      <p className="mt-1 text-xs leading-5 text-violet-800">GST registration and GSTIN format are present in this business tax profile. Create the challan first so the generated challan number is available, then record the official 12-digit e-way bill from Recent Challans when legally required.</p>
                    </div>
                    <a href="https://ewaybillgst.gov.in/" target="_blank" rel="noopener noreferrer" className="shrink-0 rounded-lg border border-violet-300 bg-white px-3 py-2 text-xs font-semibold text-violet-800 hover:bg-violet-100">Open official portal ↗</a>
                  </div>
                  <p className="mt-2 text-[11px] leading-4 text-violet-700">The application records and audits a bill generated on the official portal. Direct government generation/update/cancellation requires a configured authorized GSP/API provider and is not represented as active yet.</p>
                </div>
              ) : (
                <div className="md:col-span-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-600">
                  <b>e-Way Bill availability</b>
                  <p className="mt-1">Configure a valid GST registration in Business Settings to enable the e-way bill action. Whether a bill is required depends on the movement, value, and applicable exemptions—not GST registration alone.</p>
                </div>
              )}
            </div>

            <section className="mt-6 min-w-0" aria-labelledby="challan-items-heading">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 id="challan-items-heading" className="text-sm font-bold text-slate-900">Items & quantities</h3>
                  <p className="mt-0.5 text-xs text-slate-500">Select a product, set its quantity and rate, then add batch details if needed.</p>
                </div>
                <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-600">{lines.length} {lines.length === 1 ? 'item' : 'items'}</span>
              </div>

              <div className="space-y-3">
                {lines.map((line, i) => (
                  <section
                    key={i}
                    className="group min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-colors hover:border-slate-300 focus-within:border-violet-300 focus-within:ring-2 focus-within:ring-violet-100"
                    aria-label={`Challan item ${i + 1}`}
                  >
                    <div className="flex min-w-0 items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/80 px-3 py-2.5 sm:px-4">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-xs font-bold text-violet-700">{String(i + 1).padStart(2, '0')}</span>
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-slate-800">Item {i + 1}</p>
                          <p className="truncate text-[11px] text-slate-500">{line.description.trim() || 'Choose a product below'}</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        aria-label={`Remove item ${i + 1}`}
                        title={`Remove item ${i + 1}`}
                        className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-transparent px-2.5 text-xs font-semibold text-slate-500 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 disabled:cursor-not-allowed disabled:opacity-40"
                        onClick={() => setLines((current) => current.filter((_, n) => n !== i))}
                        disabled={lines.length === 1}
                      >
                        <span aria-hidden="true" className="text-base leading-none">×</span>
                        <span>Remove</span>
                      </button>
                    </div>

                    <div className="grid min-w-0 grid-cols-1 gap-3 p-3 sm:grid-cols-2 sm:p-4 lg:grid-cols-[minmax(0,1.8fr)_minmax(100px,.65fr)_minmax(125px,.8fr)_minmax(150px,1fr)]">
                      <label className="block min-w-0">
                        <span className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold text-slate-600">Product <span className="text-rose-500">*</span></span>
                        <MMFormSelectControl
                          aria-label={`Product for item ${i + 1}`}
                          className="w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 shadow-sm outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
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
                        </MMFormSelectControl>
                      </label>

                      <label className="block min-w-0">
                        <span className="mb-1.5 block text-[11px] font-semibold text-slate-600">Quantity <span className="text-rose-500">*</span></span>
                        <MMFormInputControl
                          aria-label={`Quantity for item ${i + 1}`}
                          className="w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm tabular-nums text-slate-800 shadow-sm outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                          placeholder="e.g. 1"
                          type="number"
                          inputMode="decimal"
                          min="0.01"
                          step="any"
                          value={line.quantity}
                          onChange={(e) =>
                            setLines((current) =>
                              current.map((x, n) => (n === i ? { ...x, quantity: e.target.value } : x))
                            )
                          }
                        />
                      </label>

                      <label className="block min-w-0">
                        <span className="mb-1.5 block text-[11px] font-semibold text-slate-600">Rate per unit</span>
                        <MMFormInputControl
                          aria-label={`Rate per unit for item ${i + 1}`}
                          className="w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm tabular-nums text-slate-800 shadow-sm outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                          placeholder="0.00"
                          type="number"
                          inputMode="decimal"
                          min="0"
                          step="any"
                          value={line.unit_price}
                          onChange={(e) =>
                            setLines((current) =>
                              current.map((x, n) => (n === i ? { ...x, unit_price: e.target.value } : x))
                            )
                          }
                        />
                      </label>

                      <label className="block min-w-0 sm:col-span-2 lg:col-span-1">
                        <span className="mb-1.5 block text-[11px] font-semibold text-slate-600">Batch / serial <span className="font-normal text-slate-400">(optional)</span></span>
                        <MMFormInputControl
                          aria-label={`Batch or serial number for item ${i + 1}`}
                          className="w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 shadow-sm outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                          placeholder="Enter batch or serial"
                          value={line.batch_number || line.serial_number}
                          onChange={(e) =>
                            setLines((current) =>
                              current.map((x, n) => (n === i ? { ...x, batch_number: e.target.value } : x))
                            )
                          }
                        />
                      </label>
                    </div>

                    <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/60 px-3 py-2.5 sm:px-4">
                      <span className="text-[11px] text-slate-500">Line amount <span className="mx-1 text-slate-300">·</span> {line.quantity || '0'} × {formatMoney(Number(line.unit_price || 0), ctx?.currency_code || 'INR')}</span>
                      <span className="text-sm font-bold tabular-nums text-slate-900">{formatMoney(Number(line.quantity || 0) * Number(line.unit_price || 0), ctx?.currency_code || 'INR')}</span>
                    </div>
                  </section>
                ))}
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-3.5 py-2 text-xs font-semibold text-violet-700 transition hover:border-violet-300 hover:bg-violet-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
                  onClick={() => setShowItemModal(true)}
                  disabled={!ctx}
                >
                  <span aria-hidden="true" className="text-base leading-none">＋</span> Create product
                </button>
                <button
                  type="button"
                  className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
                  onClick={() => setLines((current) => [...current, blank()])}
                >
                  <span aria-hidden="true" className="text-base leading-none">＋</span> Add another item
                </button>
              </div>
            </section>

            <div className="sticky bottom-0 z-10 mt-5 flex flex-col gap-3 border-t border-slate-200 bg-white/95 pt-4 pb-1 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
              <b>Total value {formatMoney(total, ctx?.currency_code || 'INR')}</b>
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
            </div>
          )}

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-semibold text-slate-950">Recent Challans</h2>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{rows.length} total</span>
                </div>
                <p className="mt-1 text-xs text-slate-500">Dispatch history, e-Way Bill references, and invoice conversion</p>
              </div>
            </div>
            <div className="mt-1 divide-y divide-slate-100">
              {rows.map((row) => {
                const eligible = ['dispatched', 'delivered'].includes(row.status) && !row.converted_invoice_id;
                return (
                  <div key={row.id} className="grid min-w-0 gap-3 py-4 first:pt-3 last:pb-1 md:grid-cols-[minmax(0,1.4fr)_minmax(120px,.55fr)_minmax(260px,1.25fr)] md:items-center">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <b className="break-words text-sm text-slate-900">{row.challan_number}</b>
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold uppercase text-slate-600">{row.status}</span>
                      </div>
                      <p className="mt-1 break-words text-xs text-slate-500">{row.customers?.display_name || 'Customer'} · {row.challan_date}</p>
                      {row.eway_bill_number && <p className="mt-1 break-words text-xs font-medium text-violet-700">E-way Bill: {row.eway_bill_number}</p>}
                    </div>
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Declared value</p>
                      <p className="mt-1 text-sm font-bold tabular-nums text-slate-900">{formatMoney(Number(row.total || 0), ctx?.currency_code || 'INR')}</p>
                      {row.converted_invoice_id && <p className="mt-1 text-[11px] text-emerald-700">Converted to invoice</p>}
                    </div>
                    <div className="flex min-w-0 flex-wrap items-center gap-2 md:justify-end">
                      {isGstRegistered && row.status !== 'cancelled' && (
                        <button
                          type="button"
                          className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-semibold text-violet-700 hover:bg-violet-100"
                          onClick={() => editEwayBill(row)}
                        >
                          {row.eway_bill_number ? 'Update E-way Bill' : 'Record E-way Bill'}
                        </button>
                      )}
                      <button
                        type="button"
                        className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-semibold text-violet-700 hover:bg-violet-100"
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
                          className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                          onClick={() => askConvert(row)}
                        >
                          {convertingId === row.id ? 'Converting…' : 'Convert to Tax Invoice'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
              {!rows.length && <div className="py-12 text-center">
                <p className="text-sm font-semibold text-slate-700">No delivery challans yet</p>
                <p className="mt-1 text-xs text-slate-500">Create a challan to track dispatches and convert eligible deliveries to invoices.</p>
                <button type="button" className="mt-4 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-700" onClick={() => { setError(''); setShowChallanModal(true); }}>Create first challan</button>
              </div>}
            </div>
          </section>
        </div>
      </div>

      {ewayTarget && (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/50 p-4" role="dialog" aria-modal="true" aria-labelledby="eway-modal-title">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="eway-modal-title" className="text-lg font-semibold text-slate-950">{ewayTarget.eway_bill_number ? 'Update E-way Bill' : 'Record E-way Bill'}</h2>
                <p className="mt-1 text-sm text-slate-600">Delivery Challan <b>{ewayTarget.challan_number}</b> · {ewayTarget.challan_date}</p>
              </div>
              <button type="button" className="rounded-lg border px-2 py-1 text-slate-500" onClick={() => setEwayTarget(null)} disabled={ewaySaving} aria-label="Close E-way Bill dialog">×</button>
            </div>
            <p className="mt-3 text-xs leading-5 text-slate-600">Generate or retrieve the bill for this exact challan on the official GST portal, then enter its 12-digit number. Saving updates the number stored in Money Matters and writes an audit event; it does not submit a generation request.</p>
            {ewayTarget.eway_bill_number && <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">Changing this number does not update or cancel the previous bill on the government portal. Complete any required official update or cancellation first.</p>}
            <a href="https://ewaybillgst.gov.in/" target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-semibold text-violet-800 hover:bg-violet-100">Open official e-Way Bill portal ↗</a>
            {error && <p role="alert" className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs leading-5 text-rose-800">{error}</p>}
            <label className="mt-4 block text-xs font-semibold text-slate-700" htmlFor="delivery-challan-eway-number">E-way Bill Number</label>
            <MMFormInputControl
              id="delivery-challan-eway-number"
              className="mt-1 w-full rounded-xl border border-slate-200 p-3 text-sm"
              placeholder="Enter 12-digit bill number"
              value={ewayValue}
              inputMode="numeric"
              maxLength={12}
              onChange={(e) => setEwayValue(e.target.value.replace(/[^0-9]/g, '').slice(0, 12))}
              disabled={ewaySaving}
            />
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="rounded-xl border px-4 py-2 text-sm" onClick={() => setEwayTarget(null)} disabled={ewaySaving}>Cancel</button>
              <button type="button" className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" onClick={() => void saveEwayBill()} disabled={ewaySaving || !/^[0-9]{12}$/.test(ewayValue.trim())}>{ewaySaving ? 'Saving…' : 'Save E-way Bill'}</button>
            </div>
          </div>
        </div>
      )}

      {ctx && (
        <ItemServiceModal
          modalLayerClassName="z-[80]"
          open={showItemModal}
          businessId={ctx.business_id}
          currencyCode={ctx.currency_code}
          initialItemType="product"
          productOnly
          onClose={() => setShowItemModal(false)}
          onCreated={(item) => {
            const createdProduct: Product = { id: item.id, name: item.name, sku: item.sku, unit: item.unit, hsn_sac: item.hsn_sac || null, sales_price: Number(item.sales_price || 0), inventory_tracked: Boolean(item.inventory_tracked) };
            setProducts((current) => [...current.filter((product) => product.id !== createdProduct.id), createdProduct].sort((a, b) => a.name.localeCompare(b.name)));
            setLines((current) => {
              const selectedLine: Line = { ...blank(), product_service_id: createdProduct.id, description: createdProduct.name, unit: createdProduct.unit || '', unit_price: String(createdProduct.sales_price || 0), hsn_sac: createdProduct.hsn_sac || '' };
              const emptyIndex = current.findIndex((line) => !line.product_service_id && !line.description.trim());
              return emptyIndex < 0 ? [...current, selectedLine] : current.map((line, index) => index === emptyIndex ? selectedLine : line);
            });
            setNotice({ text: 'Product "' + createdProduct.name + '" created and added to this challan.' });
          }}
        />
      )}

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
