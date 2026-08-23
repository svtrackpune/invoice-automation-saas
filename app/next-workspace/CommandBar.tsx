'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useWorkspace } from '@/lib/workspace-context';
import { useCommandShortcut } from './workspace-ui';

type Result = { id: string; title: string; subtitle: string; href: string; kind: string };

export default function CommandBar() {
  const { business } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [busy, setBusy] = useState(false);
  useCommandShortcut(() => setOpen(true));

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => document.getElementById('workspace-command-input')?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!business || query.trim().length < 2) { setResults([]); return; }
    let alive = true;
    const timer = window.setTimeout(async () => {
      setBusy(true);
      const q = query.trim().replace(/[%_,]/g, ' ');
      const [customers, invoices, products] = await Promise.all([
        supabase.from('customers').select('id,display_name,email').eq('business_id', business.business_id).eq('is_active', true).ilike('display_name', `%${q}%`).limit(5),
        supabase.from('invoices').select('id,invoice_number,invoice_date').eq('business_id', business.business_id).ilike('invoice_number', `%${q}%`).limit(5),
        supabase.from('products_services').select('id,name,sku').eq('business_id', business.business_id).eq('is_active', true).ilike('name', `%${q}%`).limit(5),
      ]);
      if (!alive) return;
      setResults([
        ...(customers.data || []).map(x => ({ id: x.id, title: x.display_name, subtitle: x.email || 'Customer', href: `/next-workspace/customers/${x.id}`, kind: 'Customer' })),
        ...(invoices.data || []).map(x => ({ id: x.id, title: x.invoice_number, subtitle: `Invoice · ${x.invoice_date}`, href: '/next-workspace/invoices', kind: 'Invoice' })),
        ...(products.data || []).map(x => ({ id: x.id, title: x.name, subtitle: x.sku ? `Product · ${x.sku}` : 'Product / service', href: '/next-workspace/items', kind: 'Product' })),
      ]);
      setBusy(false);
    }, 220);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [business, query]);

  if (!open) return <button onClick={() => setOpen(true)} className="hidden min-w-0 flex-1 md:flex" aria-label="Open universal search"><div className="mx-auto flex w-full max-w-xl items-center gap-2 rounded-xl border border-slate-200 bg-[#fbfaff] px-3 py-2 text-sm text-slate-400"><span>⌕</span><span className="flex-1 text-left">Search customers, invoices, products…</span><kbd className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[10px]">⌘K</kbd></div></button>;

  return <div className="fixed inset-0 z-[90] bg-slate-950/30 p-4 sm:p-10" onMouseDown={() => setOpen(false)}>
    <section onMouseDown={event => event.stopPropagation()} className="mx-auto w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
      <div className="flex items-center gap-3 border-b border-slate-100 px-4"><span className="text-slate-400">⌕</span><input id="workspace-command-input" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') setOpen(false); }} placeholder="Search anything…" className="min-w-0 flex-1 py-4 text-sm outline-none"/><kbd className="rounded-md border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-400">ESC</kbd></div>
      <div className="max-h-[55vh] overflow-y-auto p-2">
        {!query.trim() && <div className="p-6 text-center text-sm text-slate-500">Search customers, invoices or products.</div>}
        {busy && <div className="p-4 text-center text-xs text-slate-400">Searching…</div>}
        {!busy && query.trim() && !results.length && <div className="p-6 text-center text-sm text-slate-500">No matching records.</div>}
        {results.map(result => <button key={`${result.kind}-${result.id}`} onClick={() => { window.location.href = result.href; }} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left hover:bg-violet-50"><span className="grid h-9 w-9 place-items-center rounded-lg bg-violet-50 text-xs font-bold text-violet-700">{result.kind[0]}</span><span className="min-w-0 flex-1"><b className="block truncate text-sm">{result.title}</b><span className="text-xs text-slate-400">{result.subtitle}</span></span><span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{result.kind}</span></button>)}
      </div>
    </section>
  </div>;
}
