'use client';

import { getDemoCustomer, getDemoInvoices, getDemoReceipts, money } from '../../../test-data';

export default function CustomerStatement({ params }: { params: { id: string } }) {
  const customer = getDemoCustomer(params.id);
  const invoices = getDemoInvoices().filter(i => i.customerId === params.id);
  const receipts = getDemoReceipts().filter(r => r.customerId === params.id);
  const billed = invoices.reduce((n, i) => n + i.total, 0);
  const received = receipts.reduce((n, r) => n + r.amount, 0);
  const balance = Math.max(0, billed - received);
  const events = [
    ...invoices.map(i => ({ date: i.date, label: `Invoice ${i.number}`, detail: 'Invoice issued', amount: i.total, kind: 'invoice' })),
    ...receipts.map(r => ({ date: r.date, label: `Receipt ${r.number}`, detail: 'Payment received', amount: -r.amount, kind: 'payment' })),
  ].sort((a, b) => b.date.localeCompare(a.date));

  return <main className="min-h-[calc(100vh-90px)] bg-[#f7f6fb] p-4 sm:p-7"><div className="mx-auto max-w-5xl"><button type="button" onClick={() => { window.location.href = `/next-workspace/customers/${params.id}`; }} className="mb-5 text-sm font-semibold text-slate-500">← Customer 360</button><div className="mb-6"><p className="text-[10px] font-bold uppercase tracking-[.2em] text-violet-600">Customer statement</p><h1 className="mt-1 text-3xl font-bold">{customer.name}</h1><p className="mt-2 text-sm text-slate-500">A simple running record of invoices, payments and the balance remaining.</p></div><div className="grid gap-3 sm:grid-cols-3"><div className="rounded-3xl border bg-white p-5"><span className="text-xs text-slate-500">Total billed</span><b className="mt-2 block text-2xl">{money(billed)}</b></div><div className="rounded-3xl border bg-white p-5"><span className="text-xs text-slate-500">Payments received</span><b className="mt-2 block text-2xl text-emerald-700">{money(received)}</b></div><div className="rounded-3xl border bg-white p-5"><span className="text-xs text-slate-500">Balance due</span><b className="mt-2 block text-2xl">{money(balance)}</b></div></div><section className="mt-6 overflow-hidden rounded-3xl border bg-white"><div className="border-b p-5"><h2 className="font-bold">Statement activity</h2><p className="mt-1 text-xs text-slate-500">Every invoice and receipt contributes to the running customer balance.</p></div>{events.length ? <div className="divide-y">{events.map((e, i) => <div key={`${e.label}-${i}`} className="grid gap-3 p-5 sm:grid-cols-[110px_1fr_140px] sm:items-center"><span className="text-xs text-slate-400">{e.date}</span><div><b className="block text-sm">{e.label}</b><span className="text-xs text-slate-500">{e.detail}</span></div><b className={`sm:text-right ${e.kind === 'payment' ? 'text-emerald-700' : ''}`}>{e.amount < 0 ? `− ${money(Math.abs(e.amount))}` : money(e.amount)}</b></div>)}</div> : <div className="p-10 text-center"><b className="block text-sm">No activity yet</b><span className="mt-1 block text-xs text-slate-400">Invoices and payments will appear here.</span></div>}<div className="flex flex-col gap-3 border-t bg-slate-50 p-5 sm:flex-row sm:items-center sm:justify-between"><div><b className="block text-sm">Current balance</b><span className="text-xs text-slate-500">{balance ? 'This is the amount still owed.' : 'This customer has no outstanding balance.'}</span></div><b className="text-2xl">{money(balance)}</b></div></section></div></main>;
}
