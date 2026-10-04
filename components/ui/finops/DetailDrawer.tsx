'use client';

import { useEffect, useId } from 'react';
import type { ReactNode } from 'react';

export type DetailDrawerProps = {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
};

export default function DetailDrawer({ open, title, description, onClose, children, footer }: DetailDrawerProps) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[120] flex justify-end bg-slate-950/25 backdrop-blur-[1px]" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className="flex h-full w-full max-w-xl flex-col border-l border-slate-200 bg-white shadow-2xl" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="truncate text-base font-bold text-slate-900">{title}</h2>
            {description ? <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p> : null}
          </div>
          <button type="button" onClick={onClose} aria-label="Close drawer" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700">×</button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
        {footer ? <footer className="shrink-0 border-t border-slate-100 bg-slate-50/80 px-5 py-3">{footer}</footer> : null}
      </aside>
    </div>
  );
}
