'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

type Props={entityType:'invoice'|'cash_bill'|'quotation'|'purchase_bill'|'payment';entityId:string};

export default function Transaction360Panel({entityType,entityId}:Props){
  const [data,setData]=useState<any>(null),[loading,setLoading]=useState(true),[error,setError]=useState('');
  useEffect(()=>{let active=true;(async()=>{setLoading(true);const r=await supabase.rpc('get_transaction_360',{p_entity_type:entityType,p_entity_id:entityId});if(!active)return;if(r.error){setError(r.error.message);setLoading(false);return}setData(r.data);setLoading(false)})();return()=>{active=false}},[entityType,entityId]);
  if(loading)return <section className="mx-auto mt-5 max-w-6xl rounded-2xl border border-slate-200 bg-white p-4 text-xs text-slate-500">Loading linked transaction records…</section>;
  if(error)return <section className="mx-auto mt-5 max-w-6xl rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-700">Linked records unavailable: {error}</section>;
  const party=(data?.customer||data?.vendor) as any;
  const partyLabel=entityType==='purchase_bill'?'Supplier':entityType==='payment'?(data?.vendor?'Supplier':'Customer'):'Customer';
  const source=data?.source_quotation as any;
  const converted=data?.converted_invoice as any;
  const linkedInvoice=data?.invoice as any;
  const linkedBill=data?.purchase_bill as any;
  const payments=(data?.payments||[]) as any[];
  const receipts=(data?.receipts||[]) as any[];
  const inventory=(data?.inventory_movements||[]) as any[];
  const bank=(data?.bank_transactions||[]) as any[];
  const supplierCredits=(data?.supplier_credits||[]) as any[];
  const supplierCreditLedger=(data?.supplier_credit_ledger||[]) as any[];
  const creditNotes=(data?.credit_notes||[]) as any[];
  const customerCreditLedger=(data?.customer_credit_ledger||[]) as any[];
  const customerRefunds=(data?.customer_refunds||[]) as any[];
  const availableSupplierCredit=supplierCreditLedger.reduce((s,x)=>s+Number(x.amount||0),0);
  const customerCreditNet=customerCreditLedger.reduce((s,x)=>s+Number(x.amount||0),0);
  return <section className="mx-auto mt-5 max-w-6xl rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[.16em] text-violet-600">Transaction 360</p><h2 className="mt-1 text-lg font-semibold text-slate-900">Linked records & accounting trail</h2></div><div className="text-xs text-slate-400">Server-side relationship view.</div></div>
    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {party&&<a href={party.id?(entityType==='purchase_bill'?'/next-workspace/vendors/'+party.id:'/next-workspace/customers/'+party.id):'#'} className="rounded-xl border border-slate-100 bg-slate-50 p-3 hover:border-violet-200 hover:bg-violet-50"><span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">{partyLabel}</span><b className="mt-1 block text-sm text-slate-800">{party.display_name||party.legal_name||partyLabel}</b></a>}
      {source&&<a href={'/next-workspace/documents?type=quotation&id='+source.id} className="rounded-xl border border-slate-100 bg-slate-50 p-3 hover:border-violet-200 hover:bg-violet-50"><span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">Source quotation</span><b className="mt-1 block text-sm text-slate-800">{source.quotation_number||'Estimate'}</b></a>}
      {linkedInvoice&&entityType==='payment'&&<a href={'/next-workspace/documents?type=invoice&id='+linkedInvoice.id} className="rounded-xl border border-slate-100 bg-slate-50 p-3 hover:border-violet-200 hover:bg-violet-50"><span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">Linked invoice</span><b className="mt-1 block text-sm text-slate-800">{linkedInvoice.invoice_number||'Invoice'}</b></a>}{linkedBill&&entityType==='payment'&&<a href={'/next-workspace/purchases/'+linkedBill.id} className="rounded-xl border border-slate-100 bg-slate-50 p-3 hover:border-violet-200 hover:bg-violet-50"><span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">Linked purchase bill</span><b className="mt-1 block text-sm text-slate-800">{linkedBill.bill_number||'Purchase bill'}</b></a>}{converted&&<a href={'/next-workspace/documents?type=invoice&id='+converted.id} className="rounded-xl border border-slate-100 bg-slate-50 p-3 hover:border-violet-200 hover:bg-violet-50"><span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">Converted invoice</span><b className="mt-1 block text-sm text-slate-800">{converted.invoice_number||'Invoice'}</b></a>}
      <a href="/next-workspace/payments" className="rounded-xl border border-slate-100 bg-slate-50 p-3 hover:border-violet-200 hover:bg-violet-50"><span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">Payments</span><b className="mt-1 block text-sm text-slate-800">{payments.length}</b></a>
      <a href="/next-workspace/documents/library?type=receipt" className="rounded-xl border border-slate-100 bg-slate-50 p-3 hover:border-violet-200 hover:bg-violet-50"><span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">Receipts</span><b className="mt-1 block text-sm text-slate-800">{receipts.length}</b></a>
      <a href="/next-workspace/accounting" className="rounded-xl border border-slate-100 bg-slate-50 p-3 hover:border-violet-200 hover:bg-violet-50"><span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">Journal</span><b className="mt-1 block text-sm text-slate-800">{data?.journal?.entry_number?'Entry '+data.journal.entry_number:'Linked'}</b></a>
      <a href="/next-workspace/inventory" className="rounded-xl border border-slate-100 bg-slate-50 p-3 hover:border-violet-200 hover:bg-violet-50"><span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">Inventory movements</span><b className="mt-1 block text-sm text-slate-800">{inventory.length}</b></a>
      {entityType==='purchase_bill'&&<div className="rounded-xl border border-slate-100 bg-slate-50 p-3"><span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">Supplier credits</span><b className="mt-1 block text-sm text-slate-800">{supplierCredits.length}</b><span className="text-[10px] text-slate-400">Ledger {availableSupplierCredit.toFixed(2)}</span></div>}{entityType!=='purchase_bill'&&entityType!=='payment'&&creditNotes.length>0&&<div className="rounded-xl border border-slate-100 bg-slate-50 p-3"><span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">Credit notes</span><b className="mt-1 block text-sm text-slate-800">{creditNotes.length}</b><span className="text-[10px] text-slate-400">Net customer credit {customerCreditNet.toFixed(2)}</span></div>}{entityType!=='purchase_bill'&&entityType!=='payment'&&customerRefunds.length>0&&<div className="rounded-xl border border-slate-100 bg-slate-50 p-3"><span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">Customer refunds</span><b className="mt-1 block text-sm text-slate-800">{customerRefunds.length}</b></div>}<a href="/next-workspace/banking" className="rounded-xl border border-slate-100 bg-slate-50 p-3 hover:border-violet-200 hover:bg-violet-50"><span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">Bank transactions</span><b className="mt-1 block text-sm text-slate-800">{bank.length}</b></a>
    </div>
    {entityType!=='quotation'&&data?.entity&&<div className="mt-4 grid gap-3 sm:grid-cols-4 text-xs"><div className="rounded-xl bg-slate-50 p-3"><span className="text-slate-400">Document</span><b className="mt-1 block text-slate-800">{entityType==='cash_bill'?'Cash Bill':entityType==='purchase_bill'?'Purchase Bill':entityType==='payment'?'Payment':'Invoice'}</b></div><div className="rounded-xl bg-slate-50 p-3"><span className="text-slate-400">Status</span><b className="mt-1 block capitalize text-slate-800">{String(data.entity.status||'').replaceAll('_',' ')}</b></div><div className="rounded-xl bg-slate-50 p-3"><span className="text-slate-400">Amount</span><b className="mt-1 block text-slate-800">₹{Number(data.entity.total||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}</b></div><div className="rounded-xl bg-slate-50 p-3"><span className="text-slate-400">Corrections</span><b className="mt-1 block text-slate-800">{(data.corrections||[]).length}</b></div></div>}
  </section>;
}
