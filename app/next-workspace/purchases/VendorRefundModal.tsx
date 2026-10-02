'use client';

import { useEffect, useState } from 'react';
import { Button, DateInput, Field, Input, Modal, Select, Textarea } from '@/components/moneymatters';

type Account={id:string;code:string;name:string;account_subtype:string|null};

export default function VendorRefundModal({
  open,businessId,vendorId,creditId,creditNumber,available,accounts,onClose,onSaved
}:{
  open:boolean;
  businessId:string;
  vendorId:string;
  creditId:string;
  creditNumber:string;
  available:number;
  accounts:Account[];
  onClose:()=>void;
  onSaved:()=>void|Promise<void>;
}){
  const [amount,setAmount]=useState('');
  const [method,setMethod]=useState('bank_transfer');
  const [accountId,setAccountId]=useState('');
  const [date,setDate]=useState('');
  const [reference,setReference]=useState('');
  const [notes,setNotes]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');

  const settlementAccounts=accounts.filter(a=>a.account_subtype==='cash'||a.account_subtype==='bank');

  useEffect(()=>{
    if(!open)return;
    setAmount(String(Math.max(available,0)));
    setMethod('bank_transfer');
    setAccountId(settlementAccounts.find(a=>a.account_subtype==='bank')?.id||settlementAccounts[0]?.id||'');
    setDate(new Date().toISOString().slice(0,10));
    setReference('');
    setNotes('');
    setError('');
  },[open,creditId,available,accounts]);

  const save=async()=>{
    const n=Number(amount);
    if(!n||n<=0){setError('Enter a positive refund amount.');return}
    if(n>available+0.005){setError('Refund exceeds the available supplier credit.');return}
    if(!accountId){setError('Select the Cash or Bank account receiving the supplier refund.');return}
    if(!date){setError('Select the refund date.');return}

    setBusy(true);setError('');
    try{
      const {supabase}=await import('@/lib/supabase');
      const result=await supabase.rpc('receive_vendor_refund',{
        p_business_id:businessId,
        p_vendor_id:vendorId,
        p_vendor_credit_id:creditId,
        p_amount:n,
        p_method:method,
        p_account_id:accountId,
        p_reference:reference.trim()||null,
        p_refund_date:date,
        p_notes:notes.trim()||null
      });
      if(result.error)throw new Error(result.error.message);
      await onSaved();
      onClose();
    }catch(e:any){
      setError(e?.message||'Supplier refund could not be recorded.');
    }finally{
      setBusy(false);
    }
  };

  return <Modal open={open} onClose={()=>{if(!busy)onClose()}} title={'Receive supplier refund · '+creditNumber} description="Convert available supplier credit into a real Cash/Bank receipt." size="md"
    footer={<><Button variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button><Button disabled={busy||!accountId} onClick={save}>{busy?'Posting…':'Record refund'}</Button></>}>
    {error&&<div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">{error}</div>}
    <div className="rounded-xl bg-slate-50 p-4">
      <span className="text-xs text-slate-500">Available supplier credit</span>
      <b className="mt-1 block text-2xl text-slate-900">₹{available.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}</b>
    </div>
    <div className="mt-4 grid gap-4 sm:grid-cols-2">
      <Field label="Refund amount" required><Input type="number" min="0.01" max={available} step="0.01" value={amount} onChange={e=>setAmount(e.target.value)} /></Field>
      <Field label="Refund date" required><DateInput value={date} onChange={e=>setDate(e.target.value)} /></Field>
      <Field label="Method" required><Select value={method} onChange={e=>setMethod(e.target.value)}><option value="bank_transfer">Bank transfer</option><option value="upi">UPI</option><option value="cash">Cash</option><option value="cheque">Cheque</option><option value="other">Other</option></Select></Field>
      <Field label="Receiving account" required><Select value={accountId} onChange={e=>setAccountId(e.target.value)}><option value="">Select account…</option>{settlementAccounts.map(a=><option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</Select></Field>
      <Field label="Reference"><Input value={reference} onChange={e=>setReference(e.target.value)} placeholder="UTR / refund reference" /></Field>
      <Field label="Notes"><Textarea rows={2} value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Optional refund note." /></Field>
    </div>
    {!settlementAccounts.length&&<p className="mt-3 text-xs text-rose-700">No active Cash or Bank account is configured for this business.</p>}
  </Modal>;
}
