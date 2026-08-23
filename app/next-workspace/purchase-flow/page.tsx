'use client';

import { useState } from 'react';
import { money, today, addDays } from '../test-data';

type Stage = 'purchase' | 'posted' | 'paid' | 'banked' | 'reconciled' | 'gst' | 'reported';

type PurchaseRecord = { id: string; number: string; vendor: string; date: string; dueDate: string; total: number; expense: number; tax: number; paid: number; stock: number; bankMatched: boolean; reconciled: boolean };

const KEY = 'mm.demo.purchase.flow';
const read = (): PurchaseRecord | null => { if (typeof window === 'undefined') return null; try { const raw = localStorage.getItem(KEY); return raw ? JSON.parse(raw) : null; } catch { return null; } };
const write = (value: PurchaseRecord) => localStorage.setItem(KEY, JSON.stringify(value));

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) { return <section className={`rounded-3xl border border-slate-200 bg-white shadow-[0_12px_40px_rgba(15,23,42,.045)] ${className}`}>{children}</section>; }

const stages: Array<[Stage, string, string]> = [
  ['purchase', 'Purchase', 'Record what you bought'],
  ['posted', 'Expense / Inventory', 'Post the business impact'],
  ['paid', 'Payment', 'Pay the supplier'],
  ['banked', 'Banking', 'Match the bank transaction'],
  ['reconciled', 'Reconciliation', 'Confirm both sides agree'],
  ['gst', 'GST', 'Explain the tax impact'],
  ['reported', 'Reports', 'See the business result'],
];

export default function PurchaseFlow() {
  const [record, setRecord] = useState<PurchaseRecord | null>(() => read());
  const [stage, setStage] = useState<Stage>(() => record?.reconciled ? 'reconciled' : record?.paid ? 'paid' : record?.stock ? 'posted' : 'purchase');
  const [notice, setNotice] = useState('');

  const start = () => {
    const next: PurchaseRecord = { id: `purchase-${Date.now()}`, number: `PUR-${String(Date.now()).slice(-6)}`, vendor: 'ABC Supplies', date: today(), dueDate: addDays(today(), 15), total: 23600, expense: 20000, tax: 3600, paid: 0, stock: 20000, bankMatched: false, reconciled: false };
    write(next); setRecord(next); setStage('posted'); setNotice('Purchase recorded. ₹20,000 is treated as inventory/expense and ₹3,600 as GST.');
  };
  const advance = (nextStage: Stage) => {
    if (!record) return;
    const next = { ...record };
    if (nextStage === 'paid') next.paid = next.total;
    if (nextStage === 'banked') next.bankMatched = true;
    if (nextStage === 'reconciled') { next.bankMatched = true; next.reconciled = true; }
    write(next); setRecord(next); setStage(nextStage);
    const messages: Record<Stage, string> = { purchase: '', posted: 'Expense/inventory posting completed.', paid: 'Supplier payment recorded for ₹23,600.', banked: 'Bank transaction matched to the supplier payment.', reconciled: 'Bank and books now agree.', gst: 'GST impact explained: ₹3,600 input GST on the purchase.', reported: 'Purchase is now reflected in the testing report view.' };
    setNotice(messages[nextStage]);
  };

  return <main className="min-h-[calc(100vh-90px)] bg-[#f7f6fb] p-4 sm:p-7"><div className="mx-auto max-w-6xl"><p className="text-[10px] font-bold uppercase tracking-[.2em] text-violet-600">Testing workflow</p><h1 className="mt-1 text-3xl font-bold">Purchase to business report</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">One purchase should flow through cost, stock, payment, banking, reconciliation, GST and reports without making the owner understand accounting mechanics.</p>
    <div className="mt-6 grid gap-2 md:grid-cols-7">{stages.map(([id, label, hint], i) => <button type="button" key={id} onClick={() => { if (record && i <= stages.findIndex(x => x[0] === stage)) setStage(id); }} className={`rounded-2xl border p-3 text-left ${stage === id ? 'border-violet-300 bg-violet-600 text-white' : record && i <= stages.findIndex(x => x[0] === stage) ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-white text-slate-400'}`}><b className="block text-xs">{i + 1}. {label}</b><span className="mt-1 block text-[9px] leading-3 opacity-75">{hint}</span></button>)}</div>
    {notice && <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">✓ {notice}</div>}
    {!record ? <Card className="mx-auto mt-6 max-w-3xl p-7 sm:p-10"><h2 className="text-2xl font-bold">Start the purchase test</h2><p className="mt-2 text-sm leading-6 text-slate-500">We'll create a controlled ₹23,600 purchase from ABC Supplies: ₹20,000 base + ₹3,600 GST.</p><button type="button" onClick={start} className="mt-6 rounded-xl bg-violet-600 px-5 py-3 text-sm font-semibold text-white">Record purchase →</button></Card> : <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]"><Card className="p-6"><div className="flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[.18em] text-violet-600">{record.number}</p><h2 className="mt-1 text-xl font-bold">ABC Supplies</h2><p className="text-xs text-slate-500">Purchase date {record.date} · due {record.dueDate}</p></div><b className="text-2xl">{money(record.total)}</b></div><div className="mt-5 grid gap-3 sm:grid-cols-3"><Metric label="Cost / stock" value={money(record.expense)} help="Business value before GST."/><Metric label="Input GST" value={money(record.tax)} help="Potential GST credit; eligibility must be reviewed."/><Metric label="Paid" value={money(record.paid)} help="Supplier payment recorded."/></div><div className="mt-6 rounded-2xl bg-slate-50 p-5"><h3 className="font-bold">What changed?</h3><p className="mt-2 text-sm leading-6 text-slate-600">The purchase increases the relevant expense or inventory balance. When paid, cash/bank decreases. When reconciled, the bank transaction is matched. GST is shown separately so the owner can understand the tax impact.</p></div><div className="mt-6 flex flex-wrap gap-2">{stage === 'posted' && <button onClick={() => advance('paid')} className="rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white">Pay supplier →</button>}{stage === 'paid' && <button onClick={() => advance('banked')} className="rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white">Match bank transaction →</button>}{stage === 'banked' && <button onClick={() => advance('reconciled')} className="rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white">Reconcile →</button>}{stage === 'reconciled' && <button onClick={() => advance('gst')} className="rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white">Explain GST →</button>}{stage === 'gst' && <button onClick={() => advance('reported')} className="rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white">View report impact →</button>}{stage === 'reported' && <button onClick={() => { localStorage.removeItem(KEY); setRecord(null); setStage('purchase'); setNotice('Test reset.'); }} className="rounded-xl border px-4 py-3 text-sm font-semibold">Reset test</button>}</div></Card><div className="space-y-4"><Card className="p-5"><p className="text-[10px] font-bold uppercase tracking-[.18em] text-slate-400">Current stage</p><h2 className="mt-2 text-xl font-bold">{stages.find(x => x[0] === stage)?.[1]}</h2><p className="mt-2 text-sm leading-6 text-slate-500">{stages.find(x => x[0] === stage)?.[2]}.</p>{stage === 'reconciled' && <div className="mt-4 rounded-2xl bg-emerald-50 p-4 text-xs text-emerald-800"><b>Reconciled.</b> The payment and bank transaction agree at ₹23,600.</div>}{stage === 'gst' && <div className="mt-4 rounded-2xl bg-violet-50 p-4 text-xs leading-5 text-violet-900"><b>Explain this tax:</b> ₹3,600 is input GST on a ₹20,000 taxable purchase. ITC eligibility depends on the supplier invoice and business rules.</div>}</Card><Card className="p-5"><h2 className="font-bold">Testing controls</h2><p className="mt-1 text-xs leading-5 text-slate-500">This controlled flow does not write to Supabase or call banking/GST APIs.</p><div className="mt-4 space-y-2 text-xs">{[['Purchase', 'Recorded'], ['Expense / inventory', stage !== 'purchase'], ['Payment', record.paid > 0], ['Bank match', record.bankMatched], ['Reconciliation', record.reconciled], ['GST explanation', ['gst','reported'].includes(stage)], ['Report impact', stage === 'reported']].map(([label, done]) => <div key={label as string} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2"><span>{label as string}</span><b className={done ? 'text-emerald-700' : 'text-slate-300'}>{done ? '✓' : '—'}</b></div>)}</div></Card></div></div>}
  </div></main>;
}

function Metric({ label, value, help }: { label: string; value: string; help: string }) { return <div className="rounded-2xl bg-slate-50 p-4"><span className="text-xs text-slate-500">{label}</span><b className="mt-2 block text-xl">{value}</b><small className="mt-1 block text-[10px] leading-4 text-slate-400">{help}</small></div>; }
