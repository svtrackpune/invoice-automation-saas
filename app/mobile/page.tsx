'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { FormInput as MMFormInputControl, FormSelect as MMFormSelectControl } from '@/components/moneymatters/ui';
import Link from 'next/link';
import { supabase, type BusinessContext } from '@/lib/supabase';
import { FinOpsIcon, type FinOpsIconName } from '@/components/ui/finops/FinOpsPrimitives';
import { MobileBottomNav, type MobileTab } from '@/components/mobile/MobileBottomNav';

type Customer = { id: string; display_name: string };
type Invoice = {
  id: string;
  invoice_number: string;
  invoice_date: string;
  status: string;
  total: number;
  balance_due: number;
  customer_id: string | null;
  document_kind: string | null;
};

type MobileAction = {
  label: string;
  description: string;
  href: string;
  icon: FinOpsIconName;
  featured?: boolean;
};

function money(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: currency || 'INR',
      maximumFractionDigits: 2,
    }).format(Number(value || 0));
  } catch {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(value || 0));
  }
}

function dateLabel(value: string): string {
  if (!value) return 'Date unavailable';
  const parsed = new Date(value + 'T00:00:00');
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' }).format(parsed);
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function friendlyStatus(value: string): string {
  const status = String(value || 'draft').replace(/[_-]+/g, ' ');
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function statusClasses(value: string): string {
  const status = String(value || '').toLowerCase();
  if (status === 'paid' || status === 'posted' || status === 'locked') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (status === 'overdue' || status === 'cancelled' || status === 'void' || status === 'voided') return 'border-rose-200 bg-rose-50 text-rose-700';
  if (status === 'pending' || status === 'partially_paid' || status === 'partially paid') return 'border-amber-200 bg-amber-50 text-amber-700';
  return 'border-slate-200 bg-slate-50 text-slate-600';
}

function ActionCard({ action }: { action: MobileAction }) {
  return (
    <a
      href={action.href}
      className={'flex min-h-[108px] min-w-0 flex-col justify-between rounded-2xl border p-4 transition active:scale-[.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 ' + (action.featured ? 'border-violet-600 bg-violet-600 text-white shadow-lg shadow-violet-200' : 'border-slate-200 bg-white text-slate-900 shadow-sm hover:border-violet-200 hover:bg-violet-50/40')}
    >
      <span className={'grid h-10 w-10 place-items-center rounded-xl ' + (action.featured ? 'bg-white/15 text-white' : 'bg-violet-50 text-violet-700')}>
        <FinOpsIcon name={action.icon} className="h-5 w-5" />
      </span>
      <span className="mt-3 block min-w-0">
        <span className="block break-words text-sm font-bold">{action.label}</span>
        <span className={'mt-1 block text-xs leading-4 ' + (action.featured ? 'text-violet-100' : 'text-slate-500')}>{action.description}</span>
      </span>
    </a>
  );
}

function SmallAction({ action }: { action: MobileAction }) {
  return (
    <a href={action.href} className="flex min-h-[68px] min-w-0 items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition hover:border-violet-200 hover:bg-violet-50/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-50 text-violet-700">
        <FinOpsIcon name={action.icon} className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block break-words text-sm font-semibold text-slate-800">{action.label}</span>
        <span className="mt-0.5 block break-words text-[11px] leading-4 text-slate-500">{action.description}</span>
      </span>
      <FinOpsIcon name="chevron" className="h-4 w-4 shrink-0 text-slate-300" />
    </a>
  );
}

export default function MobileHomePage() {
  const [booting, setBooting] = useState(true);
  const [dataLoading, setDataLoading] = useState(false);
  const [ctx, setCtx] = useState<BusinessContext | null>(null);
  const [businesses, setBusinesses] = useState<BusinessContext[]>([]);
  const [userName, setUserName] = useState('there');
  const [activeTab, setActiveTab] = useState<MobileTab>('home');
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [cashBillEnabled, setCashBillEnabled] = useState(false);
  const [customerSearch, setCustomerSearch] = useState('');
  const [bootError, setBootError] = useState('');
  const [dataError, setDataError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let alive = true;
    const params = new URLSearchParams(window.location.search);
    if (params.get('app') === 'android') {
      localStorage.setItem('moneymatters.simpleMobileAppMode', '1');
    }
    const requestedTab = params.get('tab');
    if (requestedTab === 'sales' || requestedTab === 'customers' || requestedTab === 'more' || requestedTab === 'home') {
      setActiveTab(requestedTab);
    }

    (async () => {
      const sessionResult = await supabase.auth.getSession();
      if (!sessionResult.data.session) {
        window.location.replace('/?next=%2Fmobile');
        return;
      }

      const [contextResult, userResult] = await Promise.all([
        supabase.rpc('get_my_business_context'),
        supabase.auth.getUser(),
      ]);
      if (!alive) return;
      if (contextResult.error) {
        setBootError('We could not open your business. Please try again.');
        setBooting(false);
        return;
      }

      const rows = (contextResult.data || []) as BusinessContext[];
      if (!rows.length) {
        window.location.replace('/onboarding?next=%2Fmobile');
        return;
      }

      const saved = localStorage.getItem('moneymatters.activeBusinessId');
      const selected = rows.find((row) => row.business_id === saved) || rows[0];
      localStorage.setItem('moneymatters.activeBusinessId', selected.business_id);
      setBusinesses(rows);
      setCtx(selected);
      const user = userResult.data.user;
      setUserName(String(user?.user_metadata?.display_name || user?.user_metadata?.name || user?.email?.split('@')[0] || 'there'));
      setBooting(false);
    })().catch(() => {
      if (!alive) return;
      setBootError('Something went wrong while opening the app. Check your connection and try again.');
      setBooting(false);
    });

    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!ctx) return;
    let alive = true;
    setDataLoading(true);
    setDataError('');
    (async () => {
      const [invoiceResult, customerResult, settingsResult] = await Promise.all([
        supabase.from('invoices')
          .select('id,invoice_number,invoice_date,status,total,balance_due,customer_id,document_kind')
          .eq('business_id', ctx.business_id)
          .order('invoice_date', { ascending: false })
          .limit(6),
        supabase.from('customers')
          .select('id,display_name')
          .eq('business_id', ctx.business_id)
          .eq('is_active', true)
          .order('display_name', { ascending: true })
          .limit(100),
        supabase.from('business_settings')
          .select('cash_bill_enabled')
          .eq('business_id', ctx.business_id)
          .maybeSingle(),
      ]);
      if (!alive) return;
      setInvoices((invoiceResult.data || []) as Invoice[]);
      setCustomers((customerResult.data || []) as Customer[]);
      setCashBillEnabled(Boolean(settingsResult.data?.cash_bill_enabled));
      const firstError = invoiceResult.error || customerResult.error || settingsResult.error;
      if (firstError) setDataError('Some activity could not be refreshed. Your quick actions are still available.');
      setDataLoading(false);
    })().catch(() => {
      if (!alive) return;
      setDataError('Recent activity is temporarily unavailable. Your quick actions are still available.');
      setDataLoading(false);
    });
    return () => { alive = false; };
  }, [ctx, refreshKey]);

  const filteredCustomers = useMemo(() => {
    const term = customerSearch.trim().toLowerCase();
    return customers.filter((customer) => !term || customer.display_name.toLowerCase().includes(term));
  }, [customers, customerSearch]);

  const chooseTab = (tab: MobileTab) => setActiveTab(tab);
  const switchBusiness = (businessId: string) => {
    const selected = businesses.find((row) => row.business_id === businessId);
    if (!selected) return;
    localStorage.setItem('moneymatters.activeBusinessId', selected.business_id);
    setCtx(selected);
    window.dispatchEvent(new Event('moneymatters:business-changed'));
  };

  const homeActions: MobileAction[] = cashBillEnabled ? [
    { label: 'Cash Bill', description: 'Quick counter sale', href: '/next-workspace/cash-bill', icon: 'cash', featured: true },
    { label: 'New invoice', description: 'Bill a customer', href: '/next-workspace/invoices/new', icon: 'invoice' },
    { label: 'Add customer', description: 'Save customer details', href: '/next-workspace/customers', icon: 'customer' },
    { label: 'Receive payment', description: 'Record money received', href: '/next-workspace/payments', icon: 'bank' },
  ] : [
    { label: 'New invoice', description: 'Bill a customer', href: '/next-workspace/invoices/new', icon: 'invoice', featured: true },
    { label: 'Add customer', description: 'Save customer details', href: '/next-workspace/customers', icon: 'customer' },
    { label: 'Create quotation', description: 'Share a price estimate', href: '/next-workspace/quotations', icon: 'quote' },
    { label: 'Receive payment', description: 'Record money received', href: '/next-workspace/payments', icon: 'bank' },
  ];

  const salesActions: MobileAction[] = [
    ...(cashBillEnabled ? [{ label: 'Cash Bill', description: 'Fast counter sale', href: '/next-workspace/cash-bill', icon: 'cash' as const, featured: true }] : []),
    { label: 'New invoice', description: 'Create a customer invoice', href: '/next-workspace/invoices/new', icon: 'invoice' },
    { label: 'Quotations', description: 'Prepare and share offers', href: '/next-workspace/quotations', icon: 'quote' },
    { label: 'Receipts', description: 'View payment receipts', href: '/next-workspace/receipts', icon: 'statement' },
    { label: 'Delivery challans', description: 'Track dispatched goods', href: '/next-workspace/delivery-challans', icon: 'statement' },
    { label: 'Payments', description: 'Record money received or paid', href: '/next-workspace/payments', icon: 'bank' },
  ];

  const moreActions: MobileAction[] = [
    { label: 'Products & services', description: 'Your item catalogue', href: '/next-workspace/items', icon: 'invoice' },
    { label: 'Stock & inventory', description: 'Current stock and movements', href: '/next-workspace/inventory', icon: 'statement' },
    { label: 'Expenses', description: 'Track business spending', href: '/next-workspace/expenses', icon: 'expense' },
    { label: 'Purchases & vendors', description: 'Supplier bills and orders', href: '/next-workspace/bills', icon: 'vendor' },
    { label: 'Banking', description: 'Accounts and reconciliation', href: '/next-workspace/banking', icon: 'bank' },
    { label: 'Reports', description: 'Business summaries', href: '/next-workspace/reports', icon: 'report' },
    { label: 'Business settings', description: 'Tax, details and preferences', href: '/next-workspace/business-settings', icon: 'settings' },
  ];

  const selectedBusiness = ctx;
  const greetingLabel = greeting();

  if (booting) {
    return <main className="grid min-h-screen place-items-center bg-slate-50 px-5 text-center">
      <div>
        <Image src="/moneymatters-192.png" alt="" width={48} height={48} priority unoptimized className="mx-auto rounded-xl" />
        <p className="mt-4 text-sm font-semibold text-slate-700">Opening Money Matters…</p>
        <p className="mt-1 text-xs text-slate-400">Getting your business ready</p>
      </div>
    </main>;
  }

  if (bootError || !selectedBusiness) {
    return <main className="grid min-h-screen place-items-center bg-slate-50 p-5">
      <section className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 text-center shadow-sm">
        <Image src="/moneymatters-192.png" alt="" width={44} height={44} unoptimized className="mx-auto rounded-xl" />
        <h1 className="mt-4 text-lg font-bold text-slate-900">We could not open your app</h1>
        <p role="alert" className="mt-2 text-sm leading-5 text-slate-600">{bootError || 'No active business was found for this account.'}</p>
        <button type="button" onClick={() => window.location.reload()} className="mt-5 min-h-11 w-full rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white">Try again</button>
        <button type="button" onClick={async () => { await supabase.auth.signOut(); window.location.replace('/?next=%2Fmobile'); }} className="mt-3 min-h-10 w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600">Sign out</button>
      </section>
    </main>;
  }

  return (
    <main className="min-h-screen bg-[#F7F7FC] pb-24 text-slate-900" style={{ paddingBottom: 'calc(88px + env(safe-area-inset-bottom))' }}>
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-xl items-center gap-3">
          <Image src="/moneymatters-192.png" alt="" width={38} height={38} priority unoptimized className="shrink-0 rounded-xl" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-slate-950">Money Matters</p>
            {businesses.length > 1 ? (
              <MMFormSelectControl aria-label="Active business" value={selectedBusiness.business_id} onChange={(event) => switchBusiness(event.target.value)} className="mt-0.5 w-full max-w-[235px] border-0 bg-transparent p-0 text-[11px] font-medium text-slate-500 outline-none focus:ring-0">
                {businesses.map((business) => <option key={business.business_id} value={business.business_id}>{business.business_name}</option>)}
              </MMFormSelectControl>
            ) : (
              <p className="truncate text-[11px] text-slate-500">{selectedBusiness.business_name}</p>
            )}
          </div>
          <button type="button" onClick={() => chooseTab('more')} aria-label="Open more options" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-violet-50 text-xs font-bold text-violet-700">
            {userName.slice(0, 2).toUpperCase()}
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-xl space-y-6 px-4 pb-5 pt-5">
        {activeTab === 'home' && <>
          <section className="overflow-hidden rounded-3xl bg-gradient-to-br from-violet-700 via-violet-700 to-indigo-900 p-5 text-white shadow-lg shadow-violet-200">
            <p className="text-xs font-semibold text-violet-200">{greetingLabel},</p>
            <h1 className="mt-1 break-words text-2xl font-bold tracking-tight">{userName}</h1>
            <p className="mt-2 max-w-sm text-sm leading-5 text-violet-100">What would you like to do today?</p>
            <div className="mt-5 flex flex-wrap items-center gap-2">
              <span className="inline-flex max-w-full items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-white">
                <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-300" />
                <span className="truncate">{selectedBusiness.business_name}</span>
              </span>
              <span className="text-[11px] text-violet-200">{new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date())}</span>
            </div>
          </section>

          <section>
            <div className="mb-3 flex items-end justify-between gap-3">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[.14em] text-violet-700">Quick actions</p>
                <h2 className="mt-1 text-lg font-bold text-slate-950">Get things done</h2>
              </div>
              <button type="button" onClick={() => chooseTab('sales')} className="text-xs font-semibold text-violet-700">All sales actions →</button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {homeActions.map((action) => <ActionCard key={action.label} action={action} />)}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900">Recent sales</h2>
                <p className="mt-1 text-xs text-slate-500">Your latest invoices and cash bills</p>
              </div>
              <a href="/next-workspace/invoices" className="shrink-0 text-xs font-semibold text-violet-700">View all</a>
            </div>
            {dataError && <div role="status" className="mt-3 rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-800">{dataError} <button type="button" onClick={() => setRefreshKey((value) => value + 1)} className="font-bold underline">Retry</button></div>}
            {dataLoading ? <div className="mt-4 space-y-3">{[1,2,3].map((n) => <div key={n} className="h-14 animate-pulse rounded-xl bg-slate-100" />)}</div>
              : invoices.length ? <div className="mt-2 divide-y divide-slate-100">
                {invoices.slice(0, 5).map((invoice) => {
                  const isCashBill = invoice.document_kind === 'cash_bill';
                  const due = Number(invoice.balance_due || 0);
                  return <a key={invoice.id} href={'/next-workspace/documents?type=invoice&id=' + encodeURIComponent(invoice.id)} className="flex min-w-0 items-center gap-3 py-3 first:pt-2 last:pb-1">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-50 text-slate-500"><FinOpsIcon name={isCashBill ? 'cash' : 'invoice'} className="h-5 w-5" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold text-slate-800">{invoice.invoice_number || (isCashBill ? 'Cash Bill' : 'Invoice')}</span>
                      <span className="mt-1 block text-[11px] text-slate-500">{dateLabel(invoice.invoice_date)} · {isCashBill ? 'Cash Bill' : 'Invoice'}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-sm font-bold tabular-nums text-slate-900">{money(Number(invoice.total), selectedBusiness.currency_code)}</span>
                      <span className={'mt-1 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ' + statusClasses(invoice.status)}>{friendlyStatus(invoice.status)}</span>
                      {due > 0.01 && <span className="mt-1 block text-[10px] text-slate-500">Due {money(due, selectedBusiness.currency_code)}</span>}
                    </span>
                  </a>;
                })}
              </div>
              : <div className="py-7 text-center">
                <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-violet-50 text-violet-700"><FinOpsIcon name="invoice" className="h-6 w-6" /></span>
                <h3 className="mt-3 text-sm font-bold text-slate-800">Your first sale starts here</h3>
                <p className="mt-1 text-xs leading-5 text-slate-500">Create an invoice or cash bill and it will show up here.</p>
                <a href="/next-workspace/invoices/new" className="mt-4 inline-flex min-h-10 items-center rounded-xl bg-violet-600 px-4 py-2.5 text-xs font-bold text-white">Create invoice</a>
              </div>}
          </section>
        </>}

        {activeTab === 'sales' && <section>
          <p className="text-[11px] font-bold uppercase tracking-[.14em] text-violet-700">Sales</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-950">Sales & payments</h1>
          <p className="mt-2 text-sm leading-5 text-slate-500">The most common sales tasks, all in one place.</p>
          <div className="mt-4 space-y-3">
            {salesActions.map((action) => <SmallAction key={action.label} action={action} />)}
            {!cashBillEnabled && <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">Cash Bill is turned off for this business. Enable it in Business Settings when you’re ready to use counter sales.</p>}
          </div>
        </section>}

        {activeTab === 'customers' && <section>
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[.14em] text-violet-700">Customers</p>
              <h1 className="mt-1 text-2xl font-bold text-slate-950">Your customers</h1>
            </div>
            <Link href="/next-workspace/customers" className="inline-flex min-h-10 items-center gap-1 rounded-xl bg-violet-600 px-3 py-2 text-xs font-bold text-white"><FinOpsIcon name="plus" className="h-4 w-4" />Add</Link>
          </div>
          <label className="mt-4 flex min-h-12 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 shadow-sm focus-within:border-violet-400 focus-within:ring-2 focus-within:ring-violet-100">
            <FinOpsIcon name="search" className="h-4 w-4 shrink-0 text-slate-400" />
            <MMFormInputControl value={customerSearch} onChange={(event) => setCustomerSearch(event.target.value)} aria-label="Search customers" placeholder="Search by customer name" type="search" className="w-full min-w-0 border-0 bg-transparent py-2 text-sm outline-none placeholder:text-slate-400 focus:ring-0" />
          </label>
          <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200 bg-white">
            {dataLoading ? <div className="space-y-3 p-4">{[1,2,3].map((n) => <div key={n} className="h-10 animate-pulse rounded-lg bg-slate-100" />)}</div>
              : filteredCustomers.length ? <div className="divide-y divide-slate-100">
                {filteredCustomers.slice(0, 35).map((customer) => <Link key={customer.id} href={'/next-workspace/customers/' + encodeURIComponent(customer.id)} className="flex min-h-14 items-center gap-3 px-3 py-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-violet-50 text-xs font-bold text-violet-700">{customer.display_name.slice(0, 1).toUpperCase() || 'C'}</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800">{customer.display_name}</span>
                  <FinOpsIcon name="chevron" className="h-4 w-4 shrink-0 text-slate-300" />
                </Link>)}
              </div>
              : <p className="p-5 text-center text-sm text-slate-500">{customerSearch.trim() ? 'No matching customers.' : 'No customers yet. Add your first customer to get started.'}</p>}
          </div>
          {filteredCustomers.length > 35 && <p className="mt-2 text-center text-xs text-slate-500">Showing 35 customers. Search to narrow the list.</p>}
          <p className="mt-3 text-xs text-slate-500">Customer details stay in your existing business workspace.</p>
        </section>}

        {activeTab === 'more' && <section>
          <p className="text-[11px] font-bold uppercase tracking-[.14em] text-violet-700">More tools</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-950">Other tasks</h1>
          <p className="mt-2 text-sm leading-5 text-slate-500">Everything else is here, so your home screen stays simple.</p>
          <div className="mt-4 space-y-3">
            {moreActions.map((action) => <SmallAction key={action.label} action={action} />)}
          </div>
          <button type="button" onClick={() => window.location.assign('/next-workspace/profile')} className="mt-5 flex min-h-12 w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700">
            <span>Profile & account</span><FinOpsIcon name="chevron" className="h-4 w-4 text-slate-400" />
          </button>
          <button type="button" onClick={async () => { await supabase.auth.signOut(); window.location.replace('/?next=%2Fmobile'); }} className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
            Sign out
          </button>
          <div className="mt-5 rounded-xl border border-slate-200 bg-slate-100/70 p-3 text-xs leading-5 text-slate-500">
            Advanced accounting and setup tools remain available in the existing workspace. You do not need to use them for everyday sales and customer tasks.
          </div>
        </section>}
      </div>

      <MobileBottomNav activeTab={activeTab} onSelect={chooseTab} />
    </main>
  );
}
