'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase, type BusinessContext } from '@/lib/supabase';
import { Button, Card, EmptyState, StatusBadge } from '@/components/moneymatters';
import { PageHeader } from '@/components/ui/finops/PageHeader';
import { StatCard } from '@/components/ui/finops/StatCard';
import type { FinOpsSemanticTone } from '@/components/ui/finops/semantic';
import CustomerCreditApplyModal from './CustomerCreditApplyModal';
import CustomerRefundModal from './CustomerRefundModal';
import CollectionDrawer, { type CollectionInvoice } from '../invoices/CollectionDrawer';

type Params = { params: Promise<{ id: string }> };
type Customer = {
  id: string;
  display_name: string;
  legal_name: string | null;
  email: string | null;
  phone: string | null;
  tax_id: string | null;
  payment_terms_days: number;
  payment_reminders_enabled: boolean;
  reminder_days_before_due: number;
  default_discount_type: string;
  default_discount_value: number;
  notes: string | null;
};
type Summary = {
  lifetime_invoiced: number;
  lifetime_paid_on_invoices: number;
  outstanding: number;
  overdue: number;
  last_payment_date: string | null;
  lifetime_payments: number;
  invoice_count: number;
  quotation_count: number;
  receipt_count: number;
};
type Entry = {
  entry_date: string;
  entry_type: string;
  reference: string;
  source_id: string;
  debit: number;
  credit: number;
  running_balance: number;
};
type CustomerCredit = {
  id: string;
  entry_type: string;
  amount: number;
  description: string | null;
  credit_note_id: string | null;
  payment_id: string | null;
  refund_id: string | null;
  created_at: string;
};
type CustomerRefund = {
  id: string;
  refund_date: string;
  amount: number;
  method: string;
  reference: string | null;
  reason: string | null;
  status: string;
  journal_entry_id: string | null;
};
type InvoiceTarget = {
  id: string;
  invoice_number: string;
  balance_due: number;
  status: string;
  total: number;
  due_date: string;
  currency_code: string;
};
type Row = Record<string, string>;

const money = (n: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(Number(n || 0));

export default function Customer360Controlled({ params }: Params) {
  const [id, setId] = useState('');
  const [businessId, setBusinessId] = useState('');
  const [businessRole, setBusinessRole] = useState('');
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [invoices, setInvoices] = useState<Row[]>([]);
  const [invoiceTargets, setInvoiceTargets] = useState<InvoiceTarget[]>([]);
  const [quotes, setQuotes] = useState<Row[]>([]);
  const [payments, setPayments] = useState<Row[]>([]);
  const [receipts, setReceipts] = useState<Row[]>([]);
  const [credits, setCredits] = useState<CustomerCredit[]>([]);
  const [refunds, setRefunds] = useState<CustomerRefund[]>([]);
  const [tab, setTab] = useState('overview');
  const [applyCreditOpen, setApplyCreditOpen] = useState(false);
  const [refundCreditOpen, setRefundCreditOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [collectionInvoice, setCollectionInvoice] = useState<CollectionInvoice | null>(null);

  useEffect(() => {
    params.then((p) => setId(p.id));
  }, [params]);

  const load = async () => {
    if (!id) return;

    setLoading(true);
    setError('');

    const c = await supabase.rpc('get_my_business_context');
    const b = c.data?.[0] as BusinessContext | undefined;

    if (!b) {
      setError('Business context unavailable.');
      setLoading(false);
      return;
    }

    setBusinessId(b.business_id);
    setBusinessRole(b.role || '');

    const [cu, su, st, iv, qu, pa, re, cl, rf] = await Promise.all([
      supabase
        .from('customers')
        .select(
          'id,display_name,legal_name,email,phone,tax_id,payment_terms_days,payment_reminders_enabled,reminder_days_before_due,default_discount_type,default_discount_value,notes'
        )
        .eq('id', id)
        .eq('business_id', b.business_id)
        .maybeSingle(),
      supabase
        .from('customer_360_summary')
        .select('*')
        .eq('customer_id', id)
        .eq('business_id', b.business_id)
        .maybeSingle(),
      supabase
        .from('customer_statement_running')
        .select('entry_date,entry_type,reference,source_id,debit,credit,running_balance')
        .eq('customer_id', id)
        .eq('business_id', b.business_id)
        .order('entry_date'),
      supabase
        .from('invoices')
        .select('id,invoice_number,invoice_date,due_date,status,total,balance_due,currency_code')
        .eq('customer_id', id)
        .eq('business_id', b.business_id)
        .order('invoice_date', { ascending: false }),
      supabase
        .from('quotations')
        .select('quotation_number,quotation_date,status,total')
        .eq('customer_id', id)
        .eq('business_id', b.business_id)
        .order('quotation_date', { ascending: false }),
      supabase
        .from('payments')
        .select('payment_date,amount,method,reference')
        .eq('customer_id', id)
        .eq('business_id', b.business_id)
        .eq('direction', 'inbound')
        .order('payment_date', { ascending: false }),
      supabase
        .from('receipts')
        .select('receipt_number,receipt_date,amount,payment_method,reference_number')
        .eq('customer_id', id)
        .eq('business_id', b.business_id)
        .order('receipt_date', { ascending: false }),
      supabase
        .from('customer_credit_ledger')
        .select('id,entry_type,amount,description,credit_note_id,payment_id,refund_id,created_at')
        .eq('customer_id', id)
        .eq('business_id', b.business_id)
        .order('created_at', { ascending: false }),
      supabase
        .from('customer_refunds')
        .select('id,refund_date,amount,method,reference,reason,status,journal_entry_id')
        .eq('customer_id', id)
        .eq('business_id', b.business_id)
        .order('refund_date', { ascending: false }),
    ]);

    if (cu.error || !cu.data) {
      setError(cu.error?.message || 'Customer not found');
    } else {
      setCustomer(cu.data as Customer);
    }

    setSummary((su.data || null) as Summary | null);
    setEntries((st.data || []) as Entry[]);
    setInvoices((iv.data || []) as Row[]);
    setInvoiceTargets(
      (iv.data || []).map((x: any) => ({
        id: x.id,
        invoice_number: x.invoice_number,
        balance_due: Number(x.balance_due || 0),
        status: x.status,
        total: Number(x.total || 0),
        due_date: x.due_date,
        currency_code: x.currency_code || 'INR',
      }))
    );
    setQuotes((qu.data || []) as Row[]);
    setPayments((pa.data || []) as Row[]);
    setReceipts((re.data || []) as Row[]);
    setCredits((cl.data || []) as CustomerCredit[]);
    setRefunds((rf.data || []) as CustomerRefund[]);
    setLoading(false);
  };

  useEffect(() => {
    if (id) void load();
  }, [id]);

  const tabs = ['overview', 'invoices', 'payments', 'receipts', 'credits', 'statement'];
  const opening = useMemo(
    () =>
      entries.length
        ? Number(entries[0].running_balance) -
          Number(entries[0].debit) +
          Number(entries[0].credit)
        : 0,
    [entries]
  );
  const availableCredit = useMemo(
    () => credits.reduce((total, row) => total + Number(row.amount || 0), 0),
    [credits]
  );

  if (loading) {
    return <main className="p-6 text-sm text-slate-500">Loading Customer 360…</main>;
  }

  if (error || !customer) {
    return (
      <main className="p-6">
        <Card className="mx-auto max-w-2xl p-8">
          <h1 className="text-xl font-semibold">Customer unavailable</h1>
          <p className="mt-2 text-sm text-slate-500">{error}</p>
          <Button
            variant="secondary"
            className="mt-5"
            onClick={() => {
              location.href = '/next-workspace/customers';
            }}
          >
            Back to customers
          </Button>
        </Card>
      </main>
    );
  }

  const whatsapp = customer.phone
    ? `https://wa.me/${customer.phone.replace(/\D/g, '')}?text=${encodeURIComponent(
        `Hello ${customer.display_name}, your current outstanding balance is ${money(
          Number(summary?.outstanding || 0)
        )}.`
      )}`
    : null;

  return (
    <main className="min-h-screen bg-[#f7f6fb] p-4 sm:p-7">
      <div className="mx-auto max-w-7xl">
        <PageHeader
          breadcrumbs={[{label:'Workspace',href:'/next-workspace'},{label:'Sales & billing',href:'/next-workspace/customers'},{label:'Customer 360'}]}
          title={customer.display_name}
          subtitle={`${customer.phone || 'No phone'} · ${customer.email || 'No email'}${customer.tax_id ? ` · ${customer.tax_id}` : ''}`}
          badge={{label:'Customer 360',variant:'inflow'}}
          actions={
            <>
              <Button onClick={() => (location.href = '/next-workspace/sales')}>＋ Invoice</Button>
              <Button
                variant="secondary"
                onClick={() => (location.href = '/next-workspace/quotation')}
              >
                ＋ Quotation
              </Button>
              {whatsapp && (
                <Button
                  variant="secondary"
                  onClick={() =>
                    window.open(whatsapp, '_blank', 'noopener,noreferrer')
                  }
                >
                  WhatsApp
                </Button>
              )}
              <Button variant="secondary" onClick={() => window.print()}>
                Print
              </Button>
            </>
          }
        />

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Metric label="Outstanding" value={money(Number(summary?.outstanding || 0))} tone="inflow" />
          <Metric label="Overdue" value={money(Number(summary?.overdue || 0))} tone="pending" />
          <Metric label="Lifetime sales" value={money(Number(summary?.lifetime_invoiced || 0))} tone="inflow" />
          <Metric label="Last payment" value={summary?.last_payment_date || '—'} tone="neutral" />
          <Metric label="Available credit" value={money(availableCredit)} tone="treasury" />
        </div>

        <div className="mt-5 flex gap-1 overflow-x-auto border-b border-slate-200">
          {tabs.map((t) => (
            <button
              type="button"
              key={t}
              onClick={() => setTab(t)}
              aria-selected={tab === t}
              className={`whitespace-nowrap rounded-t-xl px-4 py-3 text-sm font-semibold capitalize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-200 ${tab === t ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500 hover:bg-white/70'}`}
            >
              {t}
            </button>
          ))}
        </div>

        {tab === 'overview' && (
          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <Card className="p-6">
              <h2 className="font-semibold">Financial relationship</h2>
              <div className="mt-5 grid grid-cols-2 gap-5 text-sm">
                <Stat label="Invoices" value={String(summary?.invoice_count || 0)} />
                <Stat label="Quotations" value={String(summary?.quotation_count || 0)} />
                <Stat label="Payments" value={money(Number(summary?.lifetime_payments || 0))} />
                <Stat label="Receipts" value={String(summary?.receipt_count || 0)} />
              </div>
            </Card>

            <Card className="p-6">
              <h2 className="font-semibold">Collection preferences</h2>
              <div className="mt-4 space-y-2 text-sm">
                <p>
                  Payment reminders: <b>{customer.payment_reminders_enabled ? 'On' : 'Off'}</b>
                </p>
                <p>
                  Reminder: <b>{customer.reminder_days_before_due} days before due</b>
                </p>
                <p>
                  Terms:{' '}
                  <b>{customer.payment_terms_days ? `Net ${customer.payment_terms_days}` : 'Due on receipt'}</b>
                </p>
                <p>
                  Default discount:{' '}
                  <b>
                    {customer.default_discount_type === 'percent'
                      ? `${customer.default_discount_value}%`
                      : customer.default_discount_type === 'amount'
                        ? money(customer.default_discount_value)
                        : 'None'}
                  </b>
                </p>
              </div>
            </Card>

            <Card className="p-6 lg:col-span-2">
              <h2 className="font-semibold">Recent activity</h2>
              {entries.length ? (
                <div className="mt-3 divide-y divide-slate-100">
                  {entries.slice(-8).reverse().map((e) => (
                    <div
                      key={`${e.entry_type}-${e.source_id}`}
                      className="flex items-center justify-between py-3 text-sm"
                    >
                      <span>
                        <b className="capitalize">{e.entry_type}</b>
                        <span className="ml-2 text-slate-400">
                          {e.reference} · {e.entry_date}
                        </span>
                      </span>
                      <span className="font-semibold">
                        {e.debit ? money(e.debit) : `-${money(e.credit)}`}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState
                  title="No financial activity yet"
                  description="Invoices, payments and receipts will appear here as they occur."
                />
              )}
            </Card>
          </div>
        )}

        {tab === 'statement' && (
          <Card className="mt-5 overflow-hidden">
            <div className="flex flex-col gap-2 p-5 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs font-semibold text-slate-400">
                  Opening balance {money(opening)}
                </p>
                <h2 className="mt-1 text-xl font-semibold">Statement of account</h2>
              </div>
              <Button variant="secondary" onClick={() => window.print()}>
                Print / PDF
              </Button>
            </div>
            <DataTable
              headers={['Date', 'Document', 'Debit', 'Credit', 'Balance']}
              rows={entries.map((e) => [
                e.entry_date,
                e.reference || e.entry_type,
                e.debit ? money(e.debit) : '—',
                e.credit ? money(e.credit) : '—',
                money(e.running_balance),
              ])}
              empty="No statement activity yet."
            />
          </Card>
        )}

        {tab === 'invoices' && (
          <Card className="mt-5 overflow-hidden">
            <div className="border-b border-slate-100 px-5 py-4"><h2 className="font-semibold">Invoices & collections</h2><p className="mt-1 text-xs text-slate-500">Open a single invoice directly into the collection workflow.</p></div>
            <div className="overflow-x-auto"><table className="min-w-[920px] w-full text-left text-xs">
              <thead><tr className="border-b border-slate-100 bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-500"><th className="px-4 py-3">Invoice</th><th className="px-4 py-3">Date</th><th className="px-4 py-3">Due</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Total</th><th className="px-4 py-3 text-right">Balance</th><th className="px-4 py-3 text-right">Action</th></tr></thead>
              <tbody>{invoices.map((x) => { const balance=Number(x.balance_due||0); const currentStatus=balance<=0?'Paid':x.status==='draft'?'Draft':new Date(x.due_date+'T23:59:59')<new Date()?'Overdue':'Unpaid'; return <tr key={x.id||x.invoice_number} className="border-b border-slate-100 hover:bg-slate-50"><td className="px-4 py-3 font-mono font-medium">{x.invoice_number}</td><td className="px-4 py-3 text-slate-500">{x.invoice_date}</td><td className="px-4 py-3 text-slate-500">{x.due_date}</td><td className="px-4 py-3"><span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold">{currentStatus}</span></td><td className="px-4 py-3 text-right font-mono tabular-nums">{money(Number(x.total||0))}</td><td className="px-4 py-3 text-right font-mono font-semibold tabular-nums">{money(balance)}</td><td className="px-4 py-3 text-right">{currentStatus!=='Paid'&&currentStatus!=='Draft'?<button type="button" onClick={()=>setCollectionInvoice({id:x.id,invoice_number:x.invoice_number,customer_id:id,customer_name:customer.display_name,balance_due:balance,total:Number(x.total||0),status:x.status,due_date:x.due_date,currency_code:x.currency_code||'INR'})} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700">Collect</button>:<span className="text-[10px] text-slate-400">—</span>}</td></tr>; })}</tbody>
            </table></div>
          </Card>
        )}

        {tab === 'payments' && (
          <DataTable
            headers={['Date', 'Amount', 'Method', 'Reference']}
            rows={payments.map((x) => [
              x.payment_date,
              money(Number(x.amount)),
              x.method,
              x.reference || '—',
            ])}
            empty="No payments yet."
          />
        )}

        {tab === 'receipts' && (
          <DataTable
            headers={['Receipt', 'Date', 'Amount', 'Method', 'Reference']}
            rows={receipts.map((x) => [
              x.receipt_number,
              x.receipt_date,
              money(Number(x.amount)),
              x.payment_method || '—',
              x.reference_number || '—',
            ])}
            empty="No receipts yet."
          />
        )}

        {tab === 'credits' && (
          <div>
            {availableCredit > 0.005 && (
              <div className="mt-5 flex flex-wrap justify-end gap-2">
                <Button variant="secondary" onClick={() => setApplyCreditOpen(true)}>
                  Apply credit to invoice
                </Button>
                <Button variant="secondary" onClick={() => setRefundCreditOpen(true)}>
                  Refund credit
                </Button>
              </div>
            )}

            <DataTable
              headers={['Date', 'Type', 'Amount', 'Description']}
              rows={credits.map((x) => [
                new Date(x.created_at).toLocaleDateString('en-IN'),
                x.entry_type,
                money(Number(x.amount)),
                x.description || 'Customer credit ledger entry',
              ])}
              empty="No customer credit activity yet."
            />

            <DataTable
              headers={['Refund', 'Date', 'Amount', 'Method', 'Reference', 'Status']}
              rows={refunds.map((x) => [
                x.id.slice(0, 8),
                x.refund_date,
                money(Number(x.amount)),
                x.method,
                x.reference || '—',
                x.status,
              ])}
              empty="No customer refunds yet."
            />
          </div>
        )}
      </div>

      {applyCreditOpen && (
        <CustomerCreditApplyModal
          open={applyCreditOpen}
          businessId={businessId}
          customerId={id}
          available={Math.max(availableCredit, 0)}
          invoices={invoiceTargets}
          onClose={() => setApplyCreditOpen(false)}
          onSaved={load}
        />
      )}

      {collectionInvoice && businessId && <CollectionDrawer businessId={businessId} invoice={collectionInvoice} canWriteOff={/owner|accountant/.test(businessRole.toLowerCase())} onClose={()=>setCollectionInvoice(null)} onUpdated={load} />}

      {refundCreditOpen && (
        <CustomerRefundModal
          open={refundCreditOpen}
          businessId={businessId}
          customerId={id}
          available={Math.max(availableCredit, 0)}
          onClose={() => setRefundCreditOpen(false)}
          onSaved={load}
        />
      )}
    </main>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: FinOpsSemanticTone }) {
  return <StatCard title={label} value={value} tone={tone} className="min-h-[100px] p-4"/>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-xs text-slate-400">{label}</span>
      <b className="mt-1 block">{value}</b>
    </div>
  );
}

function DataTable({
  headers,
  rows,
  empty,
}: {
  headers: string[];
  rows: string[][];
  empty: string;
}) {
  return (
    <Card className="mt-5 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[700px] text-left text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              {headers.map((h) => (
                <th key={h} className="px-5 py-3">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-slate-100">
                {r.map((v, j) => (
                  <td key={j} className="px-5 py-3">
                    {j === 3 &&
                    ['draft', 'paid', 'overdue', 'sent', 'accepted'].includes(v) ? (
                      <StatusBadge status={v} />
                    ) : (
                      v
                    )}
                  </td>
                ))}
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={headers.length}>
                  <EmptyState title={empty} />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
