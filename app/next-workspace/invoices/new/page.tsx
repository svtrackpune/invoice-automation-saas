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

function Input(p: React.InputHTMLAttributes<HTMLInputElement>) { return <input {...p} className={`w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 ${p.className || ''}`} />; }
function Select(p: React.SelectHTMLAttributes<HTMLSelectElement>) { return <select {...p} className={`w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 ${p.className || ''}`} />; }
function Button({ children, onClick, secondary = false, disabled = false }: { children: React.ReactNode; onClick?: () => void; secondary?: boolean; disabled?: boolean }) { return <button type="button" disabled={disabled} onClick={onClick} className={`rounded-xl px-4 py-2.5 text-sm font-semibold disabled:opacity-50 ${secondary ? 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50' : 'bg-violet-600 text-white hover:bg-violet-700'}`}>{children}</button>; }
function Field({ label, children, wide = false, required = false, help }: { label: string; children: React.ReactNode; wide?: boolean; required?: boolean; help?: string }) { return <label className={`${wide ? 'sm:col-span-2 ' : ''} block text-xs font-semibold text-slate-600`}>{label}{required ? ' *' : ''}<div className="mt-1">{children}</div>{help && <p className="mt-1 text-[11px] font-normal text-slate-400">{help}</p>}</label>; }
function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) { return <section className={`rounded-3xl border border-slate-200 bg-white shadow-sm ${className}`}>{children}</section>; }

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
      setTemplates((tm.data || []) as Template[]);
      setTaxProfile((tp.data || { tax_regime: 'NONE', gst_registration_type: 'NONE' }) as TaxProfile);
      const d = (ds.data || {}) as { invoice_due_days?: number | null; invoice_notes?: string | null; default_payment_terms?: string | null };
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
        setCustomerId(ir.data.customer_id || ''); setInvoiceDate(ir.data.invoice_date || today()); setDueDate(ir.data.due_date || plusDays(documentDefaults.invoice_due_days)); setNotes(ir.data.notes || ''); setTerms(ir.data.terms || documentDefaults.default_payment_terms || ''); setDiscountType(normalizeDiscountType(ir.data.discount_type)); setDiscountValue(Number(ir.data.discount_value || 0)); setTemplate(ir.data.template_id || documentDefaults.invoice_template_id || '');
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
  const addLine = () => { const p = products[0]; if (!p) { setItemFormOpen(true); return; } setLines(x => [...x, { product_service_id: p.id, description: p.description || p.name, quantity: 1, unit_price: Number(p.sales_price || 0), discount_type: '', discount_value: 0, tax_rate_id: taxEnabled ? (p.default_tax_rate_id || '') : '' }]); };
  const changeLine = (i: number, key: keyof Line, value: string | number) => setLines(x => x.map((line, j) => j === i ? { ...line, [key]: value } : line));
  const lineDiscount = (line: Line, product?: Product) => { if (!product?.discount_enabled) return 0; const base = Number(line.quantity || 0) * Number(line.unit_price || 0); let value = line.discount_type === 'percentage' ? base * Number(line.discount_value || 0) / 100 : Number(line.discount_value || 0); const maxType = normalizeDiscountType(product.max_discount_type); if (Number(product.max_discount_value || 0) > 0) { const max = maxType === 'percentage' ? base * Number(product.max_discount_value) / 100 : Number(product.max_discount_value); value = Math.min(value, max); } return Math.max(0, Math.min(base, value)); };
  const totals = useMemo(() => { let subtotal = 0, discount = 0, tax = 0; for (const line of lines) { const product = products.find(x => x.id === line.product_service_id); const base = Number(line.quantity || 0) * Number(line.unit_price || 0); const d = lineDiscount(line, product); const rate = taxEnabled ? (taxes.find(t => t.id === line.tax_rate_id)?.rate || 0) : 0; subtotal += base; discount += d; tax += (base - d) * rate / 100; } const invoiceDiscountBase = Math.max(0, subtotal - discount); const invoiceDiscount = discountType === 'percentage' ? invoiceDiscountBase * Number(discountValue || 0) / 100 : Number(discountValue || 0); const total = Math.max(0, subtotal - discount - Math.min(invoiceDiscountBase, invoiceDiscount) + tax); return { subtotal, discount: discount + Math.min(invoiceDiscountBase, Math.max(0, invoiceDiscount)), tax, total }; }, [lines, products, taxes, discountType, discountValue, taxEnabled]);
  const selectCustomer = (id: string) => { setCustomerId(id); const c = customers.find(x => x.id === id); if (c) { setDueDate(plusDays(Number(c.payment_terms_days || defaults.invoice_due_days || 0))); setDiscountType(normalizeDiscountType(c.default_discount_type)); setDiscountValue(Number(c.default_discount_value || 0)); } };
  const onCustomerCreated = (c: CreatedCustomer) => { setCustomers(x => [...x, c as Customer].sort((a, b) => a.display_name.localeCompare(b.display_name))); setCustomerId(c.id); setCustomerFormOpen(false); };
  const onItemCreated = (item: Product) => { setProducts(x => [...x, item].sort((a, b) => a.name.localeCompare(b.name))); setLines(x => [...x, { product_service_id: item.id, description: item.description || item.name, quantity: 1, unit_price: Number(item.sales_price || 0), discount_type: '', discount_value: 0, tax_rate_id: taxEnabled ? (item.default_tax_rate_id || '') : '' }]); setItemFormOpen(false); };
  const saveInvoice = async () => { if (!ctx || !customerId || !lines.length || totals.total <= 0) return; setBusy(true); setError(''); const itemPayload = lines.map((l, i) => ({ ...l, tax_rate_id: taxEnabled ? l.tax_rate_id : '', sort_order: i })); const r = editId ? await supabase.rpc('update_invoice_draft', { p_invoice_id: editId, p_customer_id: customerId, p_invoice_date: invoiceDate, p_due_date: dueDate, p_items: itemPayload, p_invoice_discount_type: discountType || null, p_invoice_discount_value: Number(discountValue || 0), p_notes: notes || null, p_terms: terms || null, p_template_id: template || null }) : await supabase.rpc('create_invoice_from_items', { p_business_id: ctx.business_id, p_customer_id: customerId, p_invoice_date: invoiceDate, p_due_date: dueDate, p_items: itemPayload, p_invoice_discount_type: discountType || null, p_invoice_discount_value: Number(discountValue || 0), p_notes: notes || null, p_terms: terms || null }); if (r.error) { setError(r.error.message); setBusy(false); return; } if (!editId && template) await supabase.from('invoices').update({ template_id: template }).eq('id', r.data); location.href = `/next-workspace/documents?type=invoice&id=${r.data}`; };
  if (!ctx || !editLoaded) return <div className="grid min-h-screen place-items-center text-sm text-slate-500">Loading invoice editor…</div>;
  const ruleLabel = composition ? 'Composition GST: tax is not charged separately' : taxEnabled ? `${taxRegime}${gstType !== 'NONE' ? ` · ${gstType}` : ''}: tax fields enabled` : 'Non-tax business: tax fields hidden';
  return <main className="min-h-screen bg-[#fbfaff] p-4 text-slate-950 sm:p-7"><div className="mx-auto max-w-7xl"><header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-600">{editId ? 'Edit draft invoice' : 'New invoice'}</p><h1 className="text-3xl font-bold tracking-tight">Create an invoice</h1><p className="mt-1 text-sm text-slate-500">{ruleLabel}</p></div><div className="sm:ml-auto flex gap-2"><Button secondary onClick={() => location.href = '/next-workspace/documents'}>Cancel</Button><Button disabled={busy || !customerId || !lines.length || totals.total <= 0} onClick={saveInvoice}>{busy ? 'Saving…' : editId ? 'Save draft' : 'Save invoice'}</Button></div></header>{error && <Card className="mb-4 border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</Card>}<div className="grid gap-5 lg:grid-cols-[1fr_360px]"><div className="space-y-5"><Card className="p-5"><div className="grid gap-4 sm:grid-cols-2"><Field label="Customer" required wide><div className="flex gap-2"><Select value={customerId} onChange={e => selectCustomer(e.target.value)}><option value="">Select customer…</option>{customers.map(c => <option key={c.id} value={c.id}>{c.display_name}</option>)}</Select><Button secondary onClick={() => setCustomerFormOpen(true)}>New</Button></div></Field><Field label="Invoice date" required><Input type="date" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} /></Field><Field label="Due date" required><Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} /></Field></div></Card><Card className="overflow-hidden"><div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div><h2 className="font-bold">Items</h2><p className="text-xs text-slate-500">Use existing products/services; tax and discount rules follow the business.</p></div><Button secondary onClick={addLine}>Add line</Button></div><div className="overflow-x-auto"><table className="min-w-[850px] w-full text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="p-3 text-left">Item</th><th className="p-3 text-left">Description</th><th className="p-3 text-right">Qty</th><th className="p-3 text-right">Rate</th>{taxEnabled && <th className="p-3 text-left">Tax</th>}<th className="p-3 text-right">Amount</th><th className="p-3"></th></tr></thead><tbody>{lines.map((line, i) => { const p = products.find(x => x.id === line.product_service_id); const base = Number(line.quantity || 0) * Number(line.unit_price || 0); const d = lineDiscount(line, p); const rate = taxEnabled ? (taxes.find(t => t.id === line.tax_rate_id)?.rate || 0) : 0; return <tr key={`${i}-${line.product_service_id}`} className="border-t border-slate-100 align-top"><td className="p-3"><Select value={line.product_service_id} onChange={e => { const np = products.find(x => x.id === e.target.value); changeLine(i, 'product_service_id', e.target.value); if (np) { changeLine(i, 'description', np.description || np.name); changeLine(i, 'unit_price', Number(np.sales_price || 0)); changeLine(i, 'tax_rate_id', taxEnabled ? (np.default_tax_rate_id || '') : ''); } }}><option value="">Select…</option>{products.map(x => <option key={x.id} value={x.id}>{x.name}{x.sku ? ` · ${x.sku}` : ''}</option>)}</Select></td><td className="p-3"><Input value={line.description} onChange={e => changeLine(i, 'description', e.target.value)} /></td><td className="p-3 w-24"><Input type="number" min="0.001" step="0.001" value={line.quantity} onChange={e => changeLine(i, 'quantity', Number(e.target.value))} /></td><td className="p-3 w-32"><Input type="number" min="0" step="0.01" value={line.unit_price} onChange={e => changeLine(i, 'unit_price', Number(e.target.value))} /></td>{taxEnabled && <td className="p-3 w-40"><Select value={line.tax_rate_id} onChange={e => changeLine(i, 'tax_rate_id', e.target.value)}><option value="">No tax</option>{taxes.map(t => <option key={t.id} value={t.id}>{t.name} · {t.rate}%</option>)}</Select></td>}<td className="p-3 text-right font-semibold">{money(Math.max(0, base - d + (base - d) * rate / 100))}</td><td className="p-3 text-right"><Button secondary onClick={() => setLines(x => x.filter((_, j) => j !== i))}>Remove</Button></td></tr>; })}</tbody></table>{!lines.length && <div className="p-10 text-center text-sm text-slate-500">No items yet. Add your first line.</div>}</Card><Card className="p-5"><div className="grid gap-4 sm:grid-cols-2"><Field label="Invoice discount"><div className="flex gap-2"><Select value={discountType} onChange={e => setDiscountType(e.target.value)}><option value="">None</option><option value="percentage">Percentage</option><option value="amount">Amount</option></Select><Input type="number" min="0" value={discountValue} onChange={e => setDiscountValue(Number(e.target.value))} /></div></Field><Field label="Notes" wide><Input value={notes} onChange={e => setNotes(e.target.value)} /></Field><Field label="Payment terms" wide><Input value={terms} onChange={e => setTerms(e.target.value)} /></Field><Field label="Template"><Select value={template} onChange={e => setTemplate(e.target.value)}><option value="">Business default</option>{templates.map(t => <option key={t.id} value={t.id}>{t.template_name}</option>)}</Select></Field></div></Card></div><Card className="h-fit p-5 lg:sticky lg:top-5"><h2 className="font-bold">Invoice summary</h2><div className="mt-4 space-y-3 text-sm"><div className="flex justify-between"><span>Subtotal</span><span>{money(totals.subtotal)}</span></div><div className="flex justify-between"><span>Discount</span><span>-{money(totals.discount)}</span></div>{taxEnabled && <div className="flex justify-between"><span>Tax</span><span>{money(totals.tax)}</span></div>}<div className="border-t pt-3 flex justify-between text-lg font-bold"><span>Total</span><span>{money(totals.total)}</span></div></div>{customer && <div className="mt-5 rounded-2xl bg-slate-50 p-4 text-xs text-slate-600"><div className="font-semibold text-slate-900">{customer.display_name}</div><div>Payment terms: {customer.payment_terms_days || defaults.invoice_due_days || 0} days</div>{customer.phone && <div>{customer.phone}</div>}</div>}</Card></div>{customerFormOpen && <CustomerCreateModal open={customerFormOpen} onClose={() => setCustomerFormOpen(false)} onCreated={onCustomerCreated} businessId={ctx.business_id} />}{itemFormOpen && <ItemServiceModal open={itemFormOpen} onClose={() => setItemFormOpen(false)} onCreated={onItemCreated} businessId={ctx.business_id} />}</div></main>;
}
