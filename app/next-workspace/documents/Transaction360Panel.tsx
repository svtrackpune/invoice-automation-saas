'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';

type Props={entityType:'invoice'|'cash_bill'|'quotation'|'purchase_bill'|'payment';entityId:string};

export default function Transaction360Panel({entityType,entityId}:Props){
  const [data,setData]=useState<any>(null),[loading,setLoading]=useState(true),[error,setError]=useState('');
  useEffect(()=>{let active=true;(async()=>{setLoading(true);setError('');const r=await supabase.rpc('get_transaction_360',{p_entity_type:entityType,p_entity_id:entityId});if(!active)return;if(r.error){setError(r.error.message);setLoading(false);return}setData(r.data);setLoading(false)})();return()=>{active=false}},[entityType,entityId]);
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
  const supplierAllocations=(data?.vendor_allocations||[]) as any[];
  const creditNotes=(data?.credit_notes||[]) as any[];
  const customerCreditLedger=(data?.customer_credit_ledger||[]) as any[];
  const customerRefunds=(data?.customer_refunds||[]) as any[];
  const supplierPaymentUnapplied=entityType==='payment'&&data?.entity?.direction==='outbound'
    ?Math.max(Number(data.entity.amount||0)-supplierAllocations.reduce((s,x)=>s+Number(x.amount||0),0),0)
    :0;
  const customerCreditNet=customerCreditLedger.reduce((s,x)=>s+Number(x.amount||0),0);

  const card=(label:string,value:React.ReactNode,href?:string)=>
    href
      ?<a href={href} className="rounded-xl border border-slate-100 bg-slate-50 p-3 hover:border-violet-200 hover:bg-violet-50"><span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</span><b className="mt-1 block text-sm text-slate-800">{value}</b></a>
      :<div className="rounded-xl border border-slate-100 bg-slate-50 p-3"><span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</span><b className="mt-1 block text-sm text-slate-800">{value}</b></div>;

  return <section className="mx-auto mt-5 max-w-6xl rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[.16em] text-violet-600">Transaction 360</p><h2 className="mt-1 text-lg font-semibold text-slate-900">Linked records & accounting trail</h2></div><div className="text-xs text-slate-400">Server-side relationship view.</div></div>
    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {party&&card(partyLabel,party.display_name||party.legal_name||partyLabel,party.id?(entityType==='purchase_bill'||(entityType==='payment'&&data?.vendor)?'/next-workspace/vendors/'+party.id:'/next-workspace/customers/'+party.id):undefined)}
      {source&&card('Source quotation',source.quotation_number||'Estimate','/next-workspace/documents?type=quotation&id='+source.id)}
      {linkedInvoice&&entityType==='payment'&&card('Linked invoice',linkedInvoice.invoice_number||'Invoice','/next-workspace/documents?type=invoice&id='+linkedInvoice.id)}
      {linkedBill&&entityType==='payment'&&card('Linked purchase bill',linkedBill.bill_number||'Purchase bill','/next-workspace/purchases/'+linkedBill.id)}
      {converted&&card('Converted invoice',converted.invoice_number||'Invoice','/next-workspace/documents?type=invoice&id='+converted.id)}
      {card('Payments',payments.length,'/next-workspace/payments')}
      {card('Receipts',receipts.length,'/next-workspace/documents/library?type=receipt')}
      {card('Journal',data?.journal?.entry_number?'Entry '+data.journal.entry_number:'Linked','/next-workspace/accounting')}
      {card('Inventory movements',inventory.length,'/next-workspace/inventory')}
      {entityType==='purchase_bill'&&card('Supplier credits',supplierCredits.length)}
      {entityType!=='purchase_bill'&&entityType!=='payment'&&creditNotes.length>0&&card('Credit notes',creditNotes.length)}
      {entityType!=='purchase_bill'&&entityType!=='payment'&&customerRefunds.length>0&&card('Customer refunds',customerRefunds.length)}
      {entityType==='payment'&&data?.entity?.direction==='outbound'&&card('Supplier bill allocations',supplierAllocations.length)}
      {entityType==='payment'&&data?.entity?.direction==='outbound'&&card('Unapplied supplier advance','₹'+supplierPaymentUnapplied.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2}))}
      {card('Bank transactions',bank.length,'/next-workspace/banking')}
    </div>

    {entityType==='payment'&&data?.entity?.direction==='outbound'&&<div className="mt-5 rounded-xl border border-violet-100 bg-violet-50/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-sm font-semibold text-slate-900">Supplier bill allocations</h3><p className="mt-1 text-xs text-slate-500">This payment can settle one or multiple purchase bills while retaining a single payment identity.</p></div><a href="/next-workspace/payments" className="text-xs font-semibold text-violet-700 hover:underline">Open Payments</a></div>
      {supplierAllocations.length?<div className="mt-3 grid gap-2 md:grid-cols-2">{supplierAllocations.map((x:any)=><a key={x.id} href={'/next-workspace/purchases/'+x.bill_id} className="flex items-center justify-between gap-3 rounded-lg border border-white bg-white px-3 py-2 hover:border-violet-200"><span><b className="block text-sm text-slate-800">{x.bill_number||'Purchase bill'}</b><span className="text-[11px] text-slate-400">{x.bill_date||''}</span></span><b className="text-sm text-slate-800">₹{Number(x.amount||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}</b></a>)}</div>:<div className="mt-3 rounded-lg border border-dashed border-violet-200 bg-white p-3 text-xs text-slate-500">No purchase bill allocation. The payment is currently unapplied.</div>}
    </div>}

    {entityType!=='quotation'&&data?.entity&&<div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-xs"><div className="rounded-xl bg-slate-50 p-3"><span className="text-slate-400">Document</span><b className="mt-1 block text-slate-800">{entityType==='cash_bill'?'Cash Bill':entityType==='purchase_bill'?'Purchase Bill':entityType==='payment'?'Payment':'Invoice'}</b></div><div className="rounded-xl bg-slate-50 p-3"><span className="text-slate-400">Status</span><b className="mt-1 block capitalize text-slate-800">{String(data.entity.status||'').replaceAll('_',' ')}</b></div><div className="rounded-xl bg-slate-50 p-3"><span className="text-slate-400">Amount</span><b className="mt-1 block text-slate-800">₹{Number(data.entity.total??data.entity.amount??0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}</b></div><div className="rounded-xl bg-slate-50 p-3"><span className="text-slate-400">Corrections</span><b className="mt-1 block text-slate-800">{(data.corrections||[]).length}</b></div></div>}
  </section>;
}
