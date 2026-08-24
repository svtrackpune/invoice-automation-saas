'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase, type BusinessContext } from '@/lib/supabase';

type DocType = 'invoice' | 'quotation' | 'receipt';
type Template = { id: string; document_type: DocType; template_name: string; description: string | null; template_key: string };
type Brand = { name: string; legal_name: string | null; tax_registration_number: string | null; brand_primary_color: string; brand_secondary_color: string; brand_accent_color: string; logo_storage_path: string | null; logo_original_filename: string | null };

const SAMPLE = { customer: 'Rahul Sharma', number: 'INV-2026-0042', date: '21 Aug 2026', item: 'Professional Consulting Service' };
const KEYS = ['classic', 'minimal', 'modern', 'premium', 'professional'] as const;
type TemplateKey = typeof KEYS[number];

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-3xl border border-slate-200 bg-white shadow-[0_12px_40px_rgba(15,23,42,.05)] ${className}`}>{children}</section>;
}
function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 ${props.className || ''}`} />;
}
function Button({ children, onClick, secondary = false, disabled = false }: { children: React.ReactNode; onClick?: () => void; secondary?: boolean; disabled?: boolean }) {
  return <button type="button" disabled={disabled} onClick={onClick} className={`rounded-xl px-4 py-2.5 text-sm font-semibold disabled:opacity-50 ${secondary ? 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50' : 'bg-violet-600 text-white hover:bg-violet-700'}`}>{children}</button>;
}

function Preview({ type, keyName, brand, logoUrl, large = false }: { type: DocType; keyName: TemplateKey; brand: Brand; logoUrl: string; large?: boolean }) {
  const primary = brand.brand_primary_color || '#111827';
  const accent = brand.brand_accent_color || '#7c3aed';
  const title = type === 'invoice' ? 'TAX INVOICE' : type === 'quotation' ? 'ESTIMATE' : 'PAYMENT RECEIPT';
  const dark = keyName === 'professional';
  const serif = keyName === 'classic' || keyName === 'premium';
  const compact = keyName === 'minimal';
  const accentColor = keyName === 'classic' ? '#7f1d1d' : keyName === 'professional' ? '#0f3b66' : keyName === 'premium' ? '#5b21b6' : keyName === 'minimal' ? '#111827' : primary;
  const shell = keyName === 'modern' ? 'bg-violet-50/60 border-violet-100' : keyName === 'premium' ? 'border-violet-200' : keyName === 'minimal' ? 'border-slate-200' : keyName === 'classic' ? 'border-stone-300' : 'border-slate-800';
  const heading = keyName === 'modern' ? 'rounded-2xl bg-violet-50' : keyName === 'premium' ? 'rounded-2xl bg-white border border-violet-100' : keyName === 'minimal' ? 'border-b-0' : keyName === 'classic' ? 'border-b-2 border-stone-300' : 'rounded-xl';
  return <div className={`w-full bg-white ${large ? 'max-w-[820px] p-8 text-sm' : 'p-5 text-[9px]'} text-slate-700 shadow-sm ${shell}`} style={{ fontFamily: serif ? 'Georgia, serif' : 'Inter, Arial, sans-serif' }}>
    {keyName === 'premium' && <div className="-mx-8 -mt-8 mb-6 h-2 bg-gradient-to-r from-violet-800 via-violet-500 to-violet-200" />}
    <header className={`flex items-start justify-between gap-5 border-b pb-4 ${heading} ${dark ? 'bg-slate-950 text-white p-5 border-slate-950' : ''}`}>
      <div className="flex items-start gap-3">
        <div className={`${large ? 'h-16 w-20' : 'h-10 w-14'} grid shrink-0 place-items-center overflow-hidden rounded-lg border border-slate-200 bg-white p-1`}>
          {logoUrl ? <img src={logoUrl} alt="Business logo" className="max-h-full max-w-full object-contain" /> : <span className="font-bold text-slate-400">LOGO</span>}
        </div>
        <div><div className={`${large ? 'text-xl' : 'text-sm'} font-black`} style={{ color: dark ? '#fff' : accentColor }}>{brand.name || 'Your Business Name'}</div><div className="mt-1 text-slate-400">{brand.legal_name || 'Business & Professional Services'}</div>{brand.tax_registration_number && <div className="mt-1 text-slate-500">GSTIN: {brand.tax_registration_number}</div>}</div>
      </div>
      <div className="text-right"><div className={`${large ? 'text-3xl' : 'text-base'} font-black`} style={{ color: dark ? '#fff' : accent }}>{title}</div><div className="mt-2">{type === 'invoice' ? SAMPLE.number : type === 'quotation' ? 'EST-2026-0018' : 'RCT-2026-0091'}</div><div className="text-slate-400">{SAMPLE.date}</div></div>
    </header>
    <div className="mt-5 grid grid-cols-2 gap-5"><div><div className="font-bold uppercase tracking-wider text-slate-400">{type === 'receipt' ? 'Received from' : 'Bill to'}</div><div className="mt-1 font-bold text-slate-800">{SAMPLE.customer}</div><div>customer@example.com</div><div>+91 98765 43210</div></div><div className="text-right"><div className="font-bold uppercase tracking-wider text-slate-400">From</div><div className="mt-1 font-bold">{brand.name || 'Your Business Name'}</div><div>Nilanga, Maharashtra</div><div>+91 98765 00000</div></div></div>
    <div className={`mt-5 overflow-hidden border ${compact ? '' : 'rounded-lg'}`}><div className="grid grid-cols-[1fr_45px_75px_85px] gap-2 px-3 py-2 font-bold" style={{ backgroundColor: dark || keyName === 'modern' || keyName === 'premium' || keyName === 'classic' ? accentColor : '#f1f5f9', color: dark || keyName !== 'minimal' ? '#fff' : '#334155' }}><span>Description</span><span>Qty</span><span>Rate</span><span className="text-right">Amount</span></div><div className="grid grid-cols-[1fr_45px_75px_85px] gap-2 px-3 py-3 border-t border-slate-200"><span><b>{SAMPLE.item}</b><small className="block text-slate-400">Sample service / item description</small></span><span>2</span><span>₹2,500</span><span className="text-right font-semibold">₹5,000</span></div><div className="grid grid-cols-[1fr_45px_75px_85px] gap-2 px-3 py-3 border-t border-slate-100"><span>Additional service / item</span><span>1</span><span>₹1,000</span><span className="text-right font-semibold">₹1,000</span></div></div>
    <div className="mt-5 ml-auto max-w-xs space-y-2 border-t-2 pt-3"><div className="flex justify-between"><span>Subtotal</span><b>₹6,000</b></div><div className="flex justify-between"><span>GST (18%)</span><b>₹1,080</b></div><div className="flex justify-between border-t pt-2 text-lg font-black" style={{ borderColor: accentColor, color: accentColor }}><span>Total</span><span>₹7,080</span></div></div>
    {type === 'invoice' && <div className={`mt-5 flex items-center justify-between gap-4 border p-4 ${keyName === 'premium' ? 'rounded-2xl bg-violet-50 border-violet-200' : 'rounded-lg bg-slate-50'}`}><div><b>Payment options</b><div className="mt-1 text-slate-500">Pay this invoice easily</div><button type="button" disabled className="mt-2 rounded-lg px-3 py-1.5 text-xs font-bold text-white" style={{ backgroundColor: accentColor }}>Pay Now</button></div><div className="grid h-16 w-16 place-items-center rounded-lg border-2 border-dashed text-xs font-bold" style={{ color: accentColor, borderColor: accentColor }}>QR</div></div>}
    <footer className="mt-5 border-t pt-3 text-slate-400">Thank you for your business · Terms & conditions apply · Sample preview</footer>
  </div>;
}

export default function BrandManager() {
  const [ctx, setCtx] = useState<BusinessContext | null>(null);
  const [brand, setBrand] = useState<Brand | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [type, setType] = useState<DocType>('invoice');
  const [logoUrl, setLogoUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<Template | null>(null);

  useEffect(() => {
    (async () => {
      const context = await supabase.rpc('get_my_business_context');
      const business = context.data?.[0] as BusinessContext | undefined;
      if (!business) { location.href = '/'; return; }
      setCtx(business);
      const [b, t, p] = await Promise.all([
        supabase.from('businesses').select('name,legal_name,tax_registration_number,brand_primary_color,brand_secondary_color,brand_accent_color,logo_storage_path,logo_original_filename').eq('id', business.business_id).single(),
        supabase.from('document_templates').select('id,document_type,template_name,description,template_key').eq('is_active', true).order('document_type').order('template_name'),
        supabase.from('business_document_preferences').select('document_type,template_id').eq('business_id', business.business_id),
      ]);
      if (b.error) { setError(b.error.message); return; }
      if (t.error) { setError(t.error.message); return; }
      setBrand(b.data as Brand);
      setTemplates((t.data || []) as Template[]);
      setSelected(Object.fromEntries((p.data || []).map((x: any) => [x.document_type, x.template_id])));
      if (b.data?.logo_storage_path) setLogoUrl(supabase.storage.from('business-branding-public').getPublicUrl(b.data.logo_storage_path).data.publicUrl);
    })();
  }, []);

  const current = useMemo(() => templates.filter(t => t.document_type === type), [templates, type]);

  async function saveBranding() {
    if (!ctx || !brand) return;
    setBusy(true); setError(''); setMessage('');
    const r = await supabase.from('businesses').update({ name: brand.name, legal_name: brand.legal_name || null, tax_registration_number: brand.tax_registration_number || null, brand_primary_color: brand.brand_primary_color, brand_secondary_color: brand.brand_secondary_color, brand_accent_color: brand.brand_accent_color }).eq('id', ctx.business_id);
    if (r.error) setError(r.error.message); else setMessage('Business branding saved.');
    setBusy(false);
  }

  async function chooseTemplate(template: Template) {
    if (!ctx || !brand) return;
    setBusy(true); setError(''); setMessage('');
    const r = await supabase.from('business_document_preferences').upsert({ business_id: ctx.business_id, document_type: template.document_type, template_id: template.id, primary_color: brand.brand_primary_color, secondary_color: brand.brand_secondary_color, accent_color: brand.brand_accent_color, text_color: '#0f172a', background_color: '#ffffff', font_family: 'Inter', show_logo: true, show_business_address: true, show_tax_details: true, show_payment_qr: true, show_payment_link: true, show_signature: true, show_terms: true, custom_fields: {} }, { onConflict: 'business_id,document_type' });
    if (r.error) setError(r.error.message); else { setSelected(s => ({ ...s, [template.document_type]: template.id })); setMessage(`${template.template_name} selected for ${template.document_type}.`); setPreview(null); }
    setBusy(false);
  }

  async function uploadLogo(file: File) {
    if (!ctx) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) { setError('Use PNG/JPG/WebP up to 5 MB.'); return; }
    setBusy(true); setError(''); setMessage('');
    const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
    const path = `${ctx.business_id}/logo-${Date.now()}.${ext}`;
    const upload = await supabase.storage.from('business-branding-public').upload(path, file, { upsert: true, contentType: file.type });
    if (upload.error) { setError(upload.error.message); setBusy(false); return; }
    const update = await supabase.from('businesses').update({ logo_storage_path: path, logo_original_filename: file.name, logo_mime_type: file.type, logo_updated_at: new Date().toISOString() }).eq('id', ctx.business_id);
    if (update.error) { setError(update.error.message); setBusy(false); return; }
    await supabase.from('business_brand_assets').update({ is_active: false }).eq('business_id', ctx.business_id).in('asset_type', ['logo_original', 'logo_display', 'logo_small']);
    await supabase.from('business_brand_assets').insert({ business_id: ctx.business_id, asset_type: 'logo_display', storage_path: path, mime_type: file.type, original_filename: file.name, is_active: true });
    setLogoUrl(supabase.storage.from('business-branding-public').getPublicUrl(path).data.publicUrl);
    setMessage('Logo saved for this business.');
    setBusy(false);
  }

  if (!brand) return <div className="grid min-h-screen place-items-center bg-slate-50 text-sm text-slate-500">Loading branding…</div>;

  return <main className="min-h-screen bg-[#f6f7fb] p-4 text-slate-950 sm:p-7">
    <div className="mx-auto max-w-7xl">
      <header className="mb-6 flex items-end justify-between gap-4"><div><p className="text-[11px] font-bold uppercase tracking-[.18em] text-violet-600">Business control centre</p><h1 className="mt-1 text-3xl font-semibold">Branding & document templates</h1><p className="mt-1 text-sm text-slate-500">Choose the exact invoice, estimate and receipt design used by this business.</p></div><Button secondary onClick={() => location.href = '/next-workspace'}>Back</Button></header>
      {(error || message) && <div className={`mb-5 rounded-xl border px-4 py-3 text-sm font-semibold ${error ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>{error || message}</div>}
      <div className="grid gap-5 xl:grid-cols-[.72fr_1.28fr]">
        <Card className="p-6">
          <h2 className="text-lg font-semibold">Business identity</h2>
          <div className="mt-5 grid gap-4">
            <label className="text-xs font-semibold">Business name<Input className="mt-1" value={brand.name} onChange={e => setBrand({ ...brand, name: e.target.value })} /></label>
            <label className="text-xs font-semibold">Legal name<Input className="mt-1" value={brand.legal_name || ''} onChange={e => setBrand({ ...brand, legal_name: e.target.value })} /></label>
            <label className="text-xs font-semibold">GST / Tax registration<Input className="mt-1" value={brand.tax_registration_number || ''} onChange={e => setBrand({ ...brand, tax_registration_number: e.target.value })} /></label>
            <div className="grid grid-cols-3 gap-3"><Input type="color" value={brand.brand_primary_color} onChange={e => setBrand({ ...brand, brand_primary_color: e.target.value })} className="h-11 p-1" /><Input type="color" value={brand.brand_secondary_color} onChange={e => setBrand({ ...brand, brand_secondary_color: e.target.value })} className="h-11 p-1" /><Input type="color" value={brand.brand_accent_color} onChange={e => setBrand({ ...brand, brand_accent_color: e.target.value })} className="h-11 p-1" /></div>
            <Button disabled={busy} onClick={saveBranding}>Save branding</Button>
          </div>
          <div className="mt-7 border-t border-slate-100 pt-6"><b className="text-sm">Business logo</b><p className="mt-1 text-xs text-slate-400">Used automatically on document previews and generated documents.</p><div className="mt-4 flex items-center gap-4"><div className="grid h-24 w-32 place-items-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-3">{logoUrl ? <img src={logoUrl} alt="Business logo" className="max-h-full max-w-full object-contain" /> : <span className="text-xs text-slate-400">No logo</span>}</div><label className="cursor-pointer rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white"><input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={e => { const file = e.target.files?.[0]; if (file) uploadLogo(file); }} />{logoUrl ? 'Replace logo' : 'Upload logo'}</label></div></div>
        </Card>
        <Card className="p-6">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Document templates</h2><p className="mt-1 text-xs text-slate-400">Five production templates are available for each document type.</p></div><div className="flex rounded-xl bg-slate-100 p-1">{(['invoice','quotation','receipt'] as DocType[]).map(x => <button type="button" key={x} onClick={() => setType(x)} className={`rounded-lg px-3 py-2 text-xs font-semibold capitalize ${type === x ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>{x === 'quotation' ? 'Estimate' : x}</button>)}</div></div>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{current.map(template => { const key = (KEYS.includes(template.template_key as TemplateKey) ? template.template_key : 'modern') as TemplateKey; const selectedHere = selected[type] === template.id; return <div key={template.id} className={`rounded-2xl border p-3 ${selectedHere ? 'border-violet-500 ring-2 ring-violet-100' : 'border-slate-200'}`}><button type="button" className="block w-full text-left" onClick={() => setPreview(template)}><div className="aspect-[4/3] overflow-hidden rounded-xl border bg-slate-50"><div className="origin-top-left scale-[.36]" style={{ width: '278%', height: '278%' }}><Preview type={type} keyName={key} brand={brand} logoUrl={logoUrl} /></div></div></button><div className="mt-3 flex items-start justify-between gap-2"><div><b className="block text-sm">{template.template_name}</b><span className="text-[11px] text-slate-400">{template.description || `${key} production layout`}</span></div>{selectedHere && <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700">Selected</span>}</div><button type="button" onClick={() => setPreview(template)} className="mt-3 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">View preview</button></div>; })}</div>
          {!current.length && <div className="rounded-2xl border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500">No active {type} templates are available.</div>}
        </Card>
      </div>
    </div>
    {preview && <div className="fixed inset-0 z-50 bg-slate-950/70 p-3 sm:p-6"><div className="mx-auto flex h-full max-w-5xl flex-col overflow-hidden rounded-3xl bg-white"><div className="flex items-center justify-between border-b px-5 py-4"><div><b>{preview.template_name}</b><span className="ml-2 text-xs text-slate-400">{preview.document_type === 'quotation' ? 'Estimate' : preview.document_type}</span></div><div className="flex gap-2"><Button disabled={busy} onClick={() => chooseTemplate(preview)}>Use this template</Button><Button secondary onClick={() => setPreview(null)}>Close</Button></div></div><div className="flex-1 overflow-auto bg-slate-100 p-4 sm:p-8"><Preview type={preview.document_type} keyName={(KEYS.includes(preview.template_key as TemplateKey) ? preview.template_key : 'modern') as TemplateKey} brand={brand} logoUrl={logoUrl} large /></div></div></div>}
  </main>;
}
