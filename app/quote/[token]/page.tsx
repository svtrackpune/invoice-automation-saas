'use client';

import { use, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { createCanonicalDocumentViewModel } from '@/lib/shared/document-view-model';

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
  customer:{id:string;display_name:string;legal_name:string|null;email:string|null;phone:string|null;billing_address:any};
  business:{name:string;legal_name:string|null;email:string|null;phone:string|null;website:string|null;address:any;logo_url:string|null;tax_registration_number:string|null};
  items:Array<{description:string|null;quantity:number;unit_price:number;discount_type:string|null;discount_value:number|null;tax_rate:number}>;
};

const money=(n:number)=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:2}).format(Number(n||0));
const addressLines=(value:any)=>{if(!value)return [];if(typeof value==='string')return value.split(/\n|,/).map(x=>x.trim()).filter(Boolean);return [value.line1,value.line2,[value.city,value.state,value.postal_code||value.pin||value.pincode].filter(Boolean).join(', '),value.country].filter(Boolean).map(String)};

export default function PublicQuotation({params}:{params:Promise<{token:string}>}){
  const {token:rawToken}=use(params);
  const token=decodeURIComponent(rawToken);
  const [quote,setQuote]=useState<Quote|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');

  useEffect(()=>{(async()=>{
    const r=await supabase.rpc('get_public_quotation',{p_public_accept_token:token});
    if(r.error||!r.data){setError(r.error?.message||'This quotation link is invalid or no longer available.');setLoading(false);return}
    setQuote(r.data as Quote);setLoading(false);
  })()},[token]);

  const canonical=useMemo(()=>quote?createCanonicalDocumentViewModel({
    type:'quotation',number:quote.quotation_number,date:quote.quotation_date,due_date:quote.valid_until,status:quote.status,currency_code:'INR',
    subtotal:quote.subtotal,discount_total:quote.discount_total,tax_total:quote.tax_total,total:quote.total,
    business:quote.business,customer:quote.customer,
    items:quote.items.map(item=>{
      const base=Number(item.quantity||0)*Number(item.unit_price||0);
      const discount=item.discount_type==='percentage'?base*Number(item.discount_value||0)/100:Number(item.discount_value||0);
      const tax=Math.max(0,base-discount)*Number(item.tax_rate||0)/100;
      return {...item,discount,amount:Math.max(0,base-discount)+tax};
    }),
  },{type:'quotation',publicUrl:'https://mm.nilanga.in/quote/'+encodeURIComponent(token)}):null,[quote,token]);
  const logoUrl=useMemo(()=>quote?.business.logo_url?supabase.storage.from('business-branding-public').getPublicUrl(quote.business.logo_url).data.publicUrl:'',[quote?.business.logo_url]);
  const computed=useMemo(()=>({
    subtotal:canonical?.financials.subtotal||0,
    discount:canonical?.financials.totalDiscount||0,
    tax:canonical?.financials.taxBreakdown.reduce((sum,line)=>sum+line.amount,0)||0,
    total:canonical?.financials.grandTotal||0,
  }),[canonical]);

  const emailAccept=()=>{
    if(!quote?.business.email)return;
    const subject=encodeURIComponent(`Quotation acceptance — ${quote.quotation_number}`);
    const body=encodeURIComponent(`Dear ${quote.business.name},\n\nI confirm that I accept quotation ${quote.quotation_number} dated ${quote.quotation_date}.\n\nCustomer: ${quote.customer.display_name}\n\nPlease proceed with the invoice as per the accepted quotation.\n\nRegards,\n${quote.customer.display_name}`);
    window.location.href=`mailto:${quote.business.email}?subject=${subject}&body=${body}`;
  };

  if(loading)return <main className="min-h-screen grid place-items-center bg-slate-50 text-sm text-slate-500">Loading quotation…</main>;
  if(error&&!quote)return <main className="min-h-screen grid place-items-center bg-slate-50 p-6"><div className="max-w-md rounded-3xl bg-white p-8 text-center shadow-sm"><h1 className="text-xl font-bold text-slate-900">Quotation unavailable</h1><p className="mt-3 text-sm text-slate-600">{error}</p></div></main>;
  if(!quote)return null;

  return <main className="min-h-screen bg-slate-50 p-4 sm:p-8"><div className="mx-auto max-w-4xl overflow-hidden rounded-3xl bg-white shadow-sm"><header className="border-b border-slate-200 p-6 sm:p-8"><div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between"><div className="flex items-start gap-4">{logoUrl&&<img src={logoUrl} alt="Business logo" className="h-14 w-14 rounded-xl object-contain border border-slate-100"/>}<div><p className="text-xs font-bold uppercase tracking-[0.18em] text-violet-600">Quotation</p><h1 className="mt-1 text-2xl font-bold text-slate-900">{canonical?.document.number||quote.quotation_number}</h1><p className="mt-1 text-sm text-slate-500">{quote.business.name}</p></div></div><div className="text-sm text-slate-500 sm:text-right"><div>Date: {canonical?.document.date||quote.quotation_date}</div>{quote.valid_until&&<div>Valid until: {quote.valid_until}</div>}</div></div></header><section className="grid gap-6 p-6 sm:grid-cols-2 sm:p-8"><div><p className="text-xs font-bold uppercase tracking-wider text-slate-400">From</p><h2 className="mt-2 font-semibold text-slate-900">{quote.business.legal_name||quote.business.name}</h2>{addressLines(quote.business.address).map((x,i)=><p key={i} className="text-sm text-slate-600">{x}</p>)}{quote.business.email&&<p className="text-sm text-slate-600">{quote.business.email}</p>}{quote.business.phone&&<p className="text-sm text-slate-600">{quote.business.phone}</p>}{quote.business.website&&<p className="text-sm text-slate-600">{quote.business.website}</p>}</div><div><p className="text-xs font-bold uppercase tracking-wider text-slate-400">Customer</p><h2 className="mt-2 font-semibold text-slate-900">{quote.customer.legal_name||quote.customer.display_name}</h2>{addressLines(quote.customer.billing_address).map((x,i)=><p key={i} className="text-sm text-slate-600">{x}</p>)}{quote.customer.email&&<p className="mt-1 text-sm text-slate-600">{quote.customer.email}</p>}{quote.customer.phone&&<p className="text-sm text-slate-600">{quote.customer.phone}</p>}</div></section><section className="overflow-x-auto px-6 sm:px-8"><table className="w-full min-w-[620px] text-sm"><thead className="border-y border-slate-200 bg-slate-50 text-xs uppercase tracking-wider text-slate-500"><tr><th className="p-3 text-left">Description</th><th className="p-3 text-right">Qty</th><th className="p-3 text-right">Rate</th><th className="p-3 text-right">Amount</th></tr></thead><tbody>{(canonical?.items||[]).map((item,i)=><tr key={i} className="border-b border-slate-100"><td className="p-3">{item.description}</td><td className="p-3 text-right">{item.quantity}</td><td className="p-3 text-right">{money(item.unitPrice)}</td><td className="p-3 text-right font-medium">{money(item.amount)}</td></tr>)}</tbody></table></section><section className="p-6 sm:p-8"><div className="ml-auto max-w-sm space-y-2 text-sm"><div className="flex justify-between"><span>Subtotal</span><span>{money(computed.subtotal)}</span></div><div className="flex justify-between"><span>Discount</span><span>-{money(computed.discount)}</span></div>{computed.tax>0&&<div className="flex justify-between"><span>Tax / GST</span><span>{money(computed.tax)}</span></div>}<div className="flex justify-between border-t border-slate-200 pt-3 text-lg font-bold"><span>Total</span><span>{money(computed.total)}</span></div></div></section>{quote.notes&&<section className="border-t border-slate-200 p-6 sm:p-8"><h2 className="font-semibold">Notes</h2><p className="mt-2 whitespace-pre-line text-sm text-slate-600">{quote.notes}</p></section>}{quote.terms&&<section className="border-t border-slate-200 p-6 sm:p-8"><h2 className="font-semibold">Terms & conditions</h2><p className="mt-2 whitespace-pre-line text-sm text-slate-600">{quote.terms}</p></section>}
 <section className="border-t border-slate-200 p-6 sm:p-8 print:hidden"><a href={'/api/public-documents/pdf?type=quotation&token='+encodeURIComponent(token)} className="inline-flex w-full items-center justify-center rounded-xl bg-violet-600 px-5 py-4 font-semibold text-white hover:bg-violet-700 sm:w-auto">Download Official PDF</a></section>
<footer className="border-t border-slate-200 bg-slate-50 p-6 sm:p-8"><div className="grid gap-3 sm:grid-cols-2">{quote.business.email&&<button onClick={emailAccept} className="rounded-2xl bg-violet-600 px-5 py-4 font-semibold text-white hover:bg-violet-700">Accept Quotation</button>}<button onClick={()=>navigator.clipboard.writeText(window.location.href)} className="rounded-2xl border border-slate-200 bg-white px-5 py-4 font-semibold text-slate-800 hover:bg-slate-100">Copy quotation link</button></div><p className="mt-3 text-center text-xs text-slate-400">Accept Quotation opens your default email application with a ready-made acceptance message. Once the business receives your acceptance, it can convert the quotation to the invoice using the existing business workflow.</p><div className="mt-5 flex items-center justify-center gap-2 border-t border-slate-200 pt-4 text-xs text-slate-400"><span className="inline-grid h-4 w-4 place-items-center rounded bg-violet-600 text-[9px] font-black text-white">M</span><span>Powered by <strong className="text-violet-600">Moneymatters</strong></span></div></footer></div></main>;
}