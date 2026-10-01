'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Button, Field, Input, Modal } from '@/components/moneymatters';

type Payment={id:string;amount:number;payment_date:string;vendor_id:string|null;bill_id:string|null;currency_code:string};
type Bill={id:string;bill_number:string;bill_date:string;due_date:string;total:number;balance_due:number;currency_code:string;status:string;journal_entry_id:string|null};

const money=(n:number)=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:2}).format(Number(n||0));

export default function VendorPaymentAllocationModal({
  open,
  businessId,
  payment,
  onClose,
  onSaved,
}:{
  open:boolean;
  businessId:string;
  payment:Payment|null;
  onClose:()=>void;
  onSaved:()=>Promise<void>|void;
}){
  const [bills,setBills]=useState<Bill[]>([]);
  const [allocations,setAllocations]=useState<Record<string,string>>({});
  const [loading,setLoading]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [success,setSuccess]=useState('');

  useEffect(()=>{
    if(!open||!payment||!businessId)return;
    let active=true;
    (async()=>{
      setLoading(true);
      setError('');
      setSuccess('');
      const [billsResult,allocResult]=await Promise.all([
        supabase
          .from('bills')
          .select('id,bill_number,bill_date,due_date,total,balance_due,currency_code,status,journal_entry_id')
          .eq('business_id',businessId)
          .eq('vendor_id',payment.vendor_id)
          .order('bill_date',{ascending:false}),
        supabase
          .from('vendor_payment_allocations')
          .select('bill_id,amount')
          .eq('business_id',businessId)
          .eq('payment_id',payment.id),
      ]);
      if(!active)return;
      if(billsResult.error){setError(billsResult.error.message);setLoading(false);return}
      if(allocResult.error){setError(allocResult.error.message);setLoading(false);return}
      const eligible=((billsResult.data||[]) as Bill[]).filter(b=>b.journal_entry_id&&b.status!=='draft'&&b.status!=='void');
      setBills(eligible);
      const current:Record<string,string>={};
      ((allocResult.data||[]) as {bill_id:string;amount:number}[]).forEach(a=>{current[a.bill_id]=String(a.amount)});
      setAllocations(current);
      setLoading(false);
    })();
    return()=>{active=false};
  },[open,businessId,payment?.id,payment?.vendor_id]);

  const rows=useMemo(()=>bills.map(b=>{
    const current=Number(allocations[b.id]||0);
    const max=Math.max(Number(b.balance_due||0)+current,0);
    return {bill:b,max};
  }),[bills,allocations]);

  const totalAllocated=useMemo(
    ()=>Object.values(allocations).reduce((sum,value)=>sum+Math.max(Number(value||0),0),0),
    [allocations]
  );
  const unallocated=Number(payment?.amount||0)-totalAllocated;

  const setAmount=(billId:string,value:string)=>{
    setAllocations(prev=>({...prev,[billId]:value}));
    setError('');
    setSuccess('');
  };

  const fillMax=(billId:string,max:number)=>setAmount(billId,max>0?String(Number(max.toFixed(2))):'');

  const save=async()=>{
    if(!payment)return;
    if(!payment.vendor_id){setError('This payment is not linked to a supplier.');return}
    if(totalAllocated>Number(payment.amount)+0.005){setError('Allocations cannot exceed the supplier payment amount.');return}
    for(const row of rows){
      const amount=Number(allocations[row.bill.id]||0);
      if(amount<0){setError('Allocation amounts cannot be negative.');return}
      if(amount>row.max+0.005){setError('Allocation to '+row.bill.bill_number+' exceeds the bill balance available for this payment.');return}
      if(amount>0&&row.bill.currency_code!==payment.currency_code){setError('Currency mismatch: '+row.bill.bill_number+' cannot receive this payment.');return}
    }
    setBusy(true);
    setError('');
    setSuccess('');
    const payload=rows
      .map(row=>({bill_id:row.bill.id,amount:Number(allocations[row.bill.id]||0)}))
      .filter(row=>row.amount>0);
    const r=await supabase.rpc('allocate_vendor_payment',{p_payment_id:payment.id,p_allocations:payload});
    if(r.error){setError(r.error.message);setBusy(false);return}
    setSuccess('Supplier payment allocations updated. Any remaining amount is now an unapplied vendor advance.');
    await onSaved();
    setBusy(false);
  };

  return <Modal
    open={open}
    onClose={()=>{if(!busy)onClose()}}
    title="Allocate supplier payment"
    description={payment?'Payment '+money(payment.amount)+' · '+payment.payment_date+'. Split or reassign this payment across posted purchase bills.':undefined}
    size="xl"
  >
    {loading?<div className="py-10 text-center text-sm text-slate-500">Loading purchase bills…</div>:!payment?<div className="py-10 text-center text-sm text-slate-500">No supplier payment selected.</div>:<div className="space-y-5">
      {error&&<div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>}
      {success&&<div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{success}</div>}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-100 bg-slate-50 p-3"><span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Payment</span><b className="mt-1 block text-sm text-slate-800">{money(payment.amount)}</b></div>
        <div className="rounded-xl border border-slate-100 bg-slate-50 p-3"><span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Allocated</span><b className="mt-1 block text-sm text-slate-800">{money(totalAllocated)}</b></div>
        <div className="rounded-xl border border-slate-100 bg-slate-50 p-3"><span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Unapplied</span><b className={unallocated<-0.005?'mt-1 block text-sm text-rose-700':'mt-1 block text-sm text-emerald-700'}>{money(Math.max(unallocated,0))}</b></div>
      </div>
      {!rows.length?<div className="rounded-xl bg-slate-50 p-5 text-sm text-slate-500">No posted purchase bills for this supplier are available for allocation.</div>:<div className="space-y-3">
        {rows.map(({bill,max})=><div key={bill.id} className="grid gap-3 rounded-xl border border-slate-200 p-4 md:grid-cols-[1fr_150px_auto] md:items-end">
          <div>
            <b className="block text-sm text-slate-800">{bill.bill_number}</b>
            <span className="text-xs text-slate-400">Bill {bill.bill_date} · Due {bill.due_date} · {money(bill.total)} total</span>
            <span className="mt-1 block text-[11px] text-slate-500">Current outstanding: {money(bill.balance_due)} · available for this payment: {money(max)}</span>
          </div>
          <Field label="Allocation"><Input type="number" min="0" step="0.01" value={allocations[bill.id]||''} onChange={e=>setAmount(bill.id,e.target.value)} /></Field>
          <Button type="button" size="sm" variant="secondary" onClick={()=>fillMax(bill.id,max)} disabled={max<=0}>Use max</Button>
        </div>)}
      </div>}
      <div className="flex flex-col gap-3 border-t border-slate-100 pt-4 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
        <span>Unapplied amount remains available as supplier advance for later allocation.</span>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>Close</Button>
          <Button type="button" onClick={save} disabled={busy||loading}>{busy?'Saving…':'Save allocation'}</Button>
        </div>
      </div>
    </div>}
  </Modal>;
}
