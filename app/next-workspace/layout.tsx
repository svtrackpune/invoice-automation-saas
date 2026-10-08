'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { supabase, type BusinessContext } from '@/lib/supabase';
import GlobalSearch from './GlobalSearch';
import { BusinessConfigProvider, useBusinessConfig } from '@/lib/BusinessConfigContext';
import { buildAdaptiveCreateRoutes } from '@/lib/adaptive-navigation';
import { canAccessRoute, canShowCreateMenu } from '@/lib/rbac';
import { FinOpsIcon, FinOpsPrimaryButton, FinOpsSecondaryButton } from '@/components/ui/finops/FinOpsPrimitives';

type NavItem = { label: string; href: string; icon: Parameters<typeof FinOpsIcon>[0]['name']; always?: boolean };
type NavGroup = { name: string; items: NavItem[] };

const baseGroups: NavGroup[] = [
  { name: 'Overview', items: [{ label: 'Dashboard', href: '/next-workspace', icon: 'dashboard' }] },
  { name: 'Sales & Billing', items: [
    { label: 'Cash Bill (POS)', href: '/next-workspace/cash-bill', icon: 'cash' },
    { label: 'Invoices', href: '/next-workspace/invoices', icon: 'invoice' },
    { label: 'Quotations', href: '/next-workspace/quotation', icon: 'quote' },
    { label: 'Receipts', href: '/next-workspace/receipts', icon: 'cash' },
    { label: 'Customers', href: '/next-workspace/customers', icon: 'customer' },
    { label: 'Products & Services', href: '/next-workspace/items', icon: 'invoice' },
    { label: 'Delivery Challans', href: '/next-workspace/delivery-challans', icon: 'statement' },
    { label: 'Barcode Printing', href: '/next-workspace/barcodes', icon: 'invoice' },
  ]},
  { name: 'Documents', items: [
    { label: 'Document Library', href: '/next-workspace/documents/library', icon: 'invoice' },
    { label: 'Templates & Branding', href: '/next-workspace/brand', icon: 'settings' },
  ]},
  { name: 'Purchases & Expenses', items: [
    { label: 'Expenses', href: '/next-workspace/expenses', icon: 'expense' },
    { label: 'Bills & Purchase Orders', href: '/next-workspace/bills', icon: 'statement' },
    { label: 'Vendors', href: '/next-workspace/vendors', icon: 'vendor' },
  ]},
  { name: 'Treasury & Banking', items: [
    { label: 'Bank Accounts', href: '/next-workspace/banking', icon: 'bank' },
    { label: 'Reconciliation', href: '/next-workspace/banking', icon: 'reconcile' },
    { label: 'Statements', href: '/next-workspace/banking', icon: 'statement' },
    { label: 'Payments', href: '/next-workspace/payments', icon: 'cash' },
    { label: 'Payments & Banking', href: '/next-workspace/settings/payments', icon: 'bank' },
      { label: 'System Diagnostics', href: '/next-workspace/settings/diagnostics', icon: 'settings' },
  ]},
  { name: 'Reports & Compliance', items: [
    { label: 'Tax (GST / VAT)', href: '/next-workspace/tax', icon: 'tax' },
    { label: 'P&L & Reports', href: '/next-workspace/reports', icon: 'report' },
    { label: 'Audit Trails', href: '/next-workspace/accounting', icon: 'audit' },
    { label: 'Day Book', href: '/next-workspace/day-book', icon: 'statement' },
    { label: 'Stock Audit', href: '/next-workspace/stock-audit', icon: 'audit' },
    { label: 'Daily Cash Book', href: '/next-workspace/reports/daily-cash-book', icon: 'cash' },
    { label: 'Statutory Hub', href: '/next-workspace/reports/statutory-hub', icon: 'tax' },
  ]},
  { name: 'System', items: [
    { label: 'Business Settings', href: '/next-workspace/business-settings', icon: 'settings' },
    { label: 'Integrations & Data', href: '/next-workspace/data-migration', icon: 'integration' },
    { label: 'Profile', href: '/next-workspace/profile', icon: 'profile' },
  ]},
];

const titles: Record<string, string> = {
  '/next-workspace': 'Dashboard',
  '/next-workspace/invoices': 'Invoices',
  '/next-workspace/quotation': 'Quotations',
  '/next-workspace/customers': 'Customers',
  '/next-workspace/vendors': 'Vendors',
  '/next-workspace/items': 'Products & Services',
  '/next-workspace/delivery-challans': 'Delivery Challans',
  '/next-workspace/barcodes': 'Barcode Printing',
  '/next-workspace/day-book': 'Day Book',
  '/next-workspace/stock-audit': 'Stock Audit',
  '/next-workspace/reports/daily-cash-book': 'Daily Cash Book',
  '/next-workspace/reports/statutory-hub': 'Statutory Hub',
  '/next-workspace/purchases': 'Vendor Bills',
  '/next-workspace/bills': 'Bills & Purchase Orders',
  '/next-workspace/expenses': 'Expenses',
  '/next-workspace/banking': 'Banking & Reconciliation',
  '/next-workspace/payments': 'Payments',
  '/next-workspace/settings/payments': 'Payments & Banking',
  '/next-workspace/settings/diagnostics': 'System Health & Integrity',
  '/next-workspace/receipts': 'Receipts',
  '/next-workspace/accounting': 'Accounting & Audit',
  '/next-workspace/tax': 'Tax & Compliance',
  '/next-workspace/reports': 'Reports & P&L',
  '/next-workspace/business-settings': 'Business Settings',
  '/next-workspace/brand': 'Templates & Branding',
  '/next-workspace/documents': 'Document Viewer',
  '/next-workspace/documents/library': 'Document Library',
  '/next-workspace/data-migration': 'Integrations & Data',
  '/next-workspace/profile': 'Profile',
  '/next-workspace/cash-bill': 'Cash Bill',
};

function monthPeriodLabel() {
  return new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' }).format(new Date());
}

function Nav({ pathname, go, openGroup, setOpenGroup, cashBillEnabled, collapsed, business }: {
  pathname: string;
  go: (href: string) => void;
  openGroup: string;
  setOpenGroup: (name: string) => void;
  cashBillEnabled: boolean;
  collapsed: boolean;
  business: BusinessContext | null;
}) {
  const groups = useMemo(() => baseGroups.map(group => ({
    ...group,
    items: group.items.filter(item => (item.href !== '/next-workspace/cash-bill' || cashBillEnabled) && canAccessRoute(business, item.href)),
  })).filter(group => group.items.length), [business, cashBillEnabled]);

  return (
    <nav aria-label="Workspace navigation" className="space-y-4">
      {groups.map(group => (
        <section key={group.name}>
          {!collapsed && (
            <button type="button" onClick={() => group.items.length > 1 && setOpenGroup(openGroup === group.name ? '' : group.name)}
              className="mb-1.5 flex w-full items-center justify-between px-2 text-left text-[11px] font-bold uppercase tracking-[.14em] text-slate-400 hover:text-slate-600"
              aria-expanded={group.items.length > 1 ? openGroup === group.name : undefined}>
              <span>{group.name}</span>
              {group.items.length > 1 ? <span className="text-slate-300">{openGroup === group.name ? '−' : '+'}</span> : null}
            </button>
          )}
          <div className={collapsed || openGroup === group.name || group.items.length === 1 ? 'space-y-0.5' : 'hidden'}>
            {group.items.map(item => {
              const active = pathname === item.href || (item.href !== '/next-workspace' && pathname.startsWith(item.href + '/'));
              return (
                <button key={item.label} type="button" onClick={() => go(item.href)} aria-current={active ? 'page' : undefined}
                  title={collapsed ? item.label : undefined}
                  className={`group flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 ${collapsed ? 'justify-center px-0 py-2.5' : ''} ${active ? 'bg-slate-900 font-medium text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100/80 hover:text-slate-900'}`}>
                  <FinOpsIcon name={item.icon} className={`h-4 w-4 shrink-0 ${active ? 'text-white' : 'text-slate-400 group-hover:text-slate-600'}`} />
                  {!collapsed ? <span className="min-w-0 truncate">{item.label}</span> : null}
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </nav>
  );
}

function QuickActionMenu({ go }: { go: (href: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (event: MouseEvent) => { if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  return <div ref={ref} className="relative flex">
    <FinOpsPrimaryButton onClick={() => go('/next-workspace/invoices/new')}><FinOpsIcon name="plus" className="h-4 w-4"/> Quick Action</FinOpsPrimaryButton>
    <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(v => !v)} className="inline-flex h-9 w-8 items-center justify-center rounded-r-lg border border-l border-indigo-500 bg-indigo-600 text-white hover:bg-indigo-700"><span className="text-xs">⌄</span></button>
    {open && <div role="menu" className="absolute right-0 top-10 z-[100] w-60 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">
      {[
        ['New Invoice', '/next-workspace/invoices/new'],
        ['New Cash Bill', '/next-workspace/cash-bill'],
        ['Record Payment', '/next-workspace/payments'],
        ['Add Expense', '/next-workspace/expenses'],
      ].map(([label, href]) => <button key={href} type="button" role="menuitem" onClick={() => { setOpen(false); go(href); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50">{label}</button>)}
    </div>}
  </div>;
}

function WorkspaceChrome({ children, businesses, activeBusinessId, setActiveBusinessId, userName, cashBillEnabled }: {
  children: ReactNode;
  businesses: BusinessContext[];
  activeBusinessId: string;
  setActiveBusinessId: (id: string) => void;
  userName: string;
  cashBillEnabled: boolean;
}) {
  const pathname = usePathname();
  const [mobile, setMobile] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [businessMenu, setBusinessMenu] = useState(false);
  const [accountMenu, setAccountMenu] = useState(false);
  const [openGroup, setOpenGroup] = useState('Sales & Billing');
  const businessRef = useRef<HTMLDivElement>(null);
  const accountRef = useRef<HTMLDivElement>(null);
  const { config, loading: configLoading, error: configError } = useBusinessConfig();
  const active = businesses.find(b => b.business_id === activeBusinessId) || businesses[0];
  const createItems = useMemo(() => buildAdaptiveCreateRoutes(config).filter(item => canAccessRoute(active, item.href)), [active, config]);

  useEffect(() => {
    setCollapsed(localStorage.getItem('moneymatters.sidebarCollapsed') === '1');
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setBusinessMenu(false); setAccountMenu(false); setMobile(false); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    const group = baseGroups.find(g => g.items.some(i => pathname === i.href || pathname.startsWith(i.href + '/')));
    if (group && group.items.length > 1) setOpenGroup(group.name);
  }, [pathname]);

  const go = (href: string) => { setMobile(false); setBusinessMenu(false); setAccountMenu(false); window.location.href = href; };
  const toggleSidebar = () => setCollapsed(current => { const next = !current; localStorage.setItem('moneymatters.sidebarCollapsed', next ? '1' : '0'); return next; });
  const switchBusiness = (id: string) => {
    if (!businesses.some(b => b.business_id === id)) return;
    localStorage.setItem('moneymatters.activeBusinessId', id);
    setActiveBusinessId(id);
    window.dispatchEvent(new Event('moneymatters:business-changed'));
    window.location.reload();
  };

  return <div className="min-h-screen bg-slate-50 text-slate-900">
    <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[200] focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:shadow-xl">Skip to main content</a>

    <header className="sticky top-0 z-50 h-16 border-b border-slate-200/80 bg-white/95 backdrop-blur">
      <div className="flex h-full items-center gap-3 px-4 sm:px-5">
        <button type="button" onClick={() => setMobile(true)} aria-label="Open navigation menu" aria-expanded={mobile} className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 bg-white text-slate-600 lg:hidden"><span className="text-lg">☰</span></button>

        <button type="button" onClick={() => go('/next-workspace')} className="flex w-64 shrink-0 items-center gap-2.5 text-left">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-slate-900 text-sm font-black text-white">M</span>
          <span><span className="block text-sm font-bold tracking-tight text-slate-950">Moneymatters</span><span className="mt-0.5 block text-[10px] text-slate-400">FinOps workspace</span></span>
        </button>

        <div className="hidden min-w-0 flex-1 md:block"><div className="mx-auto w-full max-w-lg"><GlobalSearch /></div></div>

        <div ref={businessRef} className="relative hidden shrink-0 lg:block">
          <button type="button" onClick={() => setBusinessMenu(v => !v)} aria-haspopup="menu" aria-expanded={businessMenu} className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-slate-100">
            <span className="min-w-0"><span className="block max-w-40 truncate text-xs font-semibold text-slate-900">{active?.business_name || 'Business'}</span><span className="block text-[10px] text-slate-400">Active entity</span></span>
            <span className="text-slate-400">⌄</span>
          </button>
          {businessMenu && <div role="menu" className="absolute right-0 top-11 z-[100] w-72 rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
            <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Business switcher</div>
            {businesses.map(b => <button key={b.business_id} type="button" role="menuitem" onClick={() => switchBusiness(b.business_id)} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-xs ${b.business_id === activeBusinessId ? 'bg-indigo-50 text-indigo-700' : 'text-slate-700 hover:bg-slate-50'}`}>
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-100 font-bold text-slate-500">{b.business_name.slice(0, 2).toUpperCase()}</span>
              <span className="min-w-0 flex-1"><b className="block truncate">{b.business_name}</b><span className="text-[10px] text-slate-400">{b.role}</span></span>
              {b.business_id === activeBusinessId ? <span className="text-[10px] font-bold">Current</span> : null}
            </button>)}
          </div>}
        </div>

        <span className="hidden rounded-full border border-slate-200 bg-slate-100 px-2.5 py-1 text-[10px] font-semibold text-slate-600 xl:inline-flex">Period: {monthPeriodLabel()} • Open</span>

        <div className="ml-auto flex items-center gap-2">
          {canShowCreateMenu(active) && <QuickActionMenu go={go} />}
          <button type="button" title="Notifications" aria-label="Notifications" className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"><FinOpsIcon name="bell" /></button>
          <div ref={accountRef} className="relative">
            <button type="button" onClick={() => setAccountMenu(v => !v)} aria-haspopup="menu" aria-expanded={accountMenu} className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-slate-100">
              <span className="hidden text-right sm:block"><span className="block max-w-28 truncate text-xs font-semibold text-slate-900">{userName}</span><span className="block text-[10px] text-slate-400">{active?.role || 'Account'}</span></span>
              <span className="grid h-8 w-8 place-items-center rounded-full bg-indigo-50 text-[11px] font-bold text-indigo-700">{(userName || 'A').slice(0, 2).toUpperCase()}</span>
            </button>
            {accountMenu && <div role="menu" className="absolute right-0 top-11 z-[100] w-64 rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
              <div className="border-b border-slate-100 px-3 py-2.5"><b className="block text-sm">{userName}</b><span className="text-[10px] text-slate-400">{active?.role || 'Account'}</span></div>
              <button type="button" role="menuitem" onClick={() => go('/next-workspace/profile')} className="mt-1 flex w-full rounded-lg px-3 py-2.5 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50">Profile</button>
              <button type="button" role="menuitem" onClick={() => go('/next-workspace/business-settings')} className="flex w-full rounded-lg px-3 py-2.5 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50">Business Settings</button>
              <button type="button" role="menuitem" onClick={() => go('/next-workspace/create-business')} className="flex w-full rounded-lg px-3 py-2.5 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50">Create another business</button>
              <button type="button" role="menuitem" onClick={async () => { await supabase.auth.signOut(); window.location.href = '/'; }} className="mt-1 flex w-full rounded-lg px-3 py-2.5 text-left text-xs font-semibold text-rose-700 hover:bg-rose-50">Sign out</button>
            </div>}
          </div>
        </div>
      </div>
    </header>

    {configError ? <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs text-amber-800">Business capability configuration could not be loaded; safe defaults are being used.</div> : null}

    <div className="flex min-h-[calc(100vh-64px)]">
      <aside className={`sticky top-16 hidden h-[calc(100vh-64px)] shrink-0 overflow-y-auto border-r border-slate-200/80 bg-white py-4 transition-[width] duration-200 lg:block ${collapsed ? 'w-[72px] px-2' : 'w-64 px-3'}`}>
        <div className={`mb-4 flex items-center ${collapsed ? 'justify-center' : 'justify-between'}`}>
          {!collapsed ? <span className="px-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Workspace navigation</span> : null}
          <button type="button" onClick={toggleSidebar} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"><span>{collapsed ? '›' : '‹'}</span></button>
        </div>
        <Nav pathname={pathname} go={go} openGroup={openGroup} setOpenGroup={setOpenGroup} cashBillEnabled={cashBillEnabled} collapsed={collapsed} business={active || null}/>
      </aside>

      {mobile ? <><button type="button" aria-label="Close navigation menu" onClick={() => setMobile(false)} className="fixed inset-0 z-[60] bg-slate-950/20 lg:hidden"/><aside className="fixed inset-y-0 left-0 z-[70] w-72 overflow-y-auto border-r border-slate-200 bg-white px-4 py-4 shadow-2xl lg:hidden"><div className="mb-5 flex items-center justify-between"><div><b className="text-sm">Moneymatters</b><span className="block text-[10px] text-slate-400">FinOps workspace</span></div><button type="button" aria-label="Close navigation menu" onClick={() => setMobile(false)} className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200">×</button></div><Nav pathname={pathname} go={go} openGroup={openGroup} setOpenGroup={setOpenGroup} cashBillEnabled={cashBillEnabled} collapsed={false} business={active || null}/></aside></> : null}

      <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 outline-none">
        <div className="border-b border-slate-200/80 bg-white px-4 py-2.5 sm:px-6">
          <div className="mx-auto flex max-w-[1480px] items-center gap-2"><span className="text-[11px] text-slate-400">Moneymatters</span><span className="text-slate-300">/</span><span className="text-xs font-semibold text-slate-700">{titles[pathname] || 'Workspace'}</span></div>
        </div>
        {configLoading ? <div className="px-6 py-2 text-center text-[11px] text-slate-400">Loading business configuration…</div> : null}
        {children}
      </main>
    </div>
  </div>;
}

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  const [userName, setUserName] = useState('Account');
  const [businesses, setBusinesses] = useState<BusinessContext[]>([]);
  const [activeBusinessId, setActiveBusinessId] = useState('');
  const [cashBillEnabled, setCashBillEnabled] = useState(false);

  useEffect(() => {
    (async () => {
      const [{ data: user }, context] = await Promise.all([supabase.auth.getUser(), supabase.rpc('get_my_business_context')]);
      setUserName(user.user?.user_metadata?.display_name || user.user?.email?.split('@')[0] || 'Account');
      const rows = (context.data || []) as BusinessContext[];
      setBusinesses(rows);
      if (!rows.length) return;
      const saved = localStorage.getItem('moneymatters.activeBusinessId');
      const active = rows.find(row => row.business_id === saved) || rows[0];
      setActiveBusinessId(active.business_id);
      localStorage.setItem('moneymatters.activeBusinessId', active.business_id);
      const pref = await supabase.from('business_settings').select('cash_bill_enabled').eq('business_id', active.business_id).maybeSingle();
      setCashBillEnabled(Boolean(pref.data?.cash_bill_enabled));
    })();
  }, []);

  if (!activeBusinessId) return <div className="grid min-h-screen place-items-center bg-slate-50 text-sm text-slate-500">Loading workspace…</div>;
  return <BusinessConfigProvider businessId={activeBusinessId}><WorkspaceChrome businesses={businesses} activeBusinessId={activeBusinessId} setActiveBusinessId={setActiveBusinessId} userName={userName} cashBillEnabled={cashBillEnabled}>{children}</WorkspaceChrome></BusinessConfigProvider>;
}
