'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';

type Quote = {
  id:string;
  quotation_number:string;
  quotation_date:string;
  valid_until:string|null;
  status:string;
  notes:string|null;
  terms:string|null;
  subtotal:number|null;
  discount_total:number|null;
  tax_total:number|null;
  total:number|null;
  customer:{id:string;display_name:string;legal_name:string|null;email:string|null;phone:string|null;billing_address:Record<string,unknown>|null};
  business:{name:string;legal_name:string|null;email:string|null;phone:string|null;website:string|null;address:string|null;logo_url:string|null;tax_registration_number:string|null};
  items:Array<{description:string|null;quantity:number;unit_price:number;discount_type:string|null;discount_value:number|null;tax_rate:number}>;
};

type AcceptanceResult = {
  success:boolean;
  invoice_id:string;
  invoice_number:string;
  payment_display_mode:string;
  payment_link:string|null;
  bank_details:{name:string;institution_name:string|null;account_holder_name:string|null;ifsc_code:string|null;branch_name:string|null;account_type:string|null;currency_code:string|null;account_last4:string|null}|null;
};

const money=(n:number)=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:2}).format(Number(n||0));

export default function PublicQuotation({params}:{params:{token:string}}){
  const token=decodeURIComponent(params.token);
  const [quote,setQuote]=useState<Quote|null>(null);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [accepted,setAccepted]=useState<AcceptanceResult|null>(null);

  useEffect(()=>{(async()=>{
    const r=await supabase.rpc('get_public_quotation',{p_public_accept_token:token});
    if(r.error||!r.data){setError(r.error?.message||'This quotation link is invalid or no longer available.');setLoading(false);return}
    setQuote(r.data as Quote);setLoading(false);
  })()},[token]);

  const computed=useMemo(()=>{
    if(!quote)return {subtotal:0,discount:0,tax:0,total:0};
    const subtotal=Number(quote.subtotal||0)||quote.items.reduce((s,x)=>s+Number(x.quantity||0)*Number(x.unit_price||0),0);
    const discount=Number(quote.discount_total||0);
    const tax=Number(quote.tax_total||0);
    const total=Number(quote.total||0)||subtotal-discount+tax;
    return {subtotal,discount,tax,total};
  },[quote]);

  const accept=async()=>{
    if(!quote||busy)return;
    setBusy(true);setError('');
    const r=await supabase.functions.invoke('accept-quotation',{body:{public_accept_token:token}});
    if(r.error||r.data?.error){setError(r.error?.message||r.data?.error||'Unable to accept quotation. Please contact the business.');setBusy(false);return}
    setAccepted(r.data as AcceptanceResult);setQuote({...quote,status:'converted'});setBusy(false);
  };

  const emailAccept=()=>{
    if(!quote?.business.email)return;
    const subject=encodeURIComponent(`Quotation acceptance — ${quote.quotation_number}`);
    const body=encodeURIComponent(
      `Dear ${quote.business.name},\\n\\nI confirm that I accept quotation ${quote.quotation_number} dated ${quote.quotation_date}.\\n\\nCustomer: ${quote.customer.display_name}\\n\\nPlease proceed with the invoice as per the accepted quotation.\\n\\nRegards,\\n${quote.customer.display_name}`
    );
    window.location.href=`mailto:${quote.business.email}?subject=${subject}&body=${body}`;
  };

  if(loading)return <main className="min-h-screen grid place-items-center bg-slate-50 text-sm text-slate-500">Loading quotation…</main>;
  if(error&&!quote)return <main className="min-h-screen grid place-items-center bg-slate-50 p-6"><div className="max-w-md rounded-3xl bg-white p-8 text-center shadow-sm"><h1 className="text-xl font-bold text-slate-900">Quotation unavailable</h1><p className="mt-3 text-sm text-slate-600">{error}</p></div></main>;
  if(!quote)return null;

  if(accepted)return <main className="min-h-screen bg-slate-50 p-4 sm:p-8"><div className="mx-auto max-w-2xl rounded-3xl bg-white p-8 shadow-sm sm:p-10"><div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-100 text-2xl text-emerald-700">✓</div><h1 className="mt-5 text-center text-2xl font-bold text-slate-900">Quotation accepted</h1><p className="mt-2 text-center text-sm text-slate-600">Quotation {accepted.invoice_number ? quote.quotation_number : quote.quotation_number} has been accepted and invoice {accepted.invoice_number} has been generated.</p>{accepted.payment_link&&<a href={accepted.payment_link} target="_blank" rel="noreferrer" className="mt-7 block rounded-2xl bg-violet-600 px-5 py-4 text-center font-semibold text-white hover:bg-violet-700">Pay Now</a>}{accepted.bank_details&&<div className="mt-6 rounded-2xl border border-slate-200 p-5"><h2 className="font-semibold text-slate-900">Bank transfer details</h2><div className="mt-3 space-y-1 text-sm text-slate-600"><div>{accepted.bank_details.account_holder_name||accepted.bank_details.name}</div>{accepted.bank_details.institution_name&&<div>{accepted.bank_details.institution_name}</div>}{accepted.bank_details.ifsc_code&&<div>IFSC: {accepted.bank_details.ifsc_code}</div>}{accepted.bank_details.branch_name&&<div>Branch: {accepted.bank_details.branch_name}</div>}{accepted.bank_details.account_last4&&<div>Account ending {accepted.bank_details.account_last4}</div>}</div></div>}<p className="mt-6 text-center text-xs text-slate-400">Please retain the invoice number {accepted.invoice_number} for your records.</p></div></main>;

  return <main className="min-h-screen bg-slate-50 p-4 sm:p-8"><div className="mx-auto max-w-4xl overflow-hidden rounded-3xl bg-white shadow-sm"><header className="border-b border-slate-200 p-6 sm:p-8"><div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between"><div className="flex items-start gap-4">{quote.business.logo_url&&<img src={quote.business.logo_url} alt="" className="h-14 w-14 rounded-xl object-contain border border-slate-100"/>}<div><p className="text-xs font-bold uppercase tracking-[0.18em] text-violet-600">Quotation</p><h1 className="mt-1 text-2xl font-bold text-slate-900">{quote.quotation_number}</h1><p className="mt-1 text-sm text-slate-500">{quote.business.name}</p></div></div><div className="text-sm text-slate-500 sm:text-right"><div>Date: {quote.quotation_date}</div>{quote.valid_until&&<div>Valid until: {quote.valid_until}</div>}</div></div></header><section className="grid gap-6 p-6 sm:grid-cols-2 sm:p-8"><div><p className="text-xs font-bold uppercase tracking-wider text-slate-400">From</p><h2 className="mt-2 font-semibold text-slate-900">{quote.business.legal_name||quote.business.name}</h2>{quote.business.address&&<p className="mt-1 whitespace-pre-line text-sm text-slate-600">{quote.business.address}</p>}{quote.business.email&&<p className="text-sm text-slate-600">{quote.business.email}</p>}{quote.business.phone&&<p className="text-sm text-slate-600">{quote.business.phone}</p>}</div><div><p className="text-xs font-bold uppercase tracking-wider text-slate-400">Customer</p><h2 className="mt-2 font-semibold text-slate-900">{quote.customer.legal_name||quote.customer.display_name}</h2>{quote.customer.email&&<p className="mt-1 text-sm text-slate-600">{quote.customer.email}</p>}{quote.customer.phone&&<p className="text-sm text-slate-600">{quote.customer.phone}</p>}</div></section><section className="overflow-x-auto px-6 sm:px-8"><table className="w-full min-w-[620px] text-sm"><thead className="border-y border-slate-200 bg-slate-50 text-xs uppercase tracking-wider text-slate-500"><tr><th className="p-3 text-left">Description</th><th className="p-3 text-right">Qty</th><th className="p-3 text-right">Rate</th><th className="p-3 text-right">Amount</th></tr></thead><tbody>{quote.items.map((item,i)=>{const base=Number(item.quantity||0)*Number(item.unit_price||0);const d=item.discount_type==='percentage'?base*Number(item.discount_value||0)/100:Number(item.discount_value||0);return <tr key={i} className="border-b border-slate-100"><td className="p-3">{item.description||'Item'}</td><td className="p-3 text-right">{item.quantity}</td><td className="p-3 text-right">{money(item.unit_price)}</td><td className="p-3 text-right font-medium">{money(Math.max(0,base-d))}</td></tr>})}</tbody></table></section><section className="p-6 sm:p-8"><div className="ml-auto max-w-sm space-y-2 text-sm"><div className="flex justify-between"><span>Subtotal</span><span>{money(computed.subtotal)}</span></div><div className="flex justify-between"><span>Discount</span><span>-{money(computed.discount)}</span></div>{computed.tax>0&&<div className="flex justify-between"><span>Tax / GST</span><span>{money(computed.tax)}</span></div>}<div className="flex justify-between border-t border-slate-200 pt-3 text-lg font-bold"><span>Total</span><span>{money(computed.total)}</span></div></div></section>{quote.notes&&<section className="border-t border-slate-200 p-6 sm:p-8"><h2 className="font-semibold">Notes</h2><p className="mt-2 whitespace-pre-line text-sm text-slate-600">{quote.notes}</p></section>}{quote.terms&&<section className="border-t border-slate-200 p-6 sm:p-8"><h2 className="font-semibold">Terms & conditions</h2><p className="mt-2 whitespace-pre-line text-sm text-slate-600">{quote.terms}</p></section>}<footer className="border-t border-slate-200 bg-slate-50 p-6 sm:p-8"><div className="grid gap-3 sm:grid-cols-2"><button disabled={busy} onClick={accept} className="rounded-2xl bg-violet-600 px-5 py-4 font-semibold text-white hover:bg-violet-700 disabled:opacity-50">{busy?'Processing…':'Accept Quotation'}</button>{quote.business.email&&<button disabled={busy} onClick={emailAccept} className="rounded-2xl border border-slate-200 bg-white px-5 py-4 font-semibold text-slate-800 hover:bg-slate-100">Accept via Email</button>}</div><p className="mt-3 text-center text-xs text-slate-400">By accepting, you confirm the quotation details and authorize the business to proceed with invoicing.</p></footer></div></main>;
}
