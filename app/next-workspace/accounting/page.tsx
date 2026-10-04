'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase, type BusinessContext } from '@/lib/supabase';

type Account = { id:string; code:string; name:string; account_type:string; normal_balance:string };
type JournalEntry = { id:string; entry_number:number; entry_date:string; description:string; source_type:string; status:string; total_debit:number; total_credit:number };
type JournalLineDraft = { accountId:string; description:string; debit:string; credit:string };
type GeneralLedgerRow = { entry_id:string; entry_number:number; entry_date:string; description:string; account_id:string; account_code:string; account_name:string; debit:number; credit:number; balance:number };
type TrialBalanceRow = { account_id:string; account_code:string; account_name:string; account_type:string; debit:number; credit:number; balance:number };
type BalanceSheetRow = { account_id:string; account_code:string; account_name:string; account_type:string; amount:number };
type Period = { id:string; period_start:string; period_end:string; status:string; closed_at:string|null };
type TabKey = 'ledger'|'trial'|'balance'|'journals'|'periods';

const tabs:Array<{key:TabKey;label:string}>=[
 {key:'ledger',label:'General Ledger'},{key:'trial',label:'Trial Balance'},{key:'balance',label:'Balance Sheet'},
 {key:'journals',label:'Journal Entries'},{key:'periods',label:'Period Management'}
];

const money=(n:number)=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:2}).format(Number(n||0));
const round2=(n:number)=>Math.round((Number(n||0)+Number.EPSILON)*100)/100;
const today=()=>new Date().toISOString().slice(0,10);
const yearStart=()=>new Date().toISOString().slice(0,4)+'-01-01';

export default function AccountingCockpit(){
 const[ctx,setCtx]=useState<BusinessContext|null>(null),[accounts,setAccounts]=useState<Account[]>([]),[entries,setEntries]=useState<JournalEntry[]>([]),[periods,setPeriods]=useState<Period[]>([]);
 const[activeTab,setActiveTab]=useState<TabKey>('trial'),[from,setFrom]=useState(yearStart()),[to,setTo]=useState(today()),[asOf,setAsOf]=useState(today()),[accountFilter,setAccountFilter]=useState('');
 const[ledgerRows,setLedgerRows]=useState<GeneralLedgerRow[]>([]),[trialRows,setTrialRows]=useState<TrialBalanceRow[]>([]),[balanceRows,setBalanceRows]=useState<BalanceSheetRow[]>([]);
 const[loading,setLoading]=useState(true),[reportLoading,setReportLoading]=useState(false),[error,setError]=useState(''),[successFlash,setSuccessFlash]=useState('');
 const[drawerOpen,setDrawerOpen]=useState(false),[journalBusy,setJournalBusy]=useState(false),[journalError,setJournalError]=useState('');
 const[journalDate,setJournalDate]=useState(today()),[journalDescription,setJournalDescription]=useState('');
 const[journalLines,setJournalLines]=useState<JournalLineDraft[]>([{accountId:'',description:'',debit:'',credit:''},{accountId:'',description:'',debit:'',credit:''}]);
 const[selectedPeriodId,setSelectedPeriodId]=useState('');

 const loadBase=async()=>{
  const c=await supabase.rpc('get_my_business_context');const b=c.data?.[0] as BusinessContext|undefined;
  if(!b){location.href='/';return null}setCtx(b);
  const[a,j,p]=await Promise.all([
   supabase.from('accounts').select('id,code,name,account_type,normal_balance').eq('business_id',b.business_id).eq('is_active',true).order('code'),
   supabase.from('journal_entries').select('id,entry_number,entry_date,description,source_type,status,total_debit,total_credit').eq('business_id',b.business_id).order('entry_date',{ascending:false}).limit(100),
   supabase.from('accounting_periods').select('id,period_start,period_end,status,closed_at').eq('business_id',b.business_id).order('period_end',{ascending:false}).limit(24)
  ]);
  if(a.error||j.error||p.error)setError((a.error||j.error||p.error)?.message||'Unable to load accounting console.');
  setAccounts((a.data||[]) as Account[]);setEntries((j.data||[]) as JournalEntry[]);const ps=(p.data||[]) as Period[];setPeriods(ps);
  const current=ps.find(x=>x.status==='open')||ps[0];setSelectedPeriodId(current?.id||'');setLoading(false);return b;
 };

 const loadReport=async(tab:TabKey,businessId=ctx?.business_id)=>{
  if(!businessId||tab==='periods'||tab==='journals')return;
  setReportLoading(true);setError('');
  try{
   if(tab==='ledger'){const r=await supabase.rpc('get_general_ledger',{p_business_id:businessId,p_start:from,p_end:to,p_account_id:accountFilter||null});if(r.error)throw new Error(r.error.message);setLedgerRows((r.data||[]) as GeneralLedgerRow[]);}
   if(tab==='trial'){const r=await supabase.rpc('get_trial_balance',{p_business_id:businessId,p_start:from,p_end:to});if(r.error)throw new Error(r.error.message);setTrialRows((r.data||[]) as TrialBalanceRow[]);}
   if(tab==='balance'){const r=await supabase.rpc('get_balance_sheet',{p_business_id:businessId,p_as_of:asOf});if(r.error)throw new Error(r.error.message);setBalanceRows((r.data||[]) as BalanceSheetRow[]);}
  }catch(e){setError(e instanceof Error?e.message:'Unable to load report.');}finally{setReportLoading(false);}
 };

 useEffect(()=>{let active=true;void loadBase().then(b=>{if(active&&b)void loadReport('trial',b.business_id)});return()=>{active=false}},[]);
 useEffect(()=>{if(ctx&&(activeTab==='ledger'||activeTab==='trial'||activeTab==='balance'))void loadReport(activeTab)},[activeTab,from,to,asOf,accountFilter,ctx?.business_id]);

 const period=periods.find(x=>x.id===selectedPeriodId)||null;
 const periodCanChange=Boolean(ctx&&/owner|accountant/.test(String(ctx.role||'').toLowerCase()));
 const periodRange=period?period.period_start+' → '+period.period_end:'No accounting period configured';

 const trialTotals=useMemo(()=>trialRows.reduce((a,r)=>{a.debit+=Number(r.debit||0);a.credit+=Number(r.credit||0);return a},{debit:0,credit:0}),[trialRows]);
 const balanceTotals=useMemo(()=>{
  const assets=balanceRows.filter(r=>r.account_type==='asset').reduce((n,r)=>n+Math.abs(Number(r.amount||0)),0);
  const liabilitiesAndEquity=balanceRows.filter(r=>r.account_type!=='asset').reduce((n,r)=>n+Math.abs(Number(r.amount||0)),0);
  const signedDelta=balanceRows.reduce((n,r)=>n+Number(r.amount||0),0);return{assets,liabilitiesAndEquity,signedDelta};
 },[balanceRows]);
 const journalDebit=useMemo(()=>journalLines.reduce((n,r)=>n+Number(r.debit||0),0),[journalLines]);
 const journalCredit=useMemo(()=>journalLines.reduce((n,r)=>n+Number(r.credit||0),0),[journalLines]);
 const journalDelta=round2(journalDebit-journalCredit);

 const updateLine=(i:number,patch:Partial<JournalLineDraft>)=>setJournalLines(rows=>rows.map((r,j)=>j===i?{...r,...patch}:r));

 const saveJournal=async()=>{
  if(!ctx)return;setJournalError('');
  if(!journalDescription.trim()){setJournalError('Enter a journal description.');return}
  if(!journalDate){setJournalError('Select the journal date.');return}
  const normalized=journalLines.map(r=>({...r,debitValue:Number(r.debit||0),creditValue:Number(r.credit||0)}));
  if(normalized.length<2||normalized.some(r=>!r.accountId||(r.debitValue<=0&&r.creditValue<=0)||(r.debitValue>0&&r.creditValue>0)||r.debitValue<0||r.creditValue<0)){setJournalError('Each journal line needs an account and exactly one positive debit or credit amount.');return}
  if(round2(normalized.reduce((n,r)=>n+r.debitValue-r.creditValue,0))!==0){setJournalError('Debits and credits must balance to exactly ₹0.00 before posting.');return}
  setJournalBusy(true);
  const created=await supabase.rpc('create_journal_entry',{
   p_business_id:ctx.business_id,p_entry_date:journalDate,p_description:journalDescription.trim(),p_source_type:'manual',p_source_id:null,
   p_currency_code:ctx.currency_code||'INR',
   p_lines:normalized.map(r=>({account_id:r.accountId,description:r.description.trim()||journalDescription.trim(),debit:r.debitValue,credit:r.creditValue,currency_code:ctx.currency_code||'INR'}))
  });
  if(created.error){setJournalError(created.error.message);setJournalBusy(false);return}
  const journalId=String(created.data||'');
  if(journalId){const posted=await supabase.rpc('post_journal_entry',{p_entry_id:journalId});if(posted.error){setJournalError(posted.error.message);setJournalBusy(false);return}}
  setDrawerOpen(false);setJournalDescription('');setJournalLines([{accountId:'',description:'',debit:'',credit:''},{accountId:'',description:'',debit:'',credit:''}]);setSuccessFlash('Journal entry posted.');setJournalBusy(false);
  const b=await loadBase();if(b)await loadReport(activeTab,b.business_id);
 };

 const closePeriod=async(target:Period)=>{
  if(!ctx||!periodCanChange)return;setError('');setSuccessFlash('');
  const r=await supabase.rpc('close_accounting_period',{p_business_id:ctx.business_id,p_period_start:target.period_start,p_period_end:target.period_end});
  if(r.error){setError(r.error.message);return}await loadBase();setSuccessFlash('Accounting period closed.');
 };
 const reopenPeriod=async(target:Period)=>{
  if(!ctx||!periodCanChange)return;setError('');setSuccessFlash('');
  const r=await supabase.rpc('reopen_accounting_period',{p_period_id:target.id});
  if(r.error){setError(r.error.message);return}await loadBase();setSuccessFlash('Accounting period reopened.');
 };

 if(loading||!ctx)return <div className="grid min-h-[70vh] place-items-center bg-slate-50 text-sm text-slate-500">Loading accounting console…</div>;
 const activeLabel=tabs.find(x=>x.key===activeTab)?.label||'Accounting';

 return <main className="min-h-screen bg-slate-50 p-3 text-slate-950 sm:p-6"><div className="mx-auto max-w-[1480px]">
  <header className="flex flex-col gap-4 border-b border-slate-200 pb-4 lg:flex-row lg:items-end lg:justify-between">
   <div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Finance control centre</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">Accounting Command Center</h1><p className="mt-1 text-sm text-slate-500">Authoritative ledger, reporting, journals and period controls.</p></div>
   <div className="flex flex-wrap items-center gap-2">
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"><span className="text-slate-400">Period</span><b className="ml-2">{periodRange}</b><span className={'ml-2 rounded-full px-2 py-0.5 text-[10px] font-bold '+(period?.status==='closed'?'bg-amber-50 text-amber-700':period?.status==='locked'?'bg-rose-50 text-rose-700':'bg-emerald-50 text-emerald-700')}>{period?.status||'none'}</span></div>
    {periodCanChange&&period?.status==='open'&&<button type="button" onClick={()=>void closePeriod(period)} className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs font-semibold text-amber-800">Close period</button>}
    {periodCanChange&&period?.status==='closed'&&<button type="button" onClick={()=>void reopenPeriod(period)} className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2.5 text-xs font-semibold text-indigo-700">Reopen period</button>}
    <button type="button" onClick={()=>setDrawerOpen(true)} className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700">＋ New Journal Entry</button>
    <button type="button" onClick={()=>location.href='/next-workspace'} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold">← Cockpit</button>
   </div>
  </header>
  {error&&<div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
  {successFlash&&<div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{successFlash}</div>}
  <nav className="mt-5 flex overflow-x-auto rounded-xl border border-slate-200 bg-white p-1 shadow-sm" aria-label="Accounting reports">{tabs.map(t=><button key={t.key} type="button" onClick={()=>{setActiveTab(t.key);setError('');setSuccessFlash('')}} className={'whitespace-nowrap rounded-lg px-4 py-2.5 text-xs font-semibold '+(activeTab===t.key?'bg-slate-900 text-white':'text-slate-500 hover:bg-slate-50 hover:text-slate-900')}>{t.label}</button>)}</nav>
  <section className="mt-4 rounded-xl border border-slate-200 bg-white p-3 shadow-sm"><div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between"><div className="flex flex-wrap gap-2">
   {(activeTab==='ledger'||activeTab==='trial')&&<><label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">From<input type="date" value={from} onChange={e=>setFrom(e.target.value)} className="mt-1 block h-9 rounded-lg border border-slate-200 px-2 text-xs text-slate-800"/></label><label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">To<input type="date" value={to} onChange={e=>setTo(e.target.value)} className="mt-1 block h-9 rounded-lg border border-slate-200 px-2 text-xs text-slate-800"/></label></>}
   {activeTab==='ledger'&&<label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Account<select value={accountFilter} onChange={e=>setAccountFilter(e.target.value)} className="mt-1 block h-9 w-72 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-800"><option value="">All accounts</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select></label>}
   {activeTab==='balance'&&<label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">As of<input type="date" value={asOf} onChange={e=>setAsOf(e.target.value)} className="mt-1 block h-9 rounded-lg border border-slate-200 px-2 text-xs text-slate-800"/></label>}
  </div><div className="text-xs text-slate-500">{reportLoading?'Refreshing authoritative report…':activeLabel}</div></div></section>

  {activeTab==='ledger'&&<ReportCard title="General Ledger" note="Posted journal lines returned by get_general_ledger." loading={reportLoading}><div className="overflow-x-auto"><table className="min-w-[1000px] w-full text-left text-xs"><thead><tr className="border-b border-slate-100 bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-500">{['Date','Entry','Account','Description','Debit','Credit','Balance'].map(x=><th key={x} className="px-4 py-3">{x}</th>)}</tr></thead><tbody>{ledgerRows.map(r=><tr key={r.entry_id+'-'+r.account_id} className="border-b border-slate-100 hover:bg-slate-50"><td className="px-4 py-3 font-mono text-[11px] text-slate-500">{r.entry_date}</td><td className="px-4 py-3 font-mono">{r.entry_number}</td><td className="px-4 py-3"><b>{r.account_code}</b><span className="ml-2 text-slate-500">{r.account_name}</span></td><td className="max-w-[320px] px-4 py-3">{r.description||'—'}</td><td className="px-4 py-3 text-right font-mono tabular-nums">{money(r.debit)}</td><td className="px-4 py-3 text-right font-mono tabular-nums">{money(r.credit)}</td><td className="px-4 py-3 text-right font-mono font-semibold tabular-nums">{money(r.balance)}</td></tr>)}{!ledgerRows.length&&!reportLoading&&<tr><td colSpan={7} className="p-12 text-center text-sm text-slate-500">No posted ledger lines for this period.</td></tr>}</tbody></table></div></ReportCard>}

  {activeTab==='trial'&&<ReportCard title="Trial Balance" note="Authoritative posted debit, credit and balance totals from get_trial_balance." loading={reportLoading}><div className="grid gap-3 p-4 sm:grid-cols-3"><Metric title="Total debits" value={money(trialTotals.debit)}/><Metric title="Total credits" value={money(trialTotals.credit)}/><Metric title="Control delta" value={money(round2(trialTotals.debit-trialTotals.credit))} tone={Math.abs(round2(trialTotals.debit-trialTotals.credit))<0.01?'good':'warn'}/></div><DataGrid headers={['Code','Account','Type','Debit','Credit','Balance']} rows={trialRows.map(r=>[r.account_code,r.account_name,r.account_type,money(r.debit),money(r.credit),money(r.balance)])}/></ReportCard>}

  {activeTab==='balance'&&<ReportCard title="Balance Sheet" note="Assets, liabilities and equity returned by get_balance_sheet." loading={reportLoading}><div className="grid gap-3 p-4 sm:grid-cols-3"><Metric title="Assets" value={money(balanceTotals.assets)}/><Metric title="Liabilities + Equity" value={money(balanceTotals.liabilitiesAndEquity)}/><Metric title="Signed control delta" value={money(round2(balanceTotals.signedDelta))} tone={Math.abs(round2(balanceTotals.signedDelta))<0.01?'good':'warn'}/></div><DataGrid headers={['Code','Account','Type','Amount']} rows={balanceRows.map(r=>[r.account_code,r.account_name,r.account_type,money(r.amount)])}/></ReportCard>}

  {activeTab==='journals'&&<ReportCard title="Journal Entries" note="Posted and draft journal activity for this business."><DataGrid headers={['#','Date','Description','Source','Status','Debit','Credit']} rows={entries.map(r=>[String(r.entry_number),r.entry_date,r.description||'—',r.source_type||'manual',r.status,money(r.total_debit),money(r.total_credit)])}/></ReportCard>}

  {activeTab==='periods'&&<ReportCard title="Period Management" note="Close and reopen actions remain enforced by the authoritative accounting RPCs."><div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left text-xs"><thead><tr className="border-b border-slate-100 bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-500"><th className="px-4 py-3">Period</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Closed at</th><th className="px-4 py-3 text-right">Actions</th></tr></thead><tbody>{periods.map(r=><tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50"><td className="px-4 py-3 font-mono">{r.period_start} → {r.period_end}</td><td className="px-4 py-3"><span className={'rounded-full px-2 py-1 text-[10px] font-bold '+(r.status==='open'?'bg-emerald-50 text-emerald-700':r.status==='closed'?'bg-amber-50 text-amber-700':'bg-rose-50 text-rose-700')}>{r.status}</span></td><td className="px-4 py-3 text-slate-500">{r.closed_at?new Date(r.closed_at).toLocaleString('en-IN'):'—'}</td><td className="px-4 py-3 text-right">{periodCanChange&&r.status==='open'&&<button type="button" onClick={()=>void closePeriod(r)} className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white">Close period</button>}{periodCanChange&&r.status==='closed'&&<button type="button" onClick={()=>void reopenPeriod(r)} className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700">Reopen period</button>}{!periodCanChange&&<span className="text-[11px] text-slate-400">Owner / accountant only</span>}</td></tr>)}</tbody></table></div></ReportCard>}

  {drawerOpen&&<div className="fixed inset-0 z-[120]"><button type="button" className="absolute inset-0 h-full w-full bg-slate-950/35" onClick={()=>!journalBusy&&setDrawerOpen(false)} aria-label="Close journal drawer"/><aside className="absolute inset-y-0 right-0 flex w-full max-w-2xl flex-col border-l border-slate-200 bg-white shadow-2xl">
   <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4"><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Manual accounting adjustment</p><h2 className="mt-1 text-xl font-semibold">New Journal Entry</h2></div><button type="button" disabled={journalBusy} onClick={()=>setDrawerOpen(false)} className="text-2xl text-slate-400">×</button></header>
   <div className="flex-1 overflow-y-auto p-5">{journalError&&<div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">{journalError}</div>}
    <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold text-slate-600">Entry date<input type="date" value={journalDate} onChange={e=>setJournalDate(e.target.value)} className="mt-1.5 h-9 w-full rounded-lg border border-slate-200 px-3 text-sm"/></label><label className="text-xs font-semibold text-slate-600">Description<input value={journalDescription} onChange={e=>setJournalDescription(e.target.value)} placeholder="e.g. Year-end depreciation" className="mt-1.5 h-9 w-full rounded-lg border border-slate-200 px-3 text-sm"/></label></div>
    <div className="mt-5 overflow-x-auto rounded-xl border border-slate-200"><div className="grid min-w-[720px] grid-cols-[1.5fr_1.2fr_130px_130px_34px] border-b border-slate-100 bg-slate-50 px-3 py-2 text-[9px] font-bold uppercase tracking-wider text-slate-500"><span>Account</span><span>Line description</span><span className="text-right">Debit</span><span className="text-right">Credit</span><span/></div>
     {journalLines.map((line,i)=><div key={i} className="grid min-w-[720px] grid-cols-[1.5fr_1.2fr_130px_130px_34px] gap-2 border-b border-slate-100 px-3 py-2"><select value={line.accountId} onChange={e=>updateLine(i,{accountId:e.target.value})} className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs"><option value="">Select account…</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select><input value={line.description} onChange={e=>updateLine(i,{description:e.target.value})} placeholder="Optional description" className="h-9 rounded-lg border border-slate-200 px-2 text-xs"/><input type="number" min="0" step="0.01" value={line.debit} onChange={e=>updateLine(i,{debit:e.target.value,credit:e.target.value?'':line.credit})} className="h-9 rounded-lg border border-slate-200 px-2 text-right font-mono text-xs tabular-nums"/><input type="number" min="0" step="0.01" value={line.credit} onChange={e=>updateLine(i,{credit:e.target.value,debit:e.target.value?'':line.debit})} className="h-9 rounded-lg border border-slate-200 px-2 text-right font-mono text-xs tabular-nums"/><button type="button" disabled={journalLines.length<=2} onClick={()=>setJournalLines(rows=>rows.filter((_,j)=>j!==i))} className="text-slate-400 hover:text-rose-600">×</button></div>)}</div>
    <button type="button" onClick={()=>setJournalLines(rows=>[...rows,{accountId:'',description:'',debit:'',credit:''}])} className="mt-3 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold">＋ Add line</button>
    <div className="mt-5 rounded-xl bg-slate-950 p-4 text-white"><div className="flex items-center justify-between text-sm"><span>Debits</span><b className="font-mono tabular-nums">{money(journalDebit)}</b></div><div className="mt-2 flex items-center justify-between text-sm"><span>Credits</span><b className="font-mono tabular-nums">{money(journalCredit)}</b></div><div className="mt-3 flex items-center justify-between border-t border-white/15 pt-3"><span className="text-xs uppercase tracking-wider text-white/60">Delta</span><b className={'font-mono text-lg tabular-nums '+(journalDelta===0?'text-emerald-300':'text-amber-300')}>{money(journalDelta)}</b></div></div>
   </div>
   <footer className="flex gap-2 border-t border-slate-200 px-5 py-4"><button type="button" disabled={journalBusy} onClick={()=>setDrawerOpen(false)} className="flex-1 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold">Cancel</button><button type="button" disabled={journalBusy||journalDelta!==0||journalLines.some(r=>!r.accountId)} onClick={()=>void saveJournal()} className="flex-1 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">{journalBusy?'Posting…':'Validate & post journal'}</button></footer>
  </aside></div>}
 </div></main>;
}

function ReportCard({title,note,loading=false,children}:{title:string;note:string;loading?:boolean;children:ReactNode}){return <section className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><header className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4"><div><h2 className="font-semibold">{title}</h2><p className="mt-1 text-xs text-slate-500">{note}</p></div>{loading&&<span className="text-[10px] font-semibold text-indigo-600">Loading…</span>}</header>{children}</section>}
function DataGrid({headers,rows}:{headers:string[];rows:string[][]}){return <div className="overflow-x-auto"><table className="min-w-[820px] w-full text-left text-xs"><thead><tr className="border-b border-slate-100 bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-500">{headers.map(h=><th key={h} className="px-4 py-3">{h}</th>)}</tr></thead><tbody>{rows.map((row,i)=><tr key={String(i)} className="border-b border-slate-100 hover:bg-slate-50">{row.map((cell,j)=><td key={String(j)} className={'px-4 py-3 '+(j>=3?'font-mono tabular-nums':'')}>{cell}</td>)}</tr>)}{!rows.length&&<tr><td colSpan={headers.length} className="p-12 text-center text-sm text-slate-500">No records for this view.</td></tr>}</tbody></table></div>}
function Metric({title,value,tone='neutral'}:{title:string;value:string;tone?:'neutral'|'good'|'warn'}){return <section className="rounded-xl border border-slate-100 bg-slate-50 p-4"><span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{title}</span><b className={'mt-2 block text-xl font-semibold '+(tone==='good'?'text-emerald-700':tone==='warn'?'text-amber-700':'text-slate-950')}>{value}</b></section>}
