'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

const nav = [
  ['Overview', '/next-workspace', '⌂'], ['Sales', '/next-workspace/sales', '↗'], ['Quotations', '/next-workspace/quotation', '▤'],
  ['Customers', '/next-workspace/customers', '♙'], ['Inventory', '/next-workspace/inventory', '▦'], ['Accounting', '/next-workspace/accounting', '∑'],
  ['Tax & ITR', '/next-workspace/tax', '%'], ['Reports', '/next-workspace/reports', '▥'], ['Branding', '/next-workspace/brand', '✦'], ['Preferences', '/next-workspace/preferences', '⚙'],
];
const flows: Record<string, { title: string; steps: string[]; help: string; next: string }> = {
  '/next-workspace/sales': { title: 'Sales', steps: ['Customer', 'Items', 'Review', 'Post', 'Payment', 'Receipt'], help: 'Start with the customer, add items, review the totals, then post the invoice. Payment and receipt come after posting.', next: 'Create an invoice' },
  '/next-workspace/quotation': { title: 'Quotation', steps: ['Customer', 'Items', 'Review', 'Send', 'Accept', 'Invoice'], help: 'Create a quote first when your customer needs to approve the price. Once accepted, convert it to an invoice without re-entering the items.', next: 'Create a quotation' },
  '/next-workspace/customers': { title: 'Customers', steps: ['Find', 'Profile', 'Transactions', 'Statement', 'Payment'], help: 'A customer profile keeps contact details, balances, invoices, payments and reminders together.', next: 'Add a customer' },
  '/next-workspace/customer-settings': { title: 'Customer Settings', steps: ['Customer', 'Reminders', 'Discount', 'Save'], help: 'Set customer-specific reminders and default discount preferences. These settings can override your business defaults.', next: 'Save customer preferences' },
  '/next-workspace/inventory': { title: 'Inventory', steps: ['Item', 'Pricing', 'Tax', 'Discount', 'Stock', 'Save'], help: 'Add products or services once. Their price, tax and discount rules can then flow into sales and quotations.', next: 'Add a product or service' },
  '/next-workspace/inventory-preferences': { title: 'Inventory Settings', steps: ['Products', 'Discount', 'Stock', 'Defaults', 'Save'], help: 'Choose sensible defaults for discounts and stock without locking yourself into rigid rules.', next: 'Set inventory defaults' },
  '/next-workspace/accounting': { title: 'Accounting', steps: ['Transactions', 'Journal', 'Ledger', 'Trial Balance', 'Reports', 'Year End'], help: 'Posted business transactions feed the accounting records. Use this area to review journals, ledgers, balances and year-end readiness.', next: 'Review accounting' },
  '/next-workspace/tax': { title: 'Tax & ITR', steps: ['Tax Profile', 'Books', 'Adjustments', 'Tax Summary', 'ITR Working', 'Export'], help: 'Choose only the tax options that apply to your business. Non-GST users can keep tax fields out of their everyday workflow.', next: 'Set tax profile' },
  '/next-workspace/reports': { title: 'Reports', steps: ['Choose', 'Period', 'Review', 'Drill Down', 'Export'], help: 'Choose a report and period, review the result, then drill into the transactions behind the number before exporting.', next: 'Open reports' },
  '/next-workspace/brand': { title: 'Brand & Documents', steps: ['Business', 'Logo', 'Invoice', 'Quotation', 'Receipt'], help: 'Set your business identity and choose separate templates for invoices, quotations and receipts.', next: 'Set document branding' },
  '/next-workspace/preferences': { title: 'Preferences', steps: ['Business', 'Tax', 'Reminders', 'Discounts', 'Documents'], help: 'Set defaults here. Defaults save time, but important customer and transaction settings can still be changed when needed.', next: 'Set preferences' },
};

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const flow = flows[pathname];
  const active = nav.findIndex(([, href]) => href === pathname);

  useEffect(() => {
    try {
      setShowWelcome(localStorage.getItem('mm_onboarding_seen') !== '1');
      setCollapsed(localStorage.getItem('mm_sidebar_collapsed') === '1');
    } catch {}
  }, []);

  useEffect(() => { setHelpOpen(false); }, [pathname]);

  const go = (href: string) => { setOpen(false); window.location.href = href; };
  const finishWelcome = () => { try { localStorage.setItem('mm_onboarding_seen', '1'); } catch {} setShowWelcome(false); };

  if (pathname === '/next-workspace') return <>{children}</>;

  return <div className="min-h-screen overflow-x-hidden bg-[#f5f7fb] text-slate-950">
    <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/95 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[1500px] items-center gap-3 px-3 sm:px-4 lg:px-5">
        <button aria-label="Open navigation" onClick={() => setOpen(true)} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-lg shadow-sm lg:hidden">☰</button>
        <button aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={() => { const next=!collapsed; setCollapsed(next); try { localStorage.setItem('mm_sidebar_collapsed', next ? '1' : '0'); } catch {} }} className="hidden h-10 w-10 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-lg shadow-sm lg:grid">☰</button>
        <button onClick={() => go('/next-workspace')} className="flex min-w-0 items-center gap-2.5 text-left"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-950 text-sm font-black text-white">M</span><span className="hidden min-w-0 sm:block"><b className="block truncate text-sm tracking-tight">Moneymatters</b><small className="text-[10px] text-slate-400">Business workspace</small></span></button>
        {flow && <div className="hidden min-w-0 items-center gap-2 border-l border-slate-200 pl-4 md:flex"><span className="truncate text-sm font-semibold">{flow.title}</span></div>}
        <div className="ml-auto flex shrink-0 items-center gap-2"><button onClick={() => go('/next-workspace')} className="hidden rounded-xl px-3 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100 md:block">Dashboard</button><button onClick={() => setHelpOpen(true)} className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 bg-white text-sm font-bold hover:bg-slate-50" aria-label="Page help">?</button><button onClick={() => go('/next-workspace/preferences')} className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 bg-white text-sm hover:bg-slate-50" aria-label="Preferences">⚙</button></div>
      </div>
    </header>

    <div className="mx-auto grid max-w-[1500px]" style={{ gridTemplateColumns: `minmax(0, ${collapsed ? '76px' : '230px'}) minmax(0,1fr)` }}>
      <aside className="hidden min-h-[calc(100vh-64px)] border-r border-slate-200 bg-white p-3 lg:block"><p className={`pb-2 pt-2 text-[10px] font-bold uppercase tracking-[.18em] text-slate-400 ${collapsed ? 'text-center' : 'px-3'}`}>{collapsed ? 'MM' : 'Workspace'}</p>{nav.map(([label, href, icon], index) => <button title={collapsed ? label : undefined} key={href} onClick={() => go(href)} className={`mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition ${collapsed ? 'justify-center px-2' : ''} ${active === index ? 'bg-slate-950 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950'}`}><span className="grid w-5 shrink-0 place-items-center">{icon}</span>{!collapsed && <span className="truncate">{label}</span>}</button>)}</aside>

      {open && <button aria-label="Close navigation" onClick={() => setOpen(false)} className="fixed inset-0 z-[60] bg-slate-950/30 backdrop-blur-sm lg:hidden" />}
      <aside className={`fixed inset-y-0 left-0 z-[70] w-[290px] transform border-r border-slate-200 bg-white p-4 shadow-2xl transition-transform duration-200 lg:hidden ${open ? 'translate-x-0' : '-translate-x-full'}`}><div className="mb-5 flex items-center justify-between"><div><b className="text-sm">Moneymatters</b><p className="mt-0.5 text-[10px] text-slate-400">Business workspace</p></div><button onClick={() => setOpen(false)} className="grid h-9 w-9 place-items-center rounded-xl bg-slate-100">×</button></div><p className="px-2 pb-2 text-[10px] font-bold uppercase tracking-[.18em] text-slate-400">Workspace</p>{nav.map(([label, href, icon], index) => <button key={href} onClick={() => go(href)} className={`mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-medium ${active === index ? 'bg-slate-950 text-white' : 'text-slate-600 hover:bg-slate-100'}`}><span className="grid w-5 place-items-center">{icon}</span>{label}</button>)}</aside>

      <main className="min-w-0">
        {flow && <FlowBar steps={flow.steps} />}
        {children}
      </main>
    </div>

    {flow && <button onClick={() => setHelpOpen(true)} className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full bg-slate-950 px-4 py-3 text-sm font-semibold text-white shadow-xl transition hover:-translate-y-0.5" aria-label="Get help"><span className="grid h-6 w-6 place-items-center rounded-full bg-white/15">?</span><span className="hidden sm:inline">Help</span></button>}

    {helpOpen && <HelpModal title={flow?.title || 'Moneymatters'} text={flow?.help || 'Use the dashboard to start a task. You can always open Help from the top-right corner.'} next={flow?.next} onClose={() => setHelpOpen(false)} />}
    {showWelcome && <WelcomeModal onClose={finishWelcome} onHelp={() => { finishWelcome(); setHelpOpen(true); }} onGo={(href) => { finishWelcome(); go(href); }} />}
  </div>;
}

function FlowBar({ steps }: { steps: string[] }) {
  return <div className="border-b border-slate-200 bg-white px-3 py-2.5 sm:px-5"><div className="mx-auto flex max-w-[1180px] items-center gap-2 overflow-x-auto pb-0.5"><span className="mr-1 shrink-0 text-[10px] font-bold uppercase tracking-[.16em] text-slate-400">Flow</span>{steps.map((step, i) => <div key={step} className="flex shrink-0 items-center gap-1.5"><span className="grid h-7 w-7 place-items-center rounded-full bg-slate-100 text-[10px] font-bold text-slate-600">{i + 1}</span><span className="whitespace-nowrap text-xs font-semibold text-slate-600">{step}</span>{i < steps.length - 1 && <span className="mx-1 text-slate-300">→</span>}</div>)}</div></div>;
}

function HelpModal({ title, text, next, onClose }: { title: string; text: string; next?: string; onClose: () => void }) {
  return <div className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/40 p-4 backdrop-blur-sm" onMouseDown={onClose}><section onMouseDown={e => e.stopPropagation()} className="w-full max-w-md overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl"><div className="flex items-start justify-between border-b border-slate-100 p-5"><div><p className="text-[10px] font-bold uppercase tracking-[.16em] text-slate-400">Quick help</p><h2 className="mt-1 text-xl font-semibold text-slate-950">{title}</h2></div><button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-xl bg-slate-100 text-slate-500">×</button></div><div className="p-5"><p className="text-sm leading-6 text-slate-600">{text}</p>{next && <div className="mt-4 rounded-2xl bg-slate-50 p-4"><p className="text-[10px] font-bold uppercase tracking-[.15em] text-slate-400">Suggested next step</p><p className="mt-1 text-sm font-semibold text-slate-900">{next}</p></div>}<button onClick={onClose} className="mt-5 w-full rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white">Got it</button></div></section></div>;
}

function WelcomeModal({ onClose, onHelp, onGo }: { onClose: () => void; onHelp: () => void; onGo: (href: string) => void }) {
  return <div className="fixed inset-0 z-[110] grid place-items-center bg-slate-950/50 p-4 backdrop-blur-sm"><section className="w-full max-w-lg overflow-hidden rounded-[28px] border border-white/20 bg-white shadow-2xl"><div className="bg-slate-950 p-7 text-white"><div className="grid h-12 w-12 place-items-center rounded-2xl bg-white text-lg font-black text-slate-950">M</div><p className="mt-5 text-xs font-bold uppercase tracking-[.18em] text-white/50">Welcome to Moneymatters</p><h1 className="mt-2 text-2xl font-semibold tracking-tight">Your accounts, without the confusion.</h1><p className="mt-2 max-w-md text-sm leading-6 text-white/70">Start with customers, sales and expenses. Moneymatters keeps the accounting work connected for you.</p></div><div className="p-6"><div className="grid gap-3 sm:grid-cols-3"><button onClick={() => onGo('/next-workspace/sales')} className="rounded-2xl border border-slate-200 p-4 text-left hover:bg-slate-50"><b className="block text-sm">Sell</b><span className="mt-1 block text-xs leading-5 text-slate-500">Create an invoice or quotation.</span></button><button onClick={() => onGo('/next-workspace/customers')} className="rounded-2xl border border-slate-200 p-4 text-left hover:bg-slate-50"><b className="block text-sm">Customers</b><span className="mt-1 block text-xs leading-5 text-slate-500">Add your first customer.</span></button><button onClick={() => onGo('/next-workspace/inventory')} className="rounded-2xl border border-slate-200 p-4 text-left hover:bg-slate-50"><b className="block text-sm">Inventory</b><span className="mt-1 block text-xs leading-5 text-slate-500">Add products and services.</span></button></div><div className="mt-5 flex flex-col gap-2 sm:flex-row"><button onClick={onHelp} className="flex-1 rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Show me around</button><button onClick={onClose} className="flex-1 rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white">Start using Moneymatters</button></div><p className="mt-3 text-center text-[11px] text-slate-400">You can reopen help anytime with the ? button.</p></div></section></div>;
}
