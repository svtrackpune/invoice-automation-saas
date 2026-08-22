'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase, type BusinessContext } from '@/lib/supabase';

type Invoice = {
  id: string;
  invoice_number: string;
  invoice_date: string;
  due_date: string;
  status: string;
  total: number;
  amount_paid: number;
  balance_due: number;
  customer_id: string;
  customer?: { display_name: string; email: string | null; phone: string | null };
};

const money = (n: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(Number(n || 0));

const days = (date: string) =>
  Math.ceil((new Date(`${date}T23:59:59`).getTime() - Date.now()) / 86400000);

const invoiceStatus = (invoice: Invoice) => {
  if (Number(invoice.balance_due) <= 0) return 'Paid';
  if (invoice.status === 'draft') return 'Draft';
  if (new Date(`${invoice.due_date}T23:59:59`) < new Date()) return 'Overdue';
  return 'Unpaid';
};

export default function Invoices() {
  const [ctx, setCtx] = useState<BusinessContext | null>(null);
  const [rows, setRows] = useState<Invoice[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [q, setQ] = useState('');
  const [customerId, setCustomerId] = useState('all');
  const [state, setState] = useState('unpaid');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [menu, setMenu] = useState<string | null>(null);

  async function load() {
    const context = await supabase.rpc('get_my_business_context');
    const business = context.data?.[0] as BusinessContext | undefined;

    if (!business) {
      location.href = '/';
      return;
    }

    setCtx(business);

    const [invoiceResult, customerResult] = await Promise.all([
      supabase
        .from('invoices')
        .select(
          'id,invoice_number,invoice_date,due_date,status,total,amount_paid,balance_due,customer_id',
        )
        .eq('business_id', business.business_id)
        .order('due_date', { ascending: true }),
      supabase
        .from('customers')
        .select('id,display_name,email,phone')
        .eq('business_id', business.business_id)
        .eq('is_active', true)
        .order('display_name'),
    ]);

    if (invoiceResult.error) setError(invoiceResult.error.message);

    const customerRows = customerResult.data || [];
    setCustomers(customerRows);

    const customerMap = new Map(customerRows.map((customer) => [customer.id, customer]));
    setRows(
      (invoiceResult.data || []).map((invoice) => ({
        ...invoice,
        customer: customerMap.get(invoice.customer_id),
      })) as Invoice[],
    );
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    let result = rows.filter((invoice) => {
      const customerMatch = customerId === 'all' || invoice.customer_id === customerId;
      const dateMatch = (!from || invoice.invoice_date >= from) && (!to || invoice.invoice_date <= to);
      const searchText = `${invoice.invoice_number} ${invoice.customer?.display_name || ''} ${invoice.customer?.email || ''}`;
      const searchMatch = searchText.toLowerCase().includes(q.toLowerCase());
      return customerMatch && dateMatch && searchMatch;
    });

    if (state === 'unpaid') {
      result = result.filter(
        (invoice) => Number(invoice.balance_due) > 0 && invoiceStatus(invoice) !== 'Draft',
      );
    }

    if (state === 'drafts') {
      result = result.filter((invoice) => invoiceStatus(invoice) === 'Draft');
    }

    return result;
  }, [rows, customerId, state, from, to, q]);

  const unpaid = rows.filter(
    (invoice) => Number(invoice.balance_due) > 0 && invoiceStatus(invoice) !== 'Draft',
  );
  const overdue = unpaid.filter((invoice) => invoiceStatus(invoice) === 'Overdue');
  const due30 = unpaid.filter(
    (invoice) => invoiceStatus(invoice) !== 'Overdue' && days(invoice.due_date) <= 30,
  );
  const draftCount = rows.filter((invoice) => invoiceStatus(invoice) === 'Draft').length;

  if (loading) {
    return (
      <div className="grid min-h-[70vh] place-items-center text-sm text-slate-500">
        Loading invoices…
      </div>
    );
  }

  return (
    <main
      className="min-h-[calc(100vh-100px)] bg-[#fbfaff] p-4 sm:p-6 lg:p-8"
      onClick={() => setMenu(null)}
    >
      <div className="mx-auto max-w-[1450px]">
        <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[.18em] text-violet-600">
              Sales & payments
            </p>
            <h1 className="mt-1 text-3xl font-semibold">Invoices</h1>
            <p className="mt-1 text-sm text-slate-500">
              Create, review, collect and manage every invoice.
            </p>
          </div>
          <button
            type="button"
            onClick={() => (location.href = '/next-workspace/invoices/new')}
            className="rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white"
          >
            ＋ Create an Invoice
          </button>
        </header>

        {error && (
          <div className="mb-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</div>
        )}

        <section className="mb-5 grid gap-3 md:grid-cols-3">
          <Metric
            title="Overdue"
            value={money(overdue.reduce((sum, invoice) => sum + Number(invoice.balance_due), 0))}
            note={`${overdue.length} invoices`}
          />
          <Metric
            title="Due within next 30 days"
            value={money(due30.reduce((sum, invoice) => sum + Number(invoice.balance_due), 0))}
            note={`${due30.length} invoices`}
          />
          <Metric
            title="Outstanding"
            value={money(unpaid.reduce((sum, invoice) => sum + Number(invoice.balance_due), 0))}
            note={`${unpaid.length} unpaid invoices`}
          />
        </section>

        <section className="mb-4 grid gap-2 lg:grid-cols-[1.2fr_150px_150px_150px_1fr]">
          <select
            value={customerId}
            onChange={(event) => setCustomerId(event.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm"
          >
            <option value="all">All customers</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.display_name}
              </option>
            ))}
          </select>

          <select
            value={state}
            onChange={(event) => setState(event.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm"
          >
            <option value="unpaid">Unpaid</option>
            <option value="drafts">Drafts</option>
            <option value="all">All invoices</option>
          </select>

          <label className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
            From
            <input
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              className="ml-2 text-sm text-slate-800 outline-none"
            />
          </label>

          <label className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
            To
            <input
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              className="ml-2 text-sm text-slate-800 outline-none"
            />
          </label>

          <input
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="Search invoice number or customer…"
            className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm"
          />
        </section>

        <div className="mb-4 inline-flex overflow-hidden rounded-xl border border-slate-200 bg-white text-sm">
          <Tab active={state === 'unpaid'} onClick={() => setState('unpaid')}>
            Unpaid <b>{unpaid.length}</b>
          </Tab>
          <Tab active={state === 'drafts'} onClick={() => setState('drafts')}>
            Drafts <b>{draftCount}</b>
          </Tab>
          <Tab active={state === 'all'} onClick={() => setState('all')}>
            All invoices <b>{rows.length}</b>
          </Tab>
        </div>

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1050px] text-left text-sm">
              <thead className="border-b border-slate-100 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Due</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Number</th>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3">Amount due</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((invoice) => (
                  <InvoiceRow
                    key={invoice.id}
                    invoice={invoice}
                    menuOpen={menu === invoice.id}
                    onToggleMenu={() => setMenu(menu === invoice.id ? null : invoice.id)}
                  />
                ))}

                {!filtered.length && (
                  <tr>
                    <td colSpan={7} className="p-12 text-center text-sm text-slate-500">
                      No invoices match these filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}

function InvoiceRow({
  invoice,
  menuOpen,
  onToggleMenu,
}: {
  invoice: Invoice;
  menuOpen: boolean;
  onToggleMenu: () => void;
}) {
  const currentStatus = invoiceStatus(invoice);
  const dueText =
    currentStatus === 'Paid' || currentStatus === 'Draft'
      ? '—'
      : `${Math.abs(days(invoice.due_date))} ${days(invoice.due_date) < 0 ? 'days ago' : 'days'}`;

  const openDocument = () => {
    location.href = `/next-workspace/documents?type=invoice&id=${invoice.id}`;
  };

  return (
    <tr
      onClick={openDocument}
      className="cursor-pointer border-b border-slate-100 hover:bg-violet-50/40"
    >
      <td className="px-4 py-3">
        <span
          className={`rounded-md px-2 py-1 text-[10px] font-bold ${
            currentStatus === 'Overdue'
              ? 'bg-rose-100 text-rose-700'
              : currentStatus === 'Paid'
                ? 'bg-emerald-100 text-emerald-700'
                : currentStatus === 'Draft'
                  ? 'bg-slate-100 text-slate-600'
                  : 'bg-amber-100 text-amber-700'
          }`}
        >
          {currentStatus}
        </span>
      </td>
      <td className="px-4 py-3 text-xs">{dueText}</td>
      <td className="px-4 py-3 text-xs">{invoice.invoice_date}</td>
      <td className="px-4 py-3 font-medium">{invoice.invoice_number}</td>
      <td className="max-w-[220px] truncate px-4 py-3">
        {invoice.customer?.display_name || 'Unknown customer'}
      </td>
      <td className="px-4 py-3 font-semibold">{money(invoice.balance_due)}</td>
      <td className="px-4 py-3 text-right" onClick={(event) => event.stopPropagation()}>
        <div className="relative inline-block">
          <button
            type="button"
            onClick={onToggleMenu}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold"
          >
            Actions
          </button>

          {menuOpen && (
            <div className="absolute right-0 z-30 mt-1 w-44 rounded-xl border border-slate-200 bg-white p-1 text-left shadow-xl">
              <Action label="View invoice" onClick={openDocument} />
              <Action
                label="Edit draft"
                onClick={() => {
                  location.href = `/next-workspace/sales?invoice=${invoice.id}`;
                }}
              />
              <Action
                label="Duplicate"
                onClick={() => {
                  location.href = `/next-workspace/invoices/new?duplicate=${invoice.id}`;
                }}
              />
              <Action
                label="Record payment"
                onClick={() => {
                  location.href = `/next-workspace/payments?invoice=${invoice.id}`;
                }}
              />
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

function Metric({
  title,
  value,
  note,
}: {
  title: string;
  value: string;
  note: string;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <span className="text-xs font-semibold text-slate-500">{title}</span>
      <b className="mt-2 block text-xl">{value}</b>
      <span className="mt-1 block text-[11px] text-slate-400">{note}</span>
    </section>
  );
}

function Tab({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-2.5 ${
        active ? 'bg-violet-50 font-semibold text-violet-800' : 'text-slate-500'
      }`}
    >
      {children}
    </button>
  );
}

function Action({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full rounded-lg px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-50"
    >
      {label}
    </button>
  );
}
