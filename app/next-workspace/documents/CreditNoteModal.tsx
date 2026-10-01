'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button, DateInput, Field, Input, Modal, Textarea } from '@/components/moneymatters';

type InvoiceItem={id:string;description:string;quantity:number;unit_price:number;line_total:number;product_service_id:string|null};
type Row={item:InvoiceItem;quantity:number};

const money=(n:number)=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:2}).format(Number(n||0));

export default function CreditNoteModal({
  open,businessId,customerId,invoiceId,invoiceNumber,balanceDue,items,onClose,onSaved
}:{
  open:boolean;
  businessId:string;
  customerId:string;
  invoiceId:string;
  invoiceNumber:string;
  balanceDue:number;
  items:InvoiceItem[];
  onClose:()=>void;
  onSaved:()=>void|Promise<void>;
}){
  const [date,setDate]=useState('');
  const [reason,setReason]=useState('Sales return / invoice adjustment');
  const [notes,setNotes]=useState('');
  const [rows,setRows]=useState<Row[]>([]);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');

  useEffect(()=>{
    if(!open)return;
    setDate(new Date().toISOString().slice(0,10));
    setReason('Sales return / invoice adjustment');
    setNotes('');
    setRows(items.map(item=>({item,quantity:0})));
    setError('');
  },[open,items]);

  const selected=useMemo(()=>rows.filter(r=>r.quantity>0),[rows]);
  const estimate=useMemo(
    ()=>selected.reduce((sum,r)=>sum+r.quantity*(Number(r.item.line_total||0)/Math.max(Number(r.item.quantity||0),1)),0),
    [selected]
  );

  const setQty=(itemId:string,value:number)=>{
    setRows(rs=>rs.map(r=>{
      if(r.item.id!==itemId)return r;
      return {...r,quantity:Math.min(Math.max(Number.isFinite(value)?value:0,0),Math.max(r.item.quantity,0))};
    }));
  };

  const save=async()=>{
    if(!selected.length){setError('Select at least one return or adjustment quantity.');return}
    if(estimate>balanceDue+0.005){setError('The selected credit exceeds the invoice balance. Reduce the quantity first.');return}
    if(!date){setError('Select the credit note date.');return}
    if(!reason.trim()){setError('Enter the credit note reason.');return}

    setBusy(true);setError('');
    try{
      const {supabase}=await import('@/lib/supabase');
      const payload=selected.map((r,index)=>({
        invoice_item_id:r.item.id,
        product_service_id:r.item.product_service_id,
        description:r.item.description,
        quantity:r.quantity,
        unit_price:Number(r.item.unit_price||0),
        tax_rate:0,
        sort_order:index
      }));
      const result=await supabase.rpc('create_and_post_credit_note',{
        p_business_id:businessId,
        p_customer_id:customerId,
        p_invoice_id:invoiceId,
        p_credit_note_date:date,
        p_reason:reason.trim(),
        p_items:payload,
        p_notes:notes.trim()||null,
        p_location_id:null
      });
      if(result.error)throw new Error(result.error.message);
      await onSaved();
      onClose();
    }catch(e:any){
      setError(e?.message||'Credit note could not be created.');
    }finally{
      setBusy(false);
    }
  };

  return <Modal open={open} onClose={()=>{if(!busy)onClose()}} title={'Create credit note · '+invoiceNumber} description="Reduce an unpaid invoice for an eligible return or adjustment." size="lg"
    footer={<><Button variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button><Button disabled={busy||!selected.length||estimate>balanceDue+0.005} onClick={save}>{busy?'Posting…':'Create & post credit note'}</Button></>}>
    {error&&<div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">{error}</div>}
    <div className="grid gap-4 sm:grid-cols-3">
      <Field label="Credit note date" required><DateInput value={date} max={new Date().toISOString().slice(0,10)} onChange={e=>setDate(e.target.value)} /></Field>
      <Field label="Reason" required className="sm:col-span-2"><Input value={reason} onChange={e=>setReason(e.target.value)} /></Field>
    </div>
    <div className="mt-5 overflow-x-auto rounded-xl border border-slate-200">
      <table className="min-w-[700px] w-full text-sm">
        <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="p-3 text-left">Invoice item</th><th className="p-3 text-right">Qty</th><th className="p-3 text-right">Return qty</th><th className="p-3 text-right">Value</th></tr></thead>
        <tbody>{rows.map(r=>{
          const max=Math.max(Number(r.item.quantity||0),0);
          const value=r.quantity*(Number(r.item.line_total||0)/Math.max(Number(r.item.quantity||0),1));
          return <tr key={r.item.id} className="border-t border-slate-100">
            <td className="p-3"><b>{r.item.description}</b><span className="mt-0.5 block text-xs text-slate-400">{money(r.item.unit_price)}</span></td>
            <td className="p-3 text-right">{r.item.quantity}</td>
            <td className="p-3 text-right"><Input type="number" min="0" max={max} step="0.001" value={r.quantity} onChange={e=>setQty(r.item.id,Number(e.target.value))} className="w-28 text-right"/></td>
            <td className="p-3 text-right">{money(value)}</td>
          </tr>
        })}</tbody>
      </table>
    </div>
    <div className="mt-4 grid gap-4 sm:grid-cols-2">
      <Field label="Notes"><Textarea rows={3} value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Optional customer/return note."/></Field>
      <div className="rounded-xl bg-slate-50 p-4">
        <span className="text-xs text-slate-500">Selected credit</span>
        <b className="mt-1 block text-xl text-slate-900">{money(estimate)}</b>
        <p className="mt-1 text-xs text-slate-400">Invoice balance available: {money(balanceDue)}. The server recalculates the source-line tax/base before posting.</p>
      </div>
    </div>
  </Modal>;
}
