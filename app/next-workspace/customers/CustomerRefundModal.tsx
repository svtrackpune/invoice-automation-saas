'use client';

import { useEffect, useState } from 'react';
import { Button, DateInput, Field, Input, Modal, Select, Textarea } from '@/components/moneymatters';

type Account={id:string;code:string;name:string;account_subtype:string|null};

export default function CustomerRefundModal({
  open,businessId,customerId,available,onClose,onSaved
}:{
  open:boolean;
  businessId:string;
  customerId:string;
  available:number;
  onClose:()=>void;
  onSaved:()=>void|Promise<void>;
}){
  const [accounts,setAccounts]=useState<Account[]>([]);
  const [amount,setAmount]=useState('');
  const [method,setMethod]=useState('bank_transfer');
  const [accountId,setAccountId]=useState('');
  const [date,setDate]=useState(new Date().toISOString().slice(0,10));
  const [reference,setReference]=useState('');
  const [reason,setReason]=useState('Customer credit refund');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');

  useEffect(()=>{
    if(!open)return;
    (async()=>{
      const {supabase}=await import('@/lib/supabase');
      const r=await supabase.from('accounts').select('id,code,name,account_subtype').eq('business_id',businessId).eq('is_active',true);
      const list=((r.data||[]) as Account[]).filter(x=>x.account_subtype==='cash'||x.account_subtype==='bank');
      setAccounts(list);
      setAmount(String(Math.max(available,0)));
      setAccountId(list.find(x=>x.account_subtype==='bank')?.id||list[0]?.id||'');
      setDate(new Date().toISOString().slice(0,10));
      setMethod('bank_transfer');
      setReference('');
      setReason('Customer credit refund');
      setError('');
    })();
  },[open,businessId,available]);

  const save=async()=>{
    const n=Number(amount);
    if(!n||n<=0){setError('Enter a positive refund amount.');return}
    if(n>available+0.005){setError('Refund exceeds available customer credit.');return}
    if(!accountId){setError('Select a Cash or Bank account.');return}
    if(!date){setError('Select the refund date.');return}
    setBusy(true);setError('');
    try{
      const {supabase}=await import('@/lib/supabase');
      const result=await supabase.rpc('refund_customer_credit',{
        p_business_id:businessId,
        p_customer_id:customerId,
        p_amount:n,
        p_account_id:accountId,
        p_method:method,
        p_reference:reference.trim()||null,
        p_reason:reason.trim()||null,
        p_refund_date:date
      });
      if(result.error)throw new Error(result.error.message);
      await onSaved();onClose();
    }catch(e:any){
      setError(e?.message||'Customer refund could not be recorded.');
    }finally{setBusy(false)}
  };

  return <Modal open={open} onClose={()=>{if(!busy)onClose()}} title="Refund customer credit" description="Return available customer credit through a real Cash/Bank settlement." size="md"
    footer={<><Button variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button><Button disabled={busy||!accountId} onClick={save}>{busy?'Posting…':'Record refund'}</Button></>}>
    {error&&<div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">{error}</div>}
    <div className="rounded-xl bg-slate-50 p-4"><span className="text-xs text-slate-500">Available customer credit</span><b className="mt-1 block text-2xl text-slate-900">{money(available)}</b></div>
    <div className="mt-4 grid gap-4 sm:grid-cols-2">
      <Field label="Refund amount" required><Input type="number" min="0.01" max={available} step="0.01" value={amount} onChange={e=>setAmount(e.target.value)}/></Field>
      <Field label="Refund date" required><DateInput value={date} onChange={e=>setDate(e.target.value)}/></Field>
      <Field label="Method" required><Select value={method} onChange={e=>setMethod(e.target.value)}><option value="bank_transfer">Bank transfer</option><option value="upi">UPI</option><option value="cash">Cash</option><option value="cheque">Cheque</option><option value="other">Other</option></Select></Field>
      <Field label="Receiving account" required><Select value={accountId} onChange={e=>setAccountId(e.target.value)}><option value="">Select account…</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</Select></Field>
      <Field label="Reference"><Input value={reference} onChange={e=>setReference(e.target.value)} placeholder="UTR / refund reference"/></Field>
      <Field label="Reason"><Textarea rows={2} value={reason} onChange={e=>setReason(e.target.value)}/></Field>
    </div>
    {!accounts.length&&<p className="mt-3 text-xs text-rose-700">No active Cash or Bank settlement account is configured.</p>}
  </Modal>;
}
function money(n:number){return new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:2}).format(Number(n||0))}
