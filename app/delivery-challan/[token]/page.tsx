import { notFound } from 'next/navigation';
import Image from 'next/image';
import { resolvePublicDocumentByToken } from '@/lib/server/documents/public-tokens';
import { createCanonicalDocumentViewModel } from '@/lib/shared/document-view-model';
export const dynamic='force-dynamic';
const money=(v:number,c:string)=>new Intl.NumberFormat('en-IN',{style:'currency',currency:c||'INR',maximumFractionDigits:2}).format(Number(v||0));
const addr=(v:unknown):string[]=>{if(!v)return[];if(typeof v==='string')return v.split(/\n|,/).map(x=>x.trim()).filter(Boolean);if(typeof v!=='object')return[];const a=v as Record<string,unknown>;return[a.line1||a.address_line1||a.street,a.line2||a.address_line2,[a.city,a.state,a.postal_code||a.pin||a.pincode].filter(Boolean).join(', '),a.country].map(x=>String(x??'').trim()).filter(Boolean);};
export default async function PublicChallan({params}:{params:Promise<{token:string}>}){
 const {token}=await params;const decoded=decodeURIComponent(token);const doc=await resolvePublicDocumentByToken('challan',decoded);if(!doc)notFound();
 const canonical=createCanonicalDocumentViewModel(doc,{type:'challan',publicUrl:'https://mm.nilanga.in/delivery-challan/'+encodeURIComponent(decoded)});
 const pdf='/api/public-documents/pdf?type=challan&token='+encodeURIComponent(decoded);
 return <main className="min-h-screen min-w-0 overflow-x-hidden bg-slate-100 p-2 sm:p-8"><article className="mx-auto w-full max-w-4xl min-w-0 overflow-hidden rounded-xl bg-white shadow-sm sm:rounded-2xl">
 <header className="min-w-0 border-b border-slate-200 p-4 sm:p-8"><p className="text-xs font-bold uppercase tracking-[0.18em] text-violet-600">Delivery Challan</p><h1 className="mt-1 break-words text-lg font-bold text-slate-900 sm:text-2xl [overflow-wrap:anywhere]">{canonical.document.number}</h1><p className="mt-1 font-medium text-slate-600">{doc.business.name}</p>{doc.business.taxRegistrationNumber&&<p className="text-xs text-slate-500">GSTIN / Tax ID: {doc.business.taxRegistrationNumber}</p>}{addr(doc.business.address).map((x,i)=><p key={i} className="text-sm text-slate-500">{x}</p>)}<p className="mt-3 text-sm text-slate-500">Dispatch date: {canonical.document.date} · Status: {doc.status.replace(/_/g,' ')}</p></header>
 <section className="grid min-w-0 gap-3 p-4 sm:grid-cols-2 sm:gap-6 sm:p-8"><div><p className="text-xs font-bold uppercase tracking-wider text-slate-400">Consignee</p><h2 className="mt-2 break-words font-semibold [overflow-wrap:anywhere]">{doc.customer.legalName||doc.customer.name}</h2>{addr(doc.customer.address).map((x,i)=><p key={i} className="text-sm text-slate-600">{x}</p>)}</div><div className="min-w-0 break-words text-sm text-slate-600 [overflow-wrap:anywhere]">{doc.vehicleNumber&&<p>Vehicle: {doc.vehicleNumber}</p>}{doc.transporterName&&<p>Transporter: {doc.transporterName}</p>}{doc.ewayBillNumber&&<p>E-Way Bill: {doc.ewayBillNumber}</p>}</div></section>
 <section className="hidden overflow-x-auto px-6 sm:block sm:px-8 print:block print:overflow-visible"><table className="w-full min-w-[520px] text-sm"><thead className="border-y border-slate-200 bg-slate-50 text-xs uppercase tracking-wider text-slate-500"><tr><th className="p-3 text-left">Item / Description</th><th className="p-3 text-right">Qty</th><th className="p-3 text-right">Rate</th><th className="p-3 text-right">Amount</th></tr></thead><tbody>{doc.items.map((item,i)=><tr key={i} className="border-b border-slate-100"><td className="p-3"><div className="font-medium">{item.description}</div>{item.hsnSac&&<div className="text-xs text-slate-400">HSN / SAC: {item.hsnSac}</div>}</td><td className="p-3 text-right">{item.quantity}{item.unit?' '+item.unit:''}</td><td className="p-3 text-right">{money(item.unitPrice,doc.currencyCode)}</td><td className="p-3 text-right font-semibold">{money(item.lineTotal,doc.currencyCode)}</td></tr>)}</tbody></table></section>
 <section className="space-y-3 px-4 py-5 sm:hidden print:hidden" aria-label="Delivery challan items">
 {doc.items.map((item,i)=><article key={i} className="min-w-0 rounded-xl border border-slate-200 bg-white p-3">
  <div className="flex min-w-0 items-start gap-2">
   <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-violet-50 text-[11px] font-bold text-violet-700">{i+1}</span>
   <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
    <h2 className="break-words text-sm font-semibold text-slate-900">{item.description||'Item'}</h2>
    {item.hsnSac&&<p className="mt-1 break-words text-[11px] text-slate-500">HSN / SAC: {item.hsnSac}</p>}
   </div>
  </div>
  <div className="mt-3 grid grid-cols-2 gap-3 border-t border-slate-100 pt-3 text-xs">
   <div className="min-w-0"><p className="text-slate-500">Quantity</p><p className="mt-1 break-words font-semibold text-slate-800">{item.quantity}{item.unit?' '+item.unit:''}</p></div>
   <div className="min-w-0"><p className="text-slate-500">Rate</p><p className="mt-1 break-words font-semibold tabular-nums text-slate-800">{money(item.unitPrice,doc.currencyCode)}</p></div>
   <div className="col-span-2 flex min-w-0 items-start justify-between gap-3 rounded-lg bg-violet-50 px-3 py-2"><span className="shrink-0 font-semibold text-violet-900">Amount</span><span className="min-w-0 break-words text-right font-extrabold tabular-nums text-slate-900 [overflow-wrap:anywhere]">{money(item.lineTotal,doc.currencyCode)}</span></div>
  </div>
 </article>)}
</section>
<section className="min-w-0 p-4 sm:p-8"><div className="ml-auto max-w-sm break-words text-right"><p className="text-xs uppercase tracking-wider text-slate-400">Declared value</p><p className="text-xl font-bold">{money(canonical.financials.grandTotal,canonical.document.currency)}</p></div>{doc.notes&&<p className="mt-4 whitespace-pre-line text-sm text-slate-600">{doc.notes}</p>}{doc.terms&&<p className="mt-3 whitespace-pre-line text-sm text-slate-600">{doc.terms}</p>}<p className="mt-5 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">Supply on Approval / Job Work / Exhibition / Transportation Only — Not for Sale / Not a Tax Invoice</p></section>
 <footer className="border-t border-slate-200 bg-slate-50 p-4 sm:p-8"><a href={pdf} className="inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-violet-600 px-4 py-3 text-center text-sm font-semibold text-white hover:bg-violet-700 sm:w-auto sm:px-5 sm:py-4 sm:text-base">Download Official PDF</a><p className="mt-4 flex items-center justify-center gap-2 text-xs text-slate-400"><Image src="/moneymatters-pdf.png" alt="" aria-hidden width={16} height={16} unoptimized className="shrink-0 object-contain" /><span>Shared securely via Money Matters FinOps.</span></p></footer>
 </article></main>;
}
