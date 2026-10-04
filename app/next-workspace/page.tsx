'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase, type BusinessContext } from '@/lib/supabase';
import { deriveWorkspaceConfiguration, type WorkspaceConfiguration } from '@/lib/business-adaptation';
import StatCard from '@/components/ui/finops/StatCard';
import StatusBadge, { normalizeFinOpsStatus } from '@/components/ui/finops/StatusBadge';
import DetailDrawer from '@/components/ui/finops/DetailDrawer';
import { StatCardSkeleton, TableRowsSkeleton } from '@/components/ui/finops/Skeletons';

type Customer = { id: string; display_name: string };
type Invoice = { id: string; invoice_number: string; invoice_date: string; status: string; total: number; balance_due: number; customer_id: string };
type Payment = { id: string; payment_date: string; amount: number; direction: string; method: string; reference: string | null; invoice_id: string | null; customer_id: string | null };
type Expense = { id: string; expense_date: string; amount: number; description: string | null };
type Bank = { id: string; name: string; account_last4: string | null };
type Rec = { id: string; bank_account_id: string; period_end: string; status: string };
type BankTx = { id: string; bank_account_id: string; transaction_date: string; description: string | null; amount: number; direction: string; status: string };

const money = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(value || 0));
const dateLabel = (value: string) => new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value));
const monthStart = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString(); };

function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = Math.max(max - min, 1);
  const points = values.map((v, i) => {
    const x = (i / Math.max(values.length - 1, 1)) * 72;
    const y = 22 - ((v - min) / range) * 18;
    return x.toFixed(1) + ',' + y.toFixed(1);
  }).join(' ');
  return <svg viewBox="0 0 72 24" className="h-7 w-20 text-violet-500" aria-hidden="true"><polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function Icon({ name }: { name: 'cash' | 'invoice' | 'import' | 'arrow' | 'bank' | 'customer' | 'close' }) {
  const common = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const paths = {
    cash: <><rect x="3.5" y="6" width="17" height="12" rx="2" /><path d="M3.5 10h17" /><path d="M8 14h3" /></>,
    invoice: <><path d="M6 3.75h8l4 4v12.5H6z" /><path d="M14 3.75v4h4" /><path d="M9 12h6M9 15.5h4" /></>,
    import: <><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 20h14" /></>,
    arrow: <><path d="M5 12h13" /><path d="m13 6 6 6-6 6" /></>,
    bank: <><path d="m3 9 9-5 9 5" /><path d="M5 10v7M9 10v7M15 10v7M19 10v7M3 20h18" /></>,
    customer: <><circle cx="12" cy="8" r="3" /><path d="M5.5 19.5c.7-3.1 2.9-4.7 6.5-4.7s5.8 1.6 6.5 4.7" /></>,
    close: <><path d="m7 7 10 10M17 7 7 17" /></>,
  };
  return <svg {...common} className="h-4 w-4">{paths[name]}</svg>;
}

function ActionButton({ label, href, icon }: { label: string; href: string; icon: 'cash' | 'invoice' | 'import' }) {
  return <button type="button" onClick={() => { window.location.href = href; }} className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm transition hover:border-violet-200 hover:bg-violet-50 hover:text-violet-800">
    <Icon name={icon} />{label}
  </button>;
}

function MetricSkeletons() {
  return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <StatCardSkeleton key={i} />)}</div>;
}

export default function NextWorkspace() {
  const [contexts, setContexts] = useState<BusinessContext[]>([]);
  const [ctx, setCtx] = useState<BusinessContext | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [reconciliations, setReconciliations] = useState<Rec[]>([]);
  const [bankTransactions, setBankTransactions] = useState<BankTx[]>([]);
  const [configuration, setConfiguration] = useState<WorkspaceConfiguration | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [refresh, setRefresh] = useState(0);

  const go = (href: string) => { window.location.href = href; };

  useEffect(() => {
    let alive = true;
    (async () => {
      const session = (await supabase.auth.getSession()).data.session;
      if (!session) { window.location.replace('/'); return; }
      const contextResult = await supabase.rpc('get_my_business_context');
      if (!alive) return;
      if (contextResult.error || !contextResult.data?.length) {
        setError(contextResult.error?.message || 'No business workspace is available for this account.');
        setLoading(false);
        return;
      }
      const rows = contextResult.data as BusinessContext[];
      const saved = typeof window !== 'undefined' ? localStorage.getItem('moneymatters.activeBusinessId') : null;
      const selected = rows.find((x) => x.business_id === saved) || rows[0];
      setContexts(rows);
      setCtx(selected);
      if (typeof window !== 'undefined') localStorage.setItem('moneymatters.activeBusinessId', selected.business_id);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!ctx) return;
    let alive = true;
    (async () => {
      const result = await supabase.from('businesses').select('id,category_id,subcategory_id,selling_model,inventory_enabled,tax_enabled,sales_channels,team_size,business_categories(name),business_subcategories(name)').eq('id', ctx.business_id).maybeSingle();
      if (!alive) return;
      if (result.data) {
        setConfiguration(deriveWorkspaceConfiguration({
          businessId: ctx.business_id,
          categoryId: result.data.category_id,
          categoryName: result.data.business_categories?.[0]?.name ?? null,
          subcategoryId: result.data.subcategory_id,
          subcategoryName: result.data.business_subcategories?.[0]?.name ?? null,
          sellingModel: result.data.selling_model,
          inventoryEnabled: result.data.inventory_enabled,
          taxEnabled: result.data.tax_enabled,
          salesChannels: result.data.sales_channels,
          teamSize: result.data.team_size,
        }));
      }
    })();
    return () => { alive = false; };
  }, [ctx]);

  useEffect(() => {
    if (!ctx) return;
    let alive = true;
    (async () => {
      setError('');
      const start = monthStart();
      const [customersResult, invoicesResult, paymentsResult, expensesResult, banksResult, recResult, txResult] = await Promise.all([
        supabase.from('customers').select('id,display_name').eq('business_id', ctx.business_id).eq('is_active', true).order('created_at', { ascending: false }).limit(200),
        supabase.from('invoices').select('id,invoice_number,invoice_date,status,total,balance_due,customer_id').eq('business_id', ctx.business_id).order('invoice_date', { ascending: false }).limit(200),
        supabase.from('payments').select('id,payment_date,amount,direction,method,reference,invoice_id,customer_id').eq('business_id', ctx.business_id).gte('payment_date', start).order('payment_date', { ascending: false }).limit(500),
        supabase.from('expenses').select('id,expense_date,amount,description').eq('business_id', ctx.business_id).gte('expense_date', start).order('expense_date', { ascending: false }).limit(500),
        supabase.from('bank_accounts').select('id,name,account_last4').eq('business_id', ctx.business_id).eq('is_active', true).order('name'),
        supabase.from('bank_reconciliations').select('id,bank_account_id,period_end,status').eq('business_id', ctx.business_id).order('period_end', { ascending: false }).limit(100),
        supabase.from('bank_transactions').select('id,bank_account_id,transaction_date,description,amount,direction,status').in('bank_account_id', (banksResult.data || []).map((b) => b.id)).order('transaction_date', { ascending: false }).limit(500),
      ]);
      if (!alive) return;
      const firstError = customersResult.error || invoicesResult.error || paymentsResult.error || expensesResult.error || banksResult.error || recResult.error || txResult.error;
      if (firstError) setError(firstError.message);
      setCustomers((customersResult.data || []) as Customer[]);
      setInvoices((invoicesResult.data || []) as Invoice[]);
      setPayments((paymentsResult.data || []) as Payment[]);
      setExpenses((expensesResult.data || []) as Expense[]);
      setBanks((banksResult.data || []) as Bank[]);
      setReconciliations((recResult.data || []) as Rec[]);
      setBankTransactions((txResult.data || []) as BankTx[]);
    })();
    return () => { alive = false; };
  }, [ctx, refresh]);

  const customerName = (id: string) => customers.find((customer) => customer.id === id)?.display_name || 'Customer';

  const metrics = useMemo(() => {
    const inbound = payments.filter((payment) => String(payment.direction).toLowerCase() === 'inbound').reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    const outbound = payments.filter((payment) => String(payment.direction).toLowerCase() === 'outbound').reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    const netCash = inbound - outbound;
    const outstanding = invoices.filter((invoice) => !['paid', 'void', 'voided'].includes(invoice.status)).reduce((sum, invoice) => sum + Number(invoice.balance_due || 0), 0);
    const overdue = invoices.filter((invoice) => invoice.status === 'overdue');
    const buckets = overdue.reduce((acc, invoice) => {
      const age = Math.max(0, Math.floor((Date.now() - new Date(invoice.invoice_date).getTime()) / 86400000));
      if (age >= 90) acc.n90 += Number(invoice.balance_due || 0);
      else if (age >= 60) acc.n60 += Number(invoice.balance_due || 0);
      else if (age >= 30) acc.n30 += Number(invoice.balance_due || 0);
      return acc;
    }, { n30: 0, n60: 0, n90: 0 });
    const latestByBank = banks.map((bank) => reconciliations.find((rec) => rec.bank_account_id === bank.id));
    const reconciledAccounts = latestByBank.filter((rec) => rec?.status === 'locked').length;
    const pendingLines = bankTransactions.filter((transaction) => !['reconciled', 'ignored'].includes(String(transaction.status).toLowerCase())).length;
    return { inbound, outbound, netCash, outstanding, overdue, buckets, reconciledAccounts, pendingLines };
  }, [banks, bankTransactions, invoices, payments, reconciliations]);

  const periodLabel = useMemo(() => new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' }).format(new Date()), []);
  const recent = invoices.slice(0, 8);
  const queue = bankTransactions.filter((transaction) => !['reconciled', 'ignored'].includes(String(transaction.status).toLowerCase())).slice(0, 5);

  if (loading) {
    return <main className="min-w-0 bg-slate-50/70 p-3 sm:p-5 lg:p-6"><div className="mx-auto max-w-[1440px] space-y-4"><div className="h-16 animate-pulse rounded-xl bg-slate-200/70" /><MetricSkeletons /><div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(280px,2fr)]"><div className="h-96 animate-pulse rounded-xl bg-slate-200/60" /><div className="h-96 animate-pulse rounded-xl bg-slate-200/60" /></div></div></main>;
  }

  if (!ctx) {
    return <main className="min-w-0 p-6"><div className="mx-auto max-w-2xl border border-slate-200 bg-white p-8 text-center shadow-xs"><h1 className="text-xl font-bold text-slate-900">Business setup required</h1><p className="mt-2 text-sm text-slate-500">{error || 'Create a business before using the workspace.'}</p><button type="button" onClick={() => go('/')} className="mt-5 rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-bold text-white">Open setup</button></div></main>;
  }

  return (
    <main className="min-w-0 bg-slate-50/70 p-3 sm:p-5 lg:p-6">
      <div className="mx-auto max-w-[1440px]">
        <header className="mb-4 flex flex-col gap-3 border-b border-slate-200/80 pb-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {contexts.length > 1 ? (
                <select value={ctx.business_id} onChange={(event) => { const next = contexts.find((item) => item.business_id === event.target.value); if (next) { setCtx(next); localStorage.setItem('moneymatters.activeBusinessId', next.business_id); } }} className="max-w-[280px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900 shadow-sm">
                  {contexts.map((item) => <option key={item.business_id} value={item.business_id}>{item.business_name}</option>)}
                </select>
              ) : <h1 className="truncate text-lg font-bold text-slate-950">{ctx.business_name}</h1>}
              <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700">Period: {periodLabel} • Open</span>
            </div>
            <p className="mt-1 text-xs text-slate-500">Executive workspace · live operational view</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <ActionButton label="+ Cash Bill" href="/next-workspace/cash-bill" icon="cash" />
            <ActionButton label="+ New Invoice" href="/next-workspace/sales" icon="invoice" />
            <ActionButton label="Import Statement" href="/next-workspace/banking" icon="import" />
            <button type="button" onClick={() => setRefresh((value) => value + 1)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-500 shadow-sm hover:bg-slate-50">Refresh</button>
          </div>
        </header>

        {error ? <div className="mb-4 border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800">{error}</div> : null}

        <section aria-label="Executive KPIs" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard title="Net Cash Flow" value={money(metrics.netCash)} delta={metrics.netCash >= 0 ? 'up' : 'down'} periodLabel={periodLabel} sparkline={<Sparkline values={[metrics.outbound, metrics.inbound, metrics.netCash, Math.max(metrics.netCash, 0)]} />} badge={<span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold text-slate-500">MTD</span>} />
          <StatCard title="Accounts Receivable" value={money(metrics.outstanding)} delta={metrics.overdue.length ? 'down' : 'neutral'} periodLabel={metrics.overdue.length + ' overdue invoices'} badge={<span className="rounded bg-rose-50 px-1.5 py-0.5 text-[9px] font-bold text-rose-700">30d {money(metrics.buckets.n30)}</span>} />
          <StatCard title="Bank Reconciliation" value={banks.length ? metrics.reconciledAccounts + '/' + banks.length : '—'} delta={metrics.pendingLines ? 'down' : 'up'} periodLabel={metrics.pendingLines + ' uncleared statement lines'} badge={<span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[9px] font-bold text-indigo-700">Locked</span>} />
          <StatCard title="E-Invoicing Delivery" value="—" delta="neutral" periodLabel="Dispatch provider status not recorded" badge={<span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold text-slate-600">PEPPOL / Factur-X</span>} />
        </section>

        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(280px,2fr)]">
          <section className="min-w-0 overflow-hidden border border-slate-200/90 bg-white shadow-xs">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
              <div><p className="text-[10px] font-bold uppercase tracking-[.14em] text-slate-400">Operations</p><h2 className="mt-0.5 text-sm font-bold text-slate-900">Recent Transaction Ledger</h2></div>
              <button type="button" onClick={() => go('/next-workspace/sales')} className="text-xs font-bold text-violet-700 hover:text-violet-900">View all →</button>
            </div>
            {recent.length ? <div className="divide-y divide-slate-100">
              {recent.map((invoice) => (
                <button key={invoice.id} type="button" onClick={() => setSelectedInvoice(invoice)} className="grid w-full grid-cols-[minmax(0,1fr)_120px_92px_20px] items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-50">
                  <span className="min-w-0"><span className="block truncate text-xs font-bold text-slate-900">{invoice.invoice_number}</span><span className="mt-0.5 block truncate text-[10px] text-slate-500">{customerName(invoice.customer_id)} · {dateLabel(invoice.invoice_date)}</span></span>
                  <span className="text-right font-mono tabular-nums text-xs font-semibold text-slate-900">{money(invoice.total)}</span>
                  <span className="justify-self-end"><StatusBadge status={normalizeFinOpsStatus(invoice.status)} /></span>
                  <span className="text-slate-300">›</span>
                </button>
              ))}
            </div> : <div className="grid min-h-64 place-items-center p-6 text-center"><div><p className="text-sm font-bold text-slate-800">No transactions yet</p><p className="mt-1 text-xs text-slate-500">Start with a Cash Bill or New Invoice.</p></div></div>}
          </section>

          <aside className="space-y-4">
            <section className="border border-slate-200/90 bg-white p-4 shadow-xs">
              <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[.14em] text-slate-400">Reconciliation</p><h2 className="mt-0.5 text-sm font-bold text-slate-900">Fast Reconciliation Queue</h2></div><span className="rounded-full bg-amber-50 px-2 py-1 text-[10px] font-bold text-amber-700">{metrics.pendingLines} pending</span></div>
              <div className="mt-3 space-y-2">
                {queue.length ? queue.map((transaction) => <button key={transaction.id} type="button" onClick={() => go('/next-workspace/banking')} className="flex w-full items-center gap-3 rounded-lg border border-slate-100 px-3 py-2 text-left hover:border-violet-200 hover:bg-violet-50/40"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-500"><Icon name="bank" /></span><span className="min-w-0 flex-1"><b className="block truncate text-xs text-slate-800">{transaction.description || 'Statement line'}</b><span className="text-[10px] text-slate-400">{dateLabel(transaction.transaction_date)}</span></span><span className="font-mono tabular-nums text-xs font-bold text-slate-800">{money(transaction.amount)}</span></button>) : <div className="rounded-lg bg-emerald-50 p-3 text-xs text-emerald-800"><b>Queue clear.</b> No uncleared statement lines are currently visible.</div>}
              </div>
              <button type="button" onClick={() => go('/next-workspace/banking')} className="mt-3 flex w-full items-center justify-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">Open Banking <Icon name="arrow" /></button>
            </section>

            <section className="border border-slate-200/90 bg-slate-950 p-4 text-white shadow-xs">
              <p className="text-[10px] font-bold uppercase tracking-[.14em] text-slate-400">Counter</p>
              <h2 className="mt-0.5 text-sm font-bold">Quick Counter Launch</h2>
              <p className="mt-1 text-xs leading-5 text-slate-400">Open the production Cash Bill flow for walk-in sales, cash or UPI.</p>
              <button type="button" onClick={() => go('/next-workspace/cash-bill')} className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-white px-3 py-2.5 text-xs font-bold text-slate-950 hover:bg-slate-100"><Icon name="cash" /> Open POS Cash Bill</button>
            </section>

            <section className="border border-slate-200/90 bg-white p-4 shadow-xs">
              <p className="text-[10px] font-bold uppercase tracking-[.14em] text-slate-400">Workspace</p>
              <h2 className="mt-0.5 text-sm font-bold text-slate-900">Quick links</h2>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button type="button" onClick={() => go('/next-workspace/customers')} className="rounded-lg border border-slate-200 px-3 py-2 text-left text-xs font-bold text-slate-700 hover:border-violet-200 hover:bg-violet-50"><Icon name="customer" /><span className="mt-1 block">Customers</span></button>
                <button type="button" onClick={() => go('/next-workspace/payments')} className="rounded-lg border border-slate-200 px-3 py-2 text-left text-xs font-bold text-slate-700 hover:border-violet-200 hover:bg-violet-50"><span className="text-base">₹</span><span className="mt-1 block">Payments</span></button>
                <button type="button" onClick={() => go('/next-workspace/reports')} className="rounded-lg border border-slate-200 px-3 py-2 text-left text-xs font-bold text-slate-700 hover:border-violet-200 hover:bg-violet-50"><span className="text-base">↗</span><span className="mt-1 block">Reports</span></button>
                <button type="button" onClick={() => go('/next-workspace/accounting')} className="rounded-lg border border-slate-200 px-3 py-2 text-left text-xs font-bold text-slate-700 hover:border-violet-200 hover:bg-violet-50"><span className="text-base">∑</span><span className="mt-1 block">Accounting</span></button>
              </div>
            </section>
          </aside>
        </div>

        {configuration?.recommendations.length ? <div className="mt-4 border border-slate-200/90 bg-white px-4 py-3 shadow-xs"><div className="flex flex-col gap-2 sm:flex-row sm:items-center"><p className="shrink-0 text-[10px] font-bold uppercase tracking-[.14em] text-slate-400">Workspace recommendations</p><div className="grid flex-1 gap-1 text-[11px] text-slate-600 sm:grid-cols-2 lg:grid-cols-4">{configuration.recommendations.slice(0, 4).map((item) => <span key={item} className="rounded-md bg-slate-50 px-2 py-1">{item}</span>)}</div></div></div> : null}
      </div>

      <DetailDrawer open={Boolean(selectedInvoice)} onClose={() => setSelectedInvoice(null)} title={selectedInvoice?.invoice_number || 'Transaction'} description={selectedInvoice ? customerName(selectedInvoice.customer_id) + ' · ' + dateLabel(selectedInvoice.invoice_date) : undefined} footer={<div className="flex justify-end gap-2"><button type="button" onClick={() => setSelectedInvoice(null)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700">Close</button><button type="button" onClick={() => selectedInvoice && go('/next-workspace/sales')} className="rounded-lg bg-violet-600 px-3 py-2 text-xs font-bold text-white">Open Sales</button></div>}>
        {selectedInvoice ? <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3"><div className="border border-slate-200 p-3"><p className="text-[10px] uppercase tracking-[.12em] text-slate-400">Document total</p><p className="mt-1 font-mono tabular-nums text-xl font-bold text-slate-900">{money(selectedInvoice.total)}</p></div><div className="border border-slate-200 p-3"><p className="text-[10px] uppercase tracking-[.12em] text-slate-400">Balance due</p><p className="mt-1 font-mono tabular-nums text-xl font-bold text-slate-900">{money(selectedInvoice.balance_due)}</p></div></div>
          <div className="flex items-center justify-between border-b border-slate-100 pb-3"><span className="text-xs font-semibold text-slate-500">Status</span><StatusBadge status={normalizeFinOpsStatus(selectedInvoice.status)} /></div>
          <div><p className="text-[10px] font-bold uppercase tracking-[.14em] text-slate-400">Audit context</p><dl className="mt-2 divide-y divide-slate-100 text-xs"><div className="flex justify-between gap-4 py-2"><dt className="text-slate-500">Invoice date</dt><dd className="font-semibold text-slate-800">{dateLabel(selectedInvoice.invoice_date)}</dd></div><div className="flex justify-between gap-4 py-2"><dt className="text-slate-500">Customer</dt><dd className="font-semibold text-slate-800">{customerName(selectedInvoice.customer_id)}</dd></div><div className="flex justify-between gap-4 py-2"><dt className="text-slate-500">Invoice ID</dt><dd className="max-w-[260px] truncate font-mono text-[10px] text-slate-500">{selectedInvoice.id}</dd></div></dl></div>
        </div> : null}
      </DetailDrawer>
    </main>
  );
}
