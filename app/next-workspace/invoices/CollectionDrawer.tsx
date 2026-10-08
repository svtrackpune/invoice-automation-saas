'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';

export type CollectionInvoice = {
  id:string; invoice_number:string; customer_id:string; customer_name:string;
  balance_due:number; total:number; status:string; due_date:string; currency_code:string;
};
type Account={id:string;code:string;name:string;account_subtype:string|null;account_type:string};
type Props={businessId:string;invoice:CollectionInvoice;canWriteOff:boolean;onClose:()=>void;onUpdated:()=>void|Promise<void>};

const money=(n:number,currency='INR')=>new Intl.NumberFormat('en-IN',{style:'currency',currency,maximumFractionDigits:2}).format(Number(n||0));
const today=()=>new Date().toISOString().slice(0,10);

export default function CollectionDrawer({businessId,invoice,canWriteOff,onClose,onUpdated}:Props){
 const[credit,setCredit]=useState(0),[accounts,setAccounts]=useState<Account[]>([]),[expenseAccounts,setExpenseAccounts]=useState<Account[]>([]);
 const[paymentMethod,setPaymentMethod]=useState('upi'),[accountId,setAccountId]=useState(''),[paymentAmount,setPaymentAmount]=useState(String(invoice.balance_due||0)),[paymentDate,setPaymentDate]=useState(today()),[reference,setReference]=useState('');
 const[writeOffAccountId,setWriteOffAccountId]=useState(''),[writeOffAmount,setWriteOffAmount]=useState(String(invoice.balance_due||0)),[writeOffReason,setWriteOffReason]=useState('Bad debt write-off');
 const[loading,setLoading]=useState(true),[busy,setBusy]=useState(''),[error,setError]=useState(''),[success,setSuccess]=useState(''),[receiptId,setReceiptId]=useState('');
 const openBalance=Math.max(0,Number(invoice.balance_due||0)),currency=invoice.currency_code||'INR';
 const selectedAccount=useMemo(()=>accounts.find(x=>x.id===accountId),[accounts,accountId]);
 const settlementAccounts=useMemo(()=>accounts.filter(x=>x.account_subtype==='cash'||x.account_subtype==='bank'),[accounts]);

 useEffect(()=>{setPaymentAmount(String(openBalance));setWriteOffAmount(String(openBalance))},[invoice.id,openBalance]);
 useEffect(()=>{
  let active=true;
  const load=async()=>{
   setLoading(true);setError('');
   const[c,a]=await Promise.all([
    supabase.rpc('customer_credit_balance',{p_business_id:businessId,p_customer_id:invoice.customer_id,p_currency_code:currency}),
    supabase.from('accounts').select('id,code,name,account_subtype,account_type').eq('business_id',businessId).eq('is_active',true).order('code')
   ]);
   if(!active)return;
   if(c.error)setError(c.error.message);else setCredit(Math.max(0,Number(c.data||0)));
   if(a.error)setError(a.error.message);else{
    const rows=(a.data||[]) as Account[];setAccounts(rows);setExpenseAccounts(rows.filter(x=>x.account_type==='expense'));
    const preferred=rows.find(x=>x.account_subtype==='bank')||rows.find(x=>x.account_subtype==='cash');if(preferred)setAccountId(preferred.id);
    const expense=rows.find(x=>x.account_type==='expense');if(expense)setWriteOffAccountId(expense.id);
   }
   setLoading(false);
  };
  void load();return()=>{active=false};
 },[businessId,invoice.customer_id,invoice.id,currency]);

 const applyCredit=async()=>{
  const amount=Math.min(credit,openBalance);if(amount<=0)return;setBusy('credit');setError('');setSuccess('');
  const r=await supabase.rpc('apply_customer_credit_to_invoice',{p_business_id:businessId,p_customer_id:invoice.customer_id,p_invoice_id:invoice.id,p_amount:amount,p_application_date:today()});
  if(r.error)setError(r.error.message);else{setCredit(x=>Math.max(0,x-amount));setSuccess('Customer credit applied to '+invoice.invoice_number+'.');await onUpdated()}setBusy('');
 };
 const sendReminder=async()=>{
  setBusy('reminder');setError('');setSuccess('');
  const r=await supabase.rpc('enqueue_invoice_reminders',{p_business_id:businessId,p_now:new Date().toISOString()});
  if(r.error)setError(r.error.message);else setSuccess(Number(r.data||0)+' reminder notification job(s) queued.');setBusy('');
 };
 const recordPayment=async()=>{
  const amount=Number(paymentAmount);
  if(!amount||amount<=0){setError('Enter a positive payment amount.');return}
  if(amount>openBalance+0.005){setError('Payment cannot exceed the current outstanding balance.');return}
  if(!accountId||!selectedAccount||!['cash','bank'].includes(String(selectedAccount.account_subtype))){setError('Select an active Cash or Bank settlement account.');return}
  if(!paymentDate){setError('Select the payment date.');return}
  setBusy('payment');setError('');setSuccess('');setReceiptId('');
  const r=await supabase.rpc('record_customer_payment',{p_business_id:businessId,p_customer_id:invoice.customer_id,p_invoice_id:invoice.id,p_amount:amount,p_method:paymentMethod,p_account_id:accountId,p_reference:reference.trim()||null,p_gateway_transaction_id:null,p_payment_date:paymentDate,p_notes:'Recorded from Collection Drawer',p_currency_code:currency||'INR'});
  if(r.error)setError(r.error.message);else{setReceiptId(typeof r.data==='string'?r.data:'');setSuccess('Payment recorded and receipt generated for '+invoice.invoice_number+'.');await onUpdated();setPaymentAmount(String(Math.max(0,openBalance-amount)));setReference('')}setBusy('');
 };
 const writeOff=async()=>{
  const amount=Number(writeOffAmount);
  if(!canWriteOff){setError('Write-off requires owner/accountant accounting authority.');return}
  if(!amount||amount<=0||amount>openBalance+0.005){setError('Enter a valid write-off amount within the current outstanding balance.');return}
  if(!writeOffAccountId){setError('Select the expense account for the bad debt write-off.');return}
  if(!writeOffReason.trim()){setError('Enter a write-off reason.');return}
  setBusy('writeoff');setError('');setSuccess('');
  const r=await supabase.rpc('write_off_customer_invoice',{p_business_id:businessId,p_invoice_id:invoice.id,p_amount:amount,p_expense_account_id:writeOffAccountId,p_reason:writeOffReason.trim(),p_date:today()});
  if(r.error)setError(r.error.message);else{setSuccess('Bad debt write-off recorded for '+invoice.invoice_number+'.');await onUpdated()}setBusy('');
 };
 const close=()=>{if(!busy)onClose()};

 return <div className="fixed inset-0 z-[120]" role="dialog" aria-modal="true">
  <button type="button" className="absolute inset-0 h-full w-full bg-slate-950/35 backdrop-blur-[1px]" aria-label="Close collection drawer" onClick={close}/>
  <aside className="absolute inset-y-0 right-0 flex w-full max-w-xl flex-col border-l border-slate-200 bg-white shadow-2xl">
   <header className="flex items-start justify-between border-b border-slate-200 px-5 py-4"><div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Accounts receivable · Collection</p><h2 className="mt-1 text-xl font-semibold text-slate-950">Collect {invoice.invoice_number}</h2><p className="mt-1 truncate text-xs text-slate-500">{invoice.customer_name} · Due {invoice.due_date}</p></div><button type="button" onClick={close} className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50" aria-label="Close">×</button></header>
   <div className="flex-1 overflow-y-auto p-5">
    {(error||success)&&<div className={'mb-4 rounded-xl border px-3 py-2.5 text-sm '+(error?'border-rose-200 bg-rose-50 text-rose-700':'border-emerald-200 bg-emerald-50 text-emerald-800')}>{error||success}{receiptId&&<a className="ml-2 font-semibold underline" href={'/next-workspace/documents?type=receipt&id='+receiptId}>View receipt</a>}</div>}
    <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><div className="flex items-end justify-between gap-4"><div><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Outstanding</p><p className="mt-1 font-mono text-3xl font-bold tabular-nums text-slate-950">{money(openBalance,currency)}</p></div><span className="rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-bold text-amber-700 ring-1 ring-amber-200">{invoice.status==='overdue'?'Overdue':'Unpaid'}</span></div></section>
    <div className="mt-5 space-y-3">
     <section className="rounded-2xl border border-slate-200 p-4"><div className="flex items-center justify-between gap-3"><div><h3 className="text-sm font-semibold">Apply Customer Credit</h3><p className="mt-1 text-xs text-slate-500">Available credit in {currency}.</p></div><span className="font-mono text-sm font-bold tabular-nums">{money(credit,currency)}</span></div><button type="button" disabled={loading||busy!==''||credit<=0||openBalance<=0} onClick={()=>void applyCredit()} className="mt-3 w-full rounded-lg bg-indigo-600 px-3 py-2.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40">{busy==='credit'?'Applying…':'Apply available credit ('+money(Math.min(credit,openBalance),currency)+')'}</button></section>
     <section className="rounded-2xl border border-slate-200 p-4"><h3 className="text-sm font-semibold">Send Reminder</h3><p className="mt-1 text-xs text-slate-500">Use the existing email / WhatsApp notification queue.</p><button type="button" disabled={busy!==''||openBalance<=0} onClick={()=>void sendReminder()} className="mt-3 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">{busy==='reminder'?'Queueing…':'Send payment reminder'}</button></section>
     <section className="rounded-2xl border border-slate-200 p-4"><h3 className="text-sm font-semibold">Record Payment</h3><p className="mt-1 text-xs text-slate-500">The authoritative payment RPC updates the invoice, journal and receipt.</p><div className="mt-3 grid gap-3 sm:grid-cols-2">
      <label className="text-xs font-semibold text-slate-600">Amount<input type="number" min="0.01" max={openBalance} step="0.01" value={paymentAmount} onChange={e=>setPaymentAmount(e.target.value)} className="mt-1.5 h-9 w-full rounded-lg border border-slate-200 px-3 text-sm font-mono tabular-nums outline-none focus:border-indigo-400"/></label>
      <label className="text-xs font-semibold text-slate-600">Method<select value={paymentMethod} onChange={e=>{const next=e.target.value;setPaymentMethod(next);const preferred=accounts.find(r=>r.account_subtype===(next==='cash'?'cash':'bank'));if(preferred)setAccountId(preferred.id)}} className="mt-1.5 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm outline-none focus:border-indigo-400"><option value="upi">UPI</option><option value="bank_transfer">Bank transfer</option><option value="cash">Cash</option><option value="card">Card</option><option value="cheque">Cheque</option><option value="payment_gateway">Payment gateway</option><option value="other">Other</option></select></label>
      <label className="text-xs font-semibold text-slate-600">Settlement account<select value={accountId} onChange={e=>setAccountId(e.target.value)} className="mt-1.5 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm outline-none focus:border-indigo-400"><option value="">Select Cash / Bank account…</option>{settlementAccounts.map(r=><option key={r.id} value={r.id}>{r.code} · {r.name}</option>)}</select></label>
      <label className="text-xs font-semibold text-slate-600">Payment date<input type="date" value={paymentDate} onChange={e=>setPaymentDate(e.target.value)} className="mt-1.5 h-9 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-indigo-400"/></label>
      <label className="text-xs font-semibold text-slate-600 sm:col-span-2">Reference<input value={reference} onChange={e=>setReference(e.target.value)} placeholder="UPI / bank / cheque reference" className="mt-1.5 h-9 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-indigo-400"/></label>
     </div><button type="button" disabled={loading||busy!==''||openBalance<=0} onClick={()=>void recordPayment()} className="mt-3 w-full rounded-lg bg-indigo-600 px-3 py-2.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40">{busy==='payment'?'Recording…':'Record payment + generate receipt'}</button></section>
     {canWriteOff&&<section className="rounded-2xl border border-rose-200 bg-rose-50/40 p-4"><h3 className="text-sm font-semibold text-rose-900">Write Off Bad Debt</h3><p className="mt-1 text-xs text-rose-700">Authorized accounting users can convert the remaining receivable into a controlled expense journal.</p><div className="mt-3 grid gap-3"><label className="text-xs font-semibold text-slate-600">Expense account<select value={writeOffAccountId} onChange={e=>setWriteOffAccountId(e.target.value)} className="mt-1.5 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm"><option value="">Select expense account…</option>{expenseAccounts.map(r=><option key={r.id} value={r.id}>{r.code} · {r.name}</option>)}</select></label><div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold text-slate-600">Amount<input type="number" min="0.01" max={openBalance} step="0.01" value={writeOffAmount} onChange={e=>setWriteOffAmount(e.target.value)} className="mt-1.5 h-9 w-full rounded-lg border border-slate-200 px-3 text-sm font-mono tabular-nums"/></label><label className="text-xs font-semibold text-slate-600">Reason<input value={writeOffReason} onChange={e=>setWriteOffReason(e.target.value)} className="mt-1.5 h-9 w-full rounded-lg border border-slate-200 px-3 text-sm"/></label></div></div><button type="button" disabled={busy!==''||openBalance<=0||!writeOffAccountId} onClick={()=>void writeOff()} className="mt-3 w-full rounded-lg border border-rose-300 bg-white px-3 py-2.5 text-xs font-semibold text-rose-800 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-40">{busy==='writeoff'?'Writing off…':'Write off receivable'}</button></section>}
    </div>
   </div>
  </aside>
 </div>;
}
