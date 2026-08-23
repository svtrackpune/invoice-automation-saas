'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase, type BusinessContext } from '@/lib/supabase';
import ItemServiceModal from './ItemServiceModal';
import CustomerCreateModal from '../../customers/CustomerCreateModal';
import type { CreatedCustomer } from '../../customers/CustomerCreateModal';

type Customer = {
  id: string; display_name: string; legal_name: string | null; email: string | null; phone: string | null;
  payment_terms_days: number; payment_reminders_enabled: boolean; reminder_days_before_due: number;
  default_discount_type: string; default_discount_value: number; billing_address: any; shipping_address: any;
};
type Product = {
  id: string; name: string; sku: string | null; description: string | null; item_type: string; unit: string | null;
  sales_price: number; default_tax_rate_id: string | null; discount_enabled: boolean; max_discount_type: string; max_discount_value: number;
};
type Tax = { id: string; name: string; rate: number };
type Template = { id: string; template_name: string };
type Line = { product_service_id: string; description: string; quantity: number; unit_price: number; discount_type: string; discount_value: number; tax_rate_id: string };
type TaxProfile = { tax_regime: string | null; gst_registration_type: string | null };
type DocumentDefaults = { invoice_due_days: number; invoice_notes: string | null; default_payment_terms: string | null; invoice_template_id: string | null };

const money = (n: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(n || 0));
const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (n: number) => new Date(Date.now() + Math.max(0, n) * 86400000).toISOString().slice(0, 10);
const normalizeDiscountType = (value: string | null | undefined) => value === 'percent' ? 'percentage' : value === 'amount' ? 'amount' : value === 'percentage' ? 'percentage' : '';

function Input(p: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...p} className={`w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 ${p.className || ''}`} />;
}
function Select(p: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...p} className={`w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 ${p.className || ''}`} />;
}
function Button({ children, onClick, secondary = false, disabled = false }: { children: React.ReactNode; onClick?: () => void; secondary?: boolean; disabled?: boolean }) {
  return <button type="button" disabled={disabled} onClick={onClick} className={`rounded-xl px-4 py-2.5 text-sm font-semibold disabled:opacity-50 ${secondary ? 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50' : 'bg-violet-600 text-white hover:bg-violet-700'}`}>{children}</button>;
}
function Field({ label, children, wide = false, required = false, help }: { label: string; children: React.ReactNode; wide?: boolean; required?: boolean; help?: string }) {
  return <label className={`${wide ? 'sm:col-span-2 ' : ''} block text-xs font-semibold text-slate-600`}>{label}{required ? ' *' : ''}<div className="mt-1">{children}</div>{help && <p className="mt-1 text-[11px] font-normal text-slate-400">{help}</p>}</label>;
}
function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-3xl border border-slate-200 bg-white shadow-sm ${className}`}>{children}</section>;
}

export default function NewInvoice() {
  const editId = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('edit') : null;
  const [ctx, setCtx] = useState<BusinessContext | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [taxes, setTaxes] = useState<Tax[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [taxProfile, setTaxProfile] = useState<TaxProfile>({ tax_regime: 'NONE', gst_registration_type: 'NONE' });
  const [defaults, setDefaults] = useState<DocumentDefaults>({ invoice_due_days: 0, invoice_notes: '', default_payment_terms: '', invoice_template_id: null });
  const [customerId, setCustomerId] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(today());
  const [dueDate, setDueDate] = useState(today());
  const [lines, setLines] = useState<Line[]>([]);
  const [discountType, setDiscountType] = useState('');
  const [discountValue, setDiscountValue] = useState(0);
  const [notes, setNotes] = useState('');
  const [terms, setTerms] = useState('');
  const [template, setTemplate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [customerFormOpen, setCustomerFormOpen] = useState(false);
  const [itemFormOpen, setItemFormOpen] = useState(false);
  const [editLoaded, setEditLoaded] = useState(!editId);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const contextResult = await supabase.rpc('get_my_business_context');
      const business = contextResult.data?.[0] as BusinessContext | undefined;
      if (!business) { location.href = '/'; return; }
      if (!mounted) return;
      setCtx(business);

      const [cs, ps, ts, tp, ds, dp, tm] = await Promise.all([
        supabase.from('customers').select('id,display_name,legal_name,email,phone,payment_terms_days,payment_reminders_enabled,reminder_days_before_due,default_discount_type,default_discount_value,billing_address,shipping_address').eq('business_id', business.business_id).eq('is_active', true).order('display_name'),
        supabase.from('products_services').select('id,name,sku,description,item_type,unit,sales_price,default_tax_rate_id,discount_enabled,max_discount_type,max_discount_value').eq('business_id', business.business_id).eq('is_active', true).eq('sell_enabled', true).order('name'),
        supabase.from('tax_rates').select('id,name,rate').eq('business_id', business.business_id).eq('is_active', true).order('rate'),
        supabase.from('business_tax_profiles').select('tax_regime,gst_registration_type').eq('business_id', business.business_id).maybeSingle(),
        supabase.from('business_settings').select('invoice_due_days,invoice_notes,default_payment_terms').eq('business_id', business.business_id).maybeSingle(),
        supabase.from('business_document_preferences').select('template_id').eq('business_id', business.business_id).eq('document_type', 'invoice').maybeSingle(),
        supabase.from('document_templates').select('id,template_name').eq('document_type', 'invoice').eq('is_active', true).order('template_name'),
      ]);
      if (!mounted) return;
      setCustomers((cs.data || []) as Customer[]);
      setProducts((ps.data || []) as Product[]);
      setTaxes((ts.data || []) as Tax[]);
      setTaxProfile((tp.data || { tax_regime: 'NONE', gst_registration_type: 'NONE' }) as TaxProfile);
      const d = ds.data || {};
      const documentDefaults: DocumentDefaults = { invoice_due_days: Number(d.invoice_due_days || 0), invoice_notes: d.invoice_notes || '', default_payment_terms: d.default_payment_terms || '', invoice_template_id: dp.data?.template_id || null };
      setDefaults(documentDefaults);
      setDueDate(plusDays(documentDefaults.invoice_due_days));
      setNotes(documentDefaults.invoice_notes || '');
      setTerms(documentDefaults.default_payment_terms || '');
      setTemplate(documentDefaults.invoice_template_id || '');

      if (editId) {
        const [ir, itemsResult] = await Promise.all([
          supabase.from('invoices').select('id,customer_id,invoice_date,due_date,notes,terms,discount_type,discount_value,template_id,status').eq('id', editId).eq('business_id', business.business_id).maybeSingle(),
          supabase.from('invoice_items').select('product_service_id,description,quantity,unit_price,discount_type,discount_value,tax_rate_id').eq('invoice_id', editId).order('sort_order'),
        ]);
        if (ir.error || itemsResult.error) { setError(ir.error?.message || itemsResult.error?.message || 'Unable to load invoice.'); setEditLoaded(true); return; }
        if (!ir.data) { setError('Invoice not found.'); setEditLoaded(true); return; }
        if (ir.data.status !== 'draft') { setError('Only draft invoices can be edited. This invoice has already been posted or paid.'); setEditLoaded(true); return; }
        setCustomerId(ir.data.customer_id || '');
        setInvoiceDate(ir.data.invoice_date || today());
        setDueDate(ir.data.due_date || plusDays(documentDefaults.invoice_due_days));
        setNotes(ir.data.notes || '');
        setTerms(ir.data.terms || documentDefaults.default_payment_terms || '');
        setDiscountType(normalizeDiscountType(ir.data.discount_type));
        setDiscountValue(Number(ir.data.discount_value || 0));
        setTemplate(ir.data.template_id || documentDefaults.invoice_template_id || '');
        setLines((itemsResult.data || []).map((x: any) => ({ product_service_id: x.product_service_id || '', description: x.description || '', quantity: Number(x.quantity || 1), unit_price: Number(x.unit_price || 0), discount_type: normalizeDiscountType(x.discount_type), discount_value: Number(x.discount_value || 0), tax_rate_id: x.tax_rate_id || '' })));
      }
      setEditLoaded(true);
    })();
    return () => { mounted = false; };
  }, [editId]);

  const customer = customers.find(x => x.id === customerId);
  const taxRegime = String(taxProfile.tax_regime || 'NONE').toUpperCase();
  const gstType = String(taxProfile.gst_registration_type || 'NONE').toUpperCase();
  const composition = taxRegime === 'GST' && gstType === 'COMPOSITION';
  const taxEnabled = taxRegime !== 'NONE' && !composition;

  const addLine = () => {
    const p = products[0];
    if (!p) { setItemFormOpen(true); return; }
    setLines(x => [...x, { product_service_id: p.id, description: p.description || p.name, quantity: 1, unit_price: Number(p.sales_price || 0), discount_type: '', discount_value: 0, tax_rate_id: taxEnabled ? (p.default_tax_rate_id || '') : '' }]);
  };
  const changeLine = (i: number, key: keyof Line, value: string | number) => setLines(x => x.map((line, j) => j === i ? { ...line, [key]: value } : line));

  const lineDiscount = (line: Line, product?: Product) => {
    if (!product?.discount_enabled) return 0;
    const base = Number(line.quantity || 0) * Number(line.unit_price || 0);
    let value = line.discount_type === 'percentage' ? base * Number(line.discount_value || 0) / 100 : Number(line.discount_value || 0);
    const maxType = normalizeDiscountType(product.max_discount_type);
    if (Number(product.max_discount_value || 0) > 0) {
      const max = maxType === 'percentage' ? base * Number(product.max_discount_value) / 100 : Number(product.max_discount_value);
      value = Math.min(value, max);
    }
    return Math.max(0, Math.min(base, value));
  };
  const totals = useMemo(() => {
    let subtotal = 0, discount = 0, tax = 0;
    for (const line of lines) {
      const product = products.find(x => x.id === line.product_service_id);
      const base = Number(line.quantity || 0) * Number(line.unit_price || 0);
      const d = lineDiscount(line, product);
      const rate = taxEnabled ? (taxes.find(t => t.id === line.tax_rate_id)?.rate || 0) : 0;
      subtotal += base;
      discount += d;
      tax += (base - d) * rate / 100;
    }
    const invoiceDiscountBase = Math.max(0, subtotal - discount);
    const invoiceDiscount = discountType === 'percentage' ? invoiceDiscountBase * Number(discountValue || 0) / 100 : Number(discountValue || 0);
    const total = Math.max(0, subtotal - discount - Math.min(invoiceDiscountBase, invoiceDiscount) + tax);
    return { subtotal, discount: discount + Math.min(invoiceDiscountBase, Math.max(0, invoiceDiscount)), tax, total };
  }, [lines, products, taxes, discountType, discountValue, taxEnabled]);

  const selectCustomer = (id: string) => {
    setCustomerId(id);
    const c = customers.find(x => x.id === id);
    if (c) {
      setDueDate(plusDays(Number(c.payment_terms_days || defaults.invoice_due_days || 0)));
      setDiscountType(normalizeDiscountType(c.default_discount_type));
      setDiscountValue(Number(c.default_discount_value || 0));
    }
  };
  const onCustomerCreated = (c: CreatedCustomer) => {
    setCustomers(x => [...x, c as Customer].sort((a, b) => a.display_name.localeCompare(b.display_name)));
    setCustomerId(c.id);
    setCustomerFormOpen(false);
  };
  const onItemCreated = (item: Product) => {
    setProducts(x => [...x, item].sort((a, b) => a.name.localeCompare(b.name)));
    setLines(x => [...x, { product_service_id: item.id, description: item.description || item.name, quantity: 1, unit_price: Number(item.sales_price || 0), discount_type: '', discount_value: 0, tax_rate_id: taxEnabled ? (item.default_tax_rate_id || '') : '' }]);
    setItemFormOpen(false);
  };

  const saveInvoice = async () => {
    if (!ctx || !customerId || !lines.length || totals.total <= 0) return;
    setBusy(true); setError('');
    const itemPayload = lines.map((l, i) => ({ ...l, tax_rate_id: taxEnabled ? l.tax_rate_id : '', sort_order: i }));
    const r = editId
      ? await supabase.rpc('update_invoice_draft', { p_invoice_id: editId, p_customer_id: customerId, p_invoice_date: invoiceDate, p_due_date: dueDate, p_items: itemPayload, p_invoice_discount_type: discountType || null, p_invoice_discount_value: Number(discountValue || 0), p_notes: notes || null, p_terms: terms || null, p_template_id: template || null })
      : await supabase.rpc('create_invoice_from_items', { p_business_id: ctx.business_id, p_customer_id: customerId, p_invoice_date: invoiceDate, p_due_date: dueDate, p_items: itemPayload, p_invoice_discount_type: discountType || null, p_invoice_discount_value: Number(discountValue || 0), p_notes: notes || null, p_terms: terms || null });
    if (r.error) { setError(r.error.message); setBusy(false); return; }
    if (!editId && template) await supabase.from('invoices').update({ template_id: template }).eq('id', r.data);
    location.href = `/next-workspace/documents?type=invoice&id=${r.data}`;
  };

  if (!ctx || !editLoaded) return <div className="grid min-h-screen place-items-center text-sm text-slate-500">Loading invoice editor…</div>;
  const ruleLabel = composition ? 'Composition GST: tax is not charged separately' : taxEnabled ? `${taxRegime}${gstType !== 'NONE' ? ` · ${gstType}` : ''}: tax fields enabled` : 'Non-tax business: tax fields hidden';

  return <main className="min-h-screen bg-[#fbfaff] p-4 text-slate-950 sm:p-7"><div className="mx-auto max-w-7xl">
    <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-[11px] font-bold uppercase tracking-[.18em] text-violet-600">Sales & payments</p><h1 className="mt-1 text-3xl font-semibold">{editId ? 'Edit Invoice' : 'Create an Invoice'}</h1><p className="mt-1 text-sm text-slate-500">Customer, items, business rules and document defaults stay adaptive to the active business.</p></div><Button secondary onClick={() => location.href = editId ? `/next-workspace/documents?type=invoice&id=${editId}` : '/next-workspace/invoices'}>{editId ? '← Back to invoice' : '← Back to invoices'}</Button></header>
    {error && <div className="mb-5 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
    <div className="mb-5 flex flex-wrap items-center gap-2 rounded-2xl border border-violet-100 bg-violet-50/60 px-4 py-3 text-xs"><span className="font-bold text-violet-800">Business rule</span><span className="text-violet-700">{ruleLabel}</span>{composition && <span className="rounded-full bg-white px-2 py-1 font-semibold text-slate-600">GST composition</span>}</div>
    <div className="grid gap-5 lg:grid-cols-[1fr_340px]"><div className="space-y-5">
      <Card className="p-6"><div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-bold uppercase tracking-wider text-slate-400">Customer</p><h2 className="mt-1 text-xl font-semibold">Bill to</h2></div><Button secondary onClick={() => setCustomerFormOpen(true)}>＋ Create new customer</Button></div><div className="mt-5 grid gap-4 sm:grid-cols-[1fr_auto]"><Select value={customerId} onChange={e => selectCustomer(e.target.value)}><option value="">Select customer…</option>{customers.map(c => <option key={c.id} value={c.id}>{c.display_name}{c.phone ? ` · ${c.phone}` : ''}</option>)}</Select><Button secondary onClick={() => location.href = '/next-workspace/customers'}>Customer master</Button></div>{customer && <div className="mt-4 grid gap-3 sm:grid-cols-3"><div className="rounded-2xl bg-slate-50 p-4"><b>{customer.display_name}</b><p className="mt-1 text-xs text-slate-500">{customer.legal_name || 'No legal name'}</p><p className="mt-1 text-xs text-slate-500">{customer.phone || 'No phone'} · {customer.email || 'No email'}</p></div><div className="rounded-2xl bg-slate-50 p-4"><span className="text-xs text-slate-400">Payment terms</span><b className="mt-1 block">{customer.payment_terms_days} days</b></div><div className="rounded-2xl bg-slate-50 p-4"><span className="text-xs text-slate-400">Default discount</span><b className="mt-1 block">{normalizeDiscountType(customer.default_discount_type) === 'percentage' ? `${customer.default_discount_value}%` : normalizeDiscountType(customer.default_discount_type) === 'amount' ? money(customer.default_discount_value) : 'None'}</b></div></div>}</Card>

      <Card className="p-6"><div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-bold uppercase tracking-wider text-slate-400">Invoice items</p><h2 className="mt-1 text-xl font-semibold">Products & Services</h2></div><div className="flex gap-2"><Button secondary onClick={() => setItemFormOpen(true)}>＋ Create product/service</Button><Button disabled={!products.length} onClick={addLine}>＋ Add line</Button></div></div>{!lines.length && <div className="mt-5 rounded-2xl border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500">No items added. Add an existing product/service or create a new one.</div>}
        <div className="mt-5 space-y-3">{lines.map((line, i) => { const product = products.find(x => x.id === line.product_service_id); const maxType = normalizeDiscountType(product?.max_discount_type); return <div key={`${line.product_service_id}-${i}`} className="rounded-2xl border border-slate-200 p-4"><div className="grid gap-3 lg:grid-cols-[1.5fr_.55fr_.8fr_.8fr_auto]"><Select value={line.product_service_id} onChange={e => { const p = products.find(x => x.id === e.target.value); changeLine(i, 'product_service_id', e.target.value); if (p) { changeLine(i, 'description', p.description || p.name); changeLine(i, 'unit_price', Number(p.sales_price || 0)); changeLine(i, 'tax_rate_id', taxEnabled ? (p.default_tax_rate_id || '') : ''); } }}>{products.map(p => <option key={p.id} value={p.id}>{p.name}{p.sku ? ` · ${p.sku}` : ''}</option>)}</Select><Input aria-label="Quantity" type="number" min="0.01" step="0.01" value={line.quantity} onChange={e => changeLine(i, 'quantity', Number(e.target.value))}/><Input aria-label="Unit price" type="number" min="0" step="0.01" value={line.unit_price} onChange={e => changeLine(i, 'unit_price', Number(e.target.value))}/>{taxEnabled ? <Select aria-label="Tax rate" value={line.tax_rate_id} onChange={e => changeLine(i, 'tax_rate_id', e.target.value)}><option value="">No tax</option>{taxes.map(t => <option key={t.id} value={t.id}>{t.name} · {t.rate}%</option>)}</Select> : <div className="grid place-items-center rounded-xl bg-slate-50 px-3 text-xs text-slate-400">Tax not applicable</div>}<button type="button" onClick={() => setLines(x => x.filter((_, j) => j !== i))} className="rounded-xl border border-rose-100 px-3 text-sm font-semibold text-rose-600">Remove</button></div><div className="mt-3 grid gap-3 sm:grid-cols-[1fr_220px]"><Input value={line.description} onChange={e => changeLine(i, 'description', e.target.value)} placeholder="Description"/>{product?.discount_enabled ? <div><div className="flex gap-2"><Select value={line.discount_type} onChange={e => changeLine(i, 'discount_type', e.target.value)}><option value="">Discount</option><option value="percentage">%</option><option value="amount">₹</option></Select><Input type="number" min="0" step="0.01" value={line.discount_value} onChange={e => changeLine(i, 'discount_value', Number(e.target.value))}/></div>{Number(product.max_discount_value || 0) > 0 && <p className="mt-1 text-[10px] text-slate-400">Maximum: {maxType === 'percentage' ? `${product.max_discount_value}%` : money(product.max_discount_value)}</p>}</div> : <div className="grid place-items-center rounded-xl bg-slate-50 text-xs text-slate-400">Discount disabled</div>}</div></div>; })}</div></Card>

      <Card className="p-6"><p className="text-xs font-bold uppercase tracking-wider text-slate-400">Invoice details</p><div className="mt-4 grid gap-4 sm:grid-cols-2"><Field label="Invoice date" required><Input type="date" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)}/></Field><Field label="Due date" required help="Starts from the customer payment terms or business default."><Input type="date" value={dueDate} min={invoiceDate} onChange={e => setDueDate(e.target.value)}/></Field><Field label="Invoice template"><Select value={template} onChange={e => setTemplate(e.target.value)}><option value="">Business default</option>{templates.map(t => <option key={t.id} value={t.id}>{t.template_name}</option>)}</Select></Field><Field label="Invoice discount"><div className="flex gap-2"><Select value={discountType} onChange={e => setDiscountType(e.target.value)}><option value="">None</option><option value="percentage">%</option><option value="amount">₹</option></Select><Input type="number" min="0" step="0.01" value={discountValue} onChange={e => setDiscountValue(Number(e.target.value))}/></div></Field><Field label="Terms" wide><textarea value={terms} onChange={e => setTerms(e.target.value)} className="min-h-24 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-violet-400" placeholder="Optional payment terms" /></Field><Field label="Notes" wide><textarea value={notes} onChange={e => setNotes(e.target.value)} className="min-h-20 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-violet-400" placeholder="Optional internal/customer note" /></Field></div></Card>
    </div>
    <aside className="h-fit lg:sticky lg:top-5"><Card className="overflow-hidden"><div className="bg-slate-950 p-6 text-white"><p className="text-xs text-slate-400">Invoice total</p><p className="mt-2 text-4xl font-semibold">{money(totals.total)}</p><p className="mt-2 text-xs text-slate-400">{customer ? customer.display_name : 'Select a customer'}</p></div><div className="space-y-3 p-6 text-sm"><div className="flex justify-between"><span>Subtotal</span><b>{money(totals.subtotal)}</b></div><div className="flex justify-between"><span>Discount</span><b>- {money(totals.discount)}</b></div><div className="flex justify-between"><span>{taxEnabled ? 'Tax' : 'Tax disabled'}</span><b>{money(totals.tax)}</b></div><div className="border-t border-slate-200 pt-3 flex justify-between text-lg"><span>Total</span><b>{money(totals.total)}</b></div><Button disabled={busy || !customerId || !lines.length || totals.total <= 0} onClick={saveInvoice}>{busy ? (editId ? 'Saving…' : 'Creating…') : (editId ? 'Save changes' : 'Save invoice')}</Button><Button secondary onClick={() => location.href = editId ? `/next-workspace/documents?type=invoice&id=${editId}` : '/next-workspace/invoices'}>Cancel</Button></div></Card></aside></div>
    <CustomerCreateModal open={customerFormOpen} businessId={ctx.business_id} onClose={() => setCustomerFormOpen(false)} onCreated={onCustomerCreated}/><ItemServiceModal open={itemFormOpen} businessId={ctx.business_id} onClose={() => setItemFormOpen(false)} onCreated={onItemCreated}/>
  </div></main>;
}
