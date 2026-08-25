'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import DocumentViewer from './DocumentViewer';

export default function DocumentReviewCenter({ type, id }: { type: string; id: string }) {
  const [status, setStatus] = useState<string>('loading');
  const [amountPaid, setAmountPaid] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    (async () => {
      if (!id) { if (active) setStatus('missing'); return; }
      const result = await supabase.from('invoices').select('status,amount_paid').eq('id', id).maybeSingle();
      if (!active) return;
      if (result.error) { setError(result.error.message); setStatus('error'); return; }
      setStatus(result.data?.status || 'missing');
      setAmountPaid(Number(result.data?.amount_paid || 0));
    })();
    return () => { active = false; };
  }, [id]);

  const draft = type === 'invoice' && status === 'draft';
  const voidable = type === 'invoice' && !draft && !['void','paid'].includes(status) && amountPaid <= 0;

  const edit = () => { if (draft && id) location.href = `/next-workspace/invoices/new?edit=${encodeURIComponent(id)}`; };
  const back = () => { location.href = type === 'invoice' ? '/next-workspace/invoices' : '/next-workspace'; };
  const finalize = async () => {
    if (!draft || !id) return;
    setBusy(true); setError(''); setNotice('');
    const result = await supabase.rpc('post_invoice', { p_invoice_id: id, p_location_id: null });
    if (result.error) { setError(result.error.message); setBusy(false); return; }
    setStatus('sent'); setNotice('Invoice finalized and posted. Accounting impact has been created.'); setBusy(false);
    setTimeout(() => { location.href = '/next-workspace/invoices'; }, 700);
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
    {type === 'invoice' && <div className="fixed inset-x-0 bottom-0 z-[80] border-t border-slate-200 bg-white/95 px-4 py-3 shadow-[0_-10px_40px_rgba(15,23,42,.12)] backdrop-blur sm:px-6"><div className="mx-auto flex max-w-6xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><div className="text-sm font-semibold text-slate-900">{draft ? 'Review invoice before posting' : status === 'void' ? 'Invoice voided' : 'Invoice'}</div><div className="text-xs text-slate-500">{draft ? 'Check customer, items, quantities, GST, totals, payment details and the final layout. Nothing affects the ledger until you finalize the invoice.' : status === 'void' ? 'This invoice is permanently void in the accounting history.' : 'Posted accounting transactions are not editable. Use Void only when the invoice has no payment and needs to be cancelled.'}</div>{error&&<div className="mt-1 text-xs font-medium text-red-600">{error}</div>}{notice&&<div className="mt-1 text-xs font-medium text-emerald-600">{notice}</div>}</div><div className="flex shrink-0 gap-2"><button type="button" onClick={back} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">Back</button>{draft&&<button type="button" onClick={edit} disabled={busy} className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-2.5 text-sm font-semibold text-violet-700 hover:bg-violet-100 disabled:opacity-50">Edit Invoice</button>}{draft&&<button type="button" onClick={finalize} disabled={busy} className="rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50">{busy?'Posting…':'Finalize & Post'}</button>}{voidable&&<button type="button" onClick={voidInvoice} disabled={busy} className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50">{busy?'Voiding…':'Void Invoice'}</button>}</div></div></div>}
  </div>;
}
