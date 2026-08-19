'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase, type BusinessContext } from '@/lib/supabase';

const money=(n:number)=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(Number(n||0));

type Bank={id:string;name:string;institution_name:string|null;account_last4:string|null;currency_code:string;is_connected:boolean};
type Tx={id:string;bank_account_id:string;transaction_date:string;description:string|null;reference:string|null;amount:number;direction:string;status:string;balance_after:number|null};
type Rec={id:string;bank_account_id:string;period_start:string;period_end:string;statement_ending_balance:number;book_ending_balance:number;difference:number;status:string;locked_at:string|null};
type Account={id:string;code:string;name:string;account_type:string};

export default function Banking(){
 const[ctx,setCtx]=useState<BusinessContext|null>(null),[banks,setBanks]=useState<Bank[]>([]),[tx,setTx]=useState<Tx[]>([]),[accounts,setAccounts]=useState<Account[]>([]),[rec,setRec]=useState<Rec[]>([]),[selectedBank,setSelectedBank]=useState(''),[q,setQ]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[statementBalance,setStatementBalance]=useState(''),[statementEnd,setStatementEnd]=useState(new Date().toISOString().slice(0,10));

 const load=async()=>{
   const c=await supabase.rpc('get_my_business_context');
   const b=c.data?.[0] as BusinessContext|undefined;
   if(!b){location.href='/';return}
   setCtx(b);
   const [ba,aa,br]=await Promise.all([
     supabase.from('bank_accounts').select('id,name,institution_name,account_last4,currency_code,is_connected').eq('business_id',b.business_id).eq('is_active',true).order('name'),
     supabase.from('accounts').select('id,code,name,account_type').eq('business_id',b.business_id).eq('is_active',true).order('code'),
     supabase.from('bank_reconciliations').select('id,bank_account_id,period_start,period_end,statement_ending_balance,book_ending_balance,difference,status,locked_at').eq('business_id',b.business_id).order('period_end',{ascending:false}).limit(20)
   ]);
   const bankRows=(ba.data||[]) as Bank[];
   setBanks(bankRows);setAccounts((aa.data||[]) as Account[]);setRec((br.data||[]) as Rec[]);
   const first=selectedBank||bankRows[0]?.id||'';setSelectedBank(first);
   if(bankRows.length){const r=await supabase.from('bank_transactions').select('id,bank_account_id,transaction_date,description,reference,amount,direction,status,balance_after').in('bank_account_id',bankRows.map(x=>x.id)).order('transaction_date',{ascending:false}).limit(200);setTx((r.data||[]) as Tx[])} else setTx([]);
   setLoading(false);
 };
 useEffect(()=>{load()},[]);

 const currentRec=useMemo(()=>rec.find(r=>r.bank_account_id===selectedBank && r.status!=='locked')||rec.find(r=>r.bank_account_id===selectedBank),[rec,selectedBank]);
 const selectedTx=useMemo(()=>tx.filter(x=>x.bank_account_id===selectedBank),[tx,selectedBank]);
 const filtered=useMemo(()=>selectedTx.filter(x=>`${x.description||''} ${x.reference||''} ${x.status}`.toLowerCase().includes(q.toLowerCase())),[selectedTx,q]);
 const unmatched=selectedTx.filter(x=>!['reconciled','ignored'].includes(String(x.status).toLowerCase())).length;
 const categoryAccounts=useMemo(()=>accounts.filter(a=>['expense','income'].includes(String(a.account_type).toLowerCase())),[accounts]);

 const startReconciliation=async()=>{
   if(!ctx||!selectedBank)return;
   const balance=Number(statementBalance);
   if(!Number.isFinite(balance)){setNotice('Enter the closing balance from the bank statement.');return}
   setBusy(true);setNotice('');
   const r=await supabase.rpc('create_bank_reconciliation',{p_business_id:ctx.business_id,p_bank_account_id:selectedBank,p_period_start:statementEnd,p_period_end:statementEnd,p_statement_ending_balance:balance,p_notes:'Started from Moneymatters Banking'});
   if(r.error)setNotice(r.error.message);else{setNotice('Reconciliation period opened. Review and categorize every transaction.');await load()}
   setBusy(false);
 };
 const categorize=async(txn:Tx,accountId:string)=>{
   if(!currentRec||currentRec.status==='locked'||!accountId)return;
   setBusy(true);setNotice('');
   const matchType=String(txn.direction).toLowerCase().includes('out')?'expense':'manual';
   const r=await supabase.rpc('match_bank_transaction',{p_reconciliation_id:currentRec.id,p_bank_transaction_id:txn.id,p_match_type:matchType,p_matched_record_id:accountId,p_notes:'Categorized in Banking'});
   if(r.error)setNotice(r.error.message);else{setNotice('Transaction categorized and posted to the ledger.');await load()}
   setBusy(false);
 };
 const lock=async()=>{
   if(!currentRec)return;
   setBusy(true);setNotice('');
   const r=await supabase.rpc('lock_bank_reconciliation',{p_reconciliation_id:currentRec.id});
   if(r.error)setNotice(r.error.message);else{setNotice('Reconciliation completed and locked.');await load()}
   setBusy(false);
 };

 if(loading)return <div className="grid min-h-[70vh] place-items-center bg-[#fbfaff] text-sm text-slate-500">Loading banking…</div>;
 return <main className="min-h-screen bg-[#fbfaff] p-4 text-slate-950 sm:p-6 lg:p-8"><div className="mx-auto max-w-[1320px]">
  <header className="mb-7 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[.18em] text-violet-600">Money</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">Banking</h1><p className="mt-2 max-w-2xl text-sm text-slate-500">Review imported transactions, categorize them once, and reconcile the bank against the books.</p></div><div className="flex flex-wrap gap-2"><button onClick={()=>location.href='/next-workspace/data-migration'} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700">Import statement</button><button onClick={()=>location.href='/next-workspace/accounting'} className="rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white">Accounting</button></div></header>
  {notice&&<div className="mb-5 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-900">{notice}</div>}
  <div className="grid gap-4 sm:grid-cols-3"><Kpi title="Bank accounts" value={String(banks.length)} note={`${banks.filter(x=>x.is_connected).length} connected`}/><Kpi title="Needs review" value={String(unmatched)} note="Uncategorized transactions" tone="amber"/><Kpi title="Reconciliation" value={currentRec?.status||'Not started'} note={currentRec?`${currentRec.period_start} → ${currentRec.period_end}`:'Start a statement period'} tone={currentRec?.difference===0?'green':'violet'}/></div>
  <div className="mt-6 grid gap-6 lg:grid-cols-[320px_1fr]"><section className="rounded-2xl border border-slate-200 bg-white p-4"><div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">Bank accounts</h2><span className="rounded-full bg-violet-50 px-2 py-1 text-[10px] font-bold text-violet-700">{banks.length}</span></div><div className="space-y-2">{banks.map(b=><button key={b.id} onClick={()=>setSelectedBank(b.id)} className={`w-full rounded-xl border p-3 text-left ${selectedBank===b.id?'border-violet-200 bg-violet-50':'border-slate-100 hover:bg-violet-50/50'}`}><div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-xl bg-violet-100 text-violet-700">₹</span><span className="min-w-0 flex-1"><b className="block truncate text-sm">{b.name}</b><span className="text-xs text-slate-500">{b.institution_name||'Bank'} {b.account_last4?`••${b.account_last4}`:''}</span></span><span className={`h-2 w-2 rounded-full ${b.is_connected?'bg-emerald-500':'bg-slate-300'}`}/></div></button>)}{!banks.length&&<div className="rounded-xl bg-violet-50 p-4 text-xs leading-5 text-violet-800">No bank account is configured yet. Import a bank account before reconciliation.</div>}<button onClick={()=>location.href='/next-workspace/data-migration'} className="w-full rounded-xl border border-dashed border-violet-200 px-3 py-2.5 text-xs font-semibold text-violet-700 hover:bg-violet-50">＋ Add / import account</button></div></section>
   <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white"><div className="border-b border-slate-100 p-4 sm:p-5"><div className="flex flex-col gap-3 lg:flex-row lg:items-end"><div className="relative flex-1"><span className="absolute left-3 top-2.5 text-slate-400">⌕</span><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search bank transactions…" className="w-full rounded-xl border border-slate-200 bg-[#fbfaff] py-2.5 pl-9 pr-4 text-sm outline-none"/></div><div className="flex flex-wrap gap-2"><input type="date" value={statementEnd} onChange={e=>setStatementEnd(e.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm"/><input inputMode="decimal" value={statementBalance} onChange={e=>setStatementBalance(e.target.value)} placeholder="Closing balance" className="w-36 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm"/>{currentRec?.status!=='locked'&&<button disabled={busy||!selectedBank} onClick={startReconciliation} className="rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{currentRec?'Update period':'Start reconciliation'}</button>}{currentRec?.status!=='locked'&&<button disabled={busy||!currentRec||unmatched>0||Math.abs(Number(currentRec?.difference||0))>.01} onClick={lock} className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-2.5 text-sm font-semibold text-violet-800 disabled:opacity-50">End & lock</button>}</div></div></div><div className="hidden grid-cols-[110px_1fr_120px_190px] gap-3 border-b border-slate-100 px-5 py-3 text-[10px] font-bold uppercase tracking-wider text-slate-400 sm:grid"><span>Date</span><span>Description</span><span>Status</span><span className="text-right">Category / Amount</span></div><div className="divide-y divide-slate-100">{filtered.slice(0,100).map(x=><div key={x.id} className="grid gap-3 px-4 py-4 sm:grid-cols-[110px_1fr_120px_190px] sm:items-center sm:px-5"><span className="text-xs text-slate-500">{x.transaction_date}</span><span className="min-w-0"><b className="block truncate text-sm">{x.description||'Bank transaction'}</b><span className="text-xs text-slate-400">{x.reference||'No reference'}</span></span><span><span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${String(x.status).toLowerCase().includes('recon')?'bg-emerald-50 text-emerald-700':'bg-amber-50 text-amber-700'}`}>{String(x.status||'review').replaceAll('_',' ')}</span></span><div className="flex items-center justify-end gap-2"><b className="text-sm">{money(Number(x.amount||0))}</b>{currentRec?.status!=='locked'&&!['reconciled','ignored'].includes(String(x.status).toLowerCase())&&<select disabled={busy} defaultValue="" onChange={e=>categorize(x,e.target.value)} className="max-w-[120px] rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px]"><option value="">Categorize</option>{categoryAccounts.map(a=><option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select>}</div></div>)}{!filtered.length&&<div className="p-10 text-center text-sm text-slate-500">No bank transactions match your filter.</div>}</div></section></div>
  <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-semibold">Reconciliation summary</h2><p className="mt-1 text-xs text-slate-500">Every transaction in the period must be categorized, matched or intentionally ignored before the period can be locked.</p></div>{currentRec&&<span className={`rounded-full px-3 py-1 text-xs font-semibold ${Math.abs(Number(currentRec.difference||0))<=.01?'bg-emerald-50 text-emerald-700':'bg-amber-50 text-amber-700'}`}>{Math.abs(Number(currentRec.difference||0))<=.01?'Balanced':'Difference '+money(currentRec.difference)}</span>}</div><div className="mt-4 grid gap-3 sm:grid-cols-3"><Summary title="Statement ending" value={currentRec?money(currentRec.statement_ending_balance):'—'}/><Summary title="Book ending" value={currentRec?money(currentRec.book_ending_balance):'—'}/><Summary title="Status" value={currentRec?.locked_at?'Locked':currentRec?'Open':'Not started'}/></div></section>
 </div></main>;
}
function Kpi({title,value,note,tone='violet'}:{title:string;value:string;note:string;tone?:string}){const cls=tone==='green'?'bg-emerald-50 text-emerald-700':tone==='amber'?'bg-amber-50 text-amber-700':'bg-violet-50 text-violet-700';return <section className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-start justify-between"><span className="text-xs font-semibold text-slate-500">{title}</span><span className={`rounded-lg px-2 py-1 text-[10px] font-bold ${cls}`}>●</span></div><p className="mt-3 text-2xl font-semibold tracking-tight">{value}</p><p className="mt-1 text-xs text-slate-400">{note}</p></section>}
function Summary({title,value}:{title:string;value:string}){return <div className="rounded-xl bg-[#faf8ff] p-4"><span className="text-xs text-slate-500">{title}</span><b className="mt-1 block text-lg">{value}</b></div>}
