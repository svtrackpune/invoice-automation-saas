'use client';

import { useState, type ReactNode } from 'react';
import {
  demoItems,
  getDemoCustomer,
  getDemoInvoices,
  money,
  getDemoEstimates,
} from './test-data';

const go = (path: string) => {
  window.location.href = path;
};

type CardProps = {
  children: ReactNode;
  className?: string;
};

const Card = ({ children, className = '' }: CardProps) => (
  <section
    className={`rounded-3xl border border-slate-200 bg-white shadow-[0_12px_40px_rgba(15,23,42,.045)] ${className}`}
  >
    {children}
  </section>
);

type MetricProps = {
  label: string;
  value: string;
  help: string;
  onClick?: () => void;
};

const Metric = ({ label, value, help, onClick }: MetricProps) => (
  <button
    type="button"
    onClick={onClick}
    className="w-full rounded-2xl border border-slate-100 bg-slate-50 p-4 text-left hover:border-violet-200 hover:bg-violet-50"
  >
    <span className="text-xs font-semibold text-slate-500">{label}</span>
    <b className="mt-2 block text-xl">{value}</b>
    <small className="mt-1 block text-[11px] leading-4 text-slate-400">
      {help}
    </small>
  </button>
);

export function Customer360({ id = 'c1' }: { id?: string }) {
  const customer = getDemoCustomer(id);
  const invoices = getDemoInvoices().filter((invoice) => invoice.customerId === id);
  const estimates = getDemoEstimates().filter((estimate) => estimate.customerId === id);
  const outstanding = invoices.reduce(
    (total, invoice) => total + Math.max(0, invoice.total - invoice.paid),
    0,
  );
  const paid = invoices.reduce((total, invoice) => total + invoice.paid, 0);
  const billed = invoices.reduce((total, invoice) => total + invoice.total, 0);

  const timeline = [
    ...invoices.map((invoice) => ({
      date: invoice.date,
      title: `Invoice ${invoice.number}`,
      description: `${money(invoice.total)} billed · ${money(
        Math.max(0, invoice.total - invoice.paid),
      )} remaining`,
    })),
    ...estimates.map((estimate) => ({
      date: estimate.date,
      title: `Estimate ${estimate.number}`,
      description: `${money(estimate.total)} · ${estimate.status}`,
    })),
  ].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <Workspace
      title="Customer 360"
      subtitle="One complete view of the customer, their activity, balance and next action."
    >
      <Card className="overflow-hidden">
        <div className="bg-slate-950 p-6 text-white">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[.2em] text-violet-300">
                Customer 360
              </p>
              <h2 className="mt-1 text-2xl font-bold">{customer.name}</h2>
              <p className="mt-1 text-xs text-slate-300">
                {customer.email} · {customer.phone}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => go('/next-workspace/sales')}
                className="rounded-xl bg-white px-4 py-2.5 text-xs font-bold text-slate-900"
              >
                + Invoice
              </button>
              <button
                type="button"
                onClick={() => go('/next-workspace/quotation')}
                className="rounded-xl bg-violet-500 px-4 py-2.5 text-xs font-bold text-white"
              >
                + Estimate
              </button>
            </div>
          </div>
        </div>

        <div className="grid gap-3 p-5 sm:grid-cols-4">
          <Metric label="Customer value" value={money(billed)} help="Total invoiced." />
          <Metric label="Paid" value={money(paid)} help="Money received." />
          <Metric label="They owe you" value={money(outstanding)} help="Open balance." />
          <Metric
            label="Estimates"
            value={String(estimates.length)}
            help="Quotes connected to this customer."
          />
        </div>
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
        <Card className="overflow-hidden">
          <div className="border-b p-5">
            <h3 className="font-bold">Everything that happened</h3>
            <p className="mt-1 text-xs text-slate-500">
              Invoices and estimates in one timeline.
            </p>
          </div>
          <div className="divide-y">
            {timeline.length === 0 ? (
              <p className="p-5 text-sm text-slate-500">No activity yet.</p>
            ) : (
              timeline.map((item, index) => (
                <div key={`${item.title}-${item.date}`} className="flex gap-4 p-5">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-violet-50 text-xs text-violet-700">
                    {index === 0 ? '✓' : '•'}
                  </span>
                  <div>
                    <b className="block text-sm">{item.title}</b>
                    <span className="text-xs text-slate-500">{item.description}</span>
                    <small className="mt-1 block text-[10px] text-slate-400">
                      {item.date}
                    </small>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>

        <div className="space-y-6">
          <Card className="p-5">
            <h3 className="font-bold">Customer statement</h3>
            <p className="mt-1 text-xs text-slate-500">Billed, paid and still due.</p>
            <div className="mt-4 rounded-2xl bg-slate-50 p-4">
              <div className="flex justify-between text-xs">
                <span>Total billed</span>
                <b>{money(billed)}</b>
              </div>
              <div className="mt-2 flex justify-between text-xs">
                <span>Payments</span>
                <b className="text-emerald-700">− {money(paid)}</b>
              </div>
              <div className="mt-3 flex justify-between border-t pt-3">
                <span className="text-sm font-bold">Balance due</span>
                <b className="text-lg">{money(outstanding)}</b>
              </div>
            </div>
            <button
              type="button"
              onClick={() => go('/next-workspace/customers')}
              className="mt-3 w-full rounded-xl border px-3 py-2.5 text-xs font-bold"
            >
              Open statement →
            </button>
          </Card>

          <Card className="p-5">
            <h3 className="font-bold">Next best action</h3>
            <p className="mt-1 text-xs text-slate-500">
              {outstanding
                ? `Collect ${money(outstanding)} from ${customer.name}.`
                : 'This customer has no open balance.'}
            </p>
            <button
              type="button"
              onClick={() => go('/next-workspace/payments')}
              className="mt-4 w-full rounded-xl bg-violet-600 px-3 py-2.5 text-xs font-bold text-white"
            >
              Record payment
            </button>
          </Card>
        </div>
      </div>
    </Workspace>
  );
}

export function MoneyIn() {
  const invoices = getDemoInvoices();
  const total = invoices.reduce((sum, invoice) => sum + invoice.total, 0);
  const paid = invoices.reduce((sum, invoice) => sum + invoice.paid, 0);
  const due = total - paid;
  const overdue = invoices
    .filter((invoice) => invoice.status === 'overdue')
    .reduce((sum, invoice) => sum + invoice.total - invoice.paid, 0);

  return (
    <Workspace
      title="Money In"
      subtitle="Everything that helps you get paid — invoices, collections and receipts."
    >
      <div className="grid gap-3 sm:grid-cols-4">
        <Metric label="Billed" value={money(total)} help="Invoices issued." />
        <Metric label="Received" value={money(paid)} help="Payments collected." />
        <Metric label="To collect" value={money(due)} help="Open balances." />
        <Metric label="Overdue" value={money(overdue)} help="Past due." />
      </div>

      <Card className="mt-6 overflow-hidden">
        <div className="border-b p-5">
          <h3 className="font-bold">Collection queue</h3>
          <p className="mt-1 text-xs text-slate-500">
            Start with customers who need action.
          </p>
        </div>
        {invoices.map((invoice) => (
          <div
            key={invoice.id}
            className="flex items-center gap-4 border-b p-5 last:border-0"
          >
            <div className="min-w-0 flex-1">
              <b className="block text-sm">{invoice.number}</b>
              <span className="text-xs text-slate-500">
                {getDemoCustomer(invoice.customerId).name} · due {invoice.dueDate}
              </span>
            </div>
            <b>{money(invoice.total - invoice.paid)}</b>
            <button
              type="button"
              onClick={() => go('/next-workspace/payments')}
              className="rounded-xl border px-3 py-2 text-xs font-bold"
            >
              Collect
            </button>
          </div>
        ))}
      </Card>
    </Workspace>
  );
}

export function MoneyOut() {
  const expenses: Array<[string, number]> = [
    ['Internet & communication', 12500],
    ['Transport', 8200],
    ['Office supplies', 5400],
    ['Advertising', 3100],
  ];
  const total = expenses.reduce((sum, expense) => sum + expense[1], 0);

  return (
    <Workspace
      title="Money Out"
      subtitle="See where business money is going and what needs attention."
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label="Expenses" value={money(total)} help="Current demo activity." />
        <Metric
          label="Largest category"
          value={money(12500)}
          help="Internet & communication."
        />
        <Metric label="Needs review" value="3" help="Items awaiting a decision." />
      </div>

      <Card className="mt-6 overflow-hidden">
        <div className="border-b p-5">
          <h3 className="font-bold">Where money is going</h3>
        </div>
        {expenses.map(([name, amount]) => (
          <div key={name} className="flex items-center gap-4 border-b p-5 last:border-0">
            <span className="flex-1 text-sm font-semibold">{name}</span>
            <b>{money(amount)}</b>
          </div>
        ))}
      </Card>
    </Workspace>
  );
}

export function Payments() {
  const [paid, setPaid] = useState(0);

  return (
    <Workspace
      title="Payments & Receipts"
      subtitle="Record money received and create the receipt experience."
    >
      <Card className="mx-auto max-w-3xl p-6 sm:p-8">
        <p className="text-[10px] font-bold uppercase tracking-[.2em] text-violet-600">
          Record payment
        </p>
        <h2 className="mt-2 text-2xl font-bold">Money has arrived?</h2>

        <label className="mt-7 block text-xs font-bold text-slate-500">Invoice</label>
        <select className="mt-2 w-full rounded-xl border p-3 text-sm" defaultValue="">
          <option value="" disabled>
            Select an invoice
          </option>
          {getDemoInvoices().map((invoice) => (
            <option key={invoice.id} value={invoice.id}>
              {invoice.number} · {getDemoCustomer(invoice.customerId).name}
            </option>
          ))}
        </select>

        <label className="mt-5 block text-xs font-bold text-slate-500">
          Amount received
        </label>
        <input
          value={paid || ''}
          onChange={(event) => setPaid(Number(event.target.value))}
          type="number"
          min="0"
          placeholder="₹ 0"
          className="mt-2 w-full rounded-xl border p-3 text-lg"
        />

        <div className="mt-5 grid grid-cols-3 gap-2">
          {[5000, 10000, 25000].map((amount) => (
            <button
              key={amount}
              type="button"
              onClick={() => setPaid(amount)}
              className="rounded-xl border p-2.5 text-xs font-semibold"
            >
              {money(amount)}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setPaid(paid || 10000)}
          className="mt-6 w-full rounded-xl bg-violet-600 px-4 py-3 text-sm font-bold text-white"
        >
          Record payment →
        </button>

        {paid > 0 && (
          <div className="mt-4 rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-800">
            ✓ Testing-mode payment recorded and receipt created locally.
          </div>
        )}
      </Card>
    </Workspace>
  );
}

export function Banking() {
  const transactions: Array<[string, string, string, string]> = [
    ['₹12,500', 'Jio', 'Internet & communication', 'High confidence'],
    ['₹42,500', 'ABC Enterprises', 'INV-000008', 'High confidence'],
    ['₹4,850', 'Office Depot', 'Office supplies', 'Review'],
  ];

  return (
    <Workspace
      title="Banking"
      subtitle="Match bank activity to your business records instead of bookkeeping by hand."
    >
      <Card className="p-5">
        <h2 className="font-bold">HDFC Current Account</h2>
        <p className="mt-1 text-xs text-slate-500">
          ₹4,82,450 available · 3 transactions need review
        </p>
        {transactions.map(([amount, vendor, classification, confidence]) => (
          <div
            key={`${amount}-${vendor}`}
            className="grid gap-3 border-b py-4 last:border-0 sm:grid-cols-[110px_1fr_1.3fr_auto] sm:items-center"
          >
            <b>{amount}</b>
            <span className="text-sm">{vendor}</span>
            <span className="text-xs">
              <b>{classification}</b>
              <small className="block text-slate-400">{confidence}</small>
            </span>
            <button type="button" className="rounded-xl border px-3 py-2 text-xs font-bold">
              Accept
            </button>
          </div>
        ))}
      </Card>

      <Card className="mt-5 p-5">
        <h2 className="font-bold">Explain this suggestion</h2>
        <p className="mt-2 text-xs leading-5 text-slate-500">
          The suggestion is based on the vendor, previous classifications and matching business records.
        </p>
      </Card>
    </Workspace>
  );
}

export function Products() {
  return (
    <Workspace
      title="Products & Inventory"
      subtitle="Know what you sell, what you have and what needs attention."
    >
      <div className="grid gap-3 sm:grid-cols-4">
        <Metric
          label="Products/services"
          value={String(demoItems.length)}
          help="Reusable catalogue items."
        />
        <Metric label="Stock value" value={money(842000)} help="Estimated inventory value." />
        <Metric label="Low stock" value="7" help="Approaching reorder point." />
        <Metric label="Out of stock" value="2" help="Cannot currently be sold." />
      </div>

      <Card className="mt-6 overflow-hidden">
        <div className="border-b p-5">
          <h2 className="font-bold">Catalogue</h2>
        </div>
        {demoItems.map((product, index) => (
          <div
            key={product.id}
            className="flex items-center gap-4 border-b p-5 last:border-0"
          >
            <div className="flex-1">
              <b className="block text-sm">{product.name}</b>
              <span className="text-xs text-slate-500">
                GST {product.tax}% · selling price {money(product.price)}
              </span>
            </div>
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700">
              {index === 2 ? 'Low stock' : 'Healthy'}
            </span>
          </div>
        ))}
      </Card>
    </Workspace>
  );
}

export function Reports() {
  const [explain, setExplain] = useState(false);
  const reports: Array<[string, string, string]> = [
    ['Profit & Loss', 'Did I make money?', '₹3,42,000'],
    ['Cash flow', 'Will I have enough cash?', '₹5,48,450'],
    ['Receivables', 'Who owes me?', '₹2,13,500'],
    ['Expenses', 'Where did money go?', '₹38,400'],
  ];

  return (
    <Workspace
      title="Reports"
      subtitle="Ask business questions; the accounting reports sit underneath the answers."
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {reports.map(([name, question, amount]) => (
          <button
            key={name}
            type="button"
            onClick={() => setExplain(true)}
            className="rounded-3xl border bg-white p-5 text-left shadow-sm"
          >
            <span className="text-xs font-semibold text-slate-500">{name}</span>
            <b className="mt-3 block text-2xl">{amount}</b>
            <small className="mt-1 block text-xs text-slate-400">{question} →</small>
          </button>
        ))}
      </div>

      {explain && (
        <Card className="mt-6 border-violet-200 bg-violet-50 p-6">
          <p className="text-[10px] font-bold uppercase tracking-[.18em] text-violet-600">
            Explain this number
          </p>
          <h2 className="mt-2 text-xl font-bold">Profit & Loss</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Sales of {money(842000)} less direct and operating costs of {money(500000)} leaves{' '}
            {money(342000)} profit in this testing example.
          </p>
        </Card>
      )}
    </Workspace>
  );
}

export function TaxCenter() {
  const checks = [
    '4 invoices missing complete GST details',
    '1 purchase needs ITC review',
    '1 customer GSTIN needs validation',
  ];

  return (
    <Workspace
      title="Tax Center"
      subtitle="Understand what your books currently say about GST and what needs attention."
    >
      <Card className="p-6">
        <p className="text-[10px] font-bold uppercase tracking-[.18em] text-violet-600">
          GST readiness
        </p>
        <h2 className="mt-2 text-2xl font-bold">₹69,250 estimated payable</h2>
        <p className="mt-1 text-xs text-slate-500">Based on current demo records.</p>
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <Metric label="Output GST" value={money(151650)} help="GST collected on sales." />
          <Metric label="Input GST" value={money(82400)} help="Potential eligible GST." />
          <Metric label="Exceptions" value="6" help="Records to review." />
        </div>
      </Card>

      <Card className="mt-6 p-6">
        <h2 className="font-bold">What should you check?</h2>
        <div className="mt-4 space-y-2">
          {checks.map((check, index) => (
            <div key={check} className="flex items-center gap-3 rounded-2xl bg-slate-50 p-4">
              <span className="text-xs font-bold">{index + 1}</span>
              <span className="text-sm">{check}</span>
              <span className="ml-auto text-xs font-bold text-violet-700">Review →</span>
            </div>
          ))}
        </div>
      </Card>
    </Workspace>
  );
}

export function BusinessHealth() {
  const metrics: Array<[string, string]> = [
    ['Cash flow', '91'],
    ['Collections', '76'],
    ['Profitability', '88'],
    ['Tax readiness', '73'],
    ['Banking', '95'],
  ];

  return (
    <Workspace
      title="Business Health"
      subtitle="A simple scorecard for cash, profit, collections, tax readiness and banking."
    >
      <Card className="p-6 sm:p-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <div className="grid h-32 w-32 shrink-0 place-items-center rounded-full border-[12px] border-violet-100">
            <b className="text-3xl">82</b>
            <span className="text-[9px] text-slate-400">/ 100</span>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[.18em] text-violet-600">
              Healthy, with opportunities
            </p>
            <h2 className="mt-2 text-2xl font-bold">Your business looks stable.</h2>
            <p className="mt-2 text-sm text-slate-500">
              Cash flow and profitability are strong. Collections and tax readiness deserve attention.
            </p>
          </div>
        </div>

        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {metrics.map(([name, score]) => (
            <div key={name} className="rounded-2xl bg-slate-50 p-4">
              <span className="text-xs text-slate-500">{name}</span>
              <b className="mt-2 block text-xl">{score}</b>
              <div className="mt-2 h-1.5 rounded-full bg-slate-200">
                <div
                  className="h-full rounded-full bg-violet-500"
                  style={{ width: `${score}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </Card>
    </Workspace>
  );
}

type WorkspaceProps = {
  title: string;
  subtitle: string;
  children: ReactNode;
};

function Workspace({ title, subtitle, children }: WorkspaceProps) {
  return (
    <main className="min-h-[calc(100vh-90px)] bg-[#f7f6fb] p-4 sm:p-7">
      <div className="mx-auto max-w-7xl">
        <p className="text-[10px] font-bold uppercase tracking-[.2em] text-violet-600">
          Moneymatters
        </p>
        <h1 className="mt-1 text-3xl font-bold">{title}</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">{subtitle}</p>
        {children}
      </div>
    </main>
  );
}
