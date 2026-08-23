'use client';

import { useState, type ReactNode } from 'react';
import { getDemoCustomer, getDemoInvoices, money } from './test-data';

const go = (path: string) => {
  window.location.href = path;
};

function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-3xl border border-slate-200 bg-white shadow-[0_12px_40px_rgba(15,23,42,.045)] ${className}`}>
      {children}
    </section>
  );
}

function Workspace({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <main className="min-h-[calc(100vh-90px)] bg-[#f7f6fb] p-4 sm:p-7">
      <div className="mx-auto max-w-7xl">
        <p className="text-[10px] font-bold uppercase tracking-[.2em] text-violet-600">Workflow intelligence</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">{title}</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">{subtitle}</p>
        {children}
      </div>
    </main>
  );
}

export function Collections() {
  const invoices = getDemoInvoices();
  const overdue = invoices.filter((i) => i.status === 'overdue');
  const partial = invoices.filter((i) => i.status === 'partially_paid');
  const total = [...overdue, ...partial].reduce((n, i) => n + Math.max(0, i.total - i.paid), 0);

  return (
    <Workspace title="Collections" subtitle="Work the balances that matter most. Start with risk and value, not a spreadsheet of every invoice.">
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <Card className="p-5"><span className="text-xs text-slate-500">Ready to collect</span><b className="mt-2 block text-2xl">{money(total)}</b><small className="text-xs text-slate-400">Overdue + partially paid</small></Card>
        <Card className="p-5"><span className="text-xs text-slate-500">Overdue invoices</span><b className="mt-2 block text-2xl">{overdue.length}</b><small className="text-xs text-slate-400">Past their due date</small></Card>
        <Card className="p-5"><span className="text-xs text-slate-500">Collection priority</span><b className="mt-2 block text-2xl">High</b><small className="text-xs text-slate-400">Because open balances need action</small></Card>
      </div>
      <Card className="mt-6 overflow-hidden">
        <div className="border-b p-5"><h2 className="font-bold">Collection queue</h2><p className="mt-1 text-xs text-slate-500">The system explains why each item is here and gives you one clear next action.</p></div>
        {[...overdue, ...partial].map((invoice, index) => {
          const customer = getDemoCustomer(invoice.customerId);
          const balance = Math.max(0, invoice.total - invoice.paid);
          const reason = invoice.status === 'overdue' ? `Overdue since ${invoice.dueDate}` : 'Partially paid';
          return (
            <div key={invoice.id} className="flex flex-col gap-4 border-b p-5 last:border-0 sm:flex-row sm:items-center">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-rose-50 text-rose-700">{index + 1}</span>
              <div className="min-w-0 flex-1"><b className="block text-sm">{customer.name}</b><span className="text-xs text-slate-500">{invoice.number} · {reason}</span></div>
              <div className="text-left sm:text-right"><b className="block">{money(balance)}</b><small className="text-[10px] text-slate-400">remaining</small></div>
              <button type="button" onClick={() => go('/next-workspace/payment-center')} className="rounded-xl bg-violet-600 px-4 py-2.5 text-xs font-bold text-white">Record / collect</button>
            </div>
          );
        })}
      </Card>
      <Card className="mt-6 border-violet-200 bg-violet-50 p-5"><b className="block text-sm text-violet-950">Collection intelligence</b><p className="mt-1 text-xs leading-5 text-violet-800">Later this queue will use customer payment history, due age, balance size and communication outcomes to rank the best next action. Outbound messaging stays disabled in this testing build.</p></Card>
    </Workspace>
  );
}

export function Lifecycle({ invoiceId }: { invoiceId?: string }) {
  const invoice = getDemoInvoices().find((i) => i.id === invoiceId) || getDemoInvoices()[0];
  const customer = getDemoCustomer(invoice.customerId);
  const paid = invoice.paid > 0;
  const full = invoice.paid >= invoice.total;
  const steps: Array<[string, boolean, string]> = [
    ['Created', true, 'Invoice exists and is ready for review.'],
    ['Sent', invoice.status !== 'draft', 'Customer-facing delivery is represented but disabled in testing.'],
    ['Payment', paid, paid ? `${money(invoice.paid)} received.` : 'No payment recorded yet.'],
    ['Receipt', paid, paid ? 'Receipt can be generated from the payment.' : 'Receipt appears after a payment.'],
    ['Settled', full, full ? 'Customer balance is zero.' : `${money(Math.max(0, invoice.total - invoice.paid))} remains outstanding.`],
  ];

  return (
    <Workspace title={`Invoice ${invoice.number}`} subtitle="A lifecycle view makes every state visible and every next action obvious.">
      <Card className="mt-6 overflow-hidden">
        <div className="bg-slate-950 p-6 text-white"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[.2em] text-violet-300">Customer lifecycle</p><h2 className="mt-1 text-2xl font-bold">{customer.name}</h2><p className="mt-1 text-xs text-slate-300">{money(invoice.total)} invoice · {money(Math.max(0, invoice.total - invoice.paid))} balance</p></div><button type="button" onClick={() => go('/next-workspace/sales')} className="rounded-xl bg-white px-4 py-2.5 text-xs font-bold text-slate-900">Open invoice</button></div></div>
        <div className="grid gap-0 p-5 sm:grid-cols-5">
          {steps.map(([label, done, description], index) => (
            <div key={label} className="relative p-3"><div className={`grid h-10 w-10 place-items-center rounded-full text-sm font-bold ${done ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}>{done ? '✓' : index + 1}</div><b className="mt-3 block text-sm">{label}</b><p className="mt-1 text-[11px] leading-4 text-slate-400">{description}</p></div>
          ))}
        </div>
      </Card>
      <Card className="mt-6 p-5"><h2 className="font-bold">Next best action</h2><p className="mt-1 text-xs text-slate-500">{full ? 'Nothing to collect. Keep the receipt and statement available.' : paid ? `Collect the remaining ${money(invoice.total - invoice.paid)}.` : 'Record the first payment when money arrives.'}</p><div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={() => go('/next-workspace/payment-center')} className="rounded-xl bg-violet-600 px-4 py-2.5 text-xs font-bold text-white">Record payment</button><button type="button" onClick={() => go('/next-workspace/customers/' + customer.id)} className="rounded-xl border px-4 py-2.5 text-xs font-bold">Customer 360</button><button type="button" onClick={() => go('/next-workspace/receipts')} className="rounded-xl border px-4 py-2.5 text-xs font-bold">Receipts</button></div></Card>
    </Workspace>
  );
}

export function ActivityTimeline() {
  const events: Array<[string, string, string, string]> = [
    ['Today', 'Business Health reviewed', 'Collections and GST were flagged for attention.', 'Insight'],
    ['Today', 'Invoice INV-000009 updated', 'Customer Rahul Sharma has ₹1,180 remaining.', 'Invoice'],
    ['Yesterday', 'Estimate EST-000004 accepted', 'Ready to convert into an invoice.', 'Estimate'],
    ['Yesterday', 'Payment recorded', 'A customer payment changed an invoice balance.', 'Payment'],
    ['Earlier', 'Product catalogue updated', 'Pricing and tax settings were refreshed.', 'Product'],
  ];
  return <Workspace title="Activity" subtitle="A human-readable audit timeline of what changed, why it changed, and what happened next."><Card className="mt-6 overflow-hidden"><div className="divide-y">{events.map((event, index) => <div key={`${event[0]}-${event[1]}`} className="flex gap-4 p-5"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-violet-50 text-xs font-bold text-violet-700">{index + 1}</span><div className="min-w-0 flex-1"><div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between"><b className="text-sm">{event[1]}</b><span className="text-[10px] text-slate-400">{event[0]}</span></div><p className="mt-1 text-xs leading-5 text-slate-500">{event[2]}</p><span className="mt-2 inline-flex rounded-full bg-slate-100 px-2 py-1 text-[9px] font-bold text-slate-500">{event[3]}</span></div></div>)}</div></Card></Workspace>;
}

export function Explain({ topic = 'Business Health' }: { topic?: string }) {
  const explanations: Record<string, { meaning: string; why: string; action: string }> = {
    'Business Health': { meaning: 'A health score is a compact signal across cash, collections, profitability, tax readiness and banking hygiene.', why: 'It is useful because a good profit number can hide weak collections or unresolved tax records.', action: 'Review the lowest-scoring area first and follow the suggested action.' },
    Receivables: { meaning: 'Receivables are amounts customers still owe the business.', why: 'They matter because sales are not cash until customers pay.', action: 'Open Collections and prioritize overdue balances.' },
    GST: { meaning: 'GST payable is broadly the output tax on sales less eligible input tax on purchases, subject to the applicable rules.', why: 'The number changes when sales, purchases, credits, reversals or tax classification changes.', action: 'Review exceptions before treating the estimate as filing-ready.' },
  };
  const explanation = explanations[topic] || explanations['Business Health'];
  return <Workspace title={`Explain: ${topic}`} subtitle="Numbers should answer three questions: what does it mean, why did it change, and what should I do next?"><Card className="mt-6 border-violet-200 bg-violet-50 p-6"><p className="text-[10px] font-bold uppercase tracking-[.18em] text-violet-600">Explain this number</p><h2 className="mt-2 text-2xl font-bold">{topic}</h2><div className="mt-6 grid gap-3 md:grid-cols-3"><div className="rounded-2xl bg-white p-4"><b className="text-sm">What it means</b><p className="mt-2 text-xs leading-5 text-slate-500">{explanation.meaning}</p></div><div className="rounded-2xl bg-white p-4"><b className="text-sm">Why it matters</b><p className="mt-2 text-xs leading-5 text-slate-500">{explanation.why}</p></div><div className="rounded-2xl bg-white p-4"><b className="text-sm">What to do</b><p className="mt-2 text-xs leading-5 text-slate-500">{explanation.action}</p></div></div></Card></Workspace>;
}

export function RecoveryDemo() {
  const [items, setItems] = useState(['Draft invoice INV-000010', 'Unsent estimate EST-000005']);
  const [undone, setUndone] = useState<string | null>(null);
  const remove = (item: string) => { setItems((v) => v.filter((x) => x !== item)); setUndone(item); };
  const undo = () => { if (undone) { setItems((v) => [undone, ...v]); setUndone(null); } };
  return <Workspace title="Recovery & Undo" subtitle="Destructive actions should be recoverable when possible. This testing surface demonstrates the interaction pattern before it reaches accounting records."><Card className="mt-6 p-5"><h2 className="font-bold">Recent drafts</h2><p className="mt-1 text-xs text-slate-500">Delete one to see the recovery pattern.</p><div className="mt-4 space-y-2">{items.map((item) => <div key={item} className="flex items-center gap-3 rounded-2xl border p-4"><span className="flex-1 text-sm font-semibold">{item}</span><button type="button" onClick={() => remove(item)} className="rounded-xl border border-rose-200 px-3 py-2 text-xs font-bold text-rose-700">Delete</button></div>)}{!items.length && <div className="rounded-2xl bg-slate-50 p-5 text-center text-xs text-slate-500">Nothing left. Use Undo to recover the last action.</div>}</div>{undone && <div className="mt-4 flex items-center gap-3 rounded-2xl bg-slate-950 p-4 text-white"><span className="flex-1 text-xs">{undone} deleted.</span><button type="button" onClick={undo} className="rounded-xl bg-white px-3 py-2 text-xs font-bold text-slate-900">Undo</button></div>}</Card></Workspace>;
}
