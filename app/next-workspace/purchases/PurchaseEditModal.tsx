'use client';

import { useEffect } from 'react';

export default function PurchaseEditModal({ billId, billNumber, onClose }: { billId: string; billNumber?: string; onClose: () => void }) {
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === 'moneymatters:transaction-updated' && String(event.data?.id) === String(billId)) onClose();
    };
    window.addEventListener('message', onMessage);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('message', onMessage);
    };
  }, [billId, onClose]);

  return (
    <div className="fixed inset-0 z-[200] bg-slate-950/55 p-2 backdrop-blur-[2px] sm:p-4" role="dialog" aria-modal="true" aria-label="Correct purchase bill">
      <div className="mx-auto flex h-full max-w-[1500px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <span className="text-[10px] font-bold uppercase tracking-[.16em] text-violet-600">Correction</span>
            <h2 className="truncate text-base font-semibold text-slate-900">Edit {billNumber || 'purchase bill'}</h2>
            <p className="text-xs text-slate-500">The bill number remains unchanged; posted accounting and inventory are synchronized with the corrected bill.</p>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Close</button>
        </header>
        <div className="min-h-0 flex-1 bg-[#f7f6fb]">
          <iframe title={`Edit ${billNumber || 'purchase bill'}`} src={`/next-workspace/purchases/new?edit=${encodeURIComponent(billId)}&embedded=1`} className="h-full w-full border-0" />
        </div>
      </div>
    </div>
  );
}
