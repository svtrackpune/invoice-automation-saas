'use client';

import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { supabase, type BusinessContext } from '@/lib/supabase';

type DocType = 'invoice' | 'quotation' | 'receipt' | 'delivery_challan' | 'purchase_order' | 'credit_note' | 'cash_bill';
type TemplateKey = 'classic' | 'minimal' | 'modern' | 'premium' | 'professional';
type Template = { id: string; document_type: DocType; template_key: string; template_name: string; description: string | null };
type ThemeStudioConfig = { row_padding: number; corner_radius: number; logo_width: number };
type Pref = {
  document_type: DocType; template_id: string | null;
  primary_color: string; secondary_color: string; accent_color: string; text_color: string; background_color: string; font_family: string;
  show_logo: boolean; show_business_address: boolean; show_tax_details: boolean; show_payment_qr: boolean; show_payment_link: boolean; show_signature: boolean; show_terms: boolean; show_bank_details: boolean;
  document_title_override: string | null; min_item_rows: number; prefill_upi_amount: boolean; show_customer_balance: boolean; show_authorized_signatory: boolean; show_serial_numbers: boolean;
  custom_fields: Record<string, unknown>;
};
type Brand = {
  name: string; legal_name: string | null; tax_registration_number: string | null;
  brand_primary_color: string; brand_secondary_color: string; brand_accent_color: string;
  logo_storage_path: string | null; address: Record<string, unknown>; phone: string | null; email: string | null;
};
type SampleCustomer = { display_name: string; legal_name: string | null; phone: string | null; email: string | null; billing_address: Record<string, unknown> };
type PaymentSettings = { upi_id: string | null; payment_qr_enabled: boolean; payment_link_enabled: boolean; payment_instructions: string | null };

const DOCS: Array<{ key: DocType; label: string; kind: 'a4' | 'receipt' }> = [
  { key: 'invoice', label: 'Invoice', kind: 'a4' },
  { key: 'quotation', label: 'Quotation', kind: 'a4' },
  { key: 'receipt', label: 'Receipt', kind: 'receipt' },
  { key: 'delivery_challan', label: 'Delivery Challan', kind: 'a4' },
  { key: 'purchase_order', label: 'Purchase Order', kind: 'a4' },
  { key: 'credit_note', label: 'Credit Note', kind: 'a4' },
  { key: 'cash_bill', label: 'Cash Bill', kind: 'receipt' },
];
const TEMPLATE_KEYS: TemplateKey[] = ['classic', 'minimal', 'modern', 'premium', 'professional'];
const FONT_OPTIONS = ['Inter', 'Roboto', 'Open Sans', 'Lato', 'Montserrat', 'Poppins', 'Source Sans 3', 'Merriweather', 'Georgia', 'Arial'];
const DOC_TITLE: Record<DocType, string> = {
  invoice: 'TAX INVOICE', quotation: 'QUOTATION', receipt: 'PAYMENT RECEIPT', delivery_challan: 'DELIVERY CHALLAN',
  purchase_order: 'PURCHASE ORDER', credit_note: 'CREDIT NOTE', cash_bill: 'CASH BILL',
};
const defaultPref = (document_type: DocType): Pref => ({
  document_type, template_id: null, primary_color: '#111827', secondary_color: '#64748B', accent_color: '#2563EB', text_color: '#172033', background_color: '#FFFFFF',
  font_family: 'Inter', show_logo: true, show_business_address: true, show_tax_details: true, show_payment_qr: true, show_payment_link: true, show_signature: false,
  show_terms: true, show_bank_details: false, document_title_override: null, min_item_rows: 4, prefill_upi_amount: true, show_customer_balance: true,
  show_authorized_signatory: true, show_serial_numbers: false, custom_fields: {},
});

function configOf(pref: Pref): ThemeStudioConfig {
  const value = ((pref.custom_fields || {}).theme_studio || {}) as Partial<ThemeStudioConfig>;
  return { row_padding: Math.min(16, Math.max(4, Number(value.row_padding || 9))), corner_radius: Math.min(24, Math.max(0, Number(value.corner_radius ?? 14))), logo_width: Math.min(180, Math.max(48, Number(value.logo_width || 92))) };
}
function withConfig(pref: Pref, next: Partial<ThemeStudioConfig>): Pref {
  const current = configOf(pref);
  return { ...pref, custom_fields: { ...(pref.custom_fields || {}), theme_studio: { ...current, ...next } } };
}
function money(value: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(value || 0));
}
function addressText(address: Record<string, unknown> | null | undefined) {
  if (!address) return 'Business address not configured';
  return [
    address.line1 || address.address_line1 || address.street,
    address.line2 || address.address_line2,
    [address.city, address.state, address.postal_code || address.pin || address.pincode].filter(Boolean).join(', '),
  ].filter(Boolean).map(String).join(' · ') || 'Business address not configured';
}
function inferTemplateKey(template: Template | undefined, index: number): TemplateKey {
  const raw = String(template?.template_key || '').toLowerCase();
  return (TEMPLATE_KEYS as readonly string[]).includes(raw) ? raw as TemplateKey : TEMPLATE_KEYS[index] || 'classic';
}
function presetColors(key: TemplateKey) {
  const presets: Record<TemplateKey, { primary: string; secondary: string; accent: string; background: string }> = {
    classic: { primary: '#7F1D1D', secondary: '#78716C', accent: '#991B1B', background: '#FFFFFF' },
    minimal: { primary: '#111827', secondary: '#64748B', accent: '#2563EB', background: '#FFFFFF' },
    modern: { primary: '#4338CA', secondary: '#64748B', accent: '#7C3AED', background: '#F8FAFC' },
    premium: { primary: '#4C1D95', secondary: '#7C3AED', accent: '#A855F7', background: '#FAF5FF' },
    professional: { primary: '#0F3B66', secondary: '#52677C', accent: '#145A8D', background: '#FFFFFF' },
  };
  return presets[key];
}

function Logo({ brand, width }: { brand: Brand; width: number }) {
  if (!brand.logo_storage_path) return <div style={{ width, height: width * .62 }} className="grid shrink-0 place-items-center rounded-xl border border-dashed border-slate-300 bg-white text-[9px] font-black text-slate-400">LOGO</div>;
  const url = supabase.storage.from('business-branding-public').getPublicUrl(brand.logo_storage_path).data.publicUrl;
  return <img src={url} alt={brand.name || 'Business logo'} style={{ width: Math.min(width, 180), maxHeight: width * .62 }} className="shrink-0 rounded-lg object-contain" />;
}

function PreviewCanvas({ type, templateKey, brand, pref, customer, balance, upiQr, payment }: { type: DocType; templateKey: TemplateKey; brand: Brand; pref: Pref; customer: SampleCustomer; balance: number; upiQr: string; payment: PaymentSettings }) {
  const config = configOf(pref);
  const colors = presetColors(templateKey);
  const primary = pref.primary_color || colors.primary;
  const secondary = pref.secondary_color || colors.secondary;
  const accent = pref.accent_color || colors.accent;
  const bg = pref.background_color || colors.background;
  const title = pref.document_title_override?.trim() || DOC_TITLE[type];
  const rows = Math.max(1, pref.min_item_rows || 4);
  const isReceipt = type === 'receipt' || type === 'cash_bill';
  const amount = type === 'quotation' ? 7080 : type === 'delivery_challan' || type === 'purchase_order' ? 6000 : type === 'credit_note' ? 2500 : 7080;
  const tax = pref.show_tax_details && !['delivery_challan', 'purchase_order', 'cash_bill'].includes(type) ? 1080 : 0;
  const displayRows = Array.from({ length: rows }, (_, index) => index);

  return <div className="min-h-full bg-slate-200/70 p-4 sm:p-7" style={{ fontFamily: pref.font_family }}>
    <article className={isReceipt ? 'mx-auto w-[300px] overflow-hidden bg-white shadow-2xl' : 'mx-auto w-full max-w-[794px] min-h-[1123px] overflow-hidden bg-white shadow-2xl'}
      style={{ borderRadius: config.corner_radius, backgroundColor: bg, color: pref.text_color }}>
      <header className="p-6 sm:p-8" style={{ background: templateKey === 'minimal' ? bg : primary, color: templateKey === 'minimal' ? pref.text_color : '#FFFFFF' }}>
        <div className="flex items-start justify-between gap-6">
          <div className="flex min-w-0 items-start gap-4">
            {pref.show_logo && <Logo brand={brand} width={config.logo_width} />}
            <div className="min-w-0">
              <div className="text-xl font-black tracking-tight">{brand.name || 'Business Name'}</div>
              {brand.legal_name && brand.legal_name !== brand.name && <div className="mt-1 text-[10px] opacity-75">{brand.legal_name}</div>}
              {pref.show_business_address && <div className="mt-2 max-w-[420px] text-[10px] leading-4 opacity-80">{addressText(brand.address)}</div>}
              {(brand.phone || brand.email) && <div className="mt-1 text-[9px] opacity-75">{[brand.phone, brand.email].filter(Boolean).join(' · ')}</div>}
              {pref.show_tax_details && brand.tax_registration_number && <div className="mt-1 text-[9px] font-bold opacity-90">GSTIN / Tax ID: {brand.tax_registration_number}</div>}
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-2xl font-black tracking-tight sm:text-3xl" style={{ color: templateKey === 'minimal' ? accent : '#FFFFFF' }}>{title}</div>
            <div className="mt-3 space-y-1 text-[10px] opacity-85">
              <div><span className="opacity-60">Number</span> <b>{type === 'quotation' ? 'QUO-00021' : type === 'receipt' ? 'RCT-00021' : type === 'cash_bill' ? 'CB-00021' : 'DOC-00021'}</b></div>
              <div><span className="opacity-60">Date</span> <b>07/10/2026</b></div>
              {!['receipt', 'cash_bill', 'delivery_challan', 'purchase_order', 'credit_note'].includes(type) && <div><span className="opacity-60">Due</span> <b>07/11/2026</b></div>}
            </div>
          </div>
        </div>
      </header>

      <section className="grid gap-3 p-6 sm:grid-cols-2 sm:p-7">
        <div className="rounded-xl border border-slate-200 bg-white/80 p-4" style={{ borderRadius: config.corner_radius }}>
          <div className="text-[9px] font-black uppercase tracking-[.16em]" style={{ color: accent }}>BILL TO</div>
          <div className="mt-2 text-sm font-black">{customer.display_name || 'Customer'}</div>
          {customer.legal_name && <div className="mt-1 text-[10px]" style={{ color: secondary }}>{customer.legal_name}</div>}
          {customer.phone && <div className="mt-1 text-[10px]" style={{ color: secondary }}>{customer.phone}</div>}
          {customer.email && <div className="mt-1 text-[10px]" style={{ color: secondary }}>{customer.email}</div>}
          <div className="mt-1 text-[10px] leading-4" style={{ color: secondary }}>{addressText(customer.billing_address)}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white/80 p-4" style={{ borderRadius: config.corner_radius }}>
          <div className="text-[9px] font-black uppercase tracking-[.16em]" style={{ color: accent }}>DOCUMENT</div>
          <div className="mt-2 text-[10px]" style={{ color: secondary }}>
            {type === 'quotation' ? 'Commercial offer and validity details.' :
              type === 'delivery_challan' ? 'Dispatch document. No tax liability is created by the challan itself.' :
              type === 'purchase_order' ? 'Purchase instruction to the supplier.' :
              type === 'credit_note' ? 'Adjustment against the customer account.' :
              isReceipt ? 'Payment acknowledgement and settlement record.' : 'Customer sale and tax document.'}
          </div>
        </div>
      </section>

      <div className="px-6 sm:px-7">
        <table className="w-full border-collapse overflow-hidden text-xs">
          <thead style={{ backgroundColor: templateKey === 'minimal' ? '#E2E8F0' : primary, color: templateKey === 'minimal' ? '#334155' : '#FFFFFF' }}>
            <tr>
              {!isReceipt && <th className="w-8 text-center" style={{ padding: config.row_padding }}>#</th>}
              <th className="text-left" style={{ padding: config.row_padding }}>Item / Description</th>
              <th className="w-16 text-right" style={{ padding: config.row_padding }}>Qty</th>
              {!isReceipt && <th className="w-24 text-right" style={{ padding: config.row_padding }}>Rate</th>}
              {pref.show_tax_details && !isReceipt && <th className="w-20 text-right" style={{ padding: config.row_padding }}>Tax</th>}
              <th className="w-24 text-right" style={{ padding: config.row_padding }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {displayRows.map(index => <tr key={index} className="border-b border-slate-200">
              {!isReceipt && <td className="text-center" style={{ padding: config.row_padding }}>{index === 0 ? '1' : ''}</td>}
              <td style={{ padding: config.row_padding }}>{index === 0 ? <><b>Professional service</b><span className="block text-[9px]" style={{ color: secondary }}>SKU-001 {pref.show_serial_numbers ? '· SN: SN-0001' : ''}</span></> : null}</td>
              <td className="text-right" style={{ padding: config.row_padding }}>{index === 0 ? '2 NOS' : ''}</td>
              {!isReceipt && <td className="text-right" style={{ padding: config.row_padding }}>{index === 0 ? money(2500) : ''}</td>}
              {pref.show_tax_details && !isReceipt && <td className="text-right" style={{ padding: config.row_padding }}>{index === 0 ? '18%' : ''}</td>}
              <td className="text-right font-semibold" style={{ padding: config.row_padding }}>{index === 0 ? money(5000) : ''}</td>
            </tr>)}
          </tbody>
        </table>
      </div>

      <section className="flex flex-col gap-5 p-6 sm:flex-row sm:justify-between sm:p-7">
        <div className="flex-1">
          {pref.show_terms && <div className="rounded-xl border-l-4 p-3 text-[10px]" style={{ borderColor: accent, backgroundColor: accent + '08' }}><b style={{ color: accent }}>TERMS & NOTES</b><p className="mt-1" style={{ color: secondary }}>{payment.payment_instructions || 'Payment due within the agreed terms. Live preview uses the selected per-document theme.'}</p></div>}
        </div>
        <div className="w-full max-w-[280px] text-xs">
          <div className="flex justify-between border-t-2 pt-2" style={{ borderColor: primary }}><span>Subtotal</span><b>{money(amount - tax)}</b></div>
          {tax > 0 && <div className="mt-1 flex justify-between"><span>GST</span><b>{money(tax)}</b></div>}
          <div className="mt-2 flex justify-between border-y py-2 text-base font-black" style={{ borderColor: secondary, color: accent }}><span>Total</span><b>{money(amount)}</b></div>
        </div>
      </section>

      {pref.show_payment_qr && <section className="mx-6 mb-5 rounded-2xl border border-dashed p-4 sm:mx-7" style={{ borderColor: accent }}>
        <div className="flex items-center justify-between gap-4">
          <div><div className="text-[9px] font-black uppercase tracking-[.16em]" style={{ color: accent }}>UPI PAYMENT</div>
            <div className="mt-1 text-xs font-bold">{upiQr ? 'Dynamic QR' : 'Configure UPI ID in Payment Settings'}</div>
            {pref.prefill_upi_amount ? <div className="mt-1 text-[10px]" style={{ color: secondary }}>Amount prefilled: {money(Math.max(balance, amount))}</div> : <div className="mt-1 text-[10px]" style={{ color: secondary }}>Amount entered by payer</div>}
          </div>
          {upiQr ? <img src={upiQr} alt="Dynamic UPI payment QR" className="h-24 w-24 rounded-lg bg-white p-1" /> : <div className="grid h-24 w-24 place-items-center rounded-lg border border-slate-200 text-center text-[8px] font-bold text-slate-400">UPI<br />QR</div>}
        </div>
      </section>}

      {(pref.show_customer_balance || pref.show_authorized_signatory) && <footer className="flex flex-col gap-4 border-t px-6 py-4 sm:flex-row sm:items-end sm:justify-between sm:px-7" style={{ borderColor: secondary }}>
        {pref.show_customer_balance ? <div className="text-[10px]"><span style={{ color: secondary }}>Customer ledger balance</span><strong className="ml-2" style={{ color: balance > 0 ? '#B91C1C' : '#047857' }}>{money(balance)} {balance > 0 ? 'outstanding' : 'clear'}</strong></div> : <span />}
        {pref.show_authorized_signatory ? <div className="min-w-44 border-t pt-2 text-center text-[9px] font-bold" style={{ borderColor: secondary }}>Authorised Signatory</div> : null}
      </footer>}
    </article>
  </div>;
}

export default function DocumentThemeStudio() {
  const [ctx, setCtx] = useState<BusinessContext | null>(null);
  const [brand, setBrand] = useState<Brand | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [prefs, setPrefs] = useState<Record<DocType, Pref>>(() => Object.fromEntries(DOCS.map(({ key }) => [key, defaultPref(key)])) as Record<DocType, Pref>);
  const [customer, setCustomer] = useState<SampleCustomer>({ display_name: 'Sample Customer', legal_name: null, phone: '+91 98765 43210', email: 'customer@example.com', billing_address: {} });
  const [balance, setBalance] = useState(0);
  const [payment, setPayment] = useState<PaymentSettings>({ upi_id: null, payment_qr_enabled: true, payment_link_enabled: false, payment_instructions: null });
  const [type, setType] = useState<DocType>('invoice');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [upiQr, setUpiQr] = useState('');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const context = await supabase.rpc('get_my_business_context');
      const business = (context.data || [])[0] as BusinessContext | undefined;
      if (!business) { window.location.href = '/'; return; }
      const [b, p, t, c, ps] = await Promise.all([
        supabase.from('businesses').select('name,legal_name,tax_registration_number,brand_primary_color,brand_secondary_color,brand_accent_color,logo_storage_path,address,phone,email').eq('id', business.business_id).single(),
        supabase.from('business_document_preferences').select('*').eq('business_id', business.business_id),
        supabase.from('document_templates').select('id,document_type,template_key,template_name,description').eq('is_active', true).order('document_type').order('template_name'),
        supabase.from('customers').select('id,display_name,legal_name,phone,email,billing_address').eq('business_id', business.business_id).eq('is_active', true).order('display_name').limit(1).maybeSingle(),
        supabase.from('document_payment_settings').select('upi_id,payment_qr_enabled,payment_link_enabled,payment_instructions').eq('business_id', business.business_id).maybeSingle(),
      ]);
      if (cancelled) return;
      if (b.error) { setError(b.error.message); setLoading(false); return; }
      setCtx(business);
      setBrand(b.data as Brand);
      setTemplates((t.data || []) as Template[]);
      if (c.data) {
        setCustomer(c.data as SampleCustomer);
        const idResult = await supabase.from('customers').select('id').eq('business_id', business.business_id).eq('display_name', c.data.display_name).limit(1).maybeSingle();
        if (idResult.data?.id) {
          const cb = await supabase.from('customer_balances').select('balance_due').eq('business_id', business.business_id).eq('customer_id', idResult.data.id).maybeSingle();
          setBalance(Number((cb.data as { balance_due: number } | null)?.balance_due || 0));
        }
      }
      setPayment((ps.data || { upi_id: null, payment_qr_enabled: true, payment_link_enabled: false, payment_instructions: null }) as PaymentSettings);
      const map = Object.fromEntries(DOCS.map(({ key }) => [key, defaultPref(key)])) as Record<DocType, Pref>;
      for (const raw of (p.data || []) as Array<Partial<Pref>>) {
        const documentType = raw.document_type as DocType;
        if (DOCS.some(x => x.key === documentType)) map[documentType] = { ...map[documentType], ...raw, document_type: documentType, custom_fields: (raw.custom_fields || {}) as Record<string, unknown> };
      }
      for (const doc of DOCS) {
        if (!map[doc.key].template_id) map[doc.key].template_id = ((t.data || []) as Template[]).find(row => row.document_type === doc.key)?.id || null;
      }
      setPrefs(map);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const currentPref = prefs[type] || defaultPref(type);
  const currentTemplates = useMemo(() => templates.filter(template => template.document_type === type), [templates, type]);
  const selectedTemplate = useMemo(() => currentTemplates.find(template => template.id === currentPref.template_id) || currentTemplates[0], [currentTemplates, currentPref.template_id]);
  const templateKey = inferTemplateKey(selectedTemplate, currentTemplates.findIndex(template => template.id === selectedTemplate?.id));
  const currentConfig = configOf(currentPref);

  useEffect(() => {
    if (!payment.upi_id || !payment.payment_qr_enabled || !currentPref.show_payment_qr) { setUpiQr(''); return; }
    const amount = 7080;
    const params = new URLSearchParams({ pa: payment.upi_id, pn: brand?.name || 'Business', cu: 'INR' });
    if (currentPref.prefill_upi_amount) params.set('am', amount.toFixed(2));
    void QRCode.toDataURL('upi://pay?' + params.toString(), { width: 180, margin: 1, errorCorrectionLevel: 'M' }).then(setUpiQr).catch(() => setUpiQr(''));
  }, [payment.upi_id, payment.payment_qr_enabled, currentPref.show_payment_qr, currentPref.prefill_upi_amount, brand?.name]);

  const updatePref = (patch: Partial<Pref>) => {
    setPrefs(current => ({ ...current, [type]: { ...current[type], ...patch } }));
    setDirty(true); setStatus('');
  };
  const updateConfig = (patch: Partial<ThemeStudioConfig>) => { setPrefs(current => ({ ...current, [type]: withConfig(current[type], patch) })); setDirty(true); setStatus(''); };
  const applyTemplate = (template: Template) => {
    const key = inferTemplateKey(template, currentTemplates.findIndex(x => x.id === template.id));
    const colors = presetColors(key);
    updatePref({ template_id: template.id, primary_color: colors.primary, secondary_color: colors.secondary, accent_color: colors.accent, background_color: colors.background });
  };

  const save = async () => {
    if (!ctx || !brand || saving) return;
    setSaving(true); setStatus(''); setError('');
    const businessUpdate = await supabase.from('businesses').update({ name: brand.name, legal_name: brand.legal_name || null, tax_registration_number: brand.tax_registration_number || null, brand_primary_color: brand.brand_primary_color, brand_secondary_color: brand.brand_secondary_color, brand_accent_color: brand.brand_accent_color }).eq('id', ctx.business_id);
    if (businessUpdate.error) { setError(businessUpdate.error.message); setSaving(false); return; }
    for (const doc of DOCS) {
      const response = await supabase.from('business_document_preferences').upsert({ ...prefs[doc.key], business_id: ctx.business_id, document_type: doc.key }, { onConflict: 'business_id,document_type' });
      if (response.error) { setError(response.error.message); setSaving(false); return; }
    }
    setDirty(false); setStatus('Saved. Per-document preferences are now available to the print renderer.'); setSaving(false);
  };

  if (loading || !brand) return <div className="grid min-h-[80vh] place-items-center bg-slate-950 text-sm text-slate-300">Loading Document Theme Studio…</div>;

  return <main className="theme-studio min-h-[calc(100vh-64px)] bg-slate-950 text-slate-100">
    <header className="border-b border-white/10 bg-slate-950/95 px-4 py-3 backdrop-blur sm:px-6">
      <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4">
        <div><p className="text-[9px] font-black uppercase tracking-[.2em] text-indigo-300">Documents · WYSIWYG</p><h1 className="mt-1 text-xl font-bold tracking-tight">Document Theme Studio</h1><p className="mt-1 text-[11px] text-slate-400">Independent visual identity, spacing and payment presentation for each document type.</p></div>
        <div className="flex items-center gap-2"><span className={dirty ? 'rounded-full bg-amber-400/10 px-3 py-1.5 text-[10px] font-bold text-amber-300 ring-1 ring-amber-400/20' : 'rounded-full bg-emerald-400/10 px-3 py-1.5 text-[10px] font-bold text-emerald-300 ring-1 ring-emerald-400/20'}>{dirty ? 'Unsaved changes' : status || 'Saved'}</span><button type="button" onClick={() => window.print()} className="rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-white/5">Print canvas</button><button type="button" disabled={!dirty || saving} onClick={() => void save()} className="rounded-lg bg-indigo-500 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-400 disabled:opacity-40">{saving ? 'Saving…' : 'Save all documents'}</button></div>
      </div>
    </header>
    {error ? <div className="border-b border-rose-400/20 bg-rose-500/10 px-4 py-3 text-center text-xs text-rose-200">{error}</div> : null}

    <div className="mx-auto grid max-w-[1600px] grid-cols-[380px_minmax(0,1fr)] min-h-[calc(100vh-137px)] max-lg:grid-cols-1">
      <aside className="overflow-y-auto border-r border-white/10 bg-slate-900 p-4 sm:p-5 max-lg:max-h-[68vh]">
        <div className="mb-4 grid grid-cols-2 gap-1 rounded-xl bg-slate-950 p-1 sm:grid-cols-3">
          {DOCS.map(doc => <button key={doc.key} type="button" onClick={() => setType(doc.key)} className={'rounded-lg px-2 py-2 text-[10px] font-bold ' + (type === doc.key ? 'bg-white text-slate-900' : 'text-slate-400 hover:bg-white/5 hover:text-white')}>{doc.label}</button>)}
        </div>

        <section className="rounded-2xl border border-white/10 bg-slate-950/50 p-4">
          <div className="flex items-center justify-between gap-2"><div><p className="text-[9px] font-black uppercase tracking-[.18em] text-indigo-300">Layout preset</p><h2 className="mt-1 text-sm font-bold">{DOC_TITLE[type]}</h2></div><span className="rounded-full bg-white/5 px-2 py-1 text-[9px] font-semibold text-slate-400">Live</span></div>
          <div className="mt-4 grid gap-2">{currentTemplates.map((template, index) => {
            const active = currentPref.template_id === template.id;
            return <button key={template.id} type="button" onClick={() => applyTemplate(template)} className={'rounded-xl border p-3 text-left ' + (active ? 'border-indigo-400/70 bg-indigo-400/10' : 'border-white/10 bg-white/[.02] hover:bg-white/[.05]')}><div className="flex items-center justify-between gap-2"><b className="text-xs text-white">{template.template_name}</b>{active && <span className="text-[9px] font-bold text-indigo-300">Selected</span>}</div><p className="mt-1 text-[10px] leading-4 text-slate-400">{template.description || 'Document layout preset'}</p></button>;
          })}</div>
        </section>

        <section className="mt-3 rounded-2xl border border-white/10 bg-slate-950/50 p-4">
          <p className="text-[9px] font-black uppercase tracking-[.18em] text-indigo-300">Visual identity</p>
          <div className="mt-3 grid grid-cols-2 gap-3">{[
            ['Primary', 'primary_color'], ['Secondary', 'secondary_color'], ['Accent', 'accent_color'], ['Text', 'text_color'], ['Background', 'background_color'],
          ].map(([label, key]) => <label key={key} className="text-[9px] font-bold uppercase tracking-wider text-slate-400">{label}<input type="color" value={(currentPref as unknown as Record<string, string>)[key]} onChange={event => updatePref({ [key]: event.target.value } as Partial<Pref>)} className="mt-1 h-9 w-full cursor-pointer rounded-lg border border-white/10 bg-slate-900 p-1" /></label>)}</div>
          <label className="mt-3 block text-[9px] font-bold uppercase tracking-wider text-slate-400">Font family<select value={currentPref.font_family} onChange={event => updatePref({ font_family: event.target.value })} className="mt-1 h-9 w-full rounded-lg border border-white/10 bg-slate-900 px-2 text-xs text-white">{FONT_OPTIONS.map(font => <option key={font} value={font}>{font}</option>)}</select></label>
          <label className="mt-3 block text-[9px] font-bold uppercase tracking-wider text-slate-400">Document title override<input value={currentPref.document_title_override || ''} onChange={event => updatePref({ document_title_override: event.target.value || null })} placeholder={DOC_TITLE[type]} className="mt-1 h-9 w-full rounded-lg border border-white/10 bg-slate-900 px-3 text-xs text-white placeholder:text-slate-600" /></label>
        </section>

        <section className="mt-3 rounded-2xl border border-white/10 bg-slate-950/50 p-4">
          <p className="text-[9px] font-black uppercase tracking-[.18em] text-indigo-300">Canvas spacing</p>
          <div className="mt-3"><label className="flex items-center justify-between text-[10px] font-semibold text-slate-300"><span>Row padding</span><b className="font-mono text-indigo-300">{currentConfig.row_padding}px</b></label><input type="range" min="4" max="16" step="1" value={currentConfig.row_padding} onChange={event => updateConfig({ row_padding: Number(event.target.value) })} className="mt-2 w-full" /></div>
          <div className="mt-4"><label className="flex items-center justify-between text-[10px] font-semibold text-slate-300"><span>Corner radius</span><b className="font-mono text-indigo-300">{currentConfig.corner_radius}px</b></label><input type="range" min="0" max="24" step="1" value={currentConfig.corner_radius} onChange={event => updateConfig({ corner_radius: Number(event.target.value) })} className="mt-2 w-full" /></div>
          <div className="mt-4"><label className="flex items-center justify-between text-[10px] font-semibold text-slate-300"><span>Logo width</span><b className="font-mono text-indigo-300">{currentConfig.logo_width}px</b></label><input type="range" min="48" max="160" step="4" value={currentConfig.logo_width} onChange={event => updateConfig({ logo_width: Number(event.target.value) })} className="mt-2 w-full" /></div>
          <label className="mt-4 flex items-center justify-between gap-3 text-xs font-semibold text-slate-300"><span><span className="block">Minimum item rows</span><small className="text-[9px] font-normal text-slate-500">Keeps short documents visually consistent.</small></span><input type="number" min="1" max="100" value={currentPref.min_item_rows} onChange={event => updatePref({ min_item_rows: Math.min(100, Math.max(1, Number(event.target.value) || 1)) })} className="w-20 rounded-lg border border-white/10 bg-slate-900 px-2 py-2 text-right font-mono text-xs text-white" /></label>
        </section>

        <section className="mt-3 rounded-2xl border border-white/10 bg-slate-950/50 p-4">
          <p className="text-[9px] font-black uppercase tracking-[.18em] text-indigo-300">Document controls</p>
          <div className="mt-3 space-y-2">{[
            ['show_logo', 'Show business logo', 'Business identity'],
            ['show_business_address', 'Show address & contacts', 'Business details'],
            ['show_tax_details', 'Show tax details', 'GST / tax fields'],
            ['show_customer_balance', 'Customer ledger balance footer', 'Outstanding / clear'],
            ['show_authorized_signatory', 'Authorised signatory', 'Signature authority'],
            ['show_signature', 'Signature area', 'Physical sign/stamp'],
            ['show_terms', 'Terms & notes', 'Footer content'],
            ['show_serial_numbers', 'Serial numbers', 'Tracked inventory'],
            ['show_bank_details', 'Bank details', 'Settlement instructions'],
            ['show_payment_link', 'Payment link', 'Online payment CTA'],
            ['show_payment_qr', 'Dynamic UPI QR', 'QR code'],
            ['prefill_upi_amount', 'Prefill UPI amount', payment.upi_id ? payment.upi_id : 'Configure UPI ID in Payment Settings'],
          ].map(([key, label, description]) => <label key={key} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 px-3 py-2.5"><span><b className="block text-[10px] text-slate-200">{label}</b><small className="text-[9px] text-slate-500">{description}</small></span><input type="checkbox" checked={Boolean((currentPref as unknown as Record<string, boolean>)[key])} onChange={event => updatePref({ [key]: event.target.checked } as Partial<Pref>)} className="h-4 w-4 accent-indigo-500" /></label>)}</div>
        </section>

        <section className="mt-3 rounded-2xl border border-white/10 bg-slate-950/50 p-4">
          <p className="text-[9px] font-black uppercase tracking-[.18em] text-indigo-300">Business identity</p>
          <div className="mt-3 grid gap-3">
            <label className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Business name<input value={brand.name} onChange={event => { setBrand({ ...brand, name: event.target.value }); setDirty(true); }} className="mt-1 h-9 w-full rounded-lg border border-white/10 bg-slate-900 px-3 text-xs text-white" /></label>
            <label className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Legal name<input value={brand.legal_name || ''} onChange={event => { setBrand({ ...brand, legal_name: event.target.value || null }); setDirty(true); }} className="mt-1 h-9 w-full rounded-lg border border-white/10 bg-slate-900 px-3 text-xs text-white" /></label>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Brand primary<input type="color" value={brand.brand_primary_color} onChange={event => { setBrand({ ...brand, brand_primary_color: event.target.value }); setDirty(true); }} className="mt-1 h-9 w-full rounded-lg border border-white/10 bg-slate-900 p-1" /></label>
              <label className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Brand accent<input type="color" value={brand.brand_accent_color} onChange={event => { setBrand({ ...brand, brand_accent_color: event.target.value }); setDirty(true); }} className="mt-1 h-9 w-full rounded-lg border border-white/10 bg-slate-900 p-1" /></label>
            </div>
          </div>
        </section>
      </aside>

      <section className="min-w-0 bg-slate-800">
        <div className="flex items-center justify-between border-b border-white/10 bg-slate-900 px-4 py-3 text-[10px] text-slate-400 sm:px-6"><span><b className="text-white">{DOC_TITLE[type]}</b> · {templateKey} · live print canvas</span><span>{DOCS.find(x => x.key === type)?.kind === 'receipt' ? 'Receipt / Cash Bill' : 'A4 / A5-style page'}</span></div>
        <div className="h-[calc(100vh-190px)] min-h-[760px] overflow-auto"><PreviewCanvas type={type} templateKey={templateKey} brand={brand} pref={currentPref} customer={customer} balance={balance} upiQr={upiQr} payment={payment} /></div>
      </section>
    </div>
  </main>;
}
