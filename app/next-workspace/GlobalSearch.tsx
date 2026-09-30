'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase, type BusinessContext } from '@/lib/supabase';
import { SearchInput } from '@/components/moneymatters';

type Result = { id: string; title: string; subtitle: string; kind: string; href: string };

const kindLabel: Record<string, string> = {
  customer: 'Customer',
  invoice: 'Invoice',
  quotation: 'Estimate',
  receipt: 'Receipt',
  product: 'Product / Service',
  vendor: 'Vendor',
};

export default function GlobalSearch() {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const [businessId, setBusinessId] = useState('');
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      const r = await supabase.rpc('get_my_business_context');
      const rows = (r.data || []) as BusinessContext[];
      const saved = localStorage.getItem('moneymatters.activeBusinessId');
      const active = rows.find(x => x.business_id === saved) || rows[0];
      if (active) setBusinessId(active.business_id);
    })();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        root.current?.querySelector('input')?.focus();
        setOpen(true);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  useEffect(() => {
    const term = q.trim();
    if (!businessId || term.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }

    const timer = window.setTimeout(async () => {
      setLoading(true);
      const pattern = `%${term}%`;

      const [customers, invoices, estimates, receipts, products, vendors] = await Promise.all([
        supabase
          .from('customers')
          .select('id,display_name,phone,email')
          .eq('business_id', businessId)
          .eq('is_active', true)
          .or(`display_name.ilike.${pattern},phone.ilike.${pattern},email.ilike.${pattern}`)
          .limit(8),
        supabase
          .from('invoices')
          .select('id,invoice_number,total,status,customer_id')
          .eq('business_id', businessId)
          .or(`invoice_number.ilike.${pattern},status.ilike.${pattern}`)
          .order('created_at', { ascending: false })
          .limit(8),
        supabase
          .from('quotations')
          .select('id,quotation_number,total,status,customer_id')
          .eq('business_id', businessId)
          .or(`quotation_number.ilike.${pattern},status.ilike.${pattern}`)
          .order('created_at', { ascending: false })
          .limit(8),
        supabase
          .from('receipts')
          .select('id,receipt_number,amount,payment_method,reference_number,customer_id')
          .eq('business_id', businessId)
          .or(`receipt_number.ilike.${pattern},payment_method.ilike.${pattern},reference_number.ilike.${pattern}`)
          .order('created_at', { ascending: false })
          .limit(8),
        supabase
          .from('products_services')
          .select('id,name,sku,item_type')
          .eq('business_id', businessId)
          .eq('is_active', true)
          .or(`name.ilike.${pattern},sku.ilike.${pattern}`)
          .limit(8),
        supabase
          .from('vendors')
          .select('id,name,phone,email')
          .eq('business_id', businessId)
          .eq('is_active', true)
          .or(`name.ilike.${pattern},phone.ilike.${pattern},email.ilike.${pattern}`)
          .limit(8),
      ]);

      const out: Result[] = [];
      const customerRows = (customers.data || []) as any[];
      const customerIds = new Set(customerRows.map(x => x.id));
      const customerName = new Map(customerRows.map(x => [x.id, x.display_name]));

      customerRows.forEach(x => out.push({
        id: x.id,
        title: x.display_name,
        subtitle: x.phone || x.email || 'Customer',
        kind: 'customer',
        href: `/next-workspace/customers/${x.id}`,
      }));

      (invoices.data || []).forEach((x: any) => out.push({
        id: x.id,
        title: x.invoice_number || 'Invoice',
        subtitle: `${x.status || 'Invoice'} · ${customerName.get(x.customer_id) || 'Customer'} · ₹${Number(x.total || 0).toLocaleString('en-IN')}`,
        kind: 'invoice',
        href: `/next-workspace/documents/library?type=invoice&q=${encodeURIComponent(x.invoice_number || '')}`,
      }));

      (estimates.data || []).forEach((x: any) => out.push({
        id: x.id,
        title: x.quotation_number || 'Estimate',
        subtitle: `${x.status || 'Estimate'} · ${customerName.get(x.customer_id) || 'Customer'} · ₹${Number(x.total || 0).toLocaleString('en-IN')}`,
        kind: 'quotation',
        href: `/next-workspace/documents/library?type=quotation&q=${encodeURIComponent(x.quotation_number || '')}`,
      }));

      (receipts.data || []).forEach((x: any) => out.push({
        id: x.id,
        title: x.receipt_number || 'Receipt',
        subtitle: `${x.payment_method || 'Payment'} · ${customerName.get(x.customer_id) || 'Customer'} · ₹${Number(x.amount || 0).toLocaleString('en-IN')}`,
        kind: 'receipt',
        href: `/next-workspace/documents/library?type=receipt&q=${encodeURIComponent(x.receipt_number || '')}`,
      }));

      (products.data || []).forEach((x: any) => out.push({
        id: x.id,
        title: x.name,
        subtitle: x.sku || x.item_type || 'Product / Service',
        kind: 'product',
        href: '/next-workspace/items',
      }));

      (vendors.data || []).forEach((x: any) => out.push({
        id: x.id,
        title: x.name,
        subtitle: x.phone || x.email || 'Vendor',
        kind: 'vendor',
        href: '/next-workspace/vendors',
      }));

      // When a customer name/phone was searched, also surface that customer's documents.
      if (customerIds.size) {
        const ids = Array.from(customerIds);
        const [customerInvoices, customerEstimates, customerReceipts] = await Promise.all([
          supabase.from('invoices').select('id,invoice_number,total,status,customer_id').eq('business_id', businessId).in('customer_id', ids).order('created_at', { ascending: false }).limit(8),
          supabase.from('quotations').select('id,quotation_number,total,status,customer_id').eq('business_id', businessId).in('customer_id', ids).order('created_at', { ascending: false }).limit(8),
          supabase.from('receipts').select('id,receipt_number,amount,payment_method,customer_id').eq('business_id', businessId).in('customer_id', ids).order('created_at', { ascending: false }).limit(8),
        ]);
        const existing = new Set(out.map(x => `${x.kind}:${x.id}`));
        (customerInvoices.data || []).forEach((x: any) => { const key = `invoice:${x.id}`; if (!existing.has(key)) out.push({ id: x.id, title: x.invoice_number || 'Invoice', subtitle: `${x.status || 'Invoice'} · ${customerName.get(x.customer_id) || 'Customer'} · ₹${Number(x.total || 0).toLocaleString('en-IN')}`, kind: 'invoice', href: `/next-workspace/documents/library?type=invoice&q=${encodeURIComponent(x.invoice_number || '')}` }); });
        (customerEstimates.data || []).forEach((x: any) => { const key = `quotation:${x.id}`; if (!existing.has(key)) out.push({ id: x.id, title: x.quotation_number || 'Estimate', subtitle: `${x.status || 'Estimate'} · ${customerName.get(x.customer_id) || 'Customer'} · ₹${Number(x.total || 0).toLocaleString('en-IN')}`, kind: 'quotation', href: `/next-workspace/documents/library?type=quotation&q=${encodeURIComponent(x.quotation_number || '')}` }); });
        (customerReceipts.data || []).forEach((x: any) => { const key = `receipt:${x.id}`; if (!existing.has(key)) out.push({ id: x.id, title: x.receipt_number || 'Receipt', subtitle: `${x.payment_method || 'Payment'} · ${customerName.get(x.customer_id) || 'Customer'} · ₹${Number(x.amount || 0).toLocaleString('en-IN')}`, kind: 'receipt', href: `/next-workspace/documents/library?type=receipt&q=${encodeURIComponent(x.receipt_number || '')}` }); });
      }

      setResults(out.slice(0, 30));
      setLoading(false);
    }, 180);

    return () => window.clearTimeout(timer);
  }, [q, businessId]);

  const go = (href: string) => {
    setOpen(false);
    setQ('');
    window.location.href = href;
  };

  return (
    <div ref={root} className="relative w-full">
      <SearchInput
        value={q}
        onChange={e => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="Search customers, invoices, estimates, receipts, products…"
        aria-label="Global search"
      />
      {open && (q.trim().length >= 2 || loading) && (
        <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-[80] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
            <span className="text-[10px] font-bold uppercase tracking-[.16em] text-slate-400">Global search</span>
            <kbd className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-400">Esc</kbd>
          </div>
          {loading ? <div className="p-5 text-sm text-slate-400">Searching…</div> : results.length ? (
            <div className="max-h-[420px] overflow-y-auto p-2">
              {results.map((r, i) => (
                <button key={`${r.kind}-${r.id}-${i}`} type="button" onClick={() => go(r.href)} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-200">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-violet-50 text-xs font-bold text-violet-700">{kindLabel[r.kind].slice(0, 1)}</span>
                  <span className="min-w-0 flex-1"><b className="block truncate text-sm text-slate-800">{r.title}</b><span className="block truncate text-xs text-slate-400">{r.subtitle}</span></span>
                  <span className="text-[10px] font-semibold text-slate-400">{kindLabel[r.kind]}</span>
                </button>
              ))}
            </div>
          ) : <div className="p-5 text-sm text-slate-400">No matching customers, invoices, estimates, receipts, products or vendors.</div>}
          <div className="border-t border-slate-100 px-4 py-2 text-[10px] text-slate-400">Search by name, phone, email, document number, status, SKU or payment reference · Ctrl/⌘ + K to focus.</div>
        </div>
      )}
    </div>
  );
}
