'use client';

import { useMemo, useState } from 'react';

const scenarios = [
  ['S01','Customer → Product → Estimate → Invoice','Create a customer, add an item, create an estimate, accept it and convert it to an invoice.','/next-workspace/customers'],
  ['S02','Invoice → Partial Payment → Receipt','Create an invoice, record a partial payment, verify the balance and receipt, then record the remainder.','/next-workspace/sales'],
  ['S03','Invoice → Full Payment → Accounting','Pay an invoice in full and verify it becomes paid with exactly one accounting posting.','/next-workspace/payments'],
  ['S04','Vendor → Bill → Payment','Create a vendor bill, record the payment and verify the payable balance falls correctly.','/next-workspace/purchases'],
  ['S05','Bank Transaction → Match → Reconcile','Review a bank transaction, match/categorize it and reconcile the period.','/next-workspace/banking'],
  ['S06','Recurring Billing','Create a recurring schedule, run one cycle and inspect the execution history.','/next-workspace/recurring'],
  ['S07','Customer 360','Open a customer and verify invoices, payments, balance, statements and activity agree.','/next-workspace/customers'],
  ['S08','Financial Reports','Run P&L, Balance Sheet, Trial Balance and A/R; totals must reconcile.','/next-workspace/reports'],
  ['S09','Tenant Isolation','Switch businesses and verify records, metrics and actions are scoped to the selected business.','/next-workspace'],
  ['S10','Mobile UX','Test at a narrow viewport: navigation, create menu, forms, tables and document preview.','/next-workspace'],
  ['S11','Refresh / Idempotency','Repeat refresh/back/submit actions after mutations; no duplicate business or ledger records.','/next-workspace/payments'],
  ['S12','Documents & Branding','Configure logo/color/template and generate invoice/estimate/receipt previews.','/next-workspace/brand'],
];

const features = [
  ['Business cockpit','Dashboard metrics, attention queue, recent activity, search and create actions'],
  ['Sales','Invoices, payment state, customer allocation and accounting linkage'],
  ['Estimates','Quotation workflow and invoice conversion'],
  ['Customers','Customer 360, statements, activity and balances'],
  ['Vendors','Supplier profiles, bills, payments and balances'],
  ['Products','Products/services, pricing, tax and inventory controls'],
  ['Banking','Import/review/match/categorize/reconcile'],
  ['Accounting','Double-entry ledger, journals, reconciliation and controls'],
  ['Tax & ITR','Tax profile, adjustments, summaries and export'],
  ['Reports','P&L, balance sheet, cash flow, ledgers and aging'],
  ['Recurring','Schedules, reminders, executions and failures'],
  ['Documents','Templates, previews, PDF and sending'],
  ['WAPI','Business-scoped WhatsApp connection, templates and delivery state'],
  ['Migration','Validate, preview, commit and export data safely'],
];

export default function QAPage(){
  const [done,setDone]=useState<Record<string,boolean>>({});
  const completed=useMemo(()=>Object.values(done).filter(Boolean).length,[done]);
  const toggle=(id:string)=>setDone(x=>({...x,[id]:!x[id]}));
  return <main className="min-h-screen bg-[#fbfaff] p-4 text-slate-950 sm:p-6 lg:p-10"><div className="mx-auto max-w-[1180px]">
    <div className="flex flex-col gap-4 border-b border-violet-100 pb-7 md:flex-row md:items-end md:justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[.18em] text-violet-600">Release candidate QA</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Wave-parity test workspace</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">Use this page to validate the business flows before calling the build ready for production. It deliberately tests outcomes, not just screens.</p></div><a href="/next-workspace" className="rounded-xl bg-violet-600 px-4 py-2.5 text-center text-sm font-semibold text-white">Open workspace</a></div>
    <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_5px_24px_rgba(70,60,120,.045)]"><div className="flex flex-wrap items-center justify-between gap-3"><div><b className="text-sm">Manual acceptance progress</b><p className="mt-1 text-xs text-slate-500">{completed} of {scenarios.length} scenarios marked complete.</p></div><div className="h-2 w-44 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-violet-600 transition-all" style={{width:`${completed/scenarios.length*100}%`}}/></div></div></section>
    <div className="mt-6 grid gap-6 lg:grid-cols-[1.45fr_.55fr]"><section className="rounded-2xl border border-slate-200 bg-white shadow-[0_5px_24px_rgba(70,60,120,.045)]"><div className="border-b border-slate-100 p-5"><h2 className="font-semibold">End-to-end scenarios</h2><p className="mt-1 text-xs text-slate-500">Open the suggested destination, execute the flow, then mark the scenario.</p></div><div className="divide-y divide-slate-100">{scenarios.map(([id,title,description,target])=><div key={id} className="flex gap-4 p-5"><button onClick={()=>toggle(id)} aria-label={`Mark ${id} complete`} className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border text-xs font-bold ${done[id]?'border-violet-600 bg-violet-600 text-white':'border-slate-300 bg-white text-transparent'}`}>✓</button><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="rounded-md bg-violet-50 px-2 py-1 text-[10px] font-bold text-violet-700">{id}</span><h3 className={`text-sm font-semibold ${done[id]?'text-slate-400 line-through':''}`}>{title}</h3></div><p className="mt-1 text-xs leading-5 text-slate-500">{description}</p><a href={target} className="mt-3 inline-flex rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-violet-50">Open flow →</a></div></div>)}</div></section>
      <aside className="space-y-6"><section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_5px_24px_rgba(70,60,120,.045)]"><h2 className="font-semibold">Feature coverage</h2><div className="mt-4 space-y-3">{features.map(([name,text])=><div key={name}><b className="block text-xs">{name}</b><span className="mt-0.5 block text-[11px] leading-4 text-slate-500">{text}</span></div>)}</div></section><section className="rounded-2xl border border-amber-200 bg-amber-50 p-5"><b className="text-sm text-amber-900">Security gate</b><p className="mt-2 text-xs leading-5 text-amber-800">Before production sign-off, verify RLS on every business-owned table, tenant isolation, server-side authorization and idempotent accounting mutations.</p></section></aside></div>
    <p className="mt-8 text-center text-xs text-slate-400">QA workspace is intentionally operational: a checked scenario means a human verified the complete business outcome.</p>
  </div></main>;
}
