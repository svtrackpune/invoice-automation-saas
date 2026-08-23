'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useWorkspace } from '@/lib/workspace-context';
import { ErrorState, LoadingState } from '../workspace-ui';

const money=(n:number)=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(Number(n||0));

type Tax={id:string;name:string;rate:number};
type Invoice={total:number;balance_due:number;status:string};

export default function TaxCenter(){
 const{business,loading:workspaceLoading}=useWorkspace();
 const[taxes,setTaxes]=useState<Tax[]>([]),[invoices,setInvoices]=useState<Invoice[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState('');
 useEffect(()=>{if(!business){setLoading(false);return}let alive=true;(async()=>{const[t,i]=await Promise.all([supabase.from('tax_rates').select('id,name,rate').eq('business_id',business.business_id).eq('is_active',true).order('rate'),supabase.from('invoices').select('total,balance_due,status').eq('business_id',business.business_id).limit(500)]);if(!alive)return;const e=t.error||i.error;if(e)setError(e.message);setTaxes(t.data||[]);setInvoices(i.data||[]);setLoading(false)})();return()=>{alive=false}},[business]);
 const invoiced=useMemo(()=>invoices.reduce((a,x)=>a+Number(x.total||0),0),[invoices]);
 if(workspaceLoading||loading)return <LoadingState label="Preparing GST center…"/>;
 if(!business)return <div className="p-6"><ErrorState message="No business workspace is active."/></div>;
 return <main className="min-h-screen bg-[#fbfaff] p-4 sm:p-6 lg:p-8"><div className="mx-auto max-w-[1100px]"><header className="mb-7"><p className="text-[10px] font-bold uppercase tracking-[.18em] text-violet-600">Tax intelligence</p><h1 className="mt-1 text-3xl font-semibold">GST Center</h1><p className="mt-2 text-sm text-slate-500">Understand the tax setup and the transaction base behind your GST records.</p></header>{error&&<div className="mb-5"><ErrorState message={error}/></div>}<div className="grid gap-4 sm:grid-cols-3"><K title="Tax mode" value={business.tax_enabled?'GST enabled':'Tax disabled'} note="Business configuration"/><K title="Invoice base" value={money(invoiced)} note="Current invoice value"/><K title="Active rates" value={String(taxes.length)} note="Configured tax rates"/></div><section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-center justify-between"><div><h2 className="font-semibold">Configured GST rates</h2><p className="mt-1 text-xs text-slate-500">These are the rates available to sales workflows. Tax liability/ITC should be read from posted accounting transactions.</p></div><button onClick={()=>{window.location.href='/next-workspace/tax'}} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold">Open tax reports →</button></div><div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{taxes.map(t=><div key={t.id} className="rounded-xl bg-slate-50 p-4"><b className="block text-lg">{t.rate}%</b><span className="text-xs text-slate-500">{t.name}</span></div>)}{!taxes.length&&<p className="col-span-full rounded-xl bg-amber-50 p-4 text-sm text-amber-800">No active GST rates are configured yet.</p>}</div></section></div></main>;
}
function K({title,value,note}:{title:string;value:string;note:string}){return <section className="rounded-2xl border border-slate-200 bg-white p-5"><span className="text-xs font-semibold text-slate-500">{title}</span><b className="mt-3 block text-2xl tracking-tight">{value}</b><span className="mt-1 block text-xs text-slate-400">{note}</span></section>}
