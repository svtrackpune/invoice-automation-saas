'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase, type BusinessContext } from '@/lib/supabase';
import VendorCreditApplyModal from './VendorCreditApplyModal';

type Vendor={id:string;display_name:string;legal_name:string|null;contact_person_name:string|null;phone:string|null;email:string|null;tax_id:string|null;tax_type:string|null;payment_terms_days:number;notes:string|null};
type Balance={billed:number;paid:number;balance_due:number};
type Bill={id:string;bill_number:string;bill_date:string;due_date:string;status:string;total:number;balance_due:number};
type Payment={id:string;payment_date:string;amount:number;method:string;reference:string|null};
type Statement={bill_date:string;bill_number:string;text:string;total:number;numeric:number;id:string};
type VendorCredit={id:string;credit_number:string;credit_date:string;reason:string;total:number;status:string;bill_id:string|null;available:number};

const money=(n:number)=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:2}).format(Number(n||0));

export default function Vendor360Controlled({params}:{params:Promise<{id:string}>}){
 const [id,setId]=useState('');
 const [businessId,setBusinessId]=useState('');
 const [vendor,setVendor]=useState<Vendor|null>(null);
 const [balance,setBalance]=useState<Balance>({billed:0,paid:0,balance_due:0});
 const [bills,setBills]=useState<Bill[]>([]);
 const [payments,setPayments]=useState<Payment[]>([]);
 const [statement,setStatement]=useState<Statement[]>([]);
 const [credits,setCredits]=useState<VendorCredit[]>([]);
 const [applyCredit,setApplyCredit]=useState<VendorCredit|null>(null);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState('');

 useEffect(()=>{params.then(p=>setId(p.id))},[params]);

 const load=async()=>{
   if(!id)return;
   setLoading(true);setError('');
   const c=await supabase.rpc('get_my_business_context');
   const b=c.data?.[0] as BusinessContext|undefined;
   if(!b){setError('Business context unavailable.');setLoading(false);return}
   setBusinessId(b.business_id);

   const [v,bal,bs,ps,st,vc,vl]=await Promise.all([
     supabase.from('vendors').select('id,display_name,legal_name,contact_person_name,phone,email,tax_id,tax_type,payment_terms_days,notes').eq('id',id).eq('business_id',b.business_id).maybeSingle(),
     supabase.from('vendor_balances').select('billed,paid,balance_due').eq('vendor_id',id).eq('business_id',b.business_id).maybeSingle(),
     supabase.from('bills').select('id,bill_number,bill_date,due_date,status,total,balance_due').eq('vendor_id',id).eq('business_id',b.business_id).order('bill_date',{ascending:false}),
     supabase.from('payments').select('id,payment_date,amount,method,reference').eq('vendor_id',id).eq('business_id',b.business_id).eq('direction','outbound').order('payment_date',{ascending:false}),
     supabase.from('vendor_statement_lines').select('bill_date,bill_number,text,total,numeric,id').eq('vendor_id',id).eq('business_id',b.business_id).order('bill_date'),
     supabase.from('vendor_credits').select('id,credit_number,credit_date,reason,total,status,bill_id').eq('vendor_id',id).eq('business_id',b.business_id).order('credit_date',{ascending:false}),
     supabase.from('vendor_credit_ledger').select('vendor_credit_id,amount').eq('vendor_id',id).eq('business_id',b.business_id)
   ]);

   if(v.error||!v.data)setError(v.error?.message||'Vendor not found');
   else setVendor(v.data as Vendor);
   setBalance((bal.data||{billed:0,paid:0,balance_due:0}) as Balance);
   setBills((bs.data||[]) as Bill[]);
   setPayments((ps.data||[]) as Payment[]);
   setStatement((st.data||[]) as Statement[]);

   const availableById:Record<string,number>={};
   (vl.data||[]).forEach((row:any)=>{
     if(row.vendor_credit_id)availableById[row.vendor_credit_id]=(availableById[row.vendor_credit_id]||0)+Number(row.amount||0);
   });
   setCredits((vc.data||[]).map((row:any)=>({...row,available:Number(availableById[row.id]||0)})) as VendorCredit[]);
   setLoading(false);
 };

 useEffect(()=>{if(id)void load()},[id]);

 const overdue=useMemo(()=>bills.filter(x=>Number(x.balance_due)>0&&x.due_date<new Date().toISOString().slice(0,10)).reduce((a,x)=>a+Number(x.balance_due||0),0),[bills]);
 const availableCredit=useMemo(()=>credits.filter(x=>x.status==='posted').reduce((a,x)=>a+Math.max(x.available,0),0),[credits]);

 if(loading)return <main className="p-6 text-sm text-slate-500">Loading Supplier 360…</main>;
 if(error||!vendor)return <main className="p-6 text-sm text-rose-700">{error||'Vendor not found.'}</main>;

 return <main className="min-h-screen bg-[#f7f6fb] p-4 sm:p-7">
   <div className="mx-auto max-w-7xl">
     <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
       <div><p className="text-xs font-bold uppercase tracking-[.18em] text-violet-600">Supplier 360</p><h1 className="mt-1 text-3xl font-bold">{vendor.display_name}</h1><p className="mt-1 text-sm text-slate-500">{vendor.contact_person_name||'No contact person'} · {vendor.phone||'No phone'} · {vendor.email||'No email'}</p></div>
       <div className="flex gap-2"><button type="button" onClick={()=>location.href='/next-workspace/vendors'} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold">← Vendors</button><button type="button" onClick={()=>location.href='/next-workspace/purchases/new'} className="rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white">＋ Purchase bill</button></div>
     </header>

     <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
       <Metric label="Billed" value={money(balance.billed)}/>
       <Metric label="Paid" value={money(balance.paid)}/>
       <Metric label="Outstanding" value={money(balance.balance_due)}/>
       <Metric label="Overdue" value={money(overdue)}/>
       <Metric label="Available credit" value={money(availableCredit)}/>
     </div>

     <Card title="Supplier profile"><p className="text-sm">{vendor.legal_name||'Legal name not set'}</p><p className="mt-2 text-sm text-slate-500">{vendor.tax_type||'N/A'}{vendor.tax_id?' · '+vendor.tax_id:''}</p><p className="mt-2 text-sm text-slate-500">{vendor.payment_terms_days?'Net '+vendor.payment_terms_days:'Due on receipt'}</p>{vendor.notes&&<p className="mt-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">{vendor.notes}</p>}</Card>

     <Card title="Purchase bills"><Table headers={['Bill','Date','Due','Status','Total','Balance']} rows={bills.map(x=>[x.bill_number,x.bill_date,x.due_date,x.status.replaceAll('_',' '),money(x.total),money(x.balance_due)])}/></Card>
     <Card title="Supplier payments"><Table headers={['Date','Amount','Method','Reference']} rows={payments.map(x=>[x.payment_date,money(x.amount),x.method.replaceAll('_',' '),x.reference||'—'])}/></Card>

     <Card title="Supplier credits">
       {credits.filter(x=>x.status==='posted').length?<div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr>{['Credit','Date','Reason','Total','Available','Action'].map(h=><th key={h} className="px-4 py-3">{h}</th>)}</tr></thead><tbody>{credits.filter(x=>x.status==='posted').map(x=><tr key={x.id} className="border-t border-slate-100"><td className="px-4 py-3 font-semibold">{x.credit_number}</td><td className="px-4 py-3">{x.credit_date}</td><td className="px-4 py-3">{x.reason}</td><td className="px-4 py-3">{money(x.total)}</td><td className="px-4 py-3">{money(Math.max(x.available,0))}</td><td className="px-4 py-3">{x.available>0.005?<button type="button" onClick={()=>setApplyCredit(x)} className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-700 hover:bg-violet-100">Apply</button>:<span className="text-xs text-slate-400">Settled</span>}</td></tr>)}</tbody></table></div>:<p className="text-sm text-slate-500">No posted supplier credits.</p>}
     </Card>

     <Card title="Supplier statement"><Table headers={['Date','Document','Text','Total']} rows={statement.map(x=>[x.bill_date,x.bill_number,x.text,money(x.total)])}/></Card>

     {applyCredit&&<VendorCreditApplyModal open={!!applyCredit} businessId={businessId} creditId={applyCredit.id} creditNumber={applyCredit.credit_number} available={Math.max(applyCredit.available,0)} bills={bills} onClose={()=>setApplyCredit(null)} onSaved={load}/>}
   </div>
 </main>;
}

function Metric({label,value}:{label:string;value:string}){return <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><span className="text-xs text-slate-400">{label}</span><b className="mt-1 block text-2xl">{value}</b></div>}
function Card({title,children}:{title:string;children:React.ReactNode}){return <section className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-100 p-5"><h2 className="font-semibold">{title}</h2></div><div className="p-5">{children}</div></section>}
function Table({headers,rows}:{headers:string[];rows:string[][]}){return <div className="overflow-x-auto"><table className="w-full min-w-[650px] text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr>{headers.map(h=><th key={h} className="px-4 py-3">{h}</th>)}</tr></thead><tbody>{rows.map((r,i)=><tr key={i} className="border-t border-slate-100">{r.map((v,j)=><td key={j} className="px-4 py-3">{v}</td>)}</tr>)}</tbody></table></div>}
