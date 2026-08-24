'use client';

import { Button, Card, PageHeader } from '@/components/moneymatters';

const actions = [
  { title: 'Create invoice', description: 'Use the canonical invoice editor, review the document, then finalize and post.', href: '/next-workspace/invoices/new', label: 'Create invoice' },
  { title: 'Invoices', description: 'Review drafts, posted invoices, outstanding balances and document actions.', href: '/next-workspace/invoices', label: 'Open invoices' },
  { title: 'Quotations', description: 'Create estimates and convert an accepted quotation into the canonical invoice flow.', href: '/next-workspace/quotation', label: 'Open quotations' },
  { title: 'Payments', description: 'Record and allocate customer payments against posted invoices.', href: '/next-workspace/payments', label: 'Open payments' },
  { title: 'Customers', description: 'Open Customer 360 and start sales actions from the customer relationship.', href: '/next-workspace/customers', label: 'Open customers' },
];

export default function SalesPage() {
  return (
    <main className="min-h-screen bg-[#fbfaff] p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-6xl">
        <PageHeader
          eyebrow="Order to cash"
          title="Sales"
          description="One connected sales workflow. Each entry point uses the same customer, document, payment and accounting processes."
          actions={<Button variant="secondary" onClick={() => { location.href = '/next-workspace'; }}>Dashboard</Button>}
        />
        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {actions.map((action) => (
            <Card key={action.title} className="flex flex-col p-5">
              <h2 className="text-lg font-semibold">{action.title}</h2>
              <p className="mt-2 flex-1 text-sm leading-6 text-slate-500">{action.description}</p>
              <Button className="mt-5 w-full" variant={action.title === 'Create invoice' ? 'primary' : 'secondary'} onClick={() => { location.href = action.href; }}>
                {action.label}
              </Button>
            </Card>
          ))}
        </div>
        <Card className="mt-6 p-5">
          <p className="text-xs font-bold uppercase tracking-[.16em] text-slate-400">Canonical lifecycle</p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-700">
            {['Customer', 'Quotation', 'Invoice Draft', 'Document Review', 'Finalize & Post', 'Payment', 'Receipt', 'Accounting'].map((step, index) => (
              <span key={step} className="flex items-center gap-2">
                <span className="rounded-lg bg-slate-100 px-3 py-2">{step}</span>
                {index < 7 && <span className="text-slate-300">→</span>}
              </span>
            ))}
          </div>
        </Card>
      </div>
    </main>
  );
}
