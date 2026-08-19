'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase, type BusinessContext } from '@/lib/supabase';

const money = (n: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(n || 0));
const frequencies = ['Weekly', 'Monthly', 'Quarterly', 'Half-yearly', 'Yearly', 'Custom'];

type Recurring = { id: string; name: string; customer_id: string; frequency: string; next_run_date: string; end_date: string | null; auto_send: boolean; auto_remind: boolean; status: string; currency_code: string };
type Customer = { id: string; display_name: string };

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-3xl border border-slate-200 bg-white shadow-[0_12px_40px_rgba(15,23,42,.05)] ${className}`}>{children}</section>;
}
function Input(p: React.InputHTMLAttributes<HTMLInputElement>) { return <input {...p} className={`w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-slate-400 ${p.className || ''}`} />; }

export default function RecurringPage() {
  const [ctx, setCtx] = useState<BusinessContext | null>(null);
  const [rows, setRows] = useState<Recurring[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [status, setStatus] = useState('all');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [frequency, setFrequency] = useState('Monthly');
  const [nextRun, setNextRun] = useState(new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState('');
  const [autoSend, setAutoSend] = useState(false);
  const [autoRemind, setAutoRemind] = useState(true);

  async function load() {
    const r = await supabase.rpc('get_my_business_context');
    const c = r.data?.[0] as BusinessContext | undefined;
    if (!c) { window.location.href = '/'; return; }
    setCtx(c);
    const [rr, cc] = await Promise.all([
      supabase.from('recurring_invoices').select('id,name,customer_id,frequency,next_run_date,end_date,auto_send,auto_remind,status,currency_code').eq('business_id', c.business_id).order('next_run_date', { ascending: true }),
      supabase.from('customers').select('id,display_name').eq('business_id', c.business_id).eq('is_active', true).order('display_name')
    ]);
    setRows(rr.data || []); setCustomers(cc.data || []);
  }
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => rows.filter(r => status === 'all' || r.status === status), [rows, status]);
  const customerName = (id: string) => customers.find(c => c.id === id)?.display_name || 'Unknown customer';

  async function create() {
    if (!ctx || !name.trim() || !customerId || !nextRun) return;
    setBusy(true); setError('');
    const r = await supabase.from('recurring_invoices').insert({ business_id: ctx.business_id, customer_id: customerId, name: name.trim(), frequency: frequency.toLowerCase(), next_run_date: nextRun, end_date: endDate || null, auto_send: autoSend, auto_remind: autoRemind, status: 'active', currency_code: 'INR', notes: null }).select().single();
    if (r.error) setError(r.error.message);
    else { setShow(false); setName(''); setCustomerId(''); setFrequency('Monthly'); setEndDate(''); setAutoSend(false); setAutoRemind(true); await load(); }
    setBusy(false);
  }

  async function setRowStatus(row: Recurring, next: string) {
    const r = await supabase.from('recurring_invoices').update({ status: next }).eq('id', row.id).eq('business_id', ctx?.business_id || '');
    if (!r.error) setRows(prev => prev.map(x => x.id === row.id ? { ...x, status: next } : x));
  }

  return <main className="min-h-screen bg-[#f6f7fb] p-4 text-slate-950 sm:p-7"><div className="mx-auto max-w-7xl">
    <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-[11px] font-bold uppercase tracking-[.18em] text-slate-400">Automate billing</p><h1 className="mt-1 text-3xl font-semibold">Recurring invoices</h1><p className="mt-1 text-sm text-slate-500">Schedule repeat billing without losing control over sending and reminders.</p></div><button onClick={() => setShow(true)} className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white">＋ Create recurring invoice</button></header>
    <div className="mb-5 flex flex-wrap gap-2">{['all','active','draft','paused'].map(s => <button key={s} onClick={() => setStatus(s)} className={`rounded-xl px-4 py-2 text-xs font-semibold capitalize ${status === s ? 'bg-slate-950 text-white' : 'border border-slate-200 bg-white text-slate-600'}`}>{s}</button>)}</div>
    <Card className="overflow-hidden"><div className="overflow-x-auto"><table className="w-full min-w-[1000px] text-left text-sm"><thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-400"><tr><th className="px-5 py-3">Recurring invoice</th><th className="px-5 py-3">Customer</th><th className="px-5 py-3">Schedule</th><th className="px-5 py-3">Next invoice</th><th className="px-5 py-3">Send</th><th className="px-5 py-3">Reminder</th><th className="px-5 py-3">Status</th><th/></tr></thead><tbody>{filtered.map(r => <tr key={r.id} className="border-t border-slate-100"><td className="px-5 py-4"><b>{r.name}</b><span className="mt-1 block text-xs text-slate-400">{r.end_date ? `Ends ${r.end_date}` : 'No end date'}</span></td><td className="px-5 py-4">{customerName(r.customer_id)}</td><td className="px-5 py-4 capitalize">{r.frequency}</td><td className="px-5 py-4 font-semibold">{r.next_run_date}</td><td className="px-5 py-4">{r.auto_send ? 'Automatic' : 'Manual'}</td><td className="px-5 py-4">{r.auto_remind ? 'On' : 'Off'}</td><td className="px-5 py-4"><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold capitalize">{r.status}</span></td><td className="px-5 py-4 text-right">{r.status === 'active' ? <button onClick={() => setRowStatus(r, 'paused')} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold">Pause</button> : <button onClick={() => setRowStatus(r, 'active')} className="rounded-xl bg-slate-950 px-3 py-2 text-xs font-semibold text-white">Activate</button>}</td></tr>)}{!filtered.length && <tr><td colSpan={8} className="px-5 py-16 text-center text-sm text-slate-400">No recurring invoices in this view.</td></tr>}</tbody></table></div></Card>
    {show && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4"><div className="w-full max-w-xl rounded-3xl bg-white p-6 shadow-2xl"><div className="flex items-center justify-between"><div><p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Recurring billing</p><h2 className="mt-1 text-xl font-semibold">Create recurring invoice</h2></div><button onClick={() => setShow(false)} className="grid h-9 w-9 place-items-center rounded-xl bg-slate-100">×</button></div><div className="mt-5 grid gap-4 sm:grid-cols-2"><label className="sm:col-span-2"><span className="mb-1 block text-xs font-semibold text-slate-500">Name *</span><Input value={name} onChange={e => setName(e.target.value)} placeholder="Monthly maintenance" /></label><label className="sm:col-span-2"><span className="mb-1 block text-xs font-semibold text-slate-500">Customer *</span><select value={customerId} onChange={e => setCustomerId(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"><option value="">Select customer</option>{customers.map(c => <option key={c.id} value={c.id}>{c.display_name}</option>)}</select></label><label><span className="mb-1 block text-xs font-semibold text-slate-500">Frequency</span><select value={frequency} onChange={e => setFrequency(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm">{frequencies.map(f => <option key={f}>{f}</option>)}</select></label><label><span className="mb-1 block text-xs font-semibold text-slate-500">Start / next invoice</span><Input type="date" value={nextRun} onChange={e => setNextRun(e.target.value)} /></label><label><span className="mb-1 block text-xs font-semibold text-slate-500">End date</span><Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} /></label><div className="flex items-end"><span className="mb-3 text-xs text-slate-400">Leave blank for never ending.</span></div></div><div className="mt-5 grid gap-3 sm:grid-cols-2"><button onClick={() => setAutoSend(!autoSend)} className={`rounded-2xl border p-4 text-left ${autoSend ? 'border-slate-950 bg-slate-950 text-white' : 'border-slate-200'}`}><b className="block text-sm">Auto-send invoice</b><span className={`mt-1 block text-xs ${autoSend ? 'text-white/60' : 'text-slate-400'}`}>{autoSend ? 'Yes — send when generated' : 'No — keep it for review'}</span></button><button onClick={() => setAutoRemind(!autoRemind)} className={`rounded-2xl border p-4 text-left ${autoRemind ? 'border-slate-950 bg-slate-950 text-white' : 'border-slate-200'}`}><b className="block text-sm">Payment reminder</b><span className={`mt-1 block text-xs ${autoRemind ? 'text-white/60' : 'text-slate-400'}`}>{autoRemind ? 'Yes — use customer reminder settings' : 'No — do not remind'}</span></button></div>{error && <p className="mt-4 rounded-xl bg-red-50 p-3 text-xs text-red-700">{error}</p>}<button disabled={busy || !name.trim() || !customerId} onClick={create} className="mt-5 w-full rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40">{busy ? 'Creating…' : 'Create recurring invoice'}</button></div></div>}
  </div></main>;
}
