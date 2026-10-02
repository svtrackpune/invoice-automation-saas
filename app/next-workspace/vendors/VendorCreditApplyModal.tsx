'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button, Field, Input, Modal, Select } from '@/components/moneymatters';

type Bill={id:string;bill_number:string;total:number;balance_due:number;status:string};

export default function VendorCreditApplyModal({
  open,businessId,creditId,creditNumber,available,bills,onClose,onSaved
}:{
  open:boolean;
  businessId:string;
  creditId:string;
  creditNumber:string;
  available:number;
  bills:Bill[];
  onClose:()=>void;
  onSaved:()=>void|Promise<void>;
}){
  const eligible=useMemo(()=>bills.filter(b=>['received','partially_paid','overdue'].includes(b.status)&&Number(b.balance_due)>0),[bills]);
  const [billId,setBillId]=useState('');
  const [amount,setAmount]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');

  useEffect(()=>{
    if(!open)return;
    const first=eligible[0];
    setBillId(first?.id||'');
    setAmount(first?String(Math.min(available,Number(first.balance_due||0))):'');
    setError('');
  },[open,creditId,available,eligible]);

  const changeBill=(nextId:string)=>{
    setBillId(nextId);
    const target=eligible.find(b=>b.id===nextId);
    setAmount(target?String(Math.min(available,Number(target.balance_due||0))):'');
  };

  const save=async()=>{
    const n=Number(amount);
    const target=eligible.find(b=>b.id===billId);
    if(!target){setError('Select a posted purchase bill with an outstanding balance.');return}
    if(!n||n<=0){setError('Enter a positive application amount.');return}
    if(n>available+0.005){setError('Application exceeds the available supplier credit.');return}
    if(n>Number(target.balance_due)+0.005){setError('Application exceeds the selected bill balance.');return}

    setBusy(true);setError('');
    try{
      const {supabase}=await import('@/lib/supabase');
      const result=await supabase.rpc('apply_vendor_credit_to_bill',{
        p_business_id:businessId,
        p_vendor_credit_id:creditId,
        p_bill_id:billId,
        p_amount:n
      });
      if(result.error)throw new Error(result.error.message);
      await onSaved();
      onClose();
    }catch(e:any){
      setError(e?.message||'Supplier credit could not be applied.');
    }finally{
      setBusy(false);
    }
  };

  return <Modal open={open} onClose={()=>{if(!busy)onClose()}} title={'Apply supplier credit · '+creditNumber} description="Move available vendor credit to another posted purchase bill for the same supplier." size="md"
    footer={<><Button variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button><Button disabled={busy||!billId} onClick={save}>{busy?'Applying…':'Apply credit'}</Button></>}>
    {error&&<div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">{error}</div>}
    <div className="rounded-xl bg-slate-50 p-4"><span className="text-xs text-slate-500">Available credit</span><b className="mt-1 block text-2xl text-slate-900">₹{available.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}</b></div>
    {!eligible.length?<div className="mt-4 rounded-xl border border-dashed border-slate-200 p-5 text-center text-xs text-slate-500">No other posted purchase bill has an outstanding balance for this supplier.</div>:<div className="mt-4 space-y-4">
      <Field label="Target purchase bill" required><Select value={billId} onChange={e=>changeBill(e.target.value)}><option value="">Select bill…</option>{eligible.map(b=><option key={b.id} value={b.id}>{b.bill_number} · ₹{Number(b.balance_due||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})} due</option>)}</Select></Field>
      <Field label="Application amount" required><Input type="number" min="0.01" max={Math.min(available,Number(eligible.find(b=>b.id===billId)?.balance_due||available))} step="0.01" value={amount} onChange={e=>setAmount(e.target.value)} /></Field>
    </div>}
  </Modal>;
}
