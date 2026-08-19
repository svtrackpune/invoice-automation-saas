'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';

type Job={id:string;document_type:string;document_id:string;template_id:string|null;template_version:number|null;payload:any;status:string};
const money=(n:any,c='INR')=>new Intl.NumberFormat('en-IN',{style:'currency',currency:String(c||'INR').trim(),maximumFractionDigits:2}).format(Number(n||0));
const text=(v:any)=>String(v??'');

function DocumentsContent(){
 const qs=useSearchParams(); const type=qs.get('type')||'invoice'; const id=qs.get('id')||'';
 const [job,setJob]=useState<Job|null>(null); const [loading,setLoading]=useState(true); const [error,setError]=useState('');
 useEffect(()=>{(async()=>{if(!id){setError('Document id is required.');setLoading(false);return;}const r=await supabase.rpc('prepare_document_render',{p_document_type:type,p_document_id:id,p_template_id:null});if(r.error){setError(r.error.message);setLoading(false);return;}const j=await supabase.from('document_render_jobs').select('id,document_type,document_id,template_id,template_version,payload,status').eq('id',r.data).single();if(j.error)setError(j.error.message);else setJob(j.data as Job);setLoading(false);})()},[type,id]);
 if(loading)return <div className="grid min-h-screen place-items-center bg-slate-100 text-sm text-slate-500">Preparing document…</div>;
 if(error)return <div className="grid min-h-screen place-items-center bg-slate-100 p-6"><div className="rounded-2xl bg-white p-6 text-sm text-rose-700 shadow">{error}</div></div>;
 const p=job?.payload||{},b=p.business||{},c=p.customer||{},items=p.items||[];
 const title=type==='invoice'?'INVOICE':type==='quotation'?'QUOTATION':type==='receipt'?'PAYMENT RECEIPT':type==='credit_note'?'CREDIT NOTE':'DEBIT NOTE';
 const number=p.invoice_number||p.quotation_number||p.receipt_number||p.credit_note_number||p.debit_note_number||'';
 const date=p.invoice_date||p.quotation_date||p.receipt_date||p.credit_note_date||p.debit_note_date||'';
 const total=p.total??p.amount??0;
 return <main className="min-h-screen bg-slate-100 p-4 sm:p-8"><div className="mx-auto mb-4 flex max-w-[900px] items-center justify-between print:hidden"><div><p className="text-[10px] font-bold uppercase tracking-[.18em] text-slate-400">Document center</p><h1 className="mt-1 text-xl font-semibold">{title} {number}</h1><p className="text-xs text-slate-500">Template v{job?.template_version||1} · Print-ready</p></div><div className="flex gap-2"><button onClick={()=>history.back()} className="rounded-xl border bg-white px-4 py-2.5 text-sm font-semibold">Back</button><button onClick={()=>window.print()} className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white">Print / Save PDF</button></div></div>
 <article className="mx-auto min-h-[1120px] max-w-[900px] bg-white p-10 shadow-xl print:min-h-0 print:max-w-none print:p-10 print:shadow-none" style={{fontFamily:'Arial, sans-serif'}}>
  <header className="flex items-start justify-between gap-8 border-b-2 border-slate-900 pb-6"><div><div className="text-2xl font-black">{text(b.name||b.legal_name||'Business')}</div>{b.address&&<div className="mt-2 max-w-sm text-xs leading-5 text-slate-500">{typeof b.address==='string'?b.address:JSON.stringify(b.address)}</div>}{b.tax_registration_number&&<div className="mt-2 text-xs font-semibold">GSTIN / Tax ID: {b.tax_registration_number}</div>}</div><div className="text-right"><div className="text-3xl font-black">{title}</div><div className="mt-3 text-sm"><b>No.</b> {number}</div><div className="mt-1 text-sm"><b>Date</b> {date}</div>{p.due_date&&<div className="mt-1 text-sm"><b>Due</b> {p.due_date}</div>}</div></header>
  <section className="mt-8 grid grid-cols-2 gap-8"><div><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{type==='receipt'?'Received from':'Bill to'}</p><div className="mt-2 text-base font-bold">{text(c.display_name||c.legal_name||'')}</div><div className="mt-1 text-xs text-slate-500">{c.email||''}{c.phone?` · ${c.phone}`:''}</div>{c.tax_id&&<div className="mt-1 text-xs font-semibold">GSTIN / Tax ID: {c.tax_id}</div>}</div><div className="text-right"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Status</p><div className="mt-2 text-sm font-semibold uppercase">{text(p.status||'')}</div></div></section>
  <table className="mt-8 w-full border-collapse text-sm"><thead><tr className="border-y-2 border-slate-900"><th className="py-3 text-left">Description</th><th className="py-3 text-right">Qty</th><th className="py-3 text-right">Rate</th><th className="py-3 text-right">Tax</th><th className="py-3 text-right">Amount</th></tr></thead><tbody>{items.map((x:any,i:number)=><tr key={i} className="border-b border-slate-200"><td className="py-3 pr-4">{text(x.description||x.name)}</td><td className="py-3 text-right">{x.quantity??1}</td><td className="py-3 text-right">{money(x.unit_price,p.currency_code)}</td><td className="py-3 text-right">{x.tax_rate??0}%</td><td className="py-3 text-right font-semibold">{money(x.line_total??(Number(x.quantity||1)*Number(x.unit_price||0)),p.currency_code)}</td></tr>)}</tbody></table>
  <div className="mt-8 ml-auto w-full max-w-sm space-y-2 border-t-2 border-slate-900 pt-4 text-sm"><div className="flex justify-between"><span>Subtotal</span><b>{money(p.subtotal,p.currency_code)}</b></div>{Number(p.discount_total)>0&&<div className="flex justify-between"><span>Discount</span><b>-{money(p.discount_total,p.currency_code)}</b></div>}{Number(p.tax_total)>0&&<div className="flex justify-between"><span>Tax</span><b>{money(p.tax_total,p.currency_code)}</b></div>}<div className="flex justify-between pt-2 text-lg"><span>Total</span><b>{money(total,p.currency_code)}</b></div>{p.balance_due!=null&&<div className="flex justify-between"><span>Balance due</span><b>{money(p.balance_due,p.currency_code)}</b></div>}</div>
  {(p.notes||p.terms||p.reason)&&<section className="mt-10 grid gap-6 border-t border-slate-200 pt-6 sm:grid-cols-2"><div>{p.notes&&<><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Notes</p><p className="mt-2 whitespace-pre-line text-xs leading-5 text-slate-600">{p.notes}</p></>}</div><div>{(p.terms||p.reason)&&<><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{p.reason?'Reason':'Terms'}</p><p className="mt-2 whitespace-pre-line text-xs leading-5 text-slate-600">{p.reason||p.terms}</p></>}</div></section>}
  <footer className="mt-16 border-t border-slate-200 pt-4 text-[10px] text-slate-400 flex justify-between"><span>{text(b.name||'Moneymatters')}</span><span>Generated from Moneymatters</span></footer>
 </article></main>;
}

export default function DocumentsPage(){
 return <Suspense fallback={<div className="grid min-h-screen place-items-center bg-slate-100 text-sm text-slate-500">Preparing document…</div>}><DocumentsContent /></Suspense>;
}
