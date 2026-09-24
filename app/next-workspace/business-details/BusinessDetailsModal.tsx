'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import BusinessCapabilitiesChecklist from './BusinessCapabilitiesChecklist';
import { DEFAULT_BUSINESS_CONFIG, normalizeBusinessConfig, type BusinessFeatureConfig } from '@/lib/business-config';

type Address = {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country?: string;
};

type BusinessProfile = {
  id: string;
  name: string;
  legal_name: string | null;
  phone: string | null;
  alternate_phone: string | null;
  contact_person_name: string | null;
  contact_person_designation: string | null;
  email: string | null;
  alternate_email: string | null;
  website: string | null;
  google_location_link: string | null;
  address: Address | null;
  feature_flags: BusinessFeatureConfig;
};

type Props = {
  businessId: string;
  onSaved: () => void;
  onSkip?: () => void;
};

const input = 'w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100';
const Field = ({ label, required, children, help }: { label: string; required?: boolean; children: ReactNode; help?: string }) => (
  <label className="block">
    <span className="mb-1.5 block text-xs font-semibold text-slate-700">{label}{required ? ' *' : ''}</span>
    {children}
    {help && <span className="mt-1 block text-[11px] leading-4 text-slate-400">{help}</span>}
  </label>
);

const emptyAddress: Address = { line1: '', line2: '', city: '', state: '', postal_code: '', country: 'India' };

export default function BusinessDetailsModal({ businessId, onSaved, onSkip }: Props) {
  const [business, setBusiness] = useState<BusinessProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [categoryName, setCategoryName] = useState<string | null>(null);
  const [subcategoryName, setSubcategoryName] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data, error: loadError } = await supabase
        .from('businesses')
        .select('id,name,legal_name,phone,alternate_phone,contact_person_name,contact_person_designation,email,alternate_email,website,google_location_link,address,feature_flags,category_id,subcategory_id')
        .eq('id', businessId)
        .maybeSingle();
      if (!active) return;
      if (loadError) setError(loadError.message);
      else if (!data) setError('Business details could not be loaded.');
      else {
        const row = data as BusinessProfile & { category_id?: string | null; subcategory_id?: string | null; feature_flags?: unknown };
        setBusiness({ ...row, feature_flags: normalizeBusinessConfig(row.feature_flags), address: { ...emptyAddress, ...(row.address || {}) } });
        const [{ data: category }, { data: subcategory }] = await Promise.all([
          row.category_id ? supabase.from('business_categories').select('name').eq('id', row.category_id).maybeSingle() : Promise.resolve({ data: null } as any),
          row.subcategory_id ? supabase.from('business_subcategories').select('name').eq('id', row.subcategory_id).maybeSingle() : Promise.resolve({ data: null } as any),
        ]);
        if (!active) return;
        setCategoryName(category?.name || null);
        setSubcategoryName(subcategory?.name || null);
      }
      setLoading(false);
    })();
    return () => { active = false; };
  }, [businessId]);

  const patch = (key: keyof BusinessProfile, value: string) => setBusiness((x) => x ? { ...x, [key]: value } : x);
  const patchFeatures = (feature_flags: BusinessFeatureConfig) => setBusiness((x) => x ? { ...x, feature_flags } : x);
  const patchAddress = (key: keyof Address, value: string) => setBusiness((x) => x ? { ...x, address: { ...(x.address || emptyAddress), [key]: value } } : x);

  const save = async () => {
    if (!business) return;
    setSaving(true);
    setError('');

    const website = business.website?.trim() || '';
    const googleLocation = business.google_location_link?.trim() || '';
    if (website && !/^https?:\/\//i.test(website)) {
      setError('Website should start with http:// or https://.');
      setSaving(false);
      return;
    }
    if (googleLocation && !/^https?:\/\//i.test(googleLocation)) {
      setError('Google location link should start with http:// or https://.');
      setSaving(false);
      return;
    }
    if (!business.name.trim()) {
      setError('Business name is required.');
      setSaving(false);
      return;
    }

    const { error: saveError } = await supabase.from('businesses').update({
      legal_name: business.legal_name?.trim() || null,
      phone: business.phone?.trim() || null,
      alternate_phone: business.alternate_phone?.trim() || null,
      contact_person_name: business.contact_person_name?.trim() || null,
      contact_person_designation: business.contact_person_designation?.trim() || null,
      email: business.email?.trim() || null,
      alternate_email: business.alternate_email?.trim() || null,
      website: website || null,
      google_location_link: googleLocation || null,
      address: business.address || emptyAddress,
      feature_flags: business.feature_flags,
      onboarding_complete: true,
      onboarding_step: 'business_details_complete',
    }).eq('id', business.id);

    if (saveError) {
      setError(saveError.message);
      setSaving(false);
      return;
    }

    setSaving(false);
    onSaved();
  };

  if (loading) {
    return (
      <div className="fixed inset-0 z-[120] grid place-items-center bg-slate-950/35 p-4">
        <div className="w-full max-w-xl rounded-3xl bg-white p-8 shadow-2xl"><p className="text-sm text-slate-500">Loading business details…</p></div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[120] overflow-y-auto bg-slate-950/45 p-4 sm:p-8" role="dialog" aria-modal="true" aria-labelledby="business-details-title">
      <div className="mx-auto my-4 w-full max-w-3xl overflow-hidden rounded-3xl border border-violet-100 bg-white shadow-2xl sm:my-10">
        <div className="border-b border-slate-100 bg-gradient-to-r from-violet-50 via-white to-white px-6 py-6 sm:px-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[.18em] text-violet-600">Complete business profile</p>
              <h2 id="business-details-title" className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">Add your business details</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">These details appear on invoices, estimates, receipts and customer-facing documents. Complete them once here so every document stays consistent.</p>
            </div>
            {onSkip && <button type="button" onClick={onSkip} className="shrink-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">Skip for now</button>}
          </div>
        </div>

        <div className="space-y-6 p-6 sm:p-8">
          {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

          {business && (
            <>
              <section>
                <h3 className="text-sm font-bold text-slate-900">Business contact</h3>
                <p className="mt-1 text-xs text-slate-500">Use the main contact customers should see first, then add a fallback contact when needed.</p>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <Field label="Business phone"><input className={input} type="tel" value={business.phone || ''} onChange={(e) => patch('phone', e.target.value)} placeholder="+91 98765 43210" autoComplete="tel" /></Field>
                  <Field label="Alternative phone"><input className={input} type="tel" value={business.alternate_phone || ''} onChange={(e) => patch('alternate_phone', e.target.value)} placeholder="+91 98765 43211" autoComplete="tel" /></Field>
                  <Field label="Contact person"><input className={input} value={business.contact_person_name || ''} onChange={(e) => patch('contact_person_name', e.target.value)} placeholder="Full name" autoComplete="name" /></Field>
                  <Field label="Designation"><input className={input} value={business.contact_person_designation || ''} onChange={(e) => patch('contact_person_designation', e.target.value)} placeholder="Owner / Manager / Director" /></Field>
                  <Field label="Email address"><input className={input} type="email" value={business.email || ''} onChange={(e) => patch('email', e.target.value)} placeholder="contact@business.com" autoComplete="email" /></Field>
                  <Field label="Alternative email"><input className={input} type="email" value={business.alternate_email || ''} onChange={(e) => patch('alternate_email', e.target.value)} placeholder="backup@business.com" autoComplete="email" /></Field>
                  <Field label="Website"><input className={input} type="url" value={business.website || ''} onChange={(e) => patch('website', e.target.value)} placeholder="https://example.com" /></Field>
                  <Field label="Google location link" help="Paste the Google Maps share link for your shop or office."><input className={input} type="url" value={business.google_location_link || ''} onChange={(e) => patch('google_location_link', e.target.value)} placeholder="https://maps.google.com/…" /></Field>
                </div>
              </section>

              <section className="border-t border-slate-100 pt-6">
                <div className="flex items-start justify-between gap-4">
                  <div><h3 className="text-sm font-bold text-slate-900">Complete business address</h3><p className="mt-1 text-xs text-slate-500">Use the address exactly as you want it displayed on customer-facing documents.</p></div>
                </div>
                <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <div className="sm:col-span-2 lg:col-span-3"><Field label="Address line 1" required><input className={input} value={business.address?.line1 || ''} onChange={(e) => patchAddress('line1', e.target.value)} placeholder="Shop / office / building / street" autoComplete="street-address" /></Field></div>
                  <div className="sm:col-span-2 lg:col-span-3"><Field label="Address line 2"><input className={input} value={business.address?.line2 || ''} onChange={(e) => patchAddress('line2', e.target.value)} placeholder="Area / landmark / locality" /></Field></div>
                  <Field label="City" required><input className={input} value={business.address?.city || ''} onChange={(e) => patchAddress('city', e.target.value)} placeholder="City" autoComplete="address-level2" /></Field>
                  <Field label="State" required><input className={input} value={business.address?.state || ''} onChange={(e) => patchAddress('state', e.target.value)} placeholder="State" autoComplete="address-level1" /></Field>
                  <Field label="PIN / Postal code" required><input className={input} inputMode="numeric" value={business.address?.postal_code || ''} onChange={(e) => patchAddress('postal_code', e.target.value)} placeholder="413521" autoComplete="postal-code" /></Field>
                  <Field label="Country" required><input className={input} value={business.address?.country || ''} onChange={(e) => patchAddress('country', e.target.value)} placeholder="India" autoComplete="country-name" /></Field>
                </div>
              </section>
            </>
          )}

          {business && (
            <section className="border-t border-slate-100 pt-6">
              <BusinessCapabilitiesChecklist
                value={business.feature_flags || DEFAULT_BUSINESS_CONFIG}
                onChange={patchFeatures}
                categoryName={categoryName}
                subcategoryName={subcategoryName}
              />
            </section>
          )}

          <div className="flex flex-col-reverse gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:items-center sm:justify-end">
            {onSkip && <button type="button" onClick={onSkip} className="rounded-xl border border-slate-200 px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Skip and complete later</button>}
            <button type="button" disabled={saving || !business} onClick={save} className="rounded-xl bg-violet-600 px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-violet-700 disabled:opacity-50">{saving ? 'Saving details…' : 'Save business details →'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
