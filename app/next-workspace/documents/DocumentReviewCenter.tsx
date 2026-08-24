'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import DocumentViewer from './DocumentViewer';

export default function DocumentReviewCenter({ type, id }: { type: string; id: string }) {
  const [status, setStatus] = useState<string>('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    (async () => {
      if (!id) {
        if (active) setStatus('missing');
        return;
      }
      const result = await supabase.from('invoices').select('status').eq('id', id).maybeSingle();
      if (!active) return;
      if (result.error) {
        setError(result.error.message);
        setStatus('error');
        return;
      }
      setStatus(result.data?.status || 'missing');
    })();
    return () => { active = false; };
  }, [id]);

  const edit = () => {
    if (type !== 'invoice' || !id) return;
    location.href = `/next-workspace/invoices/new?edit=${encodeURIComponent(id)}`;
  };

  const back = () => {
    location.href = type === 'invoice' ? '/next-workspace/invoices' : '/next-workspace';
  };

  const save = async () => {
    if (type !== 'invoice' || !id || status !== 'draft') return;
    setBusy(true);
    setError('');
    setNotice('');
    const result = await supabase.rpc('post_invoice', { p_invoice_id: id, p_location_id: null });
    if (result.error) {
      setError(result.error.message);
      setBusy(false);
      return;
    }
    setStatus('sent');
    setNotice('Invoice saved and posted successfully.');
    setBusy(false);
    setTimeout(() => { location.href = '/next-workspace/invoices'; }, 500);
  };

  const draft = type === 'invoice' && status === 'draft';

  return (
    <div className="relative min-h-screen">
      <DocumentViewer type={type} id={id} />

      {type === 'invoice' && (
        <div className="fixed inset-x-0 bottom-0 z-[80] border-t border-slate-200 bg-white/95 px-4 py-3 shadow-[0_-10px_40px_rgba(15,23,42,.12)] backdrop-blur sm:px-6">
          <div className="mx-auto flex max-w-6xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-900">Review invoice before saving</div>
              <div className="text-xs text-slate-500">Check customer, items, quantities, GST, totals, payment details and the final layout.</div>
              {error && <div className="mt-1 text-xs font-medium text-red-600">{error}</div>}
              {notice && <div className="mt-1 text-xs font-medium text-emerald-600">{notice}</div>}
            </div>
            <div className="flex shrink-0 gap-2">
              <button type="button" onClick={back} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                Back
              </button>
              <button type="button" onClick={edit} disabled={!id || busy || status === 'missing'} className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-2.5 text-sm font-semibold text-violet-700 hover:bg-violet-100 disabled:opacity-50">
                Edit Invoice
              </button>
              <button type="button" onClick={save} disabled={!draft || busy} className="rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50">
                {busy ? 'Saving…' : 'Save Invoice'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
