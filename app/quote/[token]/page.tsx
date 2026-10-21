'use client';

import { use, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import QRCode from 'qrcode';
import CopyButton from '@/components/ui/copy-button';
import { supabase } from '@/lib/supabase';
import { publicDocumentUrlFromToken, sharePublicDocument } from '@/lib/client/share-document';
import { createCanonicalDocumentViewModel } from '@/lib/shared/document-view-model';
import { buildDocumentDownloadFilename, documentFilenameLabel } from '@/lib/shared/document-filename';

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
  customer:{id:string;display_name:string;legal_name:string|null;email:string|null;phone:string|null;billing_address:any;shipping_address:any};
  business:{name:string;legal_name:string|null;email:string|null;phone:string|null;website:string|null;address:any;logo_url:string|null;tax_registration_number:string|null;gst_registration_type?:string|null;tax_regime?:string|null;country_code?:string|null;tax_id?:string|null};
  items:Array<{name?:string|null;item_name?:string|null;unit?:string|null;description:string|null;quantity:number;unit_price:number;discount_type:string|null;discount_value:number|null;tax_rate:number}>;
};

const addressLines=(value:any)=>{if(!value)return [];if(typeof value==='string')return value.split(/\n|,/).map(x=>x.trim()).filter(Boolean);return [value.line1||value.address_line1,value.line2||value.address_line2,[value.city,value.state,value.postal_code||value.pin||value.pincode].filter(Boolean).join(', '),value.country].filter(Boolean).map(String)};

export default function PublicQuotation({params}:{params:Promise<{token:string}>}){
  const router=useRouter();
  const {token:rawToken}=use(params);
  const token=decodeURIComponent(rawToken);
  const [quote,setQuote]=useState<Quote|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [accepting,setAccepting]=useState(false);
  const [acceptanceMessage,setAcceptanceMessage]=useState('');
  const [redirectToast,setRedirectToast]=useState('');
  const [qrDataUrl,setQrDataUrl]=useState('');
  const money=useCallback((n:number)=>{const raw=String(quote?.currency_code||'INR').toUpperCase();const currency=/^[A-Z]{3}$/.test(raw)?raw:'INR';return new Intl.NumberFormat('en-IN',{style:'currency',currency,maximumFractionDigits:2}).format(Number(n||0));},[quote?.currency_code]);

  useEffect(()=>{(async()=>{
    const r=await supabase.rpc('get_public_quotation',{p_public_accept_token:token});
    if(r.error||!r.data){setError(r.error?.message||'This quotation link is invalid or no longer available.');setLoading(false);return}
    setQuote(r.data as Quote);setLoading(false);
  })()},[token]);

  const quotationRegistrationType=String(quote?.business.gst_registration_type||'NONE').trim().toUpperCase();
  const quotationTaxRegime=String(quote?.business.tax_regime||'NONE').trim().toUpperCase();
  const quotationCountryCode=String(quote?.business.country_code||'IN').trim().toUpperCase();
  const quotationTaxId=String(quote?.business.tax_registration_number||'').trim().toUpperCase();
  const quotationValidGstin=quotationCountryCode==='IN'?/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/.test(quotationTaxId):Boolean(quotationTaxId);
  const quotationGstRegistered=quotationTaxRegime==='GST'&&['REGULAR','CASUAL','NON_RESIDENT','SEZ'].includes(quotationRegistrationType)&&quotationValidGstin;
  const quotationOtherTaxRegistered=Boolean(quote&&quotationCountryCode!=='IN'&&['VAT','SALES_TAX','OTHER'].includes(quotationTaxRegime)&&(quote.business.tax_id||quote.business.tax_registration_number));
  const quotationTaxEnabled=quotationGstRegistered||quotationOtherTaxRegistered;
  const canonical=useMemo(()=>quote?createCanonicalDocumentViewModel({
    type:'quotation',number:quote.quotation_number,date:quote.quotation_date,due_date:quote.valid_until,status:quote.status,currency_code:quote.currency_code||'INR',
    subtotal:quote.subtotal,discount_total:quote.discount_total,tax_total:quotationTaxEnabled?quote.tax_total:0,
    total:quotationTaxEnabled?quote.total:Math.max(0,Number(quote.subtotal||0)-Number(quote.discount_total||0)),
    business:quote.business,customer:quote.customer,bank:quote.bank || {},
    items:quote.items.map(item=>{
      const base=Number(item.quantity||0)*Number(item.unit_price||0);
      const discount=item.discount_type==='percentage'?base*Number(item.discount_value||0)/100:Number(item.discount_value||0);
      const tax=quotationTaxEnabled?Math.max(0,base-discount)*Number(item.tax_rate||0)/100:0;
      return {...item,tax_rate:quotationTaxEnabled?item.tax_rate:0,discount,amount:Math.max(0,base-discount)+tax};
    }),
  }, {type:'quotation',publicUrl:'https://mm.nilanga.in/quote/'+encodeURIComponent(token),upiId:quote.upi_id || quote.bank?.upi_id || null}):null,[quote,token,quotationTaxEnabled]);
  const logoUrl=useMemo(()=>quote?.business.logo_url?supabase.storage.from('business-branding-public').getPublicUrl(quote.business.logo_url).data.publicUrl:'',[quote?.business.logo_url]);
  useEffect(()=>{let active=true;const qr=canonical?.financials.upiQrString;if(!qr||quote?.payment_qr_enabled===false){setQrDataUrl('');return}QRCode.toDataURL(qr,{width:180,margin:1,errorCorrectionLevel:'M'}).then(url=>{if(active)setQrDataUrl(url)}).catch(()=>{if(active)setQrDataUrl('')});return()=>{active=false}},[canonical?.financials.upiQrString,quote?.payment_qr_enabled]);
  const expired=Boolean(quote?.status==='sent'&&quote.valid_until&&quote.valid_until.slice(0,10)<new Date().toISOString().slice(0,10));
  const computed=useMemo(()=>({
    subtotal:canonical?.financials.subtotal||0,
    discount:canonical?.financials.totalDiscount||0,
    tax:canonical?.financials.taxBreakdown.reduce((sum,line)=>sum+line.amount,0)||0,
    total:canonical?.financials.grandTotal||0,
  }),[canonical]);

  const shareQuotation=async()=>{
    if(!quote)return;
    try {
      const result=await sharePublicDocument({
        documentType:'quotation',
        businessName:quote.business.name||quote.business.legal_name||'Business',
        customerName:quote.customer.legal_name||quote.customer.display_name||'Customer',
        documentNumber:quote.quotation_number,
        documentDate:quote.quotation_date,
        totalAmount:Number(canonical?.financials.grandTotal??quote.total??0),
        currencyCode:quote.currency_code||'INR',
        publicUrl:publicDocumentUrlFromToken('quotation',token),
      },'Quotation '+quote.quotation_number);
      if(result==='shared')setRedirectToast('Quotation shared using your device share sheet.');
      else if(result==='copied')setRedirectToast('Customer-ready quotation message copied to clipboard.');
      if(result!=='cancelled')window.setTimeout(()=>setRedirectToast(''),3000);
    } catch(cause) {
      setError(cause instanceof Error?cause.message:'Unable to share this quotation.');
      setRedirectToast('Failed to share quotation.');
      window.setTimeout(()=>setRedirectToast(''),3000);
    }
  };

  const acceptQuotation=async()=>{
    if(!quote||accepting||quote.status==='converted')return;
    setAccepting(true);setError('');setAcceptanceMessage('');setRedirectToast('');
    try {
      const result=await supabase.rpc('rpc_accept_public_quotation',{p_token:token});
      if(result.error||!result.data) {
        const message=result.error?.message||'Quotation acceptance could not be completed. Please try again or contact the business.';
        setError(message);
        setRedirectToast('Failed to accept quotation.');
        window.setTimeout(()=>setRedirectToast(''),2500);
        return;
      }
      const outcome=result.data as {accepted?:boolean;already_processed?:boolean;quotation_id?:string;quotation_number?:string;invoice_id?:string;invoice_number?:string;invoice_status?:string;public_token?:string|null;redirect_url?:string|null;delivery_pending_posting?:boolean;message?:string};
      setQuote({...quote,status:'converted',invoice_id:outcome.invoice_id||quote.invoice_id||null,invoice_number:outcome.invoice_number||quote.invoice_number||null,invoice_status:outcome.invoice_status||quote.invoice_status||null});
      if (outcome.redirect_url) {
        setRedirectToast('Quotation accepted! Redirecting to your Tax Invoice...');
        window.setTimeout(() => router.push(outcome.redirect_url as string), 700);
        return;
      }
      setAcceptanceMessage(outcome.delivery_pending_posting
        ? `Quotation ${outcome.quotation_number||quote.quotation_number} was accepted and converted to invoice ${outcome.invoice_number||'successfully'}. Your business must post the invoice before its secure customer invoice link becomes available.`
        : `Quotation ${outcome.quotation_number||quote.quotation_number} has been accepted and converted to invoice ${outcome.invoice_number||'successfully'}.`);
    } catch (cause) {
      setError(cause instanceof Error?cause.message:'Quotation acceptance failed. Please try again.');
      setRedirectToast('Failed to accept quotation.');
      window.setTimeout(()=>setRedirectToast(''),2500);
    } finally {
      setAccepting(false);
    }
  };

  if(loading)return <main className="min-h-screen grid place-items-center bg-slate-50 text-sm text-slate-500">Loading quotation…</main>;
  if(error&&!quote)return <main className="min-h-screen grid place-items-center bg-slate-50 p-6"><div className="max-w-md rounded-3xl bg-white p-8 text-center shadow-sm"><h1 className="text-xl font-bold text-slate-900">Quotation unavailable</h1><p className="mt-3 text-sm text-slate-600">{error}</p></div></main>;
  if(!quote)return null;

 
  const publicStatus=expired?'EXPIRED':quote.status==='converted'?'CONVERTED':quote.status.toUpperCase().replace(/_/g,' ');
  const statusStyle=expired?'border-amber-200 bg-amber-50 text-amber-800':(['accepted','converted'].includes(quote.status)?'border-emerald-200 bg-emerald-50 text-emerald-800':quote.status==='sent'?'border-blue-200 bg-blue-50 text-blue-800':'border-slate-200 bg-slate-100 text-slate-700');
  const billingAddress=addressLines(quote.customer.billing_address);
  const shippingAddress=addressLines(quote.customer.shipping_address);
  return <main className="min-h-screen bg-slate-100 p-4 sm:p-8 print:bg-white print:p-0">
    {redirectToast&&<div role="status" aria-live="polite" className={'fixed bottom-5 right-5 z-[200] rounded-xl border bg-white px-4 py-3 text-sm font-semibold shadow-lg '+(redirectToast.startsWith('Failed')?'border-rose-200 text-rose-700':'border-emerald-200 text-emerald-800')}>{redirectToast}</div>}
    <article className="mx-auto max-w-4xl overflow-hidden rounded-2xl bg-white shadow-sm print:max-w-none print:rounded-none print:shadow-none">
      <header className="border-b border-slate-200 p-6 sm:p-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4">
            {logoUrl&&<img src={logoUrl} alt="Business logo" className="h-16 w-20 rounded-lg border border-slate-100 object-contain"/>}
            <div>
              <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-violet-700">QUOTATION</p>
              <h1 className="mt-1 text-2xl font-bold text-slate-900">{canonical?.document.number||quote.quotation_number}</h1>
              <p className="mt-1 text-sm font-semibold text-slate-700">{quote.business.name}</p>
              {quote.business.legal_name&&quote.business.legal_name!==quote.business.name&&<p className="text-xs text-slate-500">{quote.business.legal_name}</p>}
              <div className="mt-2 grid gap-1 text-xs text-slate-500">{addressLines(quote.business.address).map((x,i)=><span key={i}>{x}</span>)}{quote.business.phone&&<span>{quote.business.phone}</span>}{quote.business.email&&<span>{quote.business.email}</span>}{quote.business.website&&<span>{quote.business.website}</span>}{quote.business.tax_registration_number&&<span>{quotationTaxRegime==='GST'?'GSTIN':'Tax ID'}: {quote.business.tax_registration_number}</span>}</div>
            </div>
          </div>
          <div className="text-sm text-slate-500 sm:text-right">
            <span className={"inline-flex rounded-full border px-3 py-1 text-xs font-extrabold uppercase tracking-wider "+statusStyle}>{publicStatus}</span>
            <div className="mt-3">Quotation date: {canonical?.document.date||quote.quotation_date}</div>
            <div>Valid until: {quote.valid_until||'—'}</div>
          </div>
        </div>
      </header>

      <section className="border-b border-slate-200 px-6 py-4 sm:px-8 print:hidden">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <a href={'/api/public-documents/pdf?type=quotation&token='+encodeURIComponent(token)} download={buildDocumentDownloadFilename(quote.business.name || quote.business.legal_name || 'Business', documentFilenameLabel('quotation'), quote.quotation_number || 'Document')} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Download Official PDF</a>
          <CopyButton getValue={() => publicDocumentUrlFromToken('quotation',token)} label="Copy customer link" successMessage="Quotation customer link copied to clipboard!" className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50" />
          <button type="button" onClick={shareQuotation} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Share quotation</button>
          {quote.status==='sent'&&!expired&&<button type="button" onClick={acceptQuotation} disabled={accepting} className="inline-flex min-h-11 items-center justify-center rounded-xl bg-violet-600 px-5 py-3 text-sm font-semibold text-white hover:bg-violet-700 disabled:cursor-wait disabled:opacity-60">{accepting?'Accepting securely…':'Accept Quotation & Request Invoice'}</button>}
          {expired&&<div role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">This quotation expired on {quote.valid_until}. Please contact the business to extend its validity.</div>}
          {quote.status==='converted'&&<div role="status" className="text-sm font-semibold text-emerald-800">Accepted · Invoice {quote.invoice_number||'created'}{quote.invoice_status==='draft'?' · Awaiting business posting':''}</div>}
        </div>
        {error&&<p role="alert" className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
        {acceptanceMessage&&<p role="status" className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-center text-sm text-emerald-800">{acceptanceMessage}</p>}
      </section>

      <section className="grid gap-4 border-b border-slate-200 p-6 sm:grid-cols-2 sm:p-8">
        <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-violet-700">BILL TO</p>
          <h2 className="mt-2 font-semibold text-slate-900">{quote.customer.legal_name||quote.customer.display_name}</h2>
          {billingAddress.map((x,i)=><p key={i} className="text-sm leading-5 text-slate-600">{x}</p>)}
          {quote.customer.phone&&<p className="mt-1 text-sm text-slate-600">{quote.customer.phone}</p>}
          {quote.customer.email&&<p className="text-sm text-slate-600">{quote.customer.email}</p>}
        </div>
        <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-violet-700">SHIP TO</p>
          <h2 className="mt-2 font-semibold text-slate-900">{quote.customer.legal_name||quote.customer.display_name}</h2>
          {shippingAddress.length?shippingAddress.map((x,i)=><p key={i} className="text-sm leading-5 text-slate-600">{x}</p>):billingAddress.length?<p className="text-sm text-slate-600">Same as billing address</p>:<p className="text-sm text-slate-500">No shipping address provided</p>}
        </div>
      </section>

      <section className="overflow-x-auto px-6 pt-6 sm:px-8">
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <thead className="bg-[#7c3aed] text-xs uppercase tracking-wider text-white"><tr>
            <th className="w-10 p-3 text-center font-extrabold">#</th>
            <th className="p-3 text-left font-extrabold">ITEM / DESCRIPTION</th>
            <th className="w-16 p-3 text-center font-extrabold">QTY</th>
            <th className="w-20 p-3 text-center font-extrabold">UNIT</th>
            <th className="w-28 p-3 text-right font-extrabold">RATE</th>
            <th className="w-32 p-3 text-right font-extrabold">AMOUNT</th>
          </tr></thead>
          <tbody>{(canonical?.items||[]).map((item,i)=><tr key={i} className="border-b border-slate-100 align-top">
            <td className="px-4 py-3 text-center text-slate-500">{i+1}</td>
            <td className="px-4 py-3 text-left">
              <div className="text-sm font-semibold text-slate-900">{item.name||item.description||'Item'}</div>
              {item.description&&item.name&&item.description!==item.name&&<div className="mt-0.5 whitespace-pre-line text-xs text-slate-500">{item.description}</div>}
            </td>
            <td className="px-4 py-3 text-center text-sm text-slate-700">{item.quantity}</td>
            <td className="px-4 py-3 text-center text-xs font-medium uppercase text-slate-500">{item.unit||'pcs'}</td>
            <td className="px-4 py-3 text-right text-sm tabular-nums text-slate-700">{money(item.unitPrice)}</td>
            <td className="px-4 py-3 text-right text-sm font-semibold tabular-nums text-slate-900">{money(item.amount)}</td>
          </tr>)}</tbody>
        </table>
      </section>

      <section className="grid gap-6 p-6 sm:grid-cols-[minmax(0,1fr)_280px] sm:p-8">
        <div className="min-w-0 space-y-4">
          <section className="rounded-xl border border-amber-200 bg-amber-50/70 p-4">
            <h3 className="text-xs font-extrabold uppercase tracking-[0.16em] text-violet-700">TERMS &amp; CONDITIONS</h3>
            <p className="mt-2 whitespace-pre-line text-sm leading-5 text-slate-700">{quote.terms||'—'}</p>
            <div className="mt-4 border-t border-amber-200 pt-3">
              <h3 className="text-xs font-extrabold uppercase tracking-[0.16em] text-violet-700">NOTES</h3>
              <p className="mt-2 whitespace-pre-line text-sm leading-5 text-slate-700">{quote.notes||'—'}</p>
            </div>
            <p className="mt-3 border-t border-amber-200 pt-3 text-xs text-slate-600">Validity: quotation prices and scope apply until {quote.valid_until||'the date agreed with the business'}.</p>
          </section>
        </div>

        <div className="min-w-0 space-y-2 text-sm">
          <div className="flex justify-between gap-4"><span className="text-slate-600">Subtotal</span><span className="text-right tabular-nums">{money(computed.subtotal)}</span></div>
          {computed.discount!==0&&<div className="flex justify-between gap-4"><span className="text-slate-600">Trade Discount</span><span className="text-right tabular-nums">-{money(computed.discount)}</span></div>}
          {quotationTaxEnabled&&canonical?.financials.taxBreakdown.map((line,i)=><div key={i} className="flex justify-between gap-4"><span className="text-slate-600">{line.name}{line.rate>0?' ('+line.rate+'%)':''}</span><span className="text-right tabular-nums">{money(line.amount)}</span></div>)}
          <div className="flex justify-between gap-4 border-t border-slate-200 pt-3 text-lg font-extrabold text-orange-700"><span>Net Payable</span><span className="text-right tabular-nums">{money(computed.total)}</span></div>
          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-slate-500">AMOUNT IN WORDS</p>
            <p className="mt-2 text-xs font-semibold leading-5 text-slate-700">{canonical?.financials.amountInWords||'—'}</p>
          </div>
          <div className="mt-10 pt-7">
            <p className="mb-8 text-right text-xs text-slate-500">For {quote.business.legal_name||quote.business.name}</p>
            <div className="ml-auto w-44 border-t border-slate-500 pt-2 text-center"><p className="text-xs font-bold text-slate-800">Authorized Signatory</p></div>
          </div>
        </div>
      </section>

      {(canonical?.business.bankDetails||quote.bank||qrDataUrl)&&<section className="border-t border-slate-200 p-6 sm:p-8">
        <h2 className="text-xs font-extrabold uppercase tracking-[0.16em] text-violet-700">Payment details</h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          {canonical?.business.bankDetails&&<div className="rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-700">
            <p className="font-semibold text-slate-900">{canonical.business.bankDetails.bankName}</p>
            {quote.bank?.account_holder_name&&<p>Account holder: {quote.bank.account_holder_name}</p>}
            {(quote.bank?.account_number||quote.bank?.account_last4)&&<p>Account number: {quote.bank.account_number||('XXXX '+quote.bank.account_last4)}</p>}
            {quote.bank?.ifsc_code&&<p>IFSC: {quote.bank.ifsc_code}</p>}
            {quote.bank?.branch_name&&<p>Branch: {quote.bank.branch_name}</p>}
          </div>}
          {qrDataUrl&&<div className="flex flex-col items-center text-center">
            <a href={canonical?.financials.upiQrString} className="inline-flex rounded-lg bg-violet-700 px-4 py-2 text-sm font-bold text-white">Pay Now via UPI</a>
            <img src={qrDataUrl} alt="UPI payment QR code" className="mt-3 h-28 w-28 rounded-md border border-slate-200 bg-white p-1"/>
            <p className="mt-2 text-xs text-slate-500">Scan to pay the quotation amount.</p>
          </div>}
        </div>
      </section>}

      <footer className="mt-12 border-t border-slate-200 pt-4 text-center text-xs text-slate-500 space-y-1">
        <p>This is a computer-generated quotation and does not require signature.</p>
        <p className="flex items-center justify-center gap-2 text-[11px] text-slate-400"><Image src="/moneymatters-pdf.png" alt="" aria-hidden width={16} height={16} unoptimized className="shrink-0 object-contain" /><span>Powered by Money Matters FinOps | mm.nilanga.in</span></p>
      </footer>
    </article>
  </main>;
}