'use client';

import { use, useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import Image from 'next/image';
import { supabase } from '@/lib/supabase';
import { createCanonicalDocumentViewModel } from '@/lib/shared/document-view-model';
import { buildDocumentDownloadFilename, documentFilenameLabel } from '@/lib/shared/document-filename';
import CopyButton from '@/components/ui/copy-button';

type AddressValue = string | {
  line1?: string | number | null; address_line1?: string | number | null;
  line2?: string | number | null; address_line2?: string | number | null;
  city?: string | number | null; state?: string | number | null;
  postal_code?: string | number | null; pin?: string | number | null; pincode?: string | number | null;
  country?: string | number | null;
} | null;

type Invoice = {
  invoice_number:string; invoice_date:string; due_date:string|null; status:string; currency_code:string;
  subtotal:number; discount_total:number; tax_total:number; cgst_amount:number; sgst_amount:number; igst_amount:number;
  place_of_supply_state_code:string|null; supply_type:string; total:number; amount_paid:number; balance_due:number;
  notes:string|null; terms:string|null; payment_display_mode:'none'|'bank'|'online'; payment_link:string|null; payment_qr_payload:string|null;
  upi_id:string|null; payment_qr_enabled:boolean; settlement_display_mode:'upi_qr'|'bank_transfer'|'both'|'none';
  template_name:string|null;
  customer:{display_name:string;legal_name:string|null;email:string|null;phone:string|null;billing_address:AddressValue;shipping_address:AddressValue;tax_id:string|null};
  business:{name:string;legal_name:string|null;phone:string|null;email:string|null;website:string|null;address:AddressValue;logo_storage_path:string|null;tax_registration_number:string|null;gst_registration_type?:string|null;tax_regime?:string|null;country_code?:string|null;tax_id?:string|null};
  bank:{name:string;institution_name:string|null;account_holder_name:string|null;account_number:string|null;account_type:string|null;branch_name:string|null;ifsc_code:string|null;upi_id:string|null}|null;
  items:Array<{description:string|null;quantity:number;unit_price:number;discount:number;tax_amount:number;line_total:number;hsn_sac:string|null;item_name:string|null;item_type:string|null;unit:string|null}>;
};

const money=(value:number,currency='INR')=>new Intl.NumberFormat(undefined,{style:'currency',currency:String(currency||'INR').trim(),maximumFractionDigits:2}).format(Number(value||0));
const date=(value:string|null)=>{if(!value)return '—';const m=String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);return m?`${m[3]}/${m[2]}/${m[1]}`:String(value)};
const address=(value:AddressValue)=>{if(!value)return [];if(typeof value==='string')return value.split(/\n|,/).map(x=>x.trim()).filter(Boolean);const rows=[value.line1||value.address_line1,value.line2||value.address_line2,[value.city,value.state,value.postal_code||value.pin||value.pincode].filter(Boolean).join(', '),value.country].filter(Boolean);return rows.map(String)};

export default function PublicInvoice({params}:{params:Promise<{token:string}>}){
  const {token}=use(params);
  const [invoice,setInvoice]=useState<Invoice|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [qr,setQr]=useState('');

  useEffect(()=>{let active=true;(async()=>{const r=await supabase.rpc('get_public_invoice',{p_public_share_token:decodeURIComponent(token)});if(!active)return;if(r.error||!r.data){setError(r.error?.message||'This invoice link is invalid or no longer available.');setLoading(false);return}setInvoice(r.data as Invoice);setLoading(false)})();return()=>{active=false}},[token]);

  const canonical=useMemo(()=>invoice?createCanonicalDocumentViewModel({
    type:'invoice',number:invoice.invoice_number,date:invoice.invoice_date,due_date:invoice.due_date,status:invoice.status,currency_code:invoice.currency_code,
    subtotal:invoice.subtotal,discount_total:invoice.discount_total,tax_total:invoice.tax_total,
    cgst_amount:invoice.cgst_amount,sgst_amount:invoice.sgst_amount,igst_amount:invoice.igst_amount,
    place_of_supply_state_code:invoice.place_of_supply_state_code,supply_type:invoice.supply_type,
    total:invoice.total,amount_paid:invoice.amount_paid,balance_due:invoice.balance_due,payment_qr_payload:invoice.payment_qr_payload,
    settlement_display_mode:invoice.settlement_display_mode,
    business:invoice.business,customer:invoice.customer,bank:invoice.payment_qr_enabled===false?{...invoice.bank,upi_id:null}:invoice.bank,items:invoice.items,
  },{type:'invoice',publicUrl:'https://mm.nilanga.in/invoice/'+encodeURIComponent(token),upiId:invoice.payment_qr_enabled===false?null:(invoice.upi_id||invoice.bank?.upi_id),settlementDisplayMode:invoice.settlement_display_mode,paymentQrEnabled:invoice.payment_qr_enabled}):null,[invoice,token]);

  useEffect(()=>{let active=true;const mode=canonical?.settlementDisplayMode;const value=invoice?.payment_qr_enabled===false||!['upi_qr','both'].includes(mode||'')?'':canonical?.financials.upiQrString||'';if(!value){setQr('');return()=>{active=false}};QRCode.toDataURL(value,{width:180,margin:1,errorCorrectionLevel:'M'}).then(x=>{if(active)setQr(x)}).catch(()=>{if(active)setQr('')});return()=>{active=false}},[canonical?.financials.upiQrString,canonical?.settlementDisplayMode,invoice?.payment_qr_enabled]);

  const logoUrl=useMemo(()=>invoice?.business.logo_storage_path?supabase.storage.from('business-branding-public').getPublicUrl(invoice.business.logo_storage_path).data.publicUrl:'',[invoice?.business.logo_storage_path]);
  const showBankSettlement=Boolean(invoice?.bank&&(canonical?.settlementDisplayMode==='bank_transfer'||canonical?.settlementDisplayMode==='both'));
  const showUpiSettlement=Boolean(canonical?.financials.upiQrString&&(canonical?.settlementDisplayMode==='upi_qr'||canonical?.settlementDisplayMode==='both'));
  const paymentBox=showBankSettlement||showUpiSettlement;

  if(loading)return <main className="min-h-screen grid place-items-center bg-slate-50 text-sm text-slate-500">Loading invoice…</main>;
  if(error||!invoice)return <main className="min-h-screen grid place-items-center bg-slate-50 p-6"><div className="max-w-md rounded-3xl bg-white p-8 text-center shadow-sm"><h1 className="text-xl font-bold text-slate-900">Invoice unavailable</h1><p className="mt-3 text-sm text-slate-600">{error||'This invoice link is invalid or no longer available.'}</p></div></main>;

  const registrationType=String(invoice.business.gst_registration_type||'NONE').trim().toUpperCase();
  const taxRegime=String(invoice.business.tax_regime||'NONE').trim().toUpperCase();
  const countryCode=String(invoice.business.country_code||'IN').trim().toUpperCase();
  const taxNumber=String(invoice.business.tax_registration_number||'').trim().toUpperCase();
  const validGstin=countryCode==='IN'?/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/.test(taxNumber):Boolean(taxNumber);
  const validGstType=['REGULAR','CASUAL','NON_RESIDENT','SEZ','COMPOSITION'].includes(registrationType);
  const gstRegistered=taxRegime==='GST'&&validGstType&&validGstin;
  const compositionSupply=gstRegistered&&registrationType==='COMPOSITION';
  const otherTaxRegistered=countryCode!=='IN'&&['VAT','SALES_TAX','OTHER'].includes(taxRegime)&&Boolean(invoice.business.tax_id||invoice.business.tax_registration_number);
  const taxRegistered=gstRegistered||otherTaxRegistered;
  const invoiceHeading=compositionSupply?'BILL OF SUPPLY':taxRegistered?'TAX INVOICE':'INVOICE';
  const showGstBreakdown=gstRegistered&&!compositionSupply;
  const showOtherTaxBreakdown=otherTaxRegistered;

  return <main className="min-h-screen bg-slate-100 p-4 sm:p-8 print:bg-white print:p-0">
    <article className="mx-auto max-w-4xl overflow-hidden rounded-2xl bg-white shadow-sm print:max-w-none print:rounded-none print:shadow-none">
      <header className="border-b border-slate-200 p-6 sm:p-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4">
            {logoUrl&&<Image src={logoUrl} alt="Business logo" width={96} height={64} unoptimized className="h-16 w-24 rounded-lg object-contain"/>}
            <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-violet-600">{invoiceHeading}</p><h1 className="mt-1 text-2xl font-bold text-slate-900">{canonical?.document.number||invoice.invoice_number}</h1><p className="mt-1 text-sm font-medium text-slate-600">{invoice.business.name}</p>{invoice.business.legal_name&&invoice.business.legal_name!==invoice.business.name&&<p className="text-xs text-slate-500">{invoice.business.legal_name}</p>}</div>
          </div>
          <div className="text-sm text-slate-500 sm:text-right"><div>Invoice date: {date(canonical?.document.date||invoice.invoice_date)}</div><div>Due date: {date(invoice.due_date)}</div><div className="mt-2 inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-slate-700">{invoice.status.replace('_',' ')}</div></div>
        </div>
        <div className="mt-4 grid gap-1 text-xs text-slate-500">{address(invoice.business.address).map((x,i)=><span key={i}>{x}</span>)}{invoice.business.phone&&<span>{invoice.business.phone}</span>}{invoice.business.email&&<span>{invoice.business.email}</span>}{invoice.business.website&&<span>{invoice.business.website}</span>}{invoice.business.tax_registration_number&&<span>{taxRegime==='GST'?'GSTIN':'Tax ID'}: {invoice.business.tax_registration_number}</span>}</div>
      </header>

      <section className="grid gap-4 border-b border-slate-200 p-6 sm:grid-cols-2 sm:p-8">
        <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-violet-700">BILL TO</p>
          <h2 className="mt-2 font-semibold text-slate-900">{invoice.customer.legal_name||invoice.customer.display_name}</h2>
          {address(invoice.customer.billing_address).map((x,i)=><p key={i} className="text-sm leading-5 text-slate-600">{x}</p>)}
          {invoice.customer.phone&&<p className="mt-1 text-sm text-slate-600">{invoice.customer.phone}</p>}
          {invoice.customer.email&&<p className="text-sm text-slate-600">{invoice.customer.email}</p>}
          {invoice.customer.tax_id&&<p className="mt-1 text-sm font-medium text-slate-700">Tax ID: {invoice.customer.tax_id}</p>}
        </div>
        <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-violet-700">SHIP TO</p>
          <h2 className="mt-2 font-semibold text-slate-900">{invoice.customer.legal_name||invoice.customer.display_name}</h2>
          {address(invoice.customer.shipping_address).length > 0
            ? address(invoice.customer.shipping_address).map((x,i)=><p key={i} className="text-sm leading-5 text-slate-600">{x}</p>)
            : address(invoice.customer.billing_address).length > 0
              ? <p className="text-sm text-slate-600">Same as billing address</p>
              : <p className="text-sm text-slate-500">No shipping address provided</p>}
        </div>
      </section>

      <section className="overflow-x-auto px-6 sm:px-8">
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <thead className="bg-[#7c3aed] text-xs uppercase tracking-wider text-white">
            <tr>
              <th className="w-10 p-3 text-center font-extrabold">#</th>
              <th className="p-3 text-left font-extrabold">ITEM / DESCRIPTION</th>
              <th className="w-16 p-3 text-center font-extrabold">QTY</th>
              <th className="w-20 p-3 text-center font-extrabold">UNIT</th>
              <th className="w-28 p-3 text-right font-extrabold">RATE</th>
              <th className="w-32 p-3 text-right font-extrabold">AMOUNT</th>
            </tr>
          </thead>
          <tbody>
            {invoice.items.map((item,i)=><tr key={i} className="border-b border-slate-100 align-top">
              <td className="p-3 text-center text-slate-500">{i+1}</td>
              <td className="px-4 py-3 text-left">
                <div className="text-sm font-semibold text-slate-900">{item.item_name||item.description||'Item'}</div>
                {item.description&&item.item_name&&item.item_name!==item.description&&<div className="mt-0.5 whitespace-pre-line text-xs text-slate-500">{item.description}</div>}
                {item.hsn_sac&&<div className="mt-1 text-[11px] text-slate-400">HSN / SAC: {item.hsn_sac}</div>}
              </td>
              <td className="px-4 py-3 text-center text-sm text-slate-700">{item.quantity}</td>
              <td className="px-4 py-3 text-center text-xs font-medium uppercase text-slate-500">{item.unit||'pcs'}</td>
              <td className="px-4 py-3 text-right text-sm tabular-nums text-slate-700">{money(item.unit_price,invoice.currency_code)}</td>
              <td className="px-4 py-3 text-right text-sm font-semibold tabular-nums text-slate-900">{money(item.line_total,invoice.currency_code)}</td>
            </tr>)}
          </tbody>
        </table>
      </section>

      <section className="grid gap-6 p-6 sm:grid-cols-[minmax(0,1fr)_280px] sm:p-8">
        <div className="min-w-0 space-y-4">
          {paymentBox&&<section className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
            <h3 className="text-xs font-extrabold uppercase tracking-[0.16em] text-emerald-900">{showUpiSettlement&&!showBankSettlement?'SCAN & PAY VIA UPI':showBankSettlement&&!showUpiSettlement?'BANK DETAILS':'PAYMENT SETTLEMENT'}</h3>
            <div className={showBankSettlement&&showUpiSettlement?'mt-3 grid gap-4 sm:grid-cols-2':'mt-3'}>
              {showBankSettlement&&invoice.bank&&<div className="rounded-lg border border-emerald-200 bg-white/80 p-3 text-sm text-slate-700">
                {invoice.bank.account_holder_name&&<div><b>Account Name:</b> {invoice.bank.account_holder_name}</div>}
                <div><b>Bank:</b> {invoice.bank.institution_name||invoice.bank.name}</div>
                {invoice.bank.account_number&&<div><b>Account No:</b> {invoice.bank.account_number}</div>}
                {invoice.bank.account_type&&<div><b>Account Type:</b> {invoice.bank.account_type}</div>}
                {invoice.bank.branch_name&&<div><b>Branch:</b> {invoice.bank.branch_name}</div>}
                {invoice.bank.ifsc_code&&<div><b>IFSC:</b> {invoice.bank.ifsc_code}</div>}
                {invoice.bank.upi_id&&<div><b>UPI:</b> {invoice.bank.upi_id}</div>}
              </div>}
              {showUpiSettlement&&<div className="flex min-w-0 flex-col items-center justify-start text-center">
                <a href={canonical?.financials.upiQrString} className="inline-flex items-center justify-center rounded-lg bg-emerald-700 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-800">Pay Now via UPI</a>
                {qr&&<div className="mt-3">
                  <Image src={qr} alt="UPI payment QR code" width={180} height={180} unoptimized className="mx-auto h-28 w-28 rounded-md bg-white p-1"/>
                  <p className="mt-2 text-xs text-slate-600">Scan to pay the invoice amount.</p>
                </div>}
              </div>}
            </div>
          </section>}
          <section className="rounded-xl border border-amber-200 bg-amber-50/70 p-4">
            <div>
              <h3 className="text-xs font-extrabold uppercase tracking-[0.16em] text-violet-700">TERMS &amp; CONDITIONS</h3>
              <p className="mt-2 whitespace-pre-line text-sm leading-5 text-slate-700">{invoice.terms||'—'}</p>
            </div>
            <div className="mt-4 border-t border-amber-200 pt-3">
              <h3 className="text-xs font-extrabold uppercase tracking-[0.16em] text-violet-700">NOTES</h3>
              <p className="mt-2 whitespace-pre-line text-sm leading-5 text-slate-700">{invoice.notes||'—'}</p>
            </div>
          </section>
        </div>
        <div className="min-w-0 space-y-2 text-sm">
          <div className="flex justify-between gap-4 font-bold text-orange-700"><span>Subtotal</span><span className="text-right tabular-nums">{money(canonical?.financials.subtotal??invoice.subtotal,invoice.currency_code)}</span></div>
          {invoice.discount_total!==0&&<div className="flex justify-between gap-4"><span className="text-slate-600">Discount</span><span className="text-right tabular-nums">-{money(canonical?.financials.totalDiscount??invoice.discount_total,invoice.currency_code)}</span></div>}
          {showGstBreakdown&&invoice.igst_amount>0?<div className="flex justify-between gap-4 font-bold text-orange-700"><span>IGST</span><span className="text-right tabular-nums">{money(invoice.igst_amount,invoice.currency_code)}</span></div>:<>{showGstBreakdown&&invoice.cgst_amount>0&&<div className="flex justify-between gap-4 font-bold text-orange-700"><span>CGST</span><span className="text-right tabular-nums">{money(invoice.cgst_amount,invoice.currency_code)}</span></div>}{showGstBreakdown&&invoice.sgst_amount>0&&<div className="flex justify-between gap-4 font-bold text-orange-700"><span>SGST</span><span className="text-right tabular-nums">{money(invoice.sgst_amount,invoice.currency_code)}</span></div>}{showGstBreakdown&&invoice.tax_total!==0&&invoice.cgst_amount===0&&invoice.sgst_amount===0&&<div className="flex justify-between gap-4 font-bold text-orange-700"><span>GST</span><span className="text-right tabular-nums">{money(invoice.tax_total,invoice.currency_code)}</span></div>}</>}{showOtherTaxBreakdown&&invoice.tax_total!==0&&<div className="flex justify-between gap-4 font-bold text-orange-700"><span>Tax</span><span className="text-right tabular-nums">{money(invoice.tax_total,invoice.currency_code)}</span></div>}
          <div className="flex justify-between gap-4 border-t border-slate-200 pt-3 text-lg font-extrabold text-orange-700"><span>Net Payable</span><span className="text-right tabular-nums">{money(canonical?.financials.grandTotal??invoice.total,invoice.currency_code)}</span></div>
          {invoice.amount_paid>0&&<div className="flex justify-between gap-4"><span className="text-slate-600">Amount paid</span><span className="text-right tabular-nums">{money(canonical?.financials.amountPaid??invoice.amount_paid,invoice.currency_code)}</span></div>}
          <div className="flex justify-between gap-4 font-extrabold text-orange-700"><span>Balance Due</span><span className="text-right tabular-nums">{money(canonical?.financials.balanceDue??invoice.balance_due,invoice.currency_code)}</span></div>
          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-slate-500">AMOUNT IN WORDS</p>
            <p className="mt-2 text-xs font-semibold leading-5 text-slate-700">{canonical?.financials.amountInWords||'—'}</p>
          </div>
          <div className="mt-10 pt-7">
            <div className="ml-auto w-44 border-t border-slate-500 pt-2 text-center">
              <p className="text-xs font-bold text-slate-800">Authorized Signatory</p>
            </div>
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-3 border-t border-slate-200 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8 print:hidden">
        <div><p className="font-semibold text-slate-900">Need a copy for your records?</p><p className="mt-1 text-xs text-slate-500">Download a PDF copy of this invoice.</p></div>
        <div className="flex flex-wrap items-center gap-3">
          <a href={'/api/public-documents/pdf?type=invoice&token=' + encodeURIComponent(token)} download={buildDocumentDownloadFilename(invoice.business.name || invoice.business.legal_name || 'Business', documentFilenameLabel('invoice'), invoice.invoice_number || 'Document')} className="inline-flex min-h-12 items-center justify-center rounded-xl bg-violet-600 px-6 py-3 text-sm font-semibold text-white hover:bg-violet-700">Download Official PDF</a>
          <CopyButton getValue={() => window.location.href} label="Copy Invoice Link" className="inline-flex min-h-12 items-center justify-center rounded-xl border border-slate-200 bg-white px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50" />
        </div>
      </section>

      <footer className="border-t border-slate-200 bg-slate-50 px-6 py-5 text-center text-xs text-slate-500">
        <p className="font-medium text-slate-600">This is a computer-generated invoice and does not require signature.</p>
        <div className="mt-3 flex items-center justify-center gap-2 border-t border-slate-200 pt-3 text-slate-500">
          <span className="inline-grid h-4 w-4 place-items-center rounded bg-violet-600 text-[9px] font-black text-white">M</span>
          <span><strong className="text-violet-600">⚡ Powered by Moneymatters FinOps</strong> | mm.nilanga.in</span>
        </div>
      </footer>
    </article>
  </main>;
}