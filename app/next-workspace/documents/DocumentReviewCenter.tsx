'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import QRCode from 'qrcode';
import DocumentViewer from './DocumentViewer';
import InvoiceEditModal from '../invoices/InvoiceEditModal';
import QuotationEditModal from '../quotation/QuotationEditModal';
import Transaction360Panel from './Transaction360Panel';

export default function DocumentReviewCenter({ type, id }: { type: string; id: string }) {
  const [status, setStatus] = useState<string>('loading');
  const [amountPaid, setAmountPaid] = useState(0);
  const [paymentMode, setPaymentMode] = useState<'none'|'bank'|'online'>('none');
  const [quotationToken, setQuotationToken] = useState('');
  const [quotationNumber, setQuotationNumber] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [documentKind, setDocumentKind] = useState<'invoice' | 'cash_bill'>('invoice');
  const [busy, setBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [quotationEditOpen, setQuotationEditOpen] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    (async () => {
      if (!id) { if (active) setStatus('missing'); return; }
      const context = await supabase.rpc('get_my_business_context');
      if (context.error || !context.data?.[0]?.business_id) {
        if (active) { setError(context.error?.message || 'Business context not found.'); setStatus('error'); }
        return;
      }
      const businessId = context.data[0].business_id;
      if (type === 'quotation') {
        const result = await supabase.from('quotations').select('status,quotation_number,public_accept_token').eq('id', id).eq('business_id', businessId).maybeSingle();
        if (!active) return;
        if (result.error) { setError(result.error.message); setStatus('error'); return; }
        setStatus(result.data?.status || 'missing');
        setQuotationToken(result.data?.public_accept_token || '');
        setQuotationNumber(String(result.data?.quotation_number || ''));
        if (new URLSearchParams(window.location.search).get('edit') === '1' && ['draft','sent'].includes(String(result.data?.status))) setQuotationEditOpen(true);
        return;
      }
      const result = await supabase.from('invoices').select('invoice_number,document_kind,status,amount_paid,payment_display_mode,payment_link,payment_qr_payload').eq('id', id).eq('business_id', businessId).maybeSingle();
      if (!active) return;
      if (result.error) { setError(result.error.message); setStatus('error'); return; }
      setStatus(result.data?.status || 'missing');
      setAmountPaid(Number(result.data?.amount_paid || 0));
      setPaymentMode((result.data?.payment_display_mode || 'none') as 'none'|'bank'|'online');
      setInvoiceNumber(String(result.data?.invoice_number || ''));
      setDocumentKind(result.data?.document_kind === 'cash_bill' ? 'cash_bill' : 'invoice');
      if (new URLSearchParams(window.location.search).get('edit') === '1' && result.data?.status !== 'void') setEditOpen(true);
    })();
    return () => { active = false; };
  }, [id, type]);

  useEffect(() => {
    if (type !== 'quotation' || !quotationToken) return;
    const publicUrl = `${window.location.origin}/quote/${encodeURIComponent(quotationToken)}`;
    const install = () => {
      const paper = document.querySelector('.paper') as HTMLElement | null;
      if (!paper) return false;
      let payment = paper.querySelector('.quotation-acceptance-payment') as HTMLElement | null;
      if (!payment) payment = paper.querySelector('.payment') as HTMLElement | null;
      if (!payment) {
        payment = document.createElement('section');
        const signature = paper.querySelector('.signature-row');
        const footer = paper.querySelector('footer');
        if (signature) paper.insertBefore(payment, signature); else if (footer) paper.insertBefore(payment, footer); else paper.appendChild(payment);
      }
      payment.className = 'payment online-payment quotation-acceptance-payment';
      payment.innerHTML = `<div class="online-payment-column"><div><label>QUOTATION</label><strong>Accept this quotation</strong><span>Review the estimate and confirm acceptance.</span><div><a href="${publicUrl}" target="_blank" rel="noreferrer">Accept Quotation</a></div></div></div>`;
      return true;
    };
    if (install()) return;
    const observer = new MutationObserver(() => { if (install()) observer.disconnect(); });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [type, quotationToken]);

  useEffect(() => {
    if (type !== 'invoice' || paymentMode !== 'online') return;
    let active = true;
    const load = async () => {
      const result = await supabase.from('invoices').select('payment_link,payment_qr_payload,balance_due').eq('id', id).maybeSingle();
      if (!active) return;
      const link = String(result.data?.payment_link || '').trim();
      const qrPayload = String(result.data?.payment_qr_payload || link).trim();
      let qr = '';
      if (qrPayload) { try { qr = await QRCode.toDataURL(qrPayload, { width: 180, margin: 1, errorCorrectionLevel: 'M' }); } catch { qr = ''; } }
      const install = () => {
        const paper = document.querySelector('.paper') as HTMLElement | null;
        if (!paper) return false;
        let payment = paper.querySelector('.invoice-online-payment') as HTMLElement | null;
        if (!payment) payment = paper.querySelector('.payment') as HTMLElement | null;
        if (!payment) {
          payment = document.createElement('section');
          const signature = paper.querySelector('.signature-row');
          const footer = paper.querySelector('footer');
          if (signature) paper.insertBefore(payment, signature); else if (footer) paper.insertBefore(payment, footer); else paper.appendChild(payment);
        }
        payment.className = 'payment online-payment invoice-online-payment';
        const balance = Number(result.data?.balance_due || 0);
        const button = link ? `<div><a href="${link}" target="_blank" rel="noreferrer">Pay Now</a></div>` : `<div><span class="payment-pending">Pay Now will activate after the invoice is finalized.</span></div>`;
        const qrHtml = qr ? `<div class="qr"><img src="${qr}" alt="Payment QR" /></div>` : `<div class="qr qr-pending"><span>QR</span></div>`;
        payment.innerHTML = `<div class="online-payment-column"><div><label>PAYMENT OPTIONS</label><strong>Pay Now + QR</strong><span>Amount due: ${balance.toFixed(2)}</span>${button}</div>${qrHtml}</div>`;
        return true;
      };
      if (install()) return;
      const observer = new MutationObserver(() => { if (install()) observer.disconnect(); });
      observer.observe(document.body, { childList: true, subtree: true });
      window.setTimeout(() => observer.disconnect(), 3000);
    };
    void load();
    return () => { active = false; };
  }, [id, type, paymentMode]);

  const quotationEditable = type === 'quotation' && ['draft','sent'].includes(status);
  const draft = type === 'invoice' && status === 'draft';
  const editable = type === 'invoice' && status !== 'void' && status !== 'missing' && status !== 'error';
  const voidable = type === 'invoice' && !draft && !['void','paid'].includes(status) && amountPaid <= 0;
  const openEdit = () => { if (editable && id) { setError(''); setNotice(''); setEditOpen(true); } };
  const closeEdit = () => { setEditOpen(false); window.location.reload(); };
  const back = () => { location.href = type === 'invoice' ? '/next-workspace/invoices' : '/next-workspace'; };
  const generatePaymentLink = async () => {
    if (!id || type !== 'invoice' || paymentMode !== 'online' || draft) return;
    setBusy(true); setError(''); setNotice('');
    const link = await supabase.functions.invoke('create-payment-link', { body: { invoice_id: id } });
    if (link.error || link.data?.error) { setError(link.error?.message || link.data?.error || 'Unable to create payment link.'); setBusy(false); return false; }
    setNotice('Payment link and QR are ready on the invoice.'); setBusy(false); return true;
  };
  const finalize = async () => {
    if (!draft || !id) return;
    setBusy(true); setError(''); setNotice('');
    const result = await supabase.rpc('post_invoice', { p_invoice_id: id, p_location_id: null });
    if (result.error) { setError(result.error.message); setBusy(false); return; }
    setStatus('sent');
    if (paymentMode === 'online') {
      const link = await supabase.functions.invoke('create-payment-link', { body: { invoice_id: id } });
      if (link.error || link.data?.error) { setError(link.error?.message || link.data?.error || 'Invoice posted, but the payment link could not be created.'); setNotice('Invoice finalized and posted. Payment link generation can be retried below.'); setBusy(false); return; }
      setNotice('Invoice finalized and posted. Payment link and QR are ready.');
    } else setNotice('Invoice finalized and posted. Accounting impact has been created.');
    setBusy(false);
    setTimeout(() => { location.href = '/next-workspace/invoices'; }, 1000);
  };
  const voidInvoice = async () => {
    if (!voidable || !id) return;
    const reason = window.prompt('Reason for voiding this invoice:', 'Cancelled by business');
    if (reason === null) return;
    setBusy(true); setError(''); setNotice('');
    const result = await supabase.rpc('void_invoice', { p_invoice_id: id, p_reason: reason.trim() || 'Cancelled by business' });
    if (result.error) { setError(result.error.message); setBusy(false); return; }
    setStatus('void'); setNotice('Invoice voided. A reversing accounting entry was created and inventory was restored where applicable.'); setBusy(false);
    setTimeout(() => { location.href = '/next-workspace/invoices'; }, 900);
  };

  return <div className="relative min-h-screen">
    <DocumentViewer type={type} id={id} />
    {type === 'invoice' && <div className="fixed inset-x-0 bottom-0 z-[80] border-t border-slate-200 bg-white/95 px-4 py-3 shadow-[0_-10px_40px_rgba(15,23,42,.12)] backdrop-blur sm:px-6"><div className="mx-auto flex max-w-6xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><div className="text-sm font-semibold text-slate-900">{draft ? 'Review invoice before posting' : status === 'void' ? 'Invoice voided' : documentKind === 'cash_bill' ? 'Cash Bill correction' : 'Invoice correction'}</div><div className="text-xs text-slate-500">{draft ? 'Check customer, items, quantities, GST, totals, payment details and the final layout. Nothing affects the ledger until you finalize the invoice.' : status === 'void' ? 'This invoice is permanently void in the accounting history.' : documentKind === 'cash_bill' ? 'Correct the existing counter sale. The bill number stays unchanged and its settlement payment and receipt are synchronized with the corrected total.' : 'Correct any manual mistake from the existing document. The invoice number stays unchanged and the accounting history is amended with a controlled reversal and repost.'}</div>{error&&<div className="mt-1 text-xs font-medium text-red-600">{error}</div>}{notice&&<div className="mt-1 text-xs font-medium text-emerald-600">{notice}</div>}</div><div className="flex shrink-0 gap-2"><button type="button" onClick={back} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">Back</button>{editable&&<button type="button" onClick={openEdit} disabled={busy} className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-2.5 text-sm font-semibold text-violet-700 hover:bg-violet-100 disabled:opacity-50">{documentKind === 'cash_bill' ? 'Edit Cash Bill' : 'Edit Invoice'}</button>}{draft&&<button type="button" onClick={finalize} disabled={busy} className="rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50">{busy?'Posting…':'Finalize & Post'}</button>}{!draft&&paymentMode==='online'&&status!=='void'&&<button type="button" onClick={generatePaymentLink} disabled={busy} className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-2.5 text-sm font-semibold text-violet-700 hover:bg-violet-100 disabled:opacity-50">{busy?'Generating…':'Generate Payment Link'}</button>}{voidable&&<button type="button" onClick={voidInvoice} disabled={busy} className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50">{busy?'Voiding…':'Void Invoice'}</button>}</div></div></div>}
    {(type === 'invoice' || type === 'quotation') && <Transaction360Panel entityType={type === 'invoice' ? documentKind : 'quotation'} entityId={id} />}
    {editOpen && <InvoiceEditModal invoiceId={id} invoiceNumber={invoiceNumber} documentKind={documentKind} amountPaid={amountPaid} onClose={closeEdit} />}
    {quotationEditOpen && <QuotationEditModal quotationId={id} quotationNumber={quotationNumber} onClose={()=>{setQuotationEditOpen(false);window.location.reload();}} />}
    {type === 'quotation' && <div className="fixed inset-x-0 bottom-0 z-[80] border-t border-slate-200 bg-white/95 px-4 py-3 shadow-[0_-10px_40px_rgba(15,23,42,.12)] backdrop-blur sm:px-6"><div className="mx-auto flex max-w-6xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div><div className="text-sm font-semibold text-slate-900">{quotationEditable?'Quotation correction':'Quotation history'}</div><div className="text-xs text-slate-500">{quotationEditable?'Correct this estimate inside the current document context. Accepted or converted estimates are protected from mutation.':'Accepted/converted estimate history is preserved; create a new revision when the commercial terms must change.'}</div>{error&&<div className="mt-1 text-xs font-medium text-red-600">{error}</div>}</div><div className="flex shrink-0 gap-2"><button type="button" onClick={back} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">Back</button>{quotationEditable&&<button type="button" onClick={()=>setQuotationEditOpen(true)} className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-2.5 text-sm font-semibold text-violet-700 hover:bg-violet-100">Edit Quotation</button>}</div></div></div>}
  </div>;
}
