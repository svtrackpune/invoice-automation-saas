import Link from 'next/link';
import { PageHeader } from '@/components/ui/finops/PageHeader';

const settingsCards = [
  {
    title: 'Communications & Alerts',
    description: 'Configure WhatsApp (WAPI), transactional SMS, Telegram and outgoing email transports.',
    href: '/next-workspace/settings/communications',
  },
  {
    title: 'Payments & Banking',
    description: 'Configure UPI, tender policies, settlement accounts and Razorpay, Cashfree or Stripe gateways.',
    href: '/next-workspace/settings/payments',
  },
];

export default function SettingsDashboardPage() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <PageHeader
        breadcrumbs={[{label:'Workspace',href:'/next-workspace'},{label:'Settings & configuration'}]}
        title="Workspace configuration"
        subtitle="Central access to operational integrations and payment configuration. Sensitive provider credentials remain protected by the server-side Vault/RPC contracts."
        badge={{label:'Settings & Configuration',variant:'neutral'}}
      />
      <section className="mt-8 grid gap-5 md:grid-cols-2">
        {settingsCards.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className="group rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:border-indigo-300 hover:shadow-md"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">{card.title}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-500">{card.description}</p>
              </div>
              <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 group-hover:bg-indigo-50 group-hover:text-indigo-700">
                Open
              </span>
            </div>
          </Link>
        ))}
      </section>
    </main>
  );
}
