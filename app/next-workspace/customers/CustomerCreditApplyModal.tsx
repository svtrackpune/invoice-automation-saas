'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button, Field, Input, Modal, Select } from '@/components/moneymatters';

type Invoice={id:string;invoice_number:string;balance_due:number;status:string};

export default function CustomerCreditApplyModal({
  open,businessId,customerId,available,invoices,onClose,onSaved
}:{
  open:boolean;
  businessId:string;
  customerId:string;
  available:number;
  invoices:Invoice[];
  onClose:()=>void;
  onSaved:()=>void|Promise<void>;
}){
  const eligible=useMemo(()=>invoices.filter(x=>['sent','partially_paid','overdue'].includes(x.status)&&Number(x.balance_due)>0),[invoices]);
  const [invoiceId,setInvoiceId]=useState('');
  const [amount,setAmount]=useState('');
  const [date,setDate]=useState(new Date().toISOString().slice(0,10));
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');

  useEffect(()=>{
    if(!open)return;
    const first=eligible[0];
    setInvoiceId(first?.id||'');
    setAmount(first?String(Math.min(available,Number(first.balance_due||0))):'');
    setDate(new Date().toISOString().slice(0,10));
    setError('');
  },[open,available,eligible]);

  const changeInvoice=(id:string)=>{
    setInvoiceId(id);
    const target=eligible.find(x=>x.id===id);
    setAmount(target?String(Math.min(available,Number(target.balance_due||0))):'');
  };

  const save=async()=>{
    const target=eligible.find(x=>x.id===invoiceId);
    const n=Number(amount);
    if(!target){setError('Select an open invoice.');return}
    if(!n||n<=0){setError('Enter a positive application amount.');return}
    if(n>available+0.005){setError('Application exceeds available customer credit.');return}
    if(n>Number(target.balance_due)+0.005){setError('Application exceeds the invoice balance.');return}
    if(!date){setError('Select the application date.');return}

    setBusy(true);setError('');
    try{
      const {supabase}=await import('@/lib/supabase');
      const result=await supabase.rpc('apply_customer_credit_to_invoice',{
        p_business_id:businessId,
        p_customer_id:customerId,
        p_invoice_id:invoiceId,
        p_amount:n,
        p_application_date:date
      });
      if(result.error)throw new Error(result.error.message);
      await onSaved();
      onClose();
    }catch(e:any){
      setError(e?.message||'Customer credit could not be applied.');
    }finally{
      setBusy(false);
    }
  };

  return <Modal open={open} onClose={()=>{if(!busy)onClose()}} title="Apply customer credit" description="Use available overpayment/customer credit against another posted invoice." size="md"
    footer={<><Button variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button><Button disabled={busy||!invoiceId} onClick={save}>{busy?'Applying…':'Apply credit'}</Button></>}>
    {error&&<div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">{error}</div>}
    <div className="rounded-xl bg-slate-50 p-4"><span className="text-xs text-slate-500">Available customer credit</span><b className="mt-1 block text-2xl text-slate-900">{money(available)}</b></div>
    {!eligible.length?<div className="mt-4 rounded-xl border border-dashed border-slate-200 p-5 text-center text-xs text-slate-500">No open posted invoice is available for this customer.</div>:<div className="mt-4 space-y-4">
      <Field label="Target invoice" required><Select value={invoiceId} onChange={e=>changeInvoice(e.target.value)}><option value="">Select invoice…</option>{eligible.map(x=><option key={x.id} value={x.id}>{x.invoice_number} · {money(x.balance_due)} due</option>)}</Select></Field>
      <Field label="Application amount" required><Input type="number" min="0.01" step="0.01" value={amount} max={Math.min(available,Number(eligible.find(x=>x.id===invoiceId)?.balance_due||available))} onChange={e=>setAmount(e.target.value)}/></Field>
      <Field label="Application date" required><Input type="date" value={date} onChange={e=>setDate(e.target.value)}/></Field>
    </div>}
  </Modal>;
}
function money(n:number){return new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:2}).format(Number(n||0))}
