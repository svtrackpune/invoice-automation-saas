'use client';
import { useEffect, useState } from 'react';
import { supabase, type BusinessContext } from '@/lib/supabase';

type Prefs = {
  tax_mode: string;
  default_payment_reminders: boolean;
  default_reminder_days: number;
  inventory_discount_enabled: boolean;
  inventory_discount_type: string;
  inventory_discount_limit: number;
};

export default function Preferences() {
  const [ctx, setCtx] = useState<BusinessContext | null>(null);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  async function load() {
    const c = await supabase.rpc('get_my_business_context');
    const business = (c.data?.[0] || null) as BusinessContext | null;
    if (!business) return;
    setCtx(business);
    const p = await supabase.from('business_preferences').select('*').eq('business_id', business.business_id).maybeSingle();
    setPrefs((p.data || {
      tax_mode: 'auto',
      default_payment_reminders: true,
      default_reminder_days: 3,
      inventory_discount_enabled: true,
      inventory_discount_type: 'percent',
      inventory_discount_limit: 0,
    }) as Prefs);
  }

  useEffect(() => { load(); }, []);
  const set = (k: keyof Prefs, v: any) => setPrefs((p) => p ? ({ ...p, [k]: v }) : p);

  async function save() {
    if (!ctx || !prefs) return;
    setSaving(true);
    setMessage('');
    const result = await supabase.from('business_preferences').upsert(
      { ...prefs, business_id: ctx.business_id },
      { onConflict: 'business_id' }
    );
    setMessage(result.error ? result.error.message : 'Preferences saved.');
    setSaving(false);
  }

  return <main className="min-h-screen bg-[#f6f7fb] p-4 text-slate-950 sm:p-7">
    <div className="mx-auto max-w-5xl">
      <header className="mb-6">
        <p className="text-[11px] font-bold uppercase tracking-[.18em] text-slate-400">Business control</p>
        <h1 className="mt-1 text-3xl font-semibold">Preferences</h1>
        <p className="mt-1 text-sm text-slate-500">Choose how much automation and tax complexity your business wants. Nothing is forced.</p>
      </header>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold">Tax & accounting mode</h2>
          <p className="mt-1 text-sm text-slate-500">GST/tax features stay hidden unless you enable them.</p>
          <div className="mt-5 grid gap-2 sm:grid-cols-3">
            {[['auto', 'Smart'], ['gst', 'GST'], ['non_gst', 'Non-GST']].map(([v, l]) => <button key={v} type="button" onClick={() => set('tax_mode', v)} className={`rounded-2xl border p-4 text-left ${prefs?.tax_mode === v ? 'border-slate-950 bg-slate-950 text-white' : 'border-slate-200'}`}><b>{l}</b><span className="mt-1 block text-xs opacity-70">{v === 'auto' ? 'Let Moneymatters decide from your setup' : v === 'gst' ? 'Show GST fields and reports' : 'Keep tax fields out of everyday work'}</span></button>)}
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold">Payment reminders</h2>
          <p className="mt-1 text-sm text-slate-500">This is the default. Each customer can override it.</p>
          <label className="mt-5 flex items-center justify-between rounded-2xl border border-slate-200 p-4"><span><b>Enable reminders by default</b><span className="block text-xs text-slate-400">Customers can turn reminders off individually.</span></span><input type="checkbox" checked={!!prefs?.default_payment_reminders} onChange={e => set('default_payment_reminders', e.target.checked)} className="h-5 w-5" /></label>
          <label className="mt-3 block"><span className="text-xs font-semibold text-slate-500">Remind before due date</span><input type="number" min="0" max="365" value={prefs?.default_reminder_days ?? 3} onChange={e => set('default_reminder_days', Number(e.target.value))} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5" /><span className="mt-1 block text-xs text-slate-400">0 = on the due date.</span></label>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold">Discount freedom</h2>
          <p className="mt-1 text-sm text-slate-500">Set safe defaults without restricting what you can negotiate.</p>
          <label className="mt-5 flex items-center justify-between rounded-2xl border border-slate-200 p-4"><span><b>Allow item discounts</b><span className="block text-xs text-slate-400">Users can still override the default per transaction.</span></span><input type="checkbox" checked={!!prefs?.inventory_discount_enabled} onChange={e => set('inventory_discount_enabled', e.target.checked)} className="h-5 w-5" /></label>
          <div className="mt-3 grid grid-cols-2 gap-3"><label><span className="text-xs font-semibold text-slate-500">Limit type</span><select value={prefs?.inventory_discount_type || 'percent'} onChange={e => set('inventory_discount_type', e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5"><option value="percent">Percent (%)</option><option value="amount">Amount (₹)</option></select></label><label><span className="text-xs font-semibold text-slate-500">Maximum default</span><input type="number" min="0" step="0.01" value={prefs?.inventory_discount_limit ?? 0} onChange={e => set('inventory_discount_limit', Number(e.target.value))} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5" /></label></div>
          <p className="mt-2 text-xs text-slate-400">0 means no default limit. We will never silently cap a customer's discount.</p>
        </section>
      </div>

      <div className="mt-5 flex items-center justify-end gap-3"><span className="text-sm text-emerald-700">{message}</span><button type="button" disabled={saving} onClick={save} className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save preferences'}</button></div>
    </div>
  </main>;
}
