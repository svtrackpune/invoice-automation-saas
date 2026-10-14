import { notFound } from 'next/navigation';
import { resolvePublicDocumentByToken } from '@/lib/server/documents/public-tokens';
import { createCanonicalDocumentViewModel } from '@/lib/shared/document-view-model';
export const dynamic='force-dynamic';
const money=(v:number,c:string)=>new Intl.NumberFormat('en-IN',{style:'currency',currency:c||'INR',maximumFractionDigits:2}).format(Number(v||0));
const addressLines=(value:unknown):string[]=>{
 if(!value)return [];
 if(typeof value==='string')return value.split(/\n|,/).map(x=>x.trim()).filter(Boolean);
 if(typeof value==='object'){
  const v=value as Record<string,unknown>;
  return [v.line1||v.address_line1,v.line2||v.address_line2,[v.city,v.state,v.postal_code||v.pin||v.pincode].filter(Boolean).join(', '),v.country].filter(Boolean).map(String);
 }
 return [String(value)];
};
const dateLabel=(value:string|null|undefined)=>{if(!value)return '—';const match=String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);return match?match[3]+'/'+match[2]+'/'+match[1]:String(value)};
export default async function PublicReceipt({params}:{params:Promise<{token:string}>}){
 const {token}=await params;
 const decoded=decodeURIComponent(token);
 const doc=await resolvePublicDocumentByToken('receipt',decoded);
 if(!doc)notFound();
 const canonical=createCanonicalDocumentViewModel(doc,{type:'receipt',publicUrl:'https://mm.nilanga.in/receipt/'+encodeURIComponent(decoded)});
 const pdf='/api/receipts/pdf?token='+encodeURIComponent(decoded);
 const receipt=doc.receiptDetails;
 const allocations=receipt?.allocations||[];
 const received=canonical.financials.grandTotal;
 const outstanding=receipt?.customerOutstanding??canonical.financials.balanceDue;
 const ledgerCurrency=receipt?.customerOutstandingCurrencyCode||canonical.document.currency;
 return <main className="min-h-screen bg-slate-100 p-4 sm:p-8 print:bg-white print:p-0">
  <article className="mx-auto max-w-3xl overflow-hidden rounded-2xl bg-white shadow-sm print:max-w-none print:rounded-none print:shadow-none">
   <header className="border-b border-slate-200 p-6 sm:p-8">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
     <div>
      <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-violet-700">Payment Receipt / Voucher</p>
      <h1 className="mt-1 text-2xl font-bold text-slate-900">{canonical.document.number}</h1>
      <p className="mt-1 text-sm font-semibold text-slate-700">{doc.business.name}</p>
      {doc.business.legalName&&doc.business.legalName!==doc.business.name&&<p className="text-xs text-slate-500">{doc.business.legalName}</p>}
      <div className="mt-2 grid gap-1 text-xs text-slate-500">{addressLines(doc.business.address).map((line,i)=><span key={i}>{line}</span>)}{doc.business.phone&&<span>{doc.business.phone}</span>}{doc.business.email&&<span>{doc.business.email}</span>}{doc.business.taxRegistrationNumber&&<span>GSTIN / Tax ID: {doc.business.taxRegistrationNumber}</span>}</div>
     </div>
     <div className="text-left sm:text-right">
      <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-extrabold uppercase tracking-wider text-emerald-800">Paid / Received</span>
      <p className="mt-3 text-sm text-slate-500">Receipt date: {dateLabel(canonical.document.date)}</p>
      <p className="mt-1 text-xs text-slate-500">Currency: {canonical.document.currency}</p>
     </div>
    </div>
   </header>

   <section className="grid gap-4 border-b border-slate-200 p-6 sm:grid-cols-2 sm:p-8">
    <div className="rounded-xl border border-slate-200 p-4">
     <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-violet-700">Received from</p>
     <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <h2 className="min-w-0 max-w-full font-semibold text-slate-900 [overflow-wrap:anywhere]">{doc.customer.legalName||doc.customer.name}</h2>
      {doc.customer.phone&&<span className="whitespace-nowrap text-sm text-slate-600">{doc.customer.phone}</span>}
     </div>
     {addressLines(doc.customer.billingAddress||doc.customer.address).map((line,i)=><p key={i} className="text-sm leading-5 text-slate-600">{line}</p>)}
     {doc.customer.email&&<p className="text-sm text-slate-600">{doc.customer.email}</p>}
    </div>
    <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
     <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-emerald-900">Amount received</p>
     <p className="mt-2 text-2xl font-extrabold text-slate-900">{money(received,canonical.document.currency)}</p>
     <p className="mt-1 text-xs text-slate-600">Receipt {canonical.document.number}</p>
     <p className="mt-3 border-t border-emerald-200 pt-3 text-sm font-semibold text-slate-800">Amount in words: {canonical.financials.amountInWords||'—'}</p>
    </div>
   </section>

   <section className="p-6 sm:p-8">
    <h2 className="text-xs font-extrabold uppercase tracking-[0.16em] text-violet-700">Payment acknowledgement</h2>
    <div className="mt-3 grid gap-3 sm:grid-cols-3">
     <div className="rounded-lg border border-slate-200 bg-white p-3"><p className="text-xs text-slate-500">Payment Mode</p><p className="mt-1 font-semibold text-slate-900">{receipt?.paymentMethod||'—'}</p></div>
     <div className="rounded-lg border border-slate-200 bg-white p-3"><p className="text-xs text-slate-500">UTR / Transaction Ref</p><p className="mt-1 break-all font-semibold text-slate-900">{receipt?.referenceNumber||'—'}</p></div>
     <div className="rounded-lg border border-slate-200 bg-white p-3"><p className="text-xs text-slate-500">Payment Date</p><p className="mt-1 font-semibold text-slate-900">{dateLabel(receipt?.paymentDate||canonical.document.date)}</p></div>
    </div>
   </section>

   <section className="px-6 pb-6 sm:px-8">
    <h2 className="text-xs font-extrabold uppercase tracking-[0.16em] text-violet-700">Invoice Allocation</h2>
    <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
     <table className="w-full min-w-[560px] border-collapse text-sm">
      <thead className="bg-[#7c3aed] text-xs uppercase tracking-wider text-white"><tr><th className="p-3 text-left">Invoice No.</th><th className="p-3 text-left">Invoice Date</th><th className="p-3 text-right">Original Amount</th><th className="p-3 text-right">Amount Applied</th></tr></thead>
      <tbody>{allocations.length?allocations.map((row,i)=><tr key={row.invoiceNumber+'-'+i} className="border-b border-slate-100"><td className="p-3 font-medium text-slate-900">{row.invoiceNumber}</td><td className="p-3 text-slate-600">{dateLabel(row.invoiceDate)}</td><td className="p-3 text-right tabular-nums">{money(row.totalDue,canonical.document.currency)}</td><td className="p-3 text-right font-semibold tabular-nums">{money(row.amountApplied,canonical.document.currency)}</td></tr>):<tr><td colSpan={4} className="p-4 text-center text-sm text-slate-500">No invoice allocations are linked to this receipt.</td></tr>}</tbody>
     </table>
    </div>
   </section>

   <section className="px-6 pb-6 sm:px-8">
    <div className="flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
     <div><p className="text-xs font-extrabold uppercase tracking-[0.14em] text-amber-900">Customer Ledger Balance</p><p className="mt-1 text-xs text-amber-800">Current customer outstanding balance after this receipt</p></div>
     <p className="text-xl font-extrabold tabular-nums text-amber-900">{money(outstanding,ledgerCurrency)}</p>
    </div>
   </section>

   <section className="px-6 pb-6 sm:px-8 print:hidden">
    <a href={pdf} className="inline-flex w-full items-center justify-center rounded-xl bg-violet-600 px-5 py-4 font-semibold text-white hover:bg-violet-700 sm:w-auto">Download Official PDF</a>
    <p className="mt-3 text-xs text-slate-500">This receipt link is time-limited and can be revoked by the business.</p>
   </section>
   <footer className="border-t border-slate-200 bg-slate-50 px-6 py-5 text-center text-xs text-slate-500">
    <p className="font-medium text-slate-600">This is a computer-generated payment receipt and does not require signature.</p>
    <div className="mt-3 flex items-center justify-center gap-2 border-t border-slate-200 pt-3"><span className="inline-grid h-4 w-4 place-items-center rounded bg-violet-600 text-[9px] font-black text-white">M</span><span><strong className="text-violet-600">Powered by Moneymatters FinOps</strong> | mm.nilanga.in</span></div>
   </footer>
  </article>
 </main>;
}
