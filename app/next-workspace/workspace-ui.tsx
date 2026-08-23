'use client';

import { useEffect, useState } from 'react';

export function LoadingState({ label = 'Loading workspace…' }: { label?: string }) {
  return <div className="grid min-h-[240px] place-items-center text-sm text-slate-500" role="status">{label}</div>;
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-900">
    <b className="block">Something needs attention</b>
    <span className="mt-1 block text-rose-700">{message}</span>
    {onRetry && <button onClick={onRetry} className="mt-3 rounded-lg bg-white px-3 py-2 text-xs font-semibold text-rose-800 ring-1 ring-rose-200">Try again</button>}
  </div>;
}

export function EmptyState({ title, description, action, onAction }: { title: string; description: string; action?: string; onAction?: () => void }) {
  return <div className="grid min-h-[240px] place-items-center p-8 text-center">
    <div className="max-w-sm">
      <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-violet-50 text-violet-700">＋</div>
      <h3 className="mt-4 font-semibold text-slate-900">{title}</h3>
      <p className="mt-1 text-sm leading-6 text-slate-500">{description}</p>
      {action && onAction && <button onClick={onAction} className="mt-4 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white">{action}</button>}
    </div>
  </div>;
}

export function ExplainNumber({ label, value, explanation }: { label: string; value: string; explanation: string }) {
  const [open, setOpen] = useState(false);
  return <>
    <button onClick={() => setOpen(true)} className="text-left" aria-label={`Explain ${label}`}>
      <span className="block text-xs font-semibold text-slate-500">{label}</span>
      <span className="mt-2 block text-2xl font-semibold tracking-tight text-slate-950">{value}</span>
      <span className="mt-1 block text-[11px] font-medium text-violet-700">Explain this number</span>
    </button>
    {open && <div className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/30 p-4" onMouseDown={() => setOpen(false)}>
      <section role="dialog" aria-modal="true" aria-label={`Explanation for ${label}`} onMouseDown={event => event.stopPropagation()} className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4"><div><p className="text-[10px] font-bold uppercase tracking-[.16em] text-violet-600">Business meaning</p><h2 className="mt-1 text-lg font-semibold">{label}</h2></div><button onClick={() => setOpen(false)} className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-100">×</button></div>
        <p className="mt-4 text-sm leading-6 text-slate-600">{explanation}</p>
      </section>
    </div>}
  </>;
}

export function useCommandShortcut(open: () => void) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); open(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);
}
