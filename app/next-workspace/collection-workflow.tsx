'use client';

import { useMemo, useState } from 'react';
import { getDemoCustomer, getDemoInvoices, money, today, type DemoInvoice } from './test-data';

type CollectionAction = {
  id: string;
  invoiceId: string;
  action: 'follow_up' | 'promise_to_pay' | 'note';
  note: string;
  date: string;
};

type ActivityEvent = {
  id: string;
  date: string;
  title: string;
  detail: string;
  kind: string;
};

const read = <T,>(key: string, fallback: T): T => {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
};

const write = <T,>(key: string, value: T) => {
  if (typeof window !== 'undefined') localStorage.setItem(key, JSON.stringify(value));
};

const daysLate = (dueDate: string) => Math.max(0, Math.floor((Date.parse(`${today()}T00:00:00`) - Date.parse(`${dueDate}T00:00:00`)) / 86400000));

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-3xl border border-slate-200 bg-white shadow-[0_12px_40px_rgba(15,23,42,.045)] ${className}`}>{children}</section>;
}

function saveActivity(event: ActivityEvent) {
  const events = read<ActivityEvent[]>('mm.demo.activity', []);
  write('mm.demo.activity', [event, ...events]);
}

function priority(invoice: DemoInvoice) {
  const balance = Math.max(0, invoice.total - invoice.paid);
  const late = daysLate(invoice.dueDate);
  if (late >= 15 || balance >= 50000) return { label: 'Urgent', score: 3, className: 'bg-rose-100 text-rose-700' };
  if (late >= 1 || balance >= 20000) return { label: 'High', score: 2, className: 'bg-amber-100 text-amber-700' };
  return { label: 'Normal', score: 1, className: 'bg-slate-100 text-slate-600' };
}

export function CollectionsWorkflow() {
  const invoices = getDemoInvoices();
  const overdue = useMemo(() => invoices
    .filter((invoice) => invoice.paid < invoice.total && invoice.dueDate < today())
    .map((invoice) => ({ invoice: { ...invoice, status: 'overdue' as const }, priority: priority(invoice) }))
    .sort((a, b) => b.priority.score - a.priority.score || daysLate(b.invoice.dueDate) - daysLate(a.invoice.dueDate)), [invoices]);
  const partial = invoices.filter((invoice) => invoice.paid > 0 && invoice.paid < invoice.total && invoice.dueDate >= today());
  const [selected, setSelected] = useState<DemoInvoice | null>(overdue[0]?.invoice || partial[0] || null);
  const [notice, setNotice] = useState('');
  const [action, setAction] = useState<CollectionAction['action']>('follow_up');

  const act = () => {
    if (!selected) return;
    const labels: Record<CollectionAction['action'], string> = {
      follow_up: 'Follow-up marked for customer',
      promise_to_pay: 'Promise to pay recorded',
      note: 'Collection note added',
    };
    const item: CollectionAction = { id: `collection-${Date.now()}`, invoiceId: selected.id, action, note: labels[action], date: today() };
    const existing = read<CollectionAction[]>('mm.demo.collection.actions', []);
    write('mm.demo.collection.actions', [item, ...existing]);
    saveActivity({ id: `activity-${Date.now()}`, date: today(), title: labels[action], detail: `${selected.number} · ${getDemoCustomer(selected.customerId).name} · ${money(Math.max(0, selected.total - selected.paid))} remaining`, kind: 'Collection' });
    setNotice(labels[action] + '. The action is stored in the testing timeline.');
  };

  return <main className="min-h-[calc(100vh-90px)] bg-[#f7f6fb] p-4 sm:p-7"><div className="mx-auto max-w-7xl"><p className="text-[10px] font-bold uppercase tracking-[.2em] text-violet-600">Money in · Collections</p><h1 className="mt-1 text-3xl font-bold">Who needs attention?</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">Moneymatters automatically identifies unpaid invoices past their due date, ranks them by risk and value, and gives you one clear customer action.</p>
    {notice && <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">✓ {notice}</div>}
    <div className="mt-6 grid gap-3 sm:grid-cols-3"><Card className="p-5"><span className="text-xs text-slate-500">Overdue to collect</span><b className="mt-2 block text-2xl">{money(overdue.reduce((n, x) => n + Math.max(0, x.invoice.total - x.invoice.paid), 0))}</b><small className="text-xs text-slate-400">Past due and unpaid</small></Card><Card className="p-5"><span className="text-xs text-slate-500">Overdue invoices</span><b className="mt-2 block text-2xl">{overdue.length}</b><small className="text-xs text-slate-400">Detected automatically from due date</small></Card><Card className="p-5"><span className="text-xs text-slate-500">Highest priority</span><b className="mt-2 block text-2xl">{overdue[0]?.priority.label || 'None'}</b><small className="text-xs text-slate-400">Age + balance based</small></Card></div>
    <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_380px]"><Card className="overflow-hidden"><div className="border-b p-5"><h2 className="font-bold">Collection queue</h2><p className="mt-1 text-xs text-slate-500">Sorted by urgency, then amount at risk.</p></div>{overdue.length === 0 && partial.length === 0 && <div className="p-10 text-center"><b className="block text-sm">Nothing needs collection</b><span className="mt-1 block text-xs text-slate-400">Every open balance is currently within its payment terms.</span></div>}{overdue.map(({ invoice, priority: p }) => { const customer = getDemoCustomer(invoice.customerId); const balance = invoice.total - invoice.paid; return <button type="button" key={invoice.id} onClick={() => setSelected(invoice)} className={`flex w-full items-center gap-4 border-b p-5 text-left hover:bg-violet-50/50 ${selected?.id === invoice.id ? 'bg-violet-50' : ''}`}><span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-rose-50 text-rose-700">!</span><span className="min-w-0 flex-1"><b className="block text-sm">{customer.name}</b><span className="text-xs text-slate-500">{invoice.number} · {daysLate(invoice.dueDate)} day{daysLate(invoice.dueDate) === 1 ? '' : 's'} overdue</span></span><span className="text-right"><b className="block">{money(balance)}</b><span className={`mt-1 inline-flex rounded-full px-2 py-1 text-[9px] font-bold ${p.className}`}>{p.label}</span></span></button>; })}{partial.map((invoice) => { const customer = getDemoCustomer(invoice.customerId); return <button type="button" key={invoice.id} onClick={() => setSelected(invoice)} className={`flex w-full items-center gap-4 border-b p-5 text-left hover:bg-violet-50/50 ${selected?.id === invoice.id ? 'bg-violet-50' : ''}`}><span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-amber-50 text-amber-700">₹</span><span className="min-w-0 flex-1"><b className="block text-sm">{customer.name}</b><span className="text-xs text-slate-500">{invoice.number} · Partially paid</span></span><b>{money(invoice.total - invoice.paid)}</b></button>; })}</Card>
    <Card className="h-fit p-6"><p className="text-[10px] font-bold uppercase tracking-[.18em] text-violet-600">Next customer action</p>{selected ? <><h2 className="mt-2 text-xl font-bold">{getDemoCustomer(selected.customerId).name}</h2><p className="mt-1 text-xs leading-5 text-slate-500">{selected.number} has {money(selected.total - selected.paid)} outstanding.</p><div className="mt-5 rounded-2xl bg-slate-50 p-4"><span className="text-xs text-slate-500">Recommended</span><b className="mt-1 block text-sm">{selected.dueDate < today() ? `Follow up — ${daysLate(selected.dueDate)} days overdue` : 'Follow up before the due date'}</b></div><select value={action} onChange={(e) => setAction(e.target.value as CollectionAction['action'])} className="mt-4 w-full rounded-xl border border-slate-200 p-3 text-sm"><option value="follow_up">Mark follow-up</option><option value="promise_to_pay">Record promise to pay</option><option value="note">Add collection note</option></select><button type="button" onClick={act} className="mt-3 w-full rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white">Save customer action</button><button type="button" onClick={() => { window.location.href = `/next-workspace/customers/${selected.customerId}/statement`; }} className="mt-2 w-full rounded-xl border px-4 py-3 text-xs font-semibold">Open statement →</button><p className="mt-4 text-[10px] leading-4 text-slate-400">Outbound WhatsApp, email and SMS remain disabled in testing mode.</p></> : <p className="mt-2 text-sm text-slate-500">Select an open balance to see the recommended action.</p>}</Card></div>
    <Card className="mt-6 border-violet-200 bg-violet-50 p-5"><b className="block text-sm text-violet-950">How priority works</b><p className="mt-1 text-xs leading-5 text-violet-800">Urgent = 15+ days overdue or ₹50,000+ outstanding. High = overdue or ₹20,000+ outstanding. Normal = other open balances. This is a transparent testing rule and can later be replaced with the real collections intelligence model.</p></Card>
  </div></main>;
}

export function CollectionActivityTimeline() {
  const events = read<ActivityEvent[]>('mm.demo.activity', []);
  return <main className="min-h-[calc(100vh-90px)] bg-[#f7f6fb] p-4 sm:p-7"><div className="mx-auto max-w-5xl"><p className="text-[10px] font-bold uppercase tracking-[.2em] text-violet-600">Business activity</p><h1 className="mt-1 text-3xl font-bold">Activity Timeline</h1><p className="mt-2 text-sm leading-6 text-slate-500">A human-readable record of collection actions and other business events.</p><Card className="mt-6 overflow-hidden">{events.length ? <div className="divide-y">{events.map((event) => <div key={event.id} className="flex gap-4 p-5"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-violet-50 text-xs font-bold text-violet-700">•</span><div className="min-w-0 flex-1"><div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between"><b className="text-sm">{event.title}</b><span className="text-[10px] text-slate-400">{event.date}</span></div><p className="mt-1 text-xs leading-5 text-slate-500">{event.detail}</p><span className="mt-2 inline-flex rounded-full bg-slate-100 px-2 py-1 text-[9px] font-bold text-slate-500">{event.kind}</span></div></div>)}</div> : <div className="p-10 text-center"><b className="block text-sm">No collection actions yet</b><span className="mt-1 block text-xs text-slate-400">Save a customer action from Collections and it will appear here.</span></div>}</Card></div></main>;
}
