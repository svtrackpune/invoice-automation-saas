'use client';

import { use, useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { supabase } from '@/lib/supabase';

type Invoice = {
  invoice_number:string; invoice_date:string; due_date:string|null; status:string; currency_code:string;
  subtotal:number; discount_total:number; tax_total:number; total:number; amount_paid:number; balance_due:number;
  notes:string|null; terms:string|null; payment_display_mode:'none'|'bank'|'online'; payment_link:string|null; payment_qr_payload:string|null;
  template_name:string|null;
  customer:{display_name:string;legal_name:string|null;email:string|null;phone:string|null;billing_address:any;shipping_address:any;tax_id:string|null};
  business:{name:string;legal_name:string|null;phone:string|null;email:string|null;website:string|null;address:any;logo_storage_path:string|null;tax_registration_number:string|null};
  bank:{name:string;institution_name:string|null;account_holder_name:string|null;account_number:string|null;account_type:string|null;branch_name:string|null;ifsc_code:string|null;upi_id:string|null}|null;
  items:Array<{description:string|null;quantity:number;unit_price:number;discount:number;tax_amount:number;line_total:number;hsn_sac:string|null;item_name:string|null;item_type:string|null;unit:string|null}>;
};

const money=(value:number,currency='INR')=>new Intl.NumberFormat(undefined,{style:'currency',currency:String(currency||'INR').trim(),maximumFractionDigits:2}).format(Number(value||0));
const date=(value:string|null)=>{if(!value)return '—';const m=String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);return m?`${m[3]}/${m[2]}/${m[1]}`:String(value)};
const address=(value:any)=>{if(!value)return [];if(typeof value==='string')return value.split(/\n|,/).map(x=>x.trim()).filter(Boolean);const rows=[value.line1||value.address_line1,value.line2||value.address_line2,[value.city,value.state,value.postal_code||value.pin||value.pincode].filter(Boolean).join(', '),value.country].filter(Boolean);return rows.map(String)};

export default function PublicInvoice({params}:{params:Promise<{token:string}>}){
  const {token}=use(params);
  const [invoice,setInvoice]=useState<Invoice|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [qr,setQr]=useState('');

  useEffect(()=>{let active=true;(async()=>{const r=await supabase.rpc('get_public_invoice',{p_public_share_token:decodeURIComponent(token)});if(!active)return;if(r.error||!r.data){setError(r.error?.message||'This invoice link is invalid or no longer available.');setLoading(false);return}setInvoice(r.data as Invoice);setLoading(false)})();return()=>{active=false}},[token]);

  useEffect(()=>{let active=true;const value=invoice?.payment_qr_payload||invoice?.payment_link||'';if(!value){setQr('');return()=>{active=false}};QRCode.toDataURL(value,{width:180,margin:1,errorCorrectionLevel:'M'}).then(x=>{if(active)setQr(x)}).catch(()=>{if(active)setQr('')});return()=>{active=false}},[invoice?.payment_qr_payload,invoice?.payment_link]);

  const logoUrl=useMemo(()=>invoice?.business.logo_storage_path?supabase.storage.from('business-branding-public').getPublicUrl(invoice.business.logo_storage_path).data.publicUrl:'',[invoice?.business.logo_storage_path]);
  const paymentBox=invoice?.payment_display_mode==='bank'&&invoice.bank?invoice.bank:invoice?.payment_display_mode==='online'?(invoice.payment_link||invoice.payment_qr_payload?{online:true}:null):null;

  if(loading)return <main className="min-h-screen grid place-items-center bg-slate-50 text-sm text-slate-500">Loading invoice…</main>;
  if(error||!invoice)return <main className="min-h-screen grid place-items-center bg-slate-50 p-6"><div className="max-w-md rounded-3xl bg-white p-8 text-center shadow-sm"><h1 className="text-xl font-bold text-slate-900">Invoice unavailable</h1><p className="mt-3 text-sm text-slate-600">{error||'This invoice link is invalid or no longer available.'}</p></div></main>;

  return <main className="min-h-screen bg-slate-100 p-4 sm:p-8 print:bg-white print:p-0">
    <article className="mx-auto max-w-4xl overflow-hidden rounded-2xl bg-white shadow-sm print:max-w-none print:rounded-none print:shadow-none">
      <header className="border-b border-slate-200 p-6 sm:p-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4">
            {logoUrl&&<img src={logoUrl} alt="Business logo" className="h-16 w-24 rounded-lg object-contain"/>}
            <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-violet-600">Invoice</p><h1 className="mt-1 text-2xl font-bold text-slate-900">{invoice.invoice_number}</h1><p className="mt-1 text-sm font-medium text-slate-600">{invoice.business.name}</p>{invoice.business.legal_name&&invoice.business.legal_name!==invoice.business.name&&<p className="text-xs text-slate-500">{invoice.business.legal_name}</p>}</div>
          </div>
          <div className="text-sm text-slate-500 sm:text-right"><div>Invoice date: {date(invoice.invoice_date)}</div><div>Due date: {date(invoice.due_date)}</div><div className="mt-2 inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-slate-700">{invoice.status.replace('_',' ')}</div></div>
        </div>
        <div className="mt-4 grid gap-1 text-xs text-slate-500">{address(invoice.business.address).map((x,i)=><span key={i}>{x}</span>)}{invoice.business.phone&&<span>{invoice.business.phone}</span>}{invoice.business.email&&<span>{invoice.business.email}</span>}{invoice.business.website&&<span>{invoice.business.website}</span>}{invoice.business.tax_registration_number&&<span>GSTIN / Tax ID: {invoice.business.tax_registration_number}</span>}</div>
      </header>

      <section className="grid gap-6 border-b border-slate-200 p-6 sm:grid-cols-2 sm:p-8">
        <div><p className="text-xs font-bold uppercase tracking-wider text-slate-400">Bill To</p><h2 className="mt-2 font-semibold text-slate-900">{invoice.customer.legal_name||invoice.customer.display_name}</h2>{address(invoice.customer.billing_address).map((x,i)=><p key={i} className="text-sm text-slate-600">{x}</p>)}{invoice.customer.phone&&<p className="text-sm text-slate-600">{invoice.customer.phone}</p>}{invoice.customer.email&&<p className="text-sm text-slate-600">{invoice.customer.email}</p>}{invoice.customer.tax_id&&<p className="text-sm text-slate-600">Tax ID: {invoice.customer.tax_id}</p>}</div>
        <div className="sm:text-right"><p className="text-xs font-bold uppercase tracking-wider text-slate-400">Invoice summary</p><p className="mt-2 text-sm text-slate-600">Template: {invoice.template_name||'Business default'}</p>{invoice.balance_due>0&&<p className="mt-1 text-sm font-semibold text-amber-700">Balance due: {money(invoice.balance_due,invoice.currency_code)}</p>}{invoice.balance_due<=0&&<p className="mt-1 text-sm font-semibold text-emerald-700">Paid in full</p>}</div>
      </section>

      <section className="overflow-x-auto px-6 sm:px-8"><table className="w-full min-w-[620px] text-sm"><thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wider text-slate-500"><tr><th className="p-3 text-left">Item / Description</th><th className="p-3 text-right">Qty</th><th className="p-3 text-right">Rate</th><th className="p-3 text-right">Amount</th></tr></thead><tbody>{invoice.items.map((item,i)=><tr key={i} className="border-b border-slate-100"><td className="p-3"><div className="font-medium text-slate-900">{item.item_name||item.description||'Item'}</div>{item.item_name&&item.description&&item.item_name!==item.description&&<div className="text-xs text-slate-500">{item.description}</div>}{item.hsn_sac&&<div className="text-[11px] text-slate-400">HSN / SAC: {item.hsn_sac}</div>}</td><td className="p-3 text-right">{item.quantity}{item.unit&&<span className="ml-1 text-xs text-slate-400">{item.unit}</span>}</td><td className="p-3 text-right">{money(item.unit_price,invoice.currency_code)}</td><td className="p-3 text-right font-semibold">{money(item.line_total,invoice.currency_code)}</td></tr>)}</tbody></table></section>

      <section className="grid gap-8 p-6 sm:grid-cols-[1fr_280px] sm:p-8">
        <div className="text-sm text-slate-600">{invoice.notes&&<div><h3 className="font-semibold text-slate-900">Notes</h3><p className="mt-2 whitespace-pre-line">{invoice.notes}</p></div>}{invoice.terms&&<div className="mt-5"><h3 className="font-semibold text-slate-900">Terms & conditions</h3><p className="mt-2 whitespace-pre-line">{invoice.terms}</p></div>}</div>
        <div className="space-y-2 text-sm"><div className="flex justify-between"><span>Subtotal</span><span>{money(invoice.subtotal,invoice.currency_code)}</span></div>{invoice.discount_total!==0&&<div className="flex justify-between"><span>Discount</span><span>-{money(invoice.discount_total,invoice.currency_code)}</span></div>}{invoice.tax_total!==0&&<div className="flex justify-between"><span>Tax / GST</span><span>{money(invoice.tax_total,invoice.currency_code)}</span></div>}<div className="flex justify-between border-t border-slate-200 pt-3 text-lg font-bold"><span>Total</span><span>{money(invoice.total,invoice.currency_code)}</span></div>{invoice.amount_paid>0&&<div className="flex justify-between"><span>Amount paid</span><span>{money(invoice.amount_paid,invoice.currency_code)}</span></div>}<div className="flex justify-between font-semibold"><span>Balance due</span><span>{money(invoice.balance_due,invoice.currency_code)}</span></div></div>
      </section>

      {paymentBox&&<section className="mx-6 mb-8 max-w-sm rounded-xl border border-black p-4 sm:mx-8 print:mx-0">
        {invoice.payment_display_mode==='bank'&&invoice.bank&&<div className="text-sm text-slate-800"><h3 className="font-bold uppercase tracking-wider">Bank Details</h3>{invoice.bank.account_holder_name&&<div className="mt-2"><b>Account Name:</b> {invoice.bank.account_holder_name}</div>}<div><b>Bank:</b> {invoice.bank.institution_name||invoice.bank.name}</div>{invoice.bank.account_number&&<div><b>Account No:</b> {invoice.bank.account_number}</div>}{invoice.bank.account_type&&<div><b>Account Type:</b> {invoice.bank.account_type}</div>}{invoice.bank.branch_name&&<div><b>Branch:</b> {invoice.bank.branch_name}</div>}{invoice.bank.ifsc_code&&<div><b>IFSC:</b> {invoice.bank.ifsc_code}</div>}{invoice.bank.upi_id&&<div><b>UPI:</b> {invoice.bank.upi_id}</div>}</div>}
        {invoice.payment_display_mode==='online'&&<div className="text-center"><h3 className="font-bold uppercase tracking-wider">Payment</h3>{invoice.payment_link&&<a href={invoice.payment_link} target="_blank" rel="noreferrer" className="mt-3 inline-flex rounded-lg bg-violet-600 px-5 py-2.5 text-sm font-bold text-white">Pay Now</a>}{qr&&<div className="mt-3"><img src={qr} alt="Payment QR" className="mx-auto h-36 w-36"/><p className="mt-1 text-[11px] text-slate-500">Scan to pay the invoice amount.</p></div>}</div>}
      </section>}

      <footer className="border-t border-slate-200 bg-slate-50 p-6 text-center text-xs text-slate-400"><div>This is a customer-facing invoice shared by {invoice.business.name}.</div><div className="mt-3 flex items-center justify-center gap-2 border-t border-slate-200 pt-3"><span className="inline-grid h-4 w-4 place-items-center rounded bg-violet-600 text-[9px] font-black text-white">M</span><span>Powered by <strong className="text-violet-600">Moneymatters</strong></span></div></footer>
    </article>
  </main>;
}