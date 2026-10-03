'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase, type BusinessContext } from '@/lib/supabase';
import { SearchInput } from '@/components/moneymatters';

type Result = {
  id: string;
  title: string;
  subtitle: string;
  kind: string;
  href: string;
  score?: number;
};

type NavResult = { id: string; title: string; subtitle: string; kind: 'navigation'; href: string; keywords: string };

type CustomerSearchRow = {
  id: string; display_name: string | null; legal_name: string | null; phone: string | null; email: string | null; tax_id: string | null;
};
type InvoiceSearchRow = {
  id: string; invoice_number: string | null; total: number | null; status: string | null; customer_id: string | null; created_at: string | null;
};
type QuotationSearchRow = {
  id: string; quotation_number: string | null; total: number | null; status: string | null; customer_id: string | null; created_at: string | null;
};
type ReceiptSearchRow = {
  id: string; receipt_number: string | null; amount: number | null; payment_method: string | null; reference_number: string | null; customer_id: string | null; created_at: string | null;
};
type PaymentSearchRow = {
  id: string; amount: number | null; method: string | null; reference: string | null; payment_date: string | null; customer_id: string | null; invoice_id: string | null; direction: string | null; created_at: string | null;
};
type ProductSearchRow = {
  id: string; name: string | null; sku: string | null; item_type: string | null; barcode: string | null; hsn_sac: string | null;
};
type VendorSearchRow = {
  id: string; display_name: string | null; legal_name: string | null; phone: string | null; email: string | null; tax_id: string | null;
};
type CustomerNameRow = Pick<CustomerSearchRow, 'id' | 'display_name' | 'legal_name'>;

const kindLabel: Record<string, string> = {
  navigation: 'Open', customer: 'Customer', invoice: 'Invoice', quotation: 'Estimate', receipt: 'Receipt', payment: 'Payment', product: 'Product / Service', vendor: 'Vendor',
};

const navigation: NavResult[] = [
  { id: 'dashboard', title: 'Dashboard', subtitle: 'Business cockpit', kind: 'navigation', href: '/next-workspace', keywords: 'home dashboard overview' },
  { id: 'invoices', title: 'Invoices', subtitle: 'Create and manage invoices', kind: 'navigation', href: '/next-workspace/invoices', keywords: 'invoice invoices billing sales bill' },
  { id: 'estimates', title: 'Estimates', subtitle: 'Create and manage estimates', kind: 'navigation', href: '/next-workspace/quotation', keywords: 'estimate estimates quotation quotations quote' },
  { id: 'customers', title: 'Customers', subtitle: 'Customer relationships and statements', kind: 'navigation', href: '/next-workspace/customers', keywords: 'customer customers clients contacts' },
  { id: 'products', title: 'Products & Services', subtitle: 'Items, pricing and catalogue', kind: 'navigation', href: '/next-workspace/items', keywords: 'product products service services items catalogue catalog' },
  { id: 'vendors', title: 'Vendors', subtitle: 'Suppliers and vendor records', kind: 'navigation', href: '/next-workspace/vendors', keywords: 'vendor vendors supplier suppliers purchase' },
  { id: 'purchases', title: 'Purchases & Bills', subtitle: 'Purchase bills and suppliers', kind: 'navigation', href: '/next-workspace/purchases', keywords: 'purchase purchases bill bills vendor suppliers' },
  { id: 'payments', title: 'Payments', subtitle: 'Customer payments and collection', kind: 'navigation', href: '/next-workspace/payments', keywords: 'payment payments collection collections received' },
  { id: 'receipts', title: 'Receipts', subtitle: 'Payment receipts', kind: 'navigation', href: '/next-workspace/receipts', keywords: 'receipt receipts payment voucher' },
  { id: 'banking', title: 'Banking', subtitle: 'Bank accounts and reconciliation', kind: 'navigation', href: '/next-workspace/banking', keywords: 'bank banking account accounts reconciliation transaction transactions' },
  { id: 'cash-bill', title: 'Cash Bill', subtitle: 'Counter sale / cash and UPI billing', kind: 'navigation', href: '/next-workspace/cash-bill', keywords: 'cash cash bill counter carry upi counter sale' },
  { id: 'inventory', title: 'Inventory', subtitle: 'Stock and inventory', kind: 'navigation', href: '/next-workspace/inventory', keywords: 'inventory stock stocks warehouse' },
  { id: 'expenses', title: 'Expenses', subtitle: 'Business expenses', kind: 'navigation', href: '/next-workspace/expenses', keywords: 'expense expenses spending' },
  { id: 'reports', title: 'Reports', subtitle: 'Financial and business reports', kind: 'navigation', href: '/next-workspace/reports', keywords: 'report reports profit loss pnl trial balance statement' },
  { id: 'accounting', title: 'Accounting', subtitle: 'Ledger and accounting controls', kind: 'navigation', href: '/next-workspace/accounting', keywords: 'accounting accounts ledger journal chart' },
  { id: 'tax', title: 'Tax & ITR', subtitle: 'Tax and filing tools', kind: 'navigation', href: '/next-workspace/tax', keywords: 'tax gst itr return returns' },
  { id: 'recurring', title: 'Recurring', subtitle: 'Recurring invoices and services', kind: 'navigation', href: '/next-workspace/recurring', keywords: 'recurring subscription repeat automatic' },
  { id: 'documents', title: 'Documents', subtitle: 'Document review and sharing', kind: 'navigation', href: '/next-workspace/documents', keywords: 'documents document library print pdf share' },
  { id: 'settings', title: 'Business Settings', subtitle: 'Business configuration', kind: 'navigation', href: '/next-workspace/business-settings', keywords: 'settings business configuration preferences' },
  { id: 'brand', title: 'Document Settings', subtitle: 'Brand, templates and document presentation', kind: 'navigation', href: '/next-workspace/brand', keywords: 'brand branding template templates logo document invoice' },
  { id: 'profile', title: 'My Profile', subtitle: 'Account profile', kind: 'navigation', href: '/next-workspace/profile', keywords: 'profile account user' },
];

const documentHref = (type: string, id: string) => `/next-workspace/documents?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`;

function escapeLike(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

function scoreText(term: string, ...values: Array<string | null | undefined>) {
  const q = term.toLowerCase();
  let score = 0;
  for (const value of values) {
    const text = String(value || '').toLowerCase();
    if (!text) continue;
    if (text === q) score = Math.max(score, 100);
    else if (text.startsWith(q)) score = Math.max(score, 80);
    else if (text.includes(q)) score = Math.max(score, 60);
  }
  return score;
}

export default function GlobalSearch() {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const [businessId, setBusinessId] = useState('');
  const root = useRef<HTMLDivElement>(null);

  const navigationResults = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return navigation.slice(0, 8).map(x => ({ ...x, score: 0 }));
    return navigation
      .filter(x => `${x.title} ${x.subtitle} ${x.keywords}`.toLowerCase().includes(term))
      .map(x => ({ ...x, score: scoreText(term, x.title, x.keywords) }))
      .sort((a, b) => (b.score || 0) - (a.score || 0));
  }, [q]);

  useEffect(() => {
    let cancelled = false;
    const loadBusiness = async () => {
      const saved = localStorage.getItem('moneymatters.activeBusinessId');
      if (saved) setBusinessId(saved);
      const r = await supabase.rpc('get_my_business_context');
      if (cancelled) return;
      const rows = (r.data || []) as BusinessContext[];
      const active = rows.find(x => x.business_id === saved) || rows[0];
      if (active) {
        setBusinessId(active.business_id);
        if (!saved) localStorage.setItem('moneymatters.activeBusinessId', active.business_id);
      }
    };
    loadBusiness();
    const onBusinessChanged = () => loadBusiness();
    window.addEventListener('moneymatters:business-changed', onBusinessChanged);
    return () => {
      cancelled = true;
      window.removeEventListener('moneymatters:business-changed', onBusinessChanged);
    };
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

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      const pattern = `%${escapeLike(term)}%`;
      try {
        const [customers, invoices, estimates, receipts, payments, products, vendors] = await Promise.all([
          supabase.from('customers').select('id,display_name,legal_name,phone,email,tax_id').eq('business_id', businessId).eq('is_active', true).or(`display_name.ilike.${pattern},legal_name.ilike.${pattern},phone.ilike.${pattern},email.ilike.${pattern},tax_id.ilike.${pattern}`).limit(10),
          supabase.from('invoices').select('id,invoice_number,total,status,customer_id,created_at').eq('business_id', businessId).or(`invoice_number.ilike.${pattern},status.ilike.${pattern}`).order('created_at', { ascending: false }).limit(10),
          supabase.from('quotations').select('id,quotation_number,total,status,customer_id,created_at').eq('business_id', businessId).or(`quotation_number.ilike.${pattern},status.ilike.${pattern}`).order('created_at', { ascending: false }).limit(10),
          supabase.from('receipts').select('id,receipt_number,amount,payment_method,reference_number,customer_id,created_at').eq('business_id', businessId).or(`receipt_number.ilike.${pattern},payment_method.ilike.${pattern},reference_number.ilike.${pattern}`).order('created_at', { ascending: false }).limit(10),
          supabase.from('payments').select('id,amount,method,reference,payment_date,customer_id,invoice_id,direction,created_at').eq('business_id', businessId).or(`reference.ilike.${pattern},method.ilike.${pattern}`).order('created_at', { ascending: false }).limit(10),
          supabase.from('products_services').select('id,name,sku,item_type,barcode,hsn_sac').eq('business_id', businessId).eq('is_active', true).or(`name.ilike.${pattern},sku.ilike.${pattern},barcode.ilike.${pattern},hsn_sac.ilike.${pattern}`).limit(10),
          supabase.from('vendors').select('id,display_name,legal_name,phone,email,tax_id').eq('business_id', businessId).eq('is_active', true).or(`display_name.ilike.${pattern},legal_name.ilike.${pattern},phone.ilike.${pattern},email.ilike.${pattern},tax_id.ilike.${pattern}`).limit(10),
        ]);

        if (cancelled) return;
        const errors = [customers.error, invoices.error, estimates.error, receipts.error, payments.error, products.error, vendors.error].filter(Boolean);
        if (errors.length) console.warn('Global search query warning', errors);

        const customerRows = (customers.data || []) as CustomerSearchRow[];
        const directCustomerIds = new Set(customerRows.map(x => x.id));
        const customerName = new Map<string, string>();
        customerRows.forEach(x => customerName.set(x.id, x.display_name || x.legal_name || 'Customer'));
        const getCustomerName = (id: string | null) => id ? customerName.get(id) || 'Customer' : 'Customer';

        const invoiceRows = (invoices.data || []) as InvoiceSearchRow[];
        const estimateRows = (estimates.data || []) as QuotationSearchRow[];
        const receiptRows = (receipts.data || []) as ReceiptSearchRow[];
        const paymentRows = (payments.data || []) as PaymentSearchRow[];
        const referencedCustomerIds: string[] = Array.from(new Set([
          ...invoiceRows.map(x => x.customer_id),
          ...estimateRows.map(x => x.customer_id),
          ...receiptRows.map(x => x.customer_id),
        ].filter((id): id is string => Boolean(id))));

        if (referencedCustomerIds.length) {
          const missingIds = referencedCustomerIds.filter(id => !customerName.has(id));
          if (missingIds.length) {
            const { data } = await supabase.from('customers').select('id,display_name,legal_name').eq('business_id', businessId).in('id', missingIds);
            (data || []).forEach((x: CustomerNameRow) => customerName.set(x.id, x.display_name || x.legal_name || 'Customer'));
          }
        }

        const out: Result[] = [];
        customerRows.forEach(x => out.push({ id: x.id, title: x.display_name || x.legal_name || 'Customer', subtitle: x.phone || x.email || x.tax_id || 'Customer', kind: 'customer', href: `/next-workspace/customers/${x.id}`, score: scoreText(term, x.display_name, x.legal_name, x.phone, x.email, x.tax_id) }));
        invoiceRows.forEach(x => out.push({ id: x.id, title: x.invoice_number || 'Invoice', subtitle: `${x.status || 'Invoice'} · ${getCustomerName(x.customer_id)} · ₹${Number(x.total || 0).toLocaleString('en-IN')}`, kind: 'invoice', href: documentHref('invoice', x.id), score: scoreText(term, x.invoice_number, x.status) }));
        estimateRows.forEach(x => out.push({ id: x.id, title: x.quotation_number || 'Estimate', subtitle: `${x.status || 'Estimate'} · ${getCustomerName(x.customer_id)} · ₹${Number(x.total || 0).toLocaleString('en-IN')}`, kind: 'quotation', href: documentHref('quotation', x.id), score: scoreText(term, x.quotation_number, x.status) }));
        receiptRows.forEach(x => out.push({ id: x.id, title: x.receipt_number || 'Receipt', subtitle: `${x.payment_method || 'Payment'} · ${getCustomerName(x.customer_id)} · ₹${Number(x.amount || 0).toLocaleString('en-IN')}${x.reference_number ? ` · ${x.reference_number}` : ''}`, kind: 'receipt', href: documentHref('receipt', x.id), score: scoreText(term, x.receipt_number, x.payment_method, x.reference_number) }));
        paymentRows.forEach(x => out.push({ id: x.id, title: `Payment · ₹${Number(x.amount || 0).toLocaleString('en-IN')}`, subtitle: `${x.method || 'Payment'} · ${x.direction || 'inbound'} · ${getCustomerName(x.customer_id)}${x.reference ? ` · ${x.reference}` : ''}`, kind: 'payment', href: x.invoice_id ? documentHref('invoice', x.invoice_id) : '/next-workspace/payments', score: scoreText(term, x.reference, x.method, x.payment_date, String(x.amount)) }));
        (products.data || []).forEach((x: ProductSearchRow) => out.push({ id: x.id, title: x.name || 'Product / Service', subtitle: x.sku || x.barcode || x.hsn_sac || x.item_type || 'Product / Service', kind: 'product', href: `/next-workspace/items?search=${encodeURIComponent(x.name || '')}`, score: scoreText(term, x.name, x.sku, x.barcode, x.hsn_sac) }));
        (vendors.data || []).forEach((x: VendorSearchRow) => out.push({ id: x.id, title: x.display_name || x.legal_name || 'Vendor', subtitle: x.phone || x.email || x.tax_id || 'Vendor', kind: 'vendor', href: `/next-workspace/vendors?search=${encodeURIComponent(x.display_name || x.legal_name || '')}`, score: scoreText(term, x.display_name, x.legal_name, x.phone, x.email, x.tax_id) }));

        if (directCustomerIds.size) {
          const ids = Array.from(directCustomerIds);
          const [customerInvoices, customerEstimates, customerReceipts] = await Promise.all([
            supabase.from('invoices').select('id,invoice_number,total,status,customer_id,created_at').eq('business_id', businessId).in('customer_id', ids).order('created_at', { ascending: false }).limit(8),
            supabase.from('quotations').select('id,quotation_number,total,status,customer_id,created_at').eq('business_id', businessId).in('customer_id', ids).order('created_at', { ascending: false }).limit(8),
            supabase.from('receipts').select('id,receipt_number,amount,payment_method,reference_number,customer_id,created_at').eq('business_id', businessId).in('customer_id', ids).order('created_at', { ascending: false }).limit(8),
          ]);
          const existing = new Set(out.map(x => `${x.kind}:${x.id}`));
          (customerInvoices.data || []).forEach((x: InvoiceSearchRow) => { if (!existing.has(`invoice:${x.id}`)) out.push({ id: x.id, title: x.invoice_number || 'Invoice', subtitle: `${x.status || 'Invoice'} · ${getCustomerName(x.customer_id)} · ₹${Number(x.total || 0).toLocaleString('en-IN')}`, kind: 'invoice', href: documentHref('invoice', x.id), score: 55 }); });
          (customerEstimates.data || []).forEach((x: QuotationSearchRow) => { if (!existing.has(`quotation:${x.id}`)) out.push({ id: x.id, title: x.quotation_number || 'Estimate', subtitle: `${x.status || 'Estimate'} · ${getCustomerName(x.customer_id)} · ₹${Number(x.total || 0).toLocaleString('en-IN')}`, kind: 'quotation', href: documentHref('quotation', x.id), score: 55 }); });
          (customerReceipts.data || []).forEach((x: ReceiptSearchRow) => { if (!existing.has(`receipt:${x.id}`)) out.push({ id: x.id, title: x.receipt_number || 'Receipt', subtitle: `${x.payment_method || 'Payment'} · ${getCustomerName(x.customer_id)} · ₹${Number(x.amount || 0).toLocaleString('en-IN')}`, kind: 'receipt', href: documentHref('receipt', x.id), score: 55 }); });
        }

        if (!cancelled) setResults(out.sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 24));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 160);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [q, businessId]);

  const go = (href: string) => {
    setOpen(false);
    setQ('');
    window.location.href = href;
  };

  const term = q.trim();
  const navToShow = term ? navigationResults.slice(0, 5) : navigationResults.slice(0, 6);
  const recordToShow = term.length >= 2 ? results : [];

  return (
    <div ref={root} className="relative w-full">
      <SearchInput
        value={q}
        onChange={e => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="Search anything: customers, invoices, estimates, products, vendors…"
        aria-label="Global search"
      />
      {open && (
        <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-[80] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5"><span className="text-[10px] font-bold uppercase tracking-[.16em] text-slate-400">Global search</span><kbd className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-400">Esc</kbd></div>
          {!term ? (
            <div className="p-2"><div className="px-3 pb-1.5 pt-2 text-[10px] font-bold uppercase tracking-[.16em] text-slate-400">Quick access</div>{navToShow.map(r => <button key={r.id} type="button" onClick={() => go(r.href)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-200"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-violet-50 text-xs font-bold text-violet-700">→</span><span className="min-w-0 flex-1"><b className="block text-sm text-slate-800">{r.title}</b><span className="block truncate text-xs text-slate-400">{r.subtitle}</span></span><span className="text-[10px] font-semibold text-slate-400">Open</span></button>)}</div>
          ) : (
            <div className="max-h-[520px] overflow-y-auto p-2">
              {navToShow.length > 0 && <><div className="px-3 pb-1.5 pt-2 text-[10px] font-bold uppercase tracking-[.16em] text-slate-400">Pages & actions</div>{navToShow.map(r => <button key={`nav-${r.id}`} type="button" onClick={() => go(r.href)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-200"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-violet-50 text-xs font-bold text-violet-700">→</span><span className="min-w-0 flex-1"><b className="block text-sm text-slate-800">{r.title}</b><span className="block truncate text-xs text-slate-400">{r.subtitle}</span></span><span className="text-[10px] font-semibold text-violet-600">Open</span></button>)}</>}
              {recordToShow.length > 0 && <><div className="px-3 pb-1.5 pt-3 text-[10px] font-bold uppercase tracking-[.16em] text-slate-400">Records</div>{recordToShow.map((r, i) => <button key={`${r.kind}-${r.id}-${i}`} type="button" onClick={() => go(r.href)} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-200"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-violet-50 text-xs font-bold text-violet-700">{kindLabel[r.kind].slice(0, 1)}</span><span className="min-w-0 flex-1"><b className="block truncate text-sm text-slate-800">{r.title}</b><span className="block truncate text-xs text-slate-400">{r.subtitle}</span></span><span className="text-[10px] font-semibold text-slate-400">{kindLabel[r.kind]}</span></button>)}</>}
              {loading && <div className="p-4 text-sm text-slate-400">Searching workspace records…</div>}
              {!loading && !navToShow.length && !recordToShow.length && <div className="p-5 text-sm text-slate-400">No matching pages or records found.</div>}
            </div>
          )}
          <div className="border-t border-slate-100 px-4 py-2 text-[10px] text-slate-400">Search pages, customers, invoices, estimates, receipts, products, vendors, document numbers, phone, email, SKU, tax ID or payment reference · Ctrl/⌘ + K to focus.</div>
        </div>
      )}
    </div>
  );
}
