'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';

type Category = { id: string; name: string; sort_order: number };
type Subcategory = { id: string; category_id: string; name: string; sort_order: number };
type Step = 1 | 2 | 3 | 4;

const input = 'w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100';
const button = 'rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50';
const secondary = 'rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50';

const designations = [
  'Owner / Founder',
  'CEO / Director',
  'Partner',
  'Manager',
  'Accountant / CA',
  'Sales Manager',
  'Store Keeper',
  'Operations Manager',
  'Other',
] as const;

const operatingModels = [
  ['Retailer', 'retailer', 'Fast-moving retail, counter sales, local customers.'],
  ['Wholesaler', 'wholesaler', 'B2B orders, credit customers, bulk selling.'],
  ['Manufacturer', 'manufacturer', 'Production, raw materials, finished goods and COGS.'],
  ['Service Provider', 'service_provider', 'Professional services, projects or billable work.'],
  ['Freelancer / Consultant', 'freelancer', 'Independent services, consulting or advisory work.'],
  ['Contractor', 'contractor', 'Project-based contracting and field work.'],
  ['E-commerce', 'ecommerce', 'Online storefronts and marketplace selling.'],
] as const;

const states = ['Maharashtra','Karnataka','Telangana','Gujarat','Delhi','Tamil Nadu','Uttar Pradesh','Rajasthan','Madhya Pradesh','Other'];

const termsPresets = [
  ['Standard', 'Payment due within the agreed credit period.'],
  ['Trade', 'Payment due as per agreed credit terms. Goods should be checked at delivery and returns are subject to the agreed business policy.'],
  ['Services', 'Payment due as per the agreed milestone or credit terms. Any scope changes are subject to written approval.'],
] as const;

function Field({ label, required, children, help }: { label: string; required?: boolean; children: ReactNode; help?: string }) {
  return <label className="block"><span className="mb-1.5 block text-xs font-semibold text-slate-700">{label}{required ? ' *' : ''}</span>{children}{help ? <span className="mt-1 block text-[11px] leading-4 text-slate-400">{help}</span> : null}</label>;
}

function OptionCard({ selected, title, description, onClick }: { selected: boolean; title: string; description: string; onClick: () => void }) {
  return <button type="button" aria-pressed={selected} onClick={onClick} className={'rounded-2xl border p-4 text-left transition ' + (selected ? 'border-indigo-400 bg-indigo-50 shadow-sm' : 'border-slate-200 bg-white hover:border-slate-300')}>
    <span className={'mb-3 grid h-7 w-7 place-items-center rounded-lg text-xs font-black ' + (selected ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500')}>{selected ? '✓' : '•'}</span>
    <b className="block text-sm text-slate-900">{title}</b>
    <span className="mt-1 block text-xs leading-5 text-slate-500">{description}</span>
  </button>;
}

export default function OnboardingPage() {
  const [step, setStep] = useState<Step>(1);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [designation, setDesignation] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [categoryId, setCategoryId] = useState('');
  const [subcategoryId, setSubcategoryId] = useState('');
  const [gstRegistered, setGstRegistered] = useState(true);
  const [gstin, setGstin] = useState('');
  const [taxState, setTaxState] = useState('Maharashtra');
  const [termsMode, setTermsMode] = useState('standard');
  const [terms, setTerms] = useState<string>(termsPresets[0][1]);
  const [brandColor, setBrandColor] = useState('#4f46e5');
  const [invoicePrefix, setInvoicePrefix] = useState('INV-');
  const [categories, setCategories] = useState<Category[]>([]);
  const [subcategories, setSubcategories] = useState<Subcategory[]>([]);

  useEffect(() => {
    (async () => {
      const session = await supabase.auth.getSession();
      if (!session.data.session) {
        window.location.replace('/');
        return;
      }

      const context = await supabase.rpc('get_my_business_context');
      if (context.error) {
        setError(context.error.message);
        setLoading(false);
        return;
      }
      if (Array.isArray(context.data) && context.data.length) {
        window.location.replace('/next-workspace');
        return;
      }

      const [c, s] = await Promise.all([
        supabase.from('business_categories').select('id,name,sort_order').eq('is_active', true).order('sort_order'),
        supabase.from('business_subcategories').select('id,category_id,name,sort_order').eq('is_active', true).order('sort_order'),
      ]);
      if (c.error || s.error) {
        setError((c.error || s.error)?.message || 'Unable to load industry classifications.');
        setLoading(false);
        return;
      }
      setCategories((c.data || []) as Category[]);
      setSubcategories((s.data || []) as Subcategory[]);
      setLoading(false);
    })();
  }, []);

  const visibleSubcategories = useMemo(
    () => subcategories.filter((item) => item.category_id === categoryId),
    [subcategories, categoryId],
  );

  const selectedCategory = categories.find((x) => x.id === categoryId);
  const selectedSubcategory = subcategories.find((x) => x.id === subcategoryId);

  const toggleModel = (value: string) => {
    setModels((current) => current.includes(value) ? current.filter((x) => x !== value) : [...current, value]);
  };

  const goNext = () => {
    setError('');
    if (step === 1) {
      if (!businessName.trim()) return setError('Business name is required.');
      if (!designation) return setError('Please select your designation.');
      if (!models.length) return setError('Select at least one operating model.');
    }
    if (step === 2) {
      if (!categoryId) return setError('Please select your industry.');
      if (!subcategoryId) return setError('Please select your business sub-category.');
    }
    if (step === 3) {
      if (gstRegistered && !taxState.trim()) return setError('Tax state is required for GST registration.');
      const normalizedColor = brandColor.trim().toUpperCase();
      if (!/^#[0-9A-F]{6}$/.test(normalizedColor)) return setError('Brand color must be a 6-digit hex value.');
      if (gstRegistered && gstin.trim() && !/^[0-9]{2}[A-Za-z0-9]{13}$/.test(gstin.trim())) return setError('GSTIN should be 15 characters in the standard format.');
    }
    setStep((current) => Math.min(4, current + 1) as Step);
  };

  const goBack = () => {
    setError('');
    setStep((current) => Math.max(1, current - 1) as Step);
  };

  const launch = async () => {
    setBusy(true);
    setError('');
    const result = await supabase.rpc('complete_onboarding_wizard', {
      p_business_name: businessName.trim(),
      p_designation: designation.trim(),
      p_operating_models: models,
      p_category_id: categoryId,
      p_subcategory_id: subcategoryId,
      p_gst_registered: gstRegistered,
      p_gstin: gstRegistered ? (gstin.trim() || null) : null,
      p_tax_state: gstRegistered ? taxState : null,
      p_terms: terms.trim(),
      p_brand_color: brandColor.trim().toUpperCase(),
      p_invoice_prefix: invoicePrefix.trim() || 'INV-',
    });
    if (result.error) {
      setError(result.error.message);
      setBusy(false);
      return;
    }
    const payload = result.data as { success?: boolean; business_id?: string } | null;
    if (!payload?.success || !payload.business_id) {
      setError('Business was provisioned, but the workspace could not be opened.');
      setBusy(false);
      return;
    }
    localStorage.setItem('moneymatters.activeBusinessId', payload.business_id);
    window.location.replace('/next-workspace');
  };

  const inventoryAuto = models.some((x) => x === 'retailer' || x === 'wholesaler' || x === 'manufacturer');
  const services = models.some((x) => x === 'service_provider' || x === 'freelancer' || x === 'contractor');
  const b2b = models.some((x) => x === 'wholesaler' || x === 'manufacturer' || x === 'service_provider' || x === 'contractor');

  if (loading) return <main className="grid min-h-screen place-items-center bg-slate-50 text-sm text-slate-500">Preparing your workspace setup…</main>;

  return <main className="min-h-screen bg-slate-50 p-4 sm:p-8">
    <div className="mx-auto max-w-5xl">
      <header className="mb-6 flex items-center justify-between gap-4">
        <div><span className="text-[10px] font-black uppercase tracking-[.2em] text-indigo-600">Moneymatters</span><h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">Set up your workspace</h1></div>
        <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-500">Step {step} of 4</span>
      </header>

      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_20px_70px_rgba(15,23,42,.08)]">
        <div className="border-b border-slate-200 bg-gradient-to-r from-slate-50 via-white to-indigo-50/40 px-6 py-6 sm:px-9">
          <div className="grid grid-cols-4 gap-2">{['Role & operation','Industry','Invoicing & GST','Synthesis & launch'].map((label, index) => <div key={label}><div className={'h-1.5 rounded-full ' + (index + 1 <= step ? 'bg-indigo-600' : 'bg-slate-200')} /><span className={'mt-2 block text-[10px] font-bold uppercase tracking-wider ' + (index + 1 <= step ? 'text-indigo-700' : 'text-slate-400')}>{label}</span></div>)}</div>
        </div>

        <div className="p-6 sm:p-9">
          {step === 1 && <section>
            <p className="text-[10px] font-black uppercase tracking-[.18em] text-indigo-600">Step 1</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Tell us how you work</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">We use this to shape the operating workspace. It does not change your accounting rules.</p>

            <div className="mt-7">
              <Field label="Your role / designation" required><div className="grid gap-3 sm:grid-cols-3">{designations.map((label) => <OptionCard key={label} selected={designation === label} title={label} description="Saved to your personal profile." onClick={() => setDesignation(label)} />)}</div></Field>
            </div>

            <div className="mt-8">
              <Field label="How does your business operate?" required help="Choose one or more. Inventory is automatically activated for retailer, wholesaler and manufacturer models.">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{operatingModels.map(([label, value, description]) => <OptionCard key={value} selected={models.includes(value)} title={label} description={description} onClick={() => toggleModel(value)} />)}</div>
              </Field>
            </div>

            <div className="mt-7">
              <Field label="Business name" required><input autoFocus className={input} value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="e.g. ABC Traders" /></Field>
            </div>
          </section>}

          {step === 2 && <section>
            <p className="text-[10px] font-black uppercase tracking-[.18em] text-indigo-600">Step 2</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Classify your industry</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">Your category and sub-category drive the business capability presets used across the workspace.</p>
            <div className="mt-7 grid gap-5 sm:grid-cols-2">
              <Field label="Industry" required><select className={input} value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setSubcategoryId(''); }}><option value="">Select industry</option>{categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
              <Field label="Business sub-category" required><select className={input} disabled={!categoryId} value={subcategoryId} onChange={(e) => setSubcategoryId(e.target.value)}><option value="">{categoryId ? 'Select sub-category' : 'Select industry first'}</option>{visibleSubcategories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
            </div>
            <div className="mt-7 rounded-2xl border border-indigo-100 bg-indigo-50/50 p-5">
              <p className="text-xs font-bold text-indigo-800">What this changes</p>
              <div className="mt-2 grid gap-3 sm:grid-cols-3"><div className="rounded-xl bg-white p-3"><b className="block text-xs text-slate-900">Navigation</b><span className="mt-1 block text-[11px] leading-5 text-slate-500">Relevant workflows are surfaced from the existing capability engine.</span></div><div className="rounded-xl bg-white p-3"><b className="block text-xs text-slate-900">Accounting</b><span className="mt-1 block text-[11px] leading-5 text-slate-500">Seeded accounts remain governed by the accounting engine.</span></div><div className="rounded-xl bg-white p-3"><b className="block text-xs text-slate-900">Documents</b><span className="mt-1 block text-[11px] leading-5 text-slate-500">Invoice, quotation and receipt defaults are initialized automatically.</span></div></div>
            </div>
          </section>}

          {step === 3 && <section>
            <p className="text-[10px] font-black uppercase tracking-[.18em] text-indigo-600">Step 3</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Set invoicing & GST defaults</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">These values become the initial business defaults. You can refine them later in Business Settings.</p>

            <div className="mt-7 grid gap-4 sm:grid-cols-2">
              <OptionCard selected={gstRegistered} title="GST registered" description="Configure GST as the authoritative tax regime and seed standard GST slabs." onClick={() => setGstRegistered(true)} />
              <OptionCard selected={!gstRegistered} title="Not GST registered" description="Keep tax-specific charging off until you enable a tax regime later." onClick={() => setGstRegistered(false)} />
            </div>

            {gstRegistered && <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <Field label="Tax state" required><select className={input} value={taxState} onChange={(e) => setTaxState(e.target.value)}>{states.map((state) => <option key={state}>{state}</option>)}</select></Field>
              <Field label="GSTIN" help="Optional during onboarding; it can be added or verified later."><input className={input} value={gstin} onChange={(e) => setGstin(e.target.value.toUpperCase())} maxLength={15} placeholder="27AAAAA0000A1Z5" /></Field>
            </div>}

            <div className="mt-7 grid gap-5 lg:grid-cols-[1.3fr_.7fr]">
              <Field label="Default terms & conditions"><div className="space-y-2">{termsPresets.map(([label, presetText]) => <button key={label} type="button" aria-pressed={termsMode === label.toLowerCase()} onClick={() => { setTermsMode(label.toLowerCase()); setTerms(presetText); }} className={'w-full rounded-xl border p-3 text-left ' + (termsMode === label.toLowerCase() ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200')}><b className="block text-xs text-slate-900">{label}</b><span className="mt-1 block text-[11px] leading-5 text-slate-500">{presetText}</span></button>)}<button type="button" aria-pressed={termsMode === 'custom'} onClick={() => setTermsMode('custom')} className={'w-full rounded-xl border p-3 text-left ' + (termsMode === 'custom' ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200')}><b className="block text-xs text-slate-900">Custom</b><span className="mt-1 block text-[11px] text-slate-500">Write your own default terms.</span></button>{termsMode === 'custom' ? <textarea className={input + ' min-h-32'} value={terms} onChange={(e) => setTerms(e.target.value)} maxLength={4000} /> : null}</div></Field>

              <div className="space-y-5">
                <Field label="Invoice prefix"><input className={input} value={invoicePrefix} onChange={(e) => setInvoicePrefix(e.target.value)} maxLength={20} placeholder="INV-" /></Field>
                <Field label="Primary brand color" help="Used for the initial invoice, quotation and receipt document preferences."><div className="flex gap-3"><input type="color" value={/^#[0-9A-Fa-f]{6}$/.test(brandColor) ? brandColor : '#4f46e5'} onChange={(e) => setBrandColor(e.target.value)} className="h-11 w-14 rounded-xl border border-slate-200 bg-white p-1" /><input className={input} value={brandColor} onChange={(e) => setBrandColor(e.target.value)} maxLength={7} placeholder="#4f46e5" /></div></Field>
              </div>
            </div>
          </section>}

          {step === 4 && <section>
            <p className="text-[10px] font-black uppercase tracking-[.18em] text-indigo-600">Step 4</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Synthesize your workspace</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">Review the choices once. Launching creates the business, membership, accounting defaults, tax profile, documents and capability configuration in one transaction.</p>

            <div className="mt-7 grid gap-4 lg:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 p-5"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Business identity</p><p className="mt-2 text-lg font-semibold text-slate-950">{businessName || '—'}</p><p className="mt-1 text-xs text-slate-500">{designation || '—'} · India · INR</p></div>
              <div className="rounded-2xl border border-slate-200 p-5"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Industry</p><p className="mt-2 text-lg font-semibold text-slate-950">{selectedCategory?.name || '—'}</p><p className="mt-1 text-xs text-slate-500">{selectedSubcategory?.name || '—'}</p></div>
              <div className="rounded-2xl border border-slate-200 p-5"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Operating model</p><div className="mt-2 flex flex-wrap gap-2">{models.map((model) => <span key={model} className="rounded-full bg-indigo-50 px-2.5 py-1 text-[10px] font-bold text-indigo-700">{operatingModels.find((x) => x[1] === model)?.[0] || model}</span>)}</div><p className="mt-3 text-xs text-slate-500">Inventory: <b>{inventoryAuto ? 'automatic' : 'not central'}</b> · Services/projects: <b>{services ? 'enabled' : 'not central'}</b> · B2B: <b>{b2b ? 'enabled' : 'not central'}</b></p></div>
              <div className="rounded-2xl border border-slate-200 p-5"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Invoicing</p><p className="mt-2 text-lg font-semibold text-slate-950">{gstRegistered ? 'GST registered' : 'Not GST registered'}</p><p className="mt-1 text-xs text-slate-500">{gstRegistered ? ((gstin ? 'GSTIN ' + gstin + ' · ' : '') + taxState) : 'Tax regime off at launch'}</p><div className="mt-3 flex items-center gap-2"><span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold text-slate-700">{invoicePrefix || 'INV-'}</span><span className="h-5 w-5 rounded border border-slate-200" style={{ backgroundColor: brandColor }} /></div></div>
            </div>

            <div className="mt-5 rounded-2xl border border-indigo-100 bg-indigo-50/40 p-5">
              <p className="text-xs font-bold text-indigo-800">What launches automatically</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2"><span className="text-xs text-slate-700">✓ Owner membership and workspace access</span><span className="text-xs text-slate-700">✓ Chart of Accounts and accounting defaults</span><span className="text-xs text-slate-700">✓ Invoice / quotation / receipt defaults</span><span className="text-xs text-slate-700">✓ GST profile and standard slabs when registered</span>{inventoryAuto ? <span className="text-xs text-slate-700">✓ Inventory location and stock capability</span> : <span className="text-xs text-slate-700">✓ Capability flags for the selected operating model</span>}<span className="text-xs text-slate-700">✓ Your designation and active business context</span></div>
            </div>
          </section>}

          {error && <div className="mt-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

          <div className="mt-8 flex flex-col-reverse gap-3 border-t border-slate-100 pt-6 sm:flex-row sm:items-center sm:justify-between">
            <button type="button" className={secondary + ' disabled:opacity-40'} onClick={goBack} disabled={step === 1 || busy}>← Back</button>
            {step < 4 ? <button type="button" className={button} onClick={goNext}>Continue →</button> : <button type="button" className={button} onClick={launch} disabled={busy}>{busy ? 'Launching workspace…' : 'Launch Moneymatters →'}</button>}
          </div>
        </div>
      </section>
    </div>
  </main>;
}
