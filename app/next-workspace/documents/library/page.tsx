'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase, type BusinessContext } from '@/lib/supabase';

type DocType = 'invoice' | 'quotation' | 'receipt';
type Row = { id: string; number: string; date: string; status: string; customer: string; amount: number; type: DocType; balance?: number };

const money = (n: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(n || 0));
const labels: Record<DocType, string> = { invoice: 'Invoices', quotation: 'Estimates', receipt: 'Receipts' };

export default function DocumentLibrary() {
  const [type, setType] = useState<DocType>('invoice');
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState('');
  const [pageSize, setPageSize] = useState('20');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      const context = await supabase.rpc('get_my_business_context');
      const business = context.data?.[0] as BusinessContext | undefined;
      if (!business) { location.href = '/'; return; }
      const [invoices, estimates, receipts, customers] = await Promise.all([
        supabase.from('invoices').select('id,invoice_number,invoice_date,status,total,balance_due,customer_id').eq('business_id', business.business_id).order('invoice_date', { ascending: false }).limit(500),
        supabase.from('quotations').select('id,quotation_number,quotation_date,status,total,customer_id').eq('business_id', business.business_id).order('quotation_date', { ascending: false }).limit(500),
        supabase.from('receipts').select('id,receipt_number,receipt_date,amount,payment_method,customer_id').eq('business_id', business.business_id).order('receipt_date', { ascending: false }).limit(500),
        supabase.from('customers').select('id,display_name').eq('business_id', business.business_id).eq('is_active', true),
      ]);
      if (invoices.error || estimates.error || receipts.error) { setError(invoices.error?.message || estimates.error?.message || receipts.error?.message || 'Unable to load documents.'); setLoading(false); return; }
      const names = new Map((customers.data || []).map((c: any) => [c.id, c.display_name]));
      const invoiceRows: Row[] = (invoices.data || []).map((x: any) => ({ id: x.id, number: x.invoice_number, date: x.invoice_date, status: x.status || 'draft', customer: names.get(x.customer_id) || 'Customer', amount: Number(x.total || 0), balance: Number(x.balance_due || 0), type: 'invoice' }));
      const estimateRows: Row[] = (estimates.data || []).map((x: any) => ({ id: x.id, number: x.quotation_number, date: x.quotation_date, status: x.status || 'draft', customer: names.get(x.customer_id) || 'Customer', amount: Number(x.total || 0), type: 'quotation' }));
      const receiptRows: Row[] = (receipts.data || []).map((x: any) => ({ id: x.id, number: x.receipt_number, date: x.receipt_date, status: x.payment_method || 'paid', customer: names.get(x.customer_id) || 'Customer', amount: Number(x.amount || 0), type: 'receipt' }));
      setRows([...invoiceRows, ...estimateRows, ...receiptRows]);
      setLoading(false);
    })();
  }, []);

  useEffect(() => setPage(1), [type, q, pageSize]);
  const filtered = useMemo(() => rows.filter(x => x.type === type && `${x.number} ${x.customer} ${x.status}`.toLowerCase().includes(q.trim().toLowerCase())), [rows, type, q]);
  const pageCount = pageSize === 'all' ? 1 : Math.max(1, Math.ceil(filtered.length / Number(pageSize)));
  const visible = pageSize === 'all' ? filtered : filtered.slice((page - 1) * Number(pageSize), page * Number(pageSize));
  const open = (row: Row) => { location.href = `/next-workspace/documents?type=${row.type}&id=${row.id}`; };

  if (loading) return <div className="grid min-h-[70vh] place-items-center text-sm text-slate-500">Loading documents…</div>;

  return <main className="min-h-[calc(100vh-100px)] bg-[#fbfaff] p-4 sm:p-6 lg:p-8"><div className="mx-auto max-w-[1450px]">
    <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[.18em] text-violet-600">Workspace · Documents</p><h1 className="mt-1 text-3xl font-semibold">Documents</h1><p className="mt-1 text-sm text-slate-500">One place to find, preview, print and share your invoices, estimates and receipts.</p></div><div className="flex gap-2"><button onClick={() => location.href = '/next-workspace/invoices/new'} className="rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white">＋ Invoice</button><button onClick={() => location.href = '/next-workspace/quotation'} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold">＋ Estimate</button></div></header>
    {error && <div className="mb-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
    <div className="mb-5 grid gap-3 md:grid-cols-3">{(['invoice', 'quotation', 'receipt'] as DocType[]).map(d => <button key={d} onClick={() => setType(d)} className={`rounded-2xl border p-4 text-left transition ${type === d ? 'border-violet-300 bg-violet-50 ring-1 ring-violet-200' : 'border-slate-200 bg-white hover:bg-violet-50/40'}`}><span className="text-xs font-semibold text-slate-500">{labels[d]}</span><b className="mt-2 block text-2xl">{rows.filter(x => x.type === d).length}</b><span className="mt-1 block text-[11px] text-slate-400">Open document library</span></button>)}</div>
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-semibold">{labels[type]}</h2><p className="text-xs text-slate-400">Select a document to open its print/share view.</p></div><input value={q} onChange={e => setQ(e.target.value)} placeholder={`Search ${labels[type].toLowerCase()}…`} className="w-full max-w-sm rounded-xl border border-slate-200 bg-[#fbfaff] px-3 py-2.5 text-sm outline-none" /></div><div className="hidden grid-cols-[150px_130px_1fr_130px_150px_100px] gap-3 border-b border-slate-100 px-5 py-3 text-[10px] font-bold uppercase tracking-wider text-slate-400 sm:grid"><span>Number</span><span>Date</span><span>Customer</span><span>Status</span><span className="text-right">Amount</span><span /></div><div className="divide-y divide-slate-100">{visible.map(row => <button key={row.id} onClick={() => open(row)} className="grid w-full gap-2 px-4 py-4 text-left transition hover:bg-violet-50/40 sm:grid-cols-[150px_130px_1fr_130px_150px_100px] sm:items-center sm:gap-3 sm:px-5"><b className="text-sm">{row.number}</b><span className="text-xs text-slate-500">{row.date}</span><span className="text-sm">{row.customer}</span><span className="text-xs capitalize text-slate-500">{row.status}</span><b className="text-sm sm:text-right">{money(row.amount)}</b><span className="text-xs font-semibold text-violet-700 sm:text-right">Open →</span></button>)}{!visible.length && <div className="p-12 text-center text-sm text-slate-500">No {labels[type].toLowerCase()} found.</div>}</div><div className="flex flex-col gap-3 border-t border-slate-100 px-4 py-3 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between"><span>Showing {filtered.length === 0 ? 0 : pageSize === 'all' ? 1 : (page - 1) * Number(pageSize) + 1}–{pageSize === 'all' ? filtered.length : Math.min(filtered.length, page * Number(pageSize))} of {filtered.length}</span><div className="flex items-center gap-2"><label className="flex items-center gap-2">Show<select value={pageSize} onChange={e => setPageSize(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5"><option value="20">20</option><option value="50">50</option><option value="100">100</option><option value="all">Show all</option></select></label><button disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:opacity-40">Previous</button><span>Page {page} / {pageCount}</span><button disabled={page >= pageCount} onClick={() => setPage(page + 1)} className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:opacity-40">Next</button></div></div></section>
  </div></main>;
}
