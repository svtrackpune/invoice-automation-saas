'use client';

import { useEffect } from 'react';

type Props = {
  invoiceId: string;
  invoiceNumber?: string;
  isCashBill?: boolean;
  documentKind?: 'invoice' | 'cash_bill';
  amountPaid?: number;
  onClose: () => void;
};

export default function InvoiceEditModal({ invoiceId, invoiceNumber, isCashBill, documentKind = isCashBill ? 'cash_bill' : 'invoice', amountPaid = 0, onClose }: Props) {
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === 'moneymatters:transaction-updated' && String(event.data?.id) === String(invoiceId)) onClose();
    };
    window.addEventListener('message', onMessage);
    return () => { document.body.style.overflow = previous; window.removeEventListener('message', onMessage); };
  }, [invoiceId, onClose]);

  return (
    <div className="fixed inset-0 z-[200] bg-slate-950/55 p-2 backdrop-blur-[2px] sm:p-4" role="dialog" aria-modal="true" aria-label={documentKind === 'cash_bill' ? 'Edit Cash Bill' : 'Edit invoice'}>
      <div className="mx-auto flex h-full max-w-[1500px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-[.16em] text-violet-600">Correction</span>
              {documentKind === 'cash_bill' && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 ring-1 ring-amber-200">Cash Bill</span>}
              {amountPaid > 0 && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 ring-1 ring-emerald-200">Payment recorded</span>}
            </div>
            <h2 className="truncate text-base font-semibold text-slate-900">Edit {invoiceNumber || (documentKind === 'cash_bill' ? 'Cash Bill' : 'invoice')}</h2>
            <p className="text-xs text-slate-500">Correct the existing document. The document number remains unchanged.</p>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Close</button>
        </header>
        <div className="min-h-0 flex-1 bg-[#f7f6fb]">
          <iframe
            title={`Edit ${invoiceNumber || 'invoice'}`}
            src={`/next-workspace/invoices/new?edit=${encodeURIComponent(invoiceId)}&embedded=1${documentKind === 'cash_bill' ? '&cash_bill=1' : ''}`}
            className="h-full w-full border-0"
          />
        </div>
      </div>
    </div>
  );
}
