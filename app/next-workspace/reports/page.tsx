'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase, type BusinessContext } from '@/lib/supabase';

const money = (n: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(n || 0));
const localDate = (date = new Date()) => {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 10);
};
const startFY = (date = new Date()) => `${date.getFullYear() - (date.getMonth() < 3 ? 1 : 0)}-04-01`;

type Invoice = { id: string; invoice_number: string; total: number; balance_due: number; status: string; invoice_date: string; tax_total: number; customer_id: string | null };
type Expense = { id: string; amount: number; tax_amount: number; expense_date: string; description: string; vendor_id?: string | null };
type Payment = { id: string; amount: number; direction: string; payment_date: string; method: string; reference: string | null; invoice_id: string | null; customer_id: string | null };
type ReportKey = 'sales' | 'expenses' | 'receivables' | 'payments' | 'tax';
type Duration = 'fy' | 'month' | '30' | '90' | 'custom';
type SortDirection = 'asc' | 'desc';
type ReportRow = { id: string; cells: Record<string, string>; sortValues: Record<string, string | number> };

const reportLabels: Record<ReportKey, string> = { sales: 'Sales', expenses: 'Expenses', receivables: 'Receivables', payments: 'Payments', tax: 'Tax' };
const statusLabels = ['all', 'draft', 'sent', 'partially_paid', 'paid', 'overdue'];

function rangeFor(duration: Duration): [string, string] {
  const today = new Date();
  const to = localDate(today);
  if (duration === 'fy') return [startFY(today), to];
  if (duration === 'month') return [localDate(new Date(today.getFullYear(), today.getMonth(), 1)), to];
  if (duration === '30') return [localDate(new Date(today.getTime() - 29 * 86400000)), to];
  if (duration === '90') return [localDate(new Date(today.getTime() - 89 * 86400000)), to];
  return [startFY(today), to];
}

export default function Reports() {
  const [ctx, setCtx] = useState<BusinessContext | null>(null);
  const [gstWorkspace, setGstWorkspace] = useState(false);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [report, setReport] = useState<ReportKey>('sales');
  const [duration, setDuration] = useState<Duration>('fy');
  const [from, setFrom] = useState(startFY());
  const [to, setTo] = useState(localDate());
  const [status, setStatus] = useState('all');
  const [q, setQ] = useState('');
  const [sortBy, setSortBy] = useState('date');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  useEffect(() => {
    (async () => {
      const context = await supabase.rpc('get_my_business_context');
      const business = context.data?.[0] as BusinessContext | undefined;
      if (!business) { location.href = '/'; return; }
      setCtx(business);
      const [taxProfile, a, b, p] = await Promise.all([
        supabase.from('business_tax_profiles').select('tax_regime').eq('business_id', business.business_id).maybeSingle(),
        supabase.from('invoices').select('id,invoice_number,total,balance_due,status,invoice_date,tax_total,customer_id').eq('business_id', business.business_id).order('invoice_date', { ascending: false }).limit(1000),
        supabase.from('expenses').select('id,amount,tax_amount,expense_date,description,vendor_id').eq('business_id', business.business_id).order('expense_date', { ascending: false }).limit(1000),
        supabase.from('payments').select('id,amount,direction,payment_date,method,reference,invoice_id,customer_id').eq('business_id', business.business_id).order('payment_date', { ascending: false }).limit(1000),
      ]);
      if (a.error || b.error || p.error || taxProfile.error) setError((a.error || b.error || p.error || taxProfile.error)?.message || 'Unable to load reports.');
      setGstWorkspace(String(taxProfile.data?.tax_regime || '').toUpperCase() === 'GST');
      setInvoices((a.data || []) as Invoice[]);
      setExpenses((b.data || []) as Expense[]);
      setPayments((p.data || []) as Payment[]);
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    const [nextFrom, nextTo] = rangeFor(duration);
    if (duration !== 'custom') { setFrom(nextFrom); setTo(nextTo); }
  }, [duration]);

  useEffect(() => { setSortBy('date'); setSortDirection('desc'); setQ(''); }, [report]);

  const filteredInvoices = useMemo(() => invoices.filter((x) => x.invoice_date >= from && x.invoice_date <= to && (status === 'all' || x.status === status) && `${x.invoice_number} ${x.status}`.toLowerCase().includes(q.trim().toLowerCase())), [invoices, from, to, status, q]);
  const filteredExpenses = useMemo(() => expenses.filter((x) => x.expense_date >= from && x.expense_date <= to && `${x.description || ''}`.toLowerCase().includes(q.trim().toLowerCase())), [expenses, from, to, q]);
  const filteredPayments = useMemo(() => payments.filter((x) => x.payment_date >= from && x.payment_date <= to && `${x.reference || ''} ${x.method} ${x.direction}`.toLowerCase().includes(q.trim().toLowerCase())), [payments, from, to, q]);

  const metrics = useMemo(() => {
    const posted = invoices.filter((x) => x.invoice_date >= from && x.invoice_date <= to && !['draft', 'void'].includes(x.status));
    const sales = posted.reduce((s, x) => s + Number(x.total || 0), 0);
    const tax = posted.reduce((s, x) => s + Number(x.tax_total || 0), 0);
    const exp = expenses.filter((x) => x.expense_date >= from && x.expense_date <= to).reduce((s, x) => s + Number(x.amount || 0), 0);
    const receivable = invoices.filter((x) => !['paid', 'void', 'draft'].includes(x.status)).reduce((s, x) => s + Number(x.balance_due || 0), 0);
    const received = payments.filter((x) => x.payment_date >= from && x.payment_date <= to && ['in', 'inbound'].includes(x.direction)).reduce((s, x) => s + Number(x.amount || 0), 0);
    const paid = payments.filter((x) => x.payment_date >= from && x.payment_date <= to && ['out', 'outbound'].includes(x.direction)).reduce((s, x) => s + Number(x.amount || 0), 0);
    return { sales, tax, exp, receivable, received, paid, profit: sales - exp };
  }, [invoices, expenses, payments, from, to]);

  const rows = useMemo<ReportRow[]>(() => {
    if (report === 'sales') return filteredInvoices.map((x) => ({ id: x.id, cells: { number: x.invoice_number, date: x.invoice_date, status: x.status, total: money(x.total), tax: money(x.tax_total), balance: money(x.balance_due) }, sortValues: { number: x.invoice_number, date: x.invoice_date, status: x.status, total: Number(x.total || 0), tax: Number(x.tax_total || 0), balance: Number(x.balance_due || 0) } }));
    if (report === 'receivables') return filteredInvoices.filter((x) => !['paid', 'void', 'draft'].includes(x.status)).map((x) => ({ id: x.id, cells: { number: x.invoice_number, date: x.invoice_date, status: x.status, total: money(x.total), balance: money(x.balance_due) }, sortValues: { number: x.invoice_number, date: x.invoice_date, status: x.status, total: Number(x.total || 0), balance: Number(x.balance_due || 0) } }));
    if (report === 'expenses') return filteredExpenses.map((x) => ({ id: x.id, cells: { date: x.expense_date, head: x.description || 'Expense', amount: money(x.amount), tax: money(x.tax_amount) }, sortValues: { date: x.expense_date, head: x.description || 'Expense', amount: Number(x.amount || 0), tax: Number(x.tax_amount || 0) } }));
    if (report === 'payments') return filteredPayments.map((x) => ({ id: x.id, cells: { date: x.payment_date, direction: x.direction, method: String(x.method).replaceAll('_', ' '), reference: x.reference || '—', amount: money(x.amount) }, sortValues: { date: x.payment_date, direction: x.direction, method: x.method, reference: x.reference || '', amount: Number(x.amount || 0) } }));
    return filteredInvoices.map((x) => ({ id: x.id, cells: { number: x.invoice_number, date: x.invoice_date, status: x.status, tax: money(x.tax_total), total: money(x.total) }, sortValues: { number: x.invoice_number, date: x.invoice_date, status: x.status, tax: Number(x.tax_total || 0), total: Number(x.total || 0) } }));
  }, [report, filteredInvoices, filteredExpenses, filteredPayments]);

  const columns = useMemo(() => {
    if (report === 'sales') return [['number', 'Invoice'], ['date', 'Date'], ['status', 'Status'], ['total', 'Total'], ['tax', 'Tax'], ['balance', 'Balance']];
    if (report === 'receivables') return [['number', 'Invoice'], ['date', 'Date'], ['status', 'Status'], ['total', 'Total'], ['balance', 'Balance']];
    if (report === 'expenses') return [['date', 'Date'], ['head', 'Expense head'], ['amount', 'Amount'], ['tax', 'Tax']];
    if (report === 'payments') return [['date', 'Date'], ['direction', 'Direction'], ['method', 'Method'], ['reference', 'Reference'], ['amount', 'Amount']];
    return [['number', 'Invoice'], ['date', 'Date'], ['status', 'Status'], ['tax', 'Tax'], ['total', 'Total']];
  }, [report]);

  const sortedRows = useMemo(() => {
    const result = [...rows];
    const direction = sortDirection === 'asc' ? 1 : -1;
    result.sort((a, b) => {
      const av = a.sortValues[sortBy] ?? '';
      const bv = b.sortValues[sortBy] ?? '';
      const comparison = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' });
      return (comparison || a.id.localeCompare(b.id)) * direction;
    });
    return result;
  }, [rows, sortBy, sortDirection]);

  const toggleSort = (key: string) => {
    if (sortBy === key) setSortDirection((d) => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(key); setSortDirection('asc'); }
  };

  const exportCSV = () => {
    const csv = [columns.map(([, label]) => label), ...sortedRows.map((row) => columns.map(([key]) => row.cells[key] || ''))].map((r) => r.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `moneymatters-${report}-${from}-${to}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  if (loading) return <div className="grid min-h-[70vh] place-items-center text-sm text-slate-500">Preparing reports…</div>;
  if (!ctx) return null;

  return <main className="min-h-[calc(100vh-100px)] bg-[#fbfaff] p-4 sm:p-6 lg:p-8"><div className="mx-auto max-w-[1450px]">
    <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><div className="flex items-center gap-2"><p className="text-[10px] font-bold uppercase tracking-[.18em] text-violet-600">Business intelligence</p>{gstWorkspace&&<span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700 ring-1 ring-emerald-200">GST workspace</span>}</div><h1 className="mt-1 text-3xl font-semibold">Reports</h1><p className="mt-1 text-sm text-slate-500">Filter the period, report head and status, then sort any visible column.</p></div><div className="flex flex-wrap gap-2"><button onClick={exportCSV} className="rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-semibold text-white">Export CSV</button><button onClick={()=>location.href='/next-workspace'} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold">← Dashboard</button></div></header>
    {error&&<div className="mb-4 rounded-2xl bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric title="Sales" value={money(metrics.sales)} note="Posted invoices" tone="blue"/><Metric title="Expenses" value={money(metrics.exp)} note="Recorded expenses" tone="amber"/><Metric title="Profit*" value={money(metrics.profit)} note="Sales less expenses" tone={metrics.profit>=0?'green':'red'}/><Metric title="Receivable" value={money(metrics.receivable)} note="Open customer balances" tone="violet"/></div>
    <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1.1fr_180px_170px_170px_180px] xl:items-end"><label className="text-xs font-semibold text-slate-600">Report head<select value={report} onChange={e=>setReport(e.target.value as ReportKey)} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm"><option value="sales">Sales</option><option value="expenses">Expenses</option><option value="receivables">Receivables</option><option value="payments">Payments</option>{gstWorkspace&&<option value="tax">Tax</option>}</select></label><label className="text-xs font-semibold text-slate-600">Duration<select value={duration} onChange={e=>setDuration(e.target.value as Duration)} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm"><option value="fy">Current financial year</option><option value="month">This month</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="custom">Custom range</option></select></label><label className="text-xs font-semibold text-slate-600">From<input type="date" value={from} onChange={e=>{setDuration('custom');setFrom(e.target.value)}} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"/></label><label className="text-xs font-semibold text-slate-600">To<input type="date" value={to} onChange={e=>{setDuration('custom');setTo(e.target.value)}} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"/></label><label className="text-xs font-semibold text-slate-600">Status<select value={status} onChange={e=>setStatus(e.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm"><option value="all">All statuses</option>{statusLabels.slice(1).map(x=><option key={x} value={x}>{x.replaceAll('_',' ')}</option>)}</select></label></div><div className="mt-3 flex flex-col gap-2 sm:flex-row"><input value={q} onChange={e=>setQ(e.target.value)} placeholder={`Search ${reportLabels[report].toLowerCase()}…`} className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2.5 text-sm"/><span className="self-center text-xs text-slate-400">{sortedRows.length} matching records · {from} to {to}</span></div></section>
    <div className="mt-5 grid gap-5 lg:grid-cols-[1.2fr_.8fr]"><Card className="p-5"><h2 className="font-semibold">Profit & Loss snapshot</h2><p className="mt-1 text-xs text-slate-400">Selected reporting period.</p><div className="mt-4 space-y-3"><Line label="Sales" value={metrics.sales}/><Line label="Expenses" value={-metrics.exp}/><div className="border-t border-slate-200 pt-3"><Line label="Net operating result" value={metrics.profit} strong/></div></div><p className="mt-4 text-[11px] leading-5 text-slate-400">*Management snapshot; final statements remain ledger/year-end controlled.</p></Card><Card className="p-5"><h2 className="font-semibold">Cash movement</h2><p className="mt-1 text-xs text-slate-400">Recorded payment activity in the selected period.</p><div className="mt-4 space-y-3"><Line label="Money received" value={metrics.received}/><Line label="Money paid" value={-metrics.paid}/><div className="border-t border-slate-200 pt-3"><Line label="Net movement" value={metrics.received-metrics.paid} strong/></div></div></Card></div>
    <section className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-100 px-4 py-3"><h2 className="font-semibold">{reportLabels[report]} register</h2><p className="mt-1 text-xs text-slate-400">Click any column header to toggle ascending and descending order.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="border-b border-slate-100 bg-slate-50/70 text-[10px] font-bold uppercase tracking-wider text-slate-500"><tr>{columns.map(([key,label])=><th key={key} className="px-4 py-3"><button type="button" onClick={()=>toggleSort(key)} className={`inline-flex items-center gap-1.5 rounded-md py-1 font-bold uppercase tracking-wider ${sortBy===key?'text-violet-700':'text-slate-500 hover:text-slate-800'}`}>{label}<span className={sortBy===key?'text-violet-600':'text-slate-300'}>{sortBy===key?(sortDirection==='asc'?'↑':'↓'):'↕'}</span></button></th>)}<th className="px-4 py-3 text-right">Action</th></tr></thead><tbody>{sortedRows.map(row=><tr key={row.id} onClick={()=>{if(['sales','receivables','tax'].includes(report))location.href=`/next-workspace/documents?type=invoice&id=${row.id}`}} className={`border-b border-slate-100 ${['sales','receivables','tax'].includes(report)?'cursor-pointer hover:bg-violet-50/40':''}`}>{columns.map(([key])=><td key={key} className={`px-4 py-3 ${key==='number'||key==='head'?'font-medium text-slate-800':'text-slate-600'}`}>{row.cells[key]}</td>)}<td className="px-4 py-3 text-right text-xs text-violet-700">{['sales','receivables','tax'].includes(report)?'View':'—'}</td></tr>)}{!sortedRows.length&&<tr><td colSpan={columns.length+1} className="p-12 text-center text-sm text-slate-500">No records match the selected filters.</td></tr>}</tbody></table></div><div className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">Showing {sortedRows.length} records</div></section>
  </div></main>;
}

function Card({children,className=''}:{children:React.ReactNode;className?:string}){return <section className={`rounded-2xl border border-slate-200 bg-white shadow-sm ${className}`}>{children}</section>}
function Metric({title,value,note,tone}:{title:string;value:string;note:string;tone:'blue'|'amber'|'green'|'red'|'violet'}){const tones={blue:'bg-blue-50 text-blue-700 ring-blue-100',amber:'bg-amber-50 text-amber-700 ring-amber-100',green:'bg-emerald-50 text-emerald-700 ring-emerald-100',red:'bg-rose-50 text-rose-700 ring-rose-100',violet:'bg-violet-50 text-violet-700 ring-violet-100'};return <Card className="p-4"><span className={`inline-flex rounded-lg px-2 py-1 text-[10px] font-bold ring-1 ${tones[tone]}`}>{title}</span><p className="mt-2 text-2xl font-semibold">{value}</p><p className="mt-1 text-xs text-slate-400">{note}</p></Card>}
function Line({label,value,strong=false}:{label:string;value:number;strong?:boolean}){return <div className={`flex justify-between gap-3 ${strong?'font-semibold':''}`}><span className="text-sm">{label}</span><span className={value<0?'text-rose-600':''}>{money(value)}</span></div>}
