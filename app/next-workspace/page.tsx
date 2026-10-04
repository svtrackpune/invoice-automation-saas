'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase, type BusinessContext } from '@/lib/supabase';
import StatusBadge, { normalizeFinOpsStatus } from '@/components/ui/finops/StatusBadge';
import DetailDrawer from '@/components/ui/finops/DetailDrawer';
import { FinOpsCard, FinOpsIcon, FinOpsPageHeader, FinOpsPrimaryButton, FinOpsSectionLabel, FinOpsSecondaryButton, FinOpsStatusPill } from '@/components/ui/finops/FinOpsPrimitives';
import { StatCardSkeleton, TableRowsSkeleton } from '@/components/ui/finops/Skeletons';

type Customer = { id: string; display_name: string };
type Invoice = { id: string; invoice_number: string; invoice_date: string; status: string; total: number; balance_due: number; customer_id: string; document_kind?: string | null };
type Payment = { id: string; payment_date: string; amount: number; direction: string; method: string; reference: string | null; invoice_id: string | null; customer_id: string | null };
type Bank = { id: string; name: string; account_last4: string | null };
type Rec = { id: string; bank_account_id: string; period_end: string; status: string };
type BankTx = { id: string; bank_account_id: string; transaction_date: string; description: string | null; amount: number; direction: string; status: string };

const money = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(value || 0));
const dateLabel = (value: string) => new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value));
const dateKey = (d: Date) => { const x = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return x.toISOString().slice(0, 10); };
const monthStart = (offset = 0) => { const d = new Date(); return dateKey(new Date(d.getFullYear(), d.getMonth() + offset, 1)); };
const today = () => dateKey(new Date());

function trendPercent(current: number, previous: number) {
  if (Math.abs(previous) < 0.01) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function Trend({ current, previous }: { current: number; previous: number }) {
  const pct = trendPercent(current, previous);
  if (pct === null) return <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-600">No prior baseline</span>;
  const positive = pct >= 0;
  return <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${positive ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>{positive ? '↑' : '↓'} {Math.abs(pct).toFixed(1)}% vs last month</span>;
}

function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = Math.max(max - min, 1);
  const points = values.map((v, i) => {
    const x = (i / Math.max(values.length - 1, 1)) * 72;
    const y = 22 - ((v - min) / range) * 18;
    return x.toFixed(1) + ',' + y.toFixed(1);
  }).join(' ');
  return <svg viewBox="0 0 72 24" className="h-7 w-20 text-indigo-500" aria-hidden="true"><polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}

function KpiCard({ label, value, children, sparkline }: { label: string; value: string; children?: React.ReactNode; sparkline?: React.ReactNode }) {
  return <FinOpsCard className="min-h-[128px] p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><FinOpsSectionLabel>{label}</FinOpsSectionLabel><div className="mt-2 font-mono tabular-nums text-2xl font-bold tracking-tight text-slate-900">{value}</div></div>{sparkline}</div>{children ? <div className="mt-3">{children}</div> : null}</FinOpsCard>;
}

export default function NextWorkspace() {
  const [contexts, setContexts] = useState<BusinessContext[]>([]);
  const [ctx, setCtx] = useState<BusinessContext | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [previousPayments, setPreviousPayments] = useState<Payment[]>([]);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [reconciliations, setReconciliations] = useState<Rec[]>([]);
  const [bankTransactions, setBankTransactions] = useState<BankTx[]>([]);
  const [eInvoiceConfigured, setEInvoiceConfigured] = useState(false);
  const [cashBillEnabled, setCashBillEnabled] = useState(false);
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
      const result = await supabase.rpc('get_my_business_context');
      if (!alive) return;
      if (result.error || !result.data?.length) {
        setError(result.error?.message || 'No business workspace is available for this account.');
        setLoading(false);
        return;
      }
      const rows = result.data as BusinessContext[];
      const saved = localStorage.getItem('moneymatters.activeBusinessId');
      const selected = rows.find((x) => x.business_id === saved) || rows[0];
      setContexts(rows);
      setCtx(selected);
      localStorage.setItem('moneymatters.activeBusinessId', selected.business_id);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!ctx) return;
    let alive = true;
    (async () => {
      const [businessResult, settingsResult] = await Promise.all([
        supabase.from('businesses').select('e_invoice_endpoint_id,e_invoice_endpoint_scheme').eq('id', ctx.business_id).maybeSingle(),
        supabase.from('business_settings').select('cash_bill_enabled').eq('business_id', ctx.business_id).maybeSingle(),
      ]);
      if (!alive) return;
      setEInvoiceConfigured(Boolean(businessResult.data?.e_invoice_endpoint_id && businessResult.data?.e_invoice_endpoint_scheme));
      setCashBillEnabled(Boolean(settingsResult.data?.cash_bill_enabled));
    })();
    return () => { alive = false; };
  }, [ctx]);

  useEffect(() => {
    if (!ctx) return;
    let alive = true;
    (async () => {
      setError('');
      const currentStart = monthStart(0);
      const previousStart = monthStart(-1);
      const [customersResult, invoicesResult, paymentsResult, previousPaymentsResult, banksResult, recResult] = await Promise.all([
        supabase.from('customers').select('id,display_name').eq('business_id', ctx.business_id).eq('is_active', true).order('created_at', { ascending: false }).limit(200),
        supabase.from('invoices').select('id,invoice_number,invoice_date,status,total,balance_due,customer_id,document_kind').eq('business_id', ctx.business_id).order('invoice_date', { ascending: false }).limit(200),
        supabase.from('payments').select('id,payment_date,amount,direction,method,reference,invoice_id,customer_id').eq('business_id', ctx.business_id).gte('payment_date', currentStart).order('payment_date', { ascending: false }).limit(500),
        supabase.from('payments').select('id,payment_date,amount,direction,method,reference,invoice_id,customer_id').eq('business_id', ctx.business_id).gte('payment_date', previousStart).lt('payment_date', currentStart).order('payment_date', { ascending: false }).limit(500),
        supabase.from('bank_accounts').select('id,name,account_last4').eq('business_id', ctx.business_id).eq('is_active', true).order('name'),
        supabase.from('bank_reconciliations').select('id,bank_account_id,period_end,status').eq('business_id', ctx.business_id).order('period_end', { ascending: false }).limit(100),
      ]);
      if (!alive) return;
      const bankIds = (banksResult.data || []).map((bank) => bank.id);
      const txResult = bankIds.length
        ? await supabase.from('bank_transactions').select('id,bank_account_id,transaction_date,description,amount,direction,status').in('bank_account_id', bankIds).order('transaction_date', { ascending: false }).limit(500)
        : { data: [], error: null };
      const firstError = customersResult.error || invoicesResult.error || paymentsResult.error || previousPaymentsResult.error || banksResult.error || recResult.error || txResult.error;
      if (firstError) setError(firstError.message);
      setCustomers((customersResult.data || []) as Customer[]);
      setInvoices((invoicesResult.data || []) as Invoice[]);
      setPayments((paymentsResult.data || []) as Payment[]);
      setPreviousPayments((previousPaymentsResult.data || []) as Payment[]);
      setBanks((banksResult.data || []) as Bank[]);
      setReconciliations((recResult.data || []) as Rec[]);
      setBankTransactions((txResult.data || []) as BankTx[]);
    })();
    return () => { alive = false; };
  }, [ctx, refresh]);

  const customerName = (id: string) => customers.find((customer) => customer.id === id)?.display_name || 'Customer';

  const metrics = useMemo(() => {
    const sumNet = (rows: Payment[]) => rows.reduce((sum, payment) => {
      const signed = String(payment.direction).toLowerCase() === 'outbound' ? -Number(payment.amount || 0) : Number(payment.amount || 0);
      return sum + signed;
    }, 0);
    const netCash = sumNet(payments);
    const previousNetCash = sumNet(previousPayments);
    const outstanding = invoices.filter((invoice) => !['paid', 'void', 'voided'].includes(invoice.status)).reduce((sum, invoice) => sum + Number(invoice.balance_due || 0), 0);
    const overdue = invoices.filter((invoice) => {
      return Number(invoice.balance_due || 0) > 0 && new Date(`${invoice.invoice_date}T23:59:59`) < new Date();
    });
    const aging = overdue.reduce((acc, invoice) => {
      const dueBasis = Math.max(0, Math.floor((Date.now() - new Date(invoice.invoice_date).getTime()) / 86400000));
      const amount = Number(invoice.balance_due || 0);
      if (dueBasis >= 90) acc.n90 += amount;
      else if (dueBasis >= 60) acc.n60 += amount;
      else acc.n30 += amount;
      return acc;
    }, { n30: 0, n60: 0, n90: 0 });
    const latestByBank = banks.map((bank) => reconciliations.find((rec) => rec.bank_account_id === bank.id));
    const reconciledAccounts = latestByBank.filter((rec) => rec?.status === 'locked').length;
    const pendingLines = bankTransactions.filter((transaction) => !['reconciled', 'ignored'].includes(String(transaction.status).toLowerCase())).length;
    const todayCashBills = invoices.filter(invoice => invoice.invoice_date === today() && invoice.document_kind === 'cash_bill').reduce((sum, invoice) => sum + Number(invoice.total || 0), 0);
    return { netCash, previousNetCash, outstanding, overdue, aging, reconciledAccounts, pendingLines, todayCashBills };
  }, [banks, bankTransactions, invoices, payments, previousPayments, reconciliations]);

  const periodLabel = useMemo(() => new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' }).format(new Date()), []);
  const recent = invoices.slice(0, 8);
  const queue = bankTransactions.filter((transaction) => !['reconciled', 'ignored'].includes(String(transaction.status).toLowerCase())).slice(0, 5);

  if (loading) {
    return <main className="finops-page"><div className="finops-page-inner space-y-4"><div className="h-20 animate-pulse rounded-xl bg-slate-200/60"/><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><StatCardSkeleton/><StatCardSkeleton/><StatCardSkeleton/><StatCardSkeleton/></div><div className="grid gap-4 xl:grid-cols-[minmax(0,62fr)_minmax(280px,38fr)]"><div className="h-[560px] animate-pulse rounded-xl bg-slate-200/60"/><div className="h-[560px] animate-pulse rounded-xl bg-slate-200/60"/></div></div></main>;
  }

  if (!ctx) {
    return <main className="finops-page"><div className="finops-page-inner"><FinOpsCard className="p-8 text-center"><h1 className="text-xl font-bold text-slate-900">Business setup required</h1><p className="mt-2 text-sm text-slate-500">{error || 'Create a business before using the workspace.'}</p><FinOpsPrimaryButton className="mt-5" onClick={() => go('/')}>Open setup</FinOpsPrimaryButton></FinOpsCard></div></main>;
  }

  return (
    <main className="finops-page">
      <div className="finops-page-inner space-y-4">
        <FinOpsPageHeader
          breadcrumb="Dashboard / Executive Overview"
          title={ctx.business_name}
          context={contexts.length > 1 ? <select value={ctx.business_id} onChange={event => { const next = contexts.find(item => item.business_id === event.target.value); if (next) { setCtx(next); localStorage.setItem('moneymatters.activeBusinessId', next.business_id); } }} className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700">{contexts.map(item => <option key={item.business_id} value={item.business_id}>{item.business_name}</option>)}</select> : null}
          status={<FinOpsStatusPill label={`Period: ${periodLabel} • Open`} tone="neutral"/>}
          description="Executive command center for cash movement, receivables, bank control and compliant document operations."
          action={<><FinOpsSecondaryButton onClick={() => go('/next-workspace/cash-bill')} disabled={!cashBillEnabled}><FinOpsIcon name="cash"/>+ Cash Bill</FinOpsSecondaryButton><FinOpsSecondaryButton onClick={() => go('/next-workspace/invoices/new')}><FinOpsIcon name="invoice"/>+ New Invoice</FinOpsSecondaryButton><FinOpsSecondaryButton onClick={() => go('/next-workspace/banking')}><FinOpsIcon name="import"/>Import Statement</FinOpsSecondaryButton><FinOpsSecondaryButton onClick={() => setRefresh(v => v + 1)}><FinOpsIcon name="refresh"/>Refresh</FinOpsSecondaryButton></>}
        />

        {error ? <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800">{error}</div> : null}

        <section aria-label="Executive KPIs" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Net Cash Flow · MTD" value={money(metrics.netCash)} sparkline={<Sparkline values={[metrics.previousNetCash, metrics.netCash, metrics.netCash * 0.8, metrics.netCash * 1.04]}/>}>
            <div className="flex flex-wrap items-center gap-2"><span className="text-[11px] text-slate-500">Inflow {money(payments.filter(p => p.direction !== 'outbound').reduce((a,p)=>a+Number(p.amount||0),0))}</span><span className="text-slate-300">·</span><span className="text-[11px] text-slate-500">Outflow {money(payments.filter(p => p.direction === 'outbound').reduce((a,p)=>a+Number(p.amount||0),0))}</span><Trend current={metrics.netCash} previous={metrics.previousNetCash}/></div>
          </KpiCard>
          <KpiCard label="Accounts Receivable" value={money(metrics.outstanding)}><div className="flex flex-wrap gap-1.5">{[['30d',metrics.aging.n30],['60d',metrics.aging.n60],['90d+',metrics.aging.n90]].map(([label,value]) => <span key={label} className="rounded-full border border-rose-200 bg-rose-50 px-2 py-1 text-[10px] font-semibold text-rose-700">{label} {money(Number(value))}</span>)}</div></KpiCard>
          <KpiCard label="Bank Reconciliation" value={banks.length ? `${metrics.reconciledAccounts}/${banks.length}` : '—'}><div className="flex items-center justify-between gap-3"><span className="text-[11px] text-slate-500">{metrics.pendingLines} uncleared statement lines</span><span className="text-[11px] font-semibold text-slate-700">{banks.length ? Math.round((metrics.reconciledAccounts / banks.length) * 100) : 0}%</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-slate-700 transition-all" style={{ width: `${banks.length ? Math.round((metrics.reconciledAccounts / banks.length) * 100) : 0}%` }}/></div></KpiCard>
          <KpiCard label="E-Invoicing Clearance"><div className="flex items-center gap-2">{eInvoiceConfigured ? <FinOpsStatusPill label="Endpoint configured" tone="success"/> : <FinOpsStatusPill label="Not configured" tone="warning"/>}</div><p className="mt-2 text-[11px] leading-4 text-slate-500">{eInvoiceConfigured ? 'PEPPOL endpoint identity is configured. Clearance/dispatch result is not stored in this dashboard.' : 'Configure the business endpoint to enable the existing e-invoicing document paths.'}</p></KpiCard>
        </section>

        <section className="grid gap-4 xl:grid-cols-[minmax(0,62fr)_minmax(280px,38fr)]">
          <FinOpsCard className="min-w-0 overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-slate-200/80 px-4 py-3"><div><FinOpsSectionLabel>Live operations</FinOpsSectionLabel><h2 className="mt-0.5 text-sm font-semibold text-slate-900">Transaction Ledger</h2></div><button type="button" onClick={() => go('/next-workspace/invoices')} className="text-xs font-semibold text-indigo-700 hover:text-indigo-800">View all →</button></div>
            <div className="overflow-x-auto"><table className="finops-table min-w-[760px] text-left text-xs"><thead><tr><th>Date</th><th>Document #</th><th>Counterparty</th><th>Status</th><th className="text-right">Amount</th><th className="text-right">Actions</th></tr></thead><tbody>
              {recent.map(invoice => <tr key={invoice.id} className="cursor-pointer" onClick={() => setSelectedInvoice(invoice)}>
                <td className="whitespace-nowrap font-mono text-[11px] text-slate-500">{dateLabel(invoice.invoice_date)}</td>
                <td><span className="font-semibold text-slate-900">{invoice.invoice_number}</span><span className="ml-2 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[9px] font-semibold text-slate-500">{invoice.document_kind === 'cash_bill' ? 'Cash Bill' : 'Invoice'}</span></td>
                <td className="max-w-[230px] truncate text-slate-700">{customerName(invoice.customer_id)}</td>
                <td><StatusBadge status={normalizeFinOpsStatus(invoice.status)}/></td>
                <td className="finops-amount text-right text-sm font-semibold text-slate-900">{money(invoice.total)}</td>
                <td className="text-right"><button type="button" onClick={event => { event.stopPropagation(); setSelectedInvoice(invoice); }} className="rounded-md border border-slate-200 px-2 py-1 text-[10px] font-semibold text-slate-600 hover:bg-slate-50">Open</button></td>
              </tr>)}
              {!recent.length ? <tr><td colSpan={6} className="p-10 text-center text-sm text-slate-500">No transactions yet.</td></tr> : null}
            </tbody></table></div>
          </FinOpsCard>

          <aside className="space-y-4">
            <FinOpsCard className="overflow-hidden">
              <div className="border-b border-slate-200/80 px-4 py-3"><div className="flex items-center justify-between gap-3"><div><FinOpsSectionLabel>Bank control</FinOpsSectionLabel><h2 className="mt-0.5 text-sm font-semibold text-slate-900">Fast Reconciliation Queue</h2></div><span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-700">{metrics.pendingLines} pending</span></div></div>
              <div className="p-3">{queue.length ? queue.map(transaction => <button key={transaction.id} type="button" onClick={() => go('/next-workspace/banking')} className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2.5 text-left hover:bg-slate-50"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-500"><FinOpsIcon name="bank"/></span><span className="min-w-0 flex-1"><b className="block truncate text-xs font-semibold text-slate-800">{transaction.description || 'Statement line'}</b><span className="font-mono text-[10px] text-slate-400">{dateLabel(transaction.transaction_date)}</span></span><span className="finops-amount text-xs font-semibold text-slate-800">{money(Math.abs(Number(transaction.amount || 0)))}</span><FinOpsIcon name="chevron" className="h-3.5 w-3.5 text-slate-300"/></button>) : <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700"><b>Queue clear.</b> No uncleared statement lines are visible.</div>}<FinOpsSecondaryButton className="mt-2.5 w-full" onClick={() => go('/next-workspace/banking')}>Open Reconciliation</FinOpsSecondaryButton></div>
            </FinOpsCard>

            <FinOpsCard className="p-4">
              <div className="flex items-start justify-between gap-3"><div><FinOpsSectionLabel>Point of sale</FinOpsSectionLabel><h2 className="mt-0.5 text-sm font-semibold text-slate-900">High-Velocity POS</h2></div><span className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${cashBillEnabled ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-300 bg-slate-100 text-slate-700'}`}>{cashBillEnabled ? 'Available' : 'Disabled'}</span></div>
              <div className="mt-4 grid grid-cols-2 gap-2"><div className="rounded-lg bg-slate-50 p-3"><span className="text-[10px] text-slate-400">Today’s register total</span><b className="finops-amount mt-1 block text-sm font-bold text-slate-900">{money(metrics.todayCashBills)}</b></div><div className="rounded-lg bg-slate-50 p-3"><span className="text-[10px] text-slate-400">Register status</span><b className="mt-1 block text-sm font-bold text-slate-900">{cashBillEnabled ? 'Ready' : 'Unavailable'}</b></div></div>
              <FinOpsPrimaryButton disabled={!cashBillEnabled} className="mt-3 w-full" onClick={() => go('/next-workspace/cash-bill')}><FinOpsIcon name="cash"/>Open POS Cash Bill (F10)</FinOpsPrimaryButton>
            </FinOpsCard>

            <FinOpsCard className="p-4">
              <FinOpsSectionLabel>Workspace</FinOpsSectionLabel><h2 className="mt-0.5 text-sm font-semibold text-slate-900">Quick Accounting</h2>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {[['Customers','customer','/next-workspace/customers'],['Payments','cash','/next-workspace/payments'],['Reports','report','/next-workspace/reports'],['Ledgers','audit','/next-workspace/accounting']].map(([label, icon, href]) => <button key={label} type="button" onClick={() => go(href)} className="group rounded-lg border border-slate-200 px-3 py-2.5 text-left hover:bg-slate-50"><FinOpsIcon name={icon as Parameters<typeof FinOpsIcon>[0]['name']} className="h-4 w-4 text-slate-400 group-hover:text-indigo-600"/><span className="mt-2 block text-xs font-semibold text-slate-700">{label}</span></button>)}
              </div>
            </FinOpsCard>
          </aside>
        </section>

        <DetailDrawer open={Boolean(selectedInvoice)} onClose={() => setSelectedInvoice(null)} title={selectedInvoice?.invoice_number || 'Transaction 360'} description={selectedInvoice ? `${customerName(selectedInvoice.customer_id)} · ${dateLabel(selectedInvoice.invoice_date)}` : undefined}
          footer={<div className="flex justify-end gap-2"><FinOpsSecondaryButton onClick={() => setSelectedInvoice(null)}>Close</FinOpsSecondaryButton><FinOpsPrimaryButton onClick={() => selectedInvoice && go('/next-workspace/documents?type=invoice&id=' + selectedInvoice.id)}>Open document</FinOpsPrimaryButton></div>}>
          {selectedInvoice ? <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3"><FinOpsCard className="p-3"><FinOpsSectionLabel>Document total</FinOpsSectionLabel><p className="finops-amount mt-1 text-xl font-bold text-slate-900">{money(selectedInvoice.total)}</p></FinOpsCard><FinOpsCard className="p-3"><FinOpsSectionLabel>Balance due</FinOpsSectionLabel><p className="finops-amount mt-1 text-xl font-bold text-slate-900">{money(selectedInvoice.balance_due)}</p></FinOpsCard></div>
            <div className="flex items-center justify-between border-b border-slate-100 pb-3"><span className="text-xs font-semibold text-slate-500">Status</span><StatusBadge status={normalizeFinOpsStatus(selectedInvoice.status)}/></div>
            <div><FinOpsSectionLabel>Transaction context</FinOpsSectionLabel><dl className="mt-2 divide-y divide-slate-100 text-xs"><div className="flex justify-between gap-4 py-2"><dt className="text-slate-500">Invoice date</dt><dd className="font-mono text-slate-800">{dateLabel(selectedInvoice.invoice_date)}</dd></div><div className="flex justify-between gap-4 py-2"><dt className="text-slate-500">Counterparty</dt><dd className="font-semibold text-slate-800">{customerName(selectedInvoice.customer_id)}</dd></div><div className="flex justify-between gap-4 py-2"><dt className="text-slate-500">Document ID</dt><dd className="max-w-[250px] truncate font-mono text-[10px] text-slate-500">{selectedInvoice.id}</dd></div></dl></div>
          </div> : null}
        </DetailDrawer>
      </div>
    </main>
  );
}
