'use client';

import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { demoBusiness } from './test-data';

type NavItem = [string, string, string];
type Group = { name: string; hint: string; items: NavItem[] };

const groups: Group[] = [
  { name: 'Home', hint: 'See what matters now', items: [['Overview', '/next-workspace', '⌂']] },
  { name: 'Sell', hint: 'Get paid faster', items: [['Sales', '/next-workspace/sales', '↗'], ['Estimates', '/next-workspace/quotation', '▤'], ['Customers', '/next-workspace/customers', '◉'], ['Recurring', '/next-workspace/recurring', '↻']] },
  { name: 'Buy', hint: 'Track money going out', items: [['Purchases & Bills', '/next-workspace/purchases', '▣'], ['Expenses', '/next-workspace/expenses', '−'], ['Vendors', '/next-workspace/vendors', '◇']] },
  { name: 'Money', hint: 'Cash, banking and books', items: [['Banking', '/next-workspace/banking', '⌁'], ['Payments', '/next-workspace/payments', '₹'], ['Receipts', '/next-workspace/receipts', '✓'], ['Accounting', '/next-workspace/accounting', '∑']] },
  { name: 'Products', hint: 'Items and inventory', items: [['Products & Services', '/next-workspace/items', '□'], ['Inventory', '/next-workspace/inventory', '▦']] },
  { name: 'Insights', hint: 'Understand your business', items: [['Tax Center', '/next-workspace/tax', '%'], ['Reports', '/next-workspace/reports', '▥']] },
  { name: 'Manage', hint: 'Make Moneymatters yours', items: [['Automation', '/next-workspace/preferences', '✦'], ['Documents & Branding', '/next-workspace/brand', 'A'], ['Business Settings', '/next-workspace/business-settings', '⚙']] },
];

const createItems: NavItem[] = [['Invoice', '/next-workspace/sales', '＋'], ['Estimate', '/next-workspace/quotation', '＋'], ['Payment', '/next-workspace/payments', '＋'], ['Expense', '/next-workspace/expenses', '＋'], ['Customer', '/next-workspace/customers', '＋'], ['Product / Service', '/next-workspace/items', '＋']];

const titleMap: Record<string, string> = {
  '/next-workspace': 'Overview', '/next-workspace/sales': 'Sales', '/next-workspace/quotation': 'Estimates', '/next-workspace/customers': 'Customers', '/next-workspace/vendors': 'Vendors', '/next-workspace/items': 'Products & Services', '/next-workspace/inventory': 'Inventory', '/next-workspace/purchases': 'Purchases & Bills', '/next-workspace/expenses': 'Expenses', '/next-workspace/recurring': 'Recurring', '/next-workspace/banking': 'Banking', '/next-workspace/payments': 'Payments', '/next-workspace/receipts': 'Receipts', '/next-workspace/accounting': 'Accounting', '/next-workspace/tax': 'Tax Center', '/next-workspace/reports': 'Reports', '/next-workspace/brand': 'Documents & Branding', '/next-workspace/business-settings': 'Business Settings', '/next-workspace/preferences': 'Automation', '/next-workspace/profile': 'My Profile',
};

function Navigation({ pathname, onNavigate }: { pathname: string; onNavigate: (href: string) => void }) {
  const [open, setOpen] = useState('');
  return <nav className="space-y-2">{groups.map(group => {
    const active = group.items.some(([, href]) => pathname === href || (href !== '/next-workspace' && pathname.startsWith(href + '/')));
    const expanded = open === group.name || active || group.name === 'Home';
    return <section key={group.name}>
      <button onClick={() => setOpen(expanded && open === group.name ? '' : group.name)} className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left ${active ? 'text-violet-800' : 'text-slate-500 hover:bg-violet-50'}`}>
        <span><b className="block text-[11px] font-bold uppercase tracking-[.14em]">{group.name}</b><small className="mt-0.5 block text-[10px] font-normal text-slate-400">{group.hint}</small></span><span className="text-xs">{expanded ? '⌄' : '›'}</span>
      </button>
      <div className={`${expanded ? 'mt-1 max-h-96 opacity-100' : 'max-h-0 opacity-0'} overflow-hidden transition-all duration-200`}>
        {group.items.map(([label, href, icon]) => { const itemActive = pathname === href || (href !== '/next-workspace' && pathname.startsWith(href + '/')); return <button key={href} onClick={() => onNavigate(href)} className={`mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium ${itemActive ? 'bg-violet-100 text-violet-900 shadow-sm' : 'text-slate-600 hover:bg-slate-50'}`}><span className={`grid h-7 w-7 place-items-center rounded-lg text-xs ${itemActive ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-500'}`}>{icon}</span>{label}</button>; })}
      </div>
    </section>;
  })}</nav>;
}

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mobile, setMobile] = useState(false);
  const [create, setCreate] = useState(false);
  const [account, setAccount] = useState(false);
  const go = (href: string) => { setMobile(false); setCreate(false); setAccount(false); window.location.href = href; };
  return <div className="min-h-screen bg-[#f7f6fb] text-slate-900">
    <div className="border-b border-violet-100 bg-violet-950 px-4 py-1.5 text-center text-[11px] font-semibold text-violet-100">TESTING BUILD · Login verification, user creation and WhatsApp / Email / SMS APIs are intentionally disabled</div>
    <header className="sticky top-0 z-50 h-16 border-b border-violet-100 bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-full max-w-[1540px] items-center gap-3 px-3 sm:px-5 lg:px-6">
        <button onClick={() => setMobile(true)} className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 lg:hidden">☰</button>
        <button onClick={() => go('/next-workspace')} className="flex items-center gap-2.5 text-left"><span className="grid h-10 w-10 place-items-center rounded-xl bg-violet-600 text-sm font-black text-white shadow-sm">M</span><span className="hidden sm:block"><b className="block text-sm">Moneymatters</b><small className="text-[10px] text-slate-400">Business financial workspace</small></span></button>
        <div className="hidden flex-1 md:block"><div className="mx-auto max-w-xl flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"><span className="text-slate-400">⌕</span><input className="min-w-0 flex-1 bg-transparent text-sm outline-none" placeholder="Search anything — customer, invoice, payment…" /><kbd className="hidden rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[9px] text-slate-400 lg:block">⌘ K</kbd></div></div>
        <div className="relative ml-auto"><button onClick={() => setCreate(v => !v)} className="rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-violet-700">＋ Create</button>{create && <div className="absolute right-0 mt-2 w-72 rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl">{createItems.map(([label, href, icon]) => <button key={href} onClick={() => go(href)} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm hover:bg-violet-50"><span className="grid h-8 w-8 place-items-center rounded-lg bg-violet-50 text-violet-700">{icon}</span><span><b className="block">{label}</b><small className="text-[10px] text-slate-400">Start a new {label.toLowerCase()}</small></span></button>)}</div>}</div>
        <div className="relative"><button onClick={() => setAccount(v => !v)} className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-violet-50"><span className="hidden text-right sm:block"><b className="block text-xs">{demoBusiness.name}</b><small className="text-[10px] text-slate-400">Testing account · Owner</small></span><span className="grid h-9 w-9 place-items-center rounded-full bg-violet-100 text-xs font-bold text-violet-700">MB</span><span className="text-xs text-slate-400">⌄</span></button>{account && <div className="absolute right-0 mt-2 w-72 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl"><div className="rounded-xl bg-violet-50 p-3"><b className="block text-sm">{demoBusiness.name}</b><span className="text-xs text-violet-700">Owner · Testing mode</span></div><button onClick={() => go('/next-workspace/business-settings')} className="mt-2 w-full rounded-xl px-3 py-2.5 text-left text-sm hover:bg-violet-50">Business Settings</button><button onClick={() => { localStorage.clear(); window.location.reload(); }} className="w-full rounded-xl px-3 py-2.5 text-left text-sm text-rose-600 hover:bg-rose-50">Reset test data</button></div>}</div>
      </div>
    </header>
    <div className="mx-auto grid max-w-[1540px] lg:grid-cols-[250px_minmax(0,1fr)]">
      <aside className="hidden min-h-[calc(100vh-90px)] border-r border-violet-100 bg-white px-3 py-5 lg:block"><Navigation pathname={pathname} onNavigate={go}/></aside>
      {mobile && <><button aria-label="Close menu" onClick={() => setMobile(false)} className="fixed inset-0 z-[60] bg-violet-950/20 lg:hidden"/><aside className="fixed inset-y-0 left-0 z-[70] w-[310px] overflow-y-auto border-r border-violet-100 bg-white px-4 py-5 shadow-2xl lg:hidden"><div className="mb-5 flex items-center justify-between"><div className="flex items-center gap-2"><span className="grid h-9 w-9 place-items-center rounded-xl bg-violet-600 font-black text-white">M</span><b>Moneymatters</b></div><button onClick={() => setMobile(false)} className="grid h-9 w-9 place-items-center rounded-lg bg-violet-50 text-violet-700">×</button></div><Navigation pathname={pathname} onNavigate={go}/></aside></>}
      <main className="min-w-0"><div className="border-b border-violet-100 bg-white px-4 py-3 sm:px-6"><div className="mx-auto flex max-w-[1280px] items-center justify-between"><div><span className="text-xs font-semibold text-slate-400">Moneymatters</span><span className="mx-2 text-slate-300">/</span><span className="text-sm font-semibold">{titleMap[pathname] || 'Workspace'}</span></div><span className="hidden rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700 sm:block">● Demo data</span></div></div>{children}</main>
    </div>
  </div>;
}
