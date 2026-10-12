'use client';

import { use, useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { supabase } from '@/lib/supabase';
import { createCanonicalDocumentViewModel } from '@/lib/shared/document-view-model';

type Quote = {
  id:string;
  quotation_number:string;
  quotation_date:string;
  valid_until:string|null;
  status:string;
  invoice_id?:string|null;
  invoice_number?:string|null;
  invoice_status?:string|null;
   currency_code?:string|null;
   upi_id?:string|null;
   payment_qr_enabled?:boolean;
   bank?:{name:string|null;institution_name:string|null;account_holder_name:string|null;account_number:string|null;account_last4:string|null;ifsc_code:string|null;branch_name:string|null;upi_id:string|null}|null;
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

const addressLines=(value:any)=>{if(!value)return [];if(typeof value==='string')return value.split(/\n|,/).map(x=>x.trim()).filter(Boolean);return [value.line1,value.line2,[value.city,value.state,value.postal_code||value.pin||value.pincode].filter(Boolean).join(', '),value.country].filter(Boolean).map(String)};

export default function PublicQuotation({params}:{params:Promise<{token:string}>}){
  const {token:rawToken}=use(params);
  const token=decodeURIComponent(rawToken);
  const [quote,setQuote]=useState<Quote|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [accepting,setAccepting]=useState(false);
  const [acceptanceMessage,setAcceptanceMessage]=useState('');
  const [qrDataUrl,setQrDataUrl]=useState('');
  const money=useCallback((n:number)=>{const raw=String(quote?.currency_code||'INR').toUpperCase();const currency=/^[A-Z]{3}$/.test(raw)?raw:'INR';return new Intl.NumberFormat('en-IN',{style:'currency',currency,maximumFractionDigits:2}).format(Number(n||0));},[quote?.currency_code]);

  useEffect(()=>{(async()=>{
    const r=await supabase.rpc('get_public_quotation',{p_public_accept_token:token});
    if(r.error||!r.data){setError(r.error?.message||'This quotation link is invalid or no longer available.');setLoading(false);return}
    setQuote(r.data as Quote);setLoading(false);
  })()},[token]);

  const canonical=useMemo(()=>quote?createCanonicalDocumentViewModel({
    type:'quotation',number:quote.quotation_number,date:quote.quotation_date,due_date:quote.valid_until,status:quote.status,currency_code:quote.currency_code||'INR',
    subtotal:quote.subtotal,discount_total:quote.discount_total,tax_total:quote.tax_total,total:quote.total,
    business:quote.business,customer:quote.customer,bank:quote.bank || {},
    items:quote.items.map(item=>{
      const base=Number(item.quantity||0)*Number(item.unit_price||0);
      const discount=item.discount_type==='percentage'?base*Number(item.discount_value||0)/100:Number(item.discount_value||0);
      const tax=Math.max(0,base-discount)*Number(item.tax_rate||0)/100;
      return {...item,discount,amount:Math.max(0,base-discount)+tax};
    }),
  }, {type:'quotation',publicUrl:'https://mm.nilanga.in/quote/'+encodeURIComponent(token),upiId:quote.upi_id || quote.bank?.upi_id || null}):null,[quote,token]);
  const logoUrl=useMemo(()=>quote?.business.logo_url?supabase.storage.from('business-branding-public').getPublicUrl(quote.business.logo_url).data.publicUrl:'',[quote?.business.logo_url]);
  useEffect(()=>{let active=true;const qr=canonical?.financials.upiQrString;if(!qr||quote?.payment_qr_enabled===false){setQrDataUrl('');return}QRCode.toDataURL(qr,{width:180,margin:1,errorCorrectionLevel:'M'}).then(url=>{if(active)setQrDataUrl(url)}).catch(()=>{if(active)setQrDataUrl('')});return()=>{active=false}},[canonical?.financials.upiQrString,quote?.payment_qr_enabled]);
  const expired=Boolean(quote?.status==='sent'&&quote.valid_until&&quote.valid_until.slice(0,10)<new Date().toISOString().slice(0,10));
  const computed=useMemo(()=>({
    subtotal:canonical?.financials.subtotal||0,
    discount:canonical?.financials.totalDiscount||0,
    tax:canonical?.financials.taxBreakdown.reduce((sum,line)=>sum+line.amount,0)||0,
    total:canonical?.financials.grandTotal||0,
  }),[canonical]);

  const acceptQuotation=async()=>{
    if(!quote||accepting||quote.status==='converted')return;
    setAccepting(true);setError('');setAcceptanceMessage('');
    const result=await supabase.rpc('rpc_accept_public_quotation',{p_token:token});
    if(result.error||!result.data){
      setError(result.error?.message||'Quotation acceptance could not be completed. Please try again or contact the business.');
      setAccepting(false);
      return;
    }
    const outcome=result.data as {accepted?:boolean;already_processed?:boolean;quotation_number?:string;invoice_id?:string;invoice_number?:string;invoice_status?:string;delivery_pending_posting?:boolean;message?:string};
    setQuote({...quote,status:'converted',invoice_id:outcome.invoice_id||quote.invoice_id||null,invoice_number:outcome.invoice_number||quote.invoice_number||null,invoice_status:outcome.invoice_status||quote.invoice_status||null});
    setAcceptanceMessage(outcome.delivery_pending_posting
      ? `Thank you. Quotation ${outcome.quotation_number||quote.quotation_number} was accepted and converted to invoice ${outcome.invoice_number||'successfully'}. The official Tax Invoice will be shared after the business posts it.`
      : `Thank you. Quotation ${outcome.quotation_number||quote.quotation_number} has been accepted and converted to invoice ${outcome.invoice_number||'successfully'}.`);
    setAccepting(false);
  };

  if(loading)return <main className="min-h-screen grid place-items-center bg-slate-50 text-sm text-slate-500">Loading quotation…</main>;
  if(error&&!quote)return <main className="min-h-screen grid place-items-center bg-slate-50 p-6"><div className="max-w-md rounded-3xl bg-white p-8 text-center shadow-sm"><h1 className="text-xl font-bold text-slate-900">Quotation unavailable</h1><p className="mt-3 text-sm text-slate-600">{error}</p></div></main>;
  if(!quote)return null;

  return <main className="min-h-screen bg-slate-50 p-4 sm:p-8"><div className="mx-auto max-w-4xl overflow-hidden rounded-3xl bg-white shadow-sm"><header className="border-b border-slate-200 p-6 sm:p-8"><div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between"><div className="flex items-start gap-4">{logoUrl&&<img src={logoUrl} alt="Business logo" className="h-14 w-14 rounded-xl object-contain border border-slate-100"/>}<div><p className="text-xs font-bold uppercase tracking-[0.18em] text-violet-600">Quotation</p><h1 className="mt-1 text-2xl font-bold text-slate-900">{canonical?.document.number||quote.quotation_number}</h1><p className="mt-1 text-sm text-slate-500">{quote.business.name}</p></div></div><div className="text-sm text-slate-500 sm:text-right"><div>Date: {canonical?.document.date||quote.quotation_date}</div>{quote.valid_until&&<div>Valid until: {quote.valid_until}</div>}</div></div></header><section className="grid gap-6 p-6 sm:grid-cols-2 sm:p-8"><div><p className="text-xs font-bold uppercase tracking-wider text-slate-400">From</p><h2 className="mt-2 font-semibold text-slate-900">{quote.business.legal_name||quote.business.name}</h2>{addressLines(quote.business.address).map((x,i)=><p key={i} className="text-sm text-slate-600">{x}</p>)}{quote.business.email&&<p className="text-sm text-slate-600">{quote.business.email}</p>}{quote.business.phone&&<p className="text-sm text-slate-600">{quote.business.phone}</p>}{quote.business.website&&<p className="text-sm text-slate-600">{quote.business.website}</p>}</div><div><p className="text-xs font-bold uppercase tracking-wider text-slate-400">Customer</p><h2 className="mt-2 font-semibold text-slate-900">{quote.customer.legal_name||quote.customer.display_name}</h2>{addressLines(quote.customer.billing_address).map((x,i)=><p key={i} className="text-sm text-slate-600">{x}</p>)}{quote.customer.email&&<p className="mt-1 text-sm text-slate-600">{quote.customer.email}</p>}{quote.customer.phone&&<p className="text-sm text-slate-600">{quote.customer.phone}</p>}</div></section><section className="overflow-x-auto px-6 sm:px-8"><table className="w-full min-w-[620px] text-sm"><thead className="border-y border-slate-200 bg-slate-50 text-xs uppercase tracking-wider text-slate-500"><tr><th className="p-3 text-left">Description</th><th className="p-3 text-right">Qty</th><th className="p-3 text-right">Rate</th><th className="p-3 text-right">Amount</th></tr></thead><tbody>{(canonical?.items||[]).map((item,i)=><tr key={i} className="border-b border-slate-100"><td className="p-3">{item.description}</td><td className="p-3 text-right">{item.quantity}</td><td className="p-3 text-right">{money(item.unitPrice)}</td><td className="p-3 text-right font-medium">{money(item.amount)}</td></tr>)}</tbody></table></section><section className="p-6 sm:p-8"><div className="ml-auto max-w-sm space-y-2 text-sm"><div className="flex justify-between"><span>Subtotal</span><span>{money(computed.subtotal)}</span></div><div className="flex justify-between"><span>Discount</span><span>-{money(computed.discount)}</span></div>{computed.tax>0&&<div className="flex justify-between"><span>Tax / GST</span><span>{money(computed.tax)}</span></div>}<div className="flex justify-between border-t border-slate-200 pt-3 text-lg font-bold"><span>Total</span><span>{money(computed.total)}</span></div></div></section>{(canonical?.business.bankDetails||quote.bank||qrDataUrl)&&<section className="border-t border-slate-200 p-6 sm:p-8"><h2 className="font-semibold text-slate-900">Payment details</h2><div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">{canonical?.business.bankDetails&&<div className="space-y-1 text-sm text-slate-600"><p className="font-semibold text-slate-900">{canonical.business.bankDetails.bankName}</p>{quote.bank?.account_holder_name&&<p>Account holder: {quote.bank.account_holder_name}</p>}{(quote.bank?.account_number||quote.bank?.account_last4)&&<p>Account number: {quote.bank.account_number||('XXXX '+quote.bank.account_last4)}</p>}{quote.bank?.ifsc_code&&<p>IFSC: {quote.bank.ifsc_code}</p>}{quote.bank?.branch_name&&<p>Branch: {quote.bank.branch_name}</p>}{quote.upi_id&&<p>UPI ID: {quote.upi_id}</p>}</div>}{qrDataUrl&&<div className="text-center"><img src={qrDataUrl} alt="Scan to pay using UPI" className="h-36 w-36 border border-slate-200 bg-white p-2"/><p className="mt-1 text-xs text-slate-500">Scan to pay {money(computed.total)}</p></div>}</div></section>}{quote.notes&&<section className="border-t border-slate-200 p-6 sm:p-8"><h2 className="font-semibold">Notes</h2><p className="mt-2 whitespace-pre-line text-sm text-slate-600">{quote.notes}</p></section>}{quote.terms&&<section className="border-t border-slate-200 p-6 sm:p-8"><h2 className="font-semibold">Terms & conditions</h2><p className="mt-2 whitespace-pre-line text-sm text-slate-600">{quote.terms}</p></section>}
 <section className="border-t border-slate-200 p-6 sm:p-8 print:hidden"><a href={'/api/public-documents/pdf?type=quotation&token='+encodeURIComponent(token)} className="inline-flex w-full items-center justify-center rounded-xl bg-violet-600 px-5 py-4 font-semibold text-white hover:bg-violet-700 sm:w-auto">Download Official PDF</a></section>
<footer className="border-t border-slate-200 bg-slate-50 p-6 sm:p-8"><div className="grid gap-3 sm:grid-cols-2">{quote.status==='sent'&&!expired&&<button onClick={acceptQuotation} disabled={accepting} className="rounded-2xl bg-violet-600 px-5 py-4 font-semibold text-white hover:bg-violet-700 disabled:cursor-wait disabled:opacity-60">{accepting?'Accepting securely…':'Accept Quotation'}</button>}{expired&&<div role="status" className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm font-semibold text-amber-900">This quotation expired on {quote.valid_until}. Please contact the business to extend its validity before accepting.</div>}{quote.status==='converted'&&<div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm font-semibold text-emerald-800">Accepted · Invoice {quote.invoice_number||'created'}{quote.invoice_status==='draft'?' · Awaiting business posting':''}</div>}<button onClick={()=>navigator.clipboard.writeText(window.location.href)} className="rounded-2xl border border-slate-200 bg-white px-5 py-4 font-semibold text-slate-800 hover:bg-slate-100">Copy quotation link</button></div>{acceptanceMessage&&<p role="status" className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-center text-sm text-emerald-800">{acceptanceMessage}</p>}<p className="mt-3 text-center text-xs text-slate-400">Accepting records your response against this secure quotation link and creates an invoice using the business’s existing tax and numbering rules. The official Tax Invoice is dispatched only after the business posts it.</p><div className="mt-5 flex items-center justify-center gap-2 border-t border-slate-200 pt-4 text-xs text-slate-400"><span className="inline-grid h-4 w-4 place-items-center rounded bg-violet-600 text-[9px] font-black text-white">M</span><span>Powered by <strong className="text-violet-600">Moneymatters</strong></span></div></footer></div></main>;
}