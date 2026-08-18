'use client';

import { usePathname } from 'next/navigation';
import { useState } from 'react';

const nav = [
  ['Overview', '/next-workspace', '⌂'], ['Sales', '/next-workspace/sales', '↗'], ['Quotations', '/next-workspace/quotation', '▤'],
  ['Customers', '/next-workspace/customers', '♙'], ['Inventory', '/next-workspace/inventory', '▦'], ['Accounting', '/next-workspace/accounting', '∑'],
  ['Tax & ITR', '/next-workspace/tax', '%'], ['Reports', '/next-workspace/reports', '▥'], ['Branding', '/next-workspace/brand', '✦'], ['Preferences', '/next-workspace/preferences', '⚙'],
];
const flows: Record<string, { title: string; steps: string[] }> = {
  '/next-workspace/sales': { title: 'Sales', steps: ['Customer', 'Items', 'Review', 'Post', 'Payment', 'Receipt'] },
  '/next-workspace/quotation': { title: 'Quotation', steps: ['Customer', 'Items', 'Review', 'Send', 'Accept', 'Invoice'] },
  '/next-workspace/customers': { title: 'Customers', steps: ['Find', 'Profile', 'Transactions', 'Statement', 'Payment'] },
  '/next-workspace/inventory': { title: 'Inventory', steps: ['Item', 'Pricing', 'Tax', 'Discount', 'Stock', 'Save'] },
  '/next-workspace/accounting': { title: 'Accounting', steps: ['Transactions', 'Journal', 'Ledger', 'Trial Balance', 'Reports', 'Year End'] },
  '/next-workspace/tax': { title: 'Tax & ITR', steps: ['Tax Profile', 'Books', 'Adjustments', 'Tax Summary', 'ITR Working', 'Export'] },
  '/next-workspace/reports': { title: 'Reports', steps: ['Choose', 'Period', 'Review', 'Drill Down', 'Export'] },
  '/next-workspace/brand': { title: 'Brand & Documents', steps: ['Business', 'Logo', 'Invoice', 'Quotation', 'Receipt'] },
  '/next-workspace/preferences': { title: 'Preferences', steps: ['Business', 'Tax', 'Reminders', 'Discounts', 'Documents'] },
};

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // Overview already contains the richer cockpit shell. Keep it untouched and apply the shared shell to all functional pages.
  if (pathname === '/next-workspace') return <>{children}</>;
  const [open, setOpen] = useState(false);
  const flow = flows[pathname];
  const active = nav.findIndex(([, href]) => href === pathname);
  const go = (href: string) => { setOpen(false); window.location.href = href; };
  return <div className="min-h-screen bg-[#f5f7fb] text-slate-950">
    <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/95 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[1500px] items-center gap-3 px-4 lg:px-6">
        <button aria-label="Open navigation" onClick={() => setOpen(true)} className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 bg-white text-lg shadow-sm lg:hidden">☰</button>
        <button onClick={() => go('/next-workspace')} className="flex items-center gap-2.5 text-left"><span className="grid h-9 w-9 place-items-center rounded-xl bg-slate-950 text-sm font-black text-white">M</span><span className="hidden sm:block"><b className="block text-sm tracking-tight">Moneymatters</b><small className="text-[10px] text-slate-400">Business workspace</small></span></button>
        {flow && <div className="hidden items-center gap-2 border-l border-slate-200 pl-4 md:flex"><span className="text-sm font-semibold">{flow.title}</span></div>}
        <div className="ml-auto flex items-center gap-2"><button onClick={() => go('/next-workspace')} className="hidden rounded-xl px-3 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100 md:block">Dashboard</button><button onClick={() => go('/next-workspace/preferences')} className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 bg-white text-sm hover:bg-slate-50" aria-label="Preferences">⚙</button></div>
      </div>
    </header>
    <div className="mx-auto grid max-w-[1500px] lg:grid-cols-[230px_1fr]">
      <aside className="hidden min-h-[calc(100vh-64px)] border-r border-slate-200 bg-white p-3 lg:block"><p className="px-3 pb-2 pt-2 text-[10px] font-bold uppercase tracking-[.18em] text-slate-400">Workspace</p>{nav.map(([label, href, icon], index) => <button key={href} onClick={() => go(href)} className={`mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition ${active === index ? 'bg-slate-950 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950'}`}><span className="grid w-5 place-items-center">{icon}</span>{label}</button>)}</aside>
      {open && <button aria-label="Close navigation" onClick={() => setOpen(false)} className="fixed inset-0 z-[60] bg-slate-950/30 backdrop-blur-sm lg:hidden" />}
      <aside className={`fixed inset-y-0 left-0 z-[70] w-[290px] transform border-r border-slate-200 bg-white p-4 shadow-2xl transition-transform duration-200 lg:hidden ${open ? 'translate-x-0' : '-translate-x-full'}`}><div className="mb-5 flex items-center justify-between"><b className="text-sm">Moneymatters</b><button onClick={() => setOpen(false)} className="grid h-9 w-9 place-items-center rounded-xl bg-slate-100">×</button></div><p className="px-2 pb-2 text-[10px] font-bold uppercase tracking-[.18em] text-slate-400">Workspace</p>{nav.map(([label, href, icon], index) => <button key={href} onClick={() => go(href)} className={`mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-medium ${active === index ? 'bg-slate-950 text-white' : 'text-slate-600 hover:bg-slate-100'}`}><span className="grid w-5 place-items-center">{icon}</span>{label}</button>)}</aside>
      <main className="min-w-0">{flow && <FlowBar steps={flow.steps} />}{children}</main>
    </div>
  </div>;
}
function FlowBar({ steps }: { steps: string[] }) { return <div className="border-b border-slate-200 bg-white px-4 py-3 sm:px-6"><div className="mx-auto flex max-w-[1180px] items-center gap-3 overflow-x-auto"><span className="mr-1 shrink-0 text-xs font-bold uppercase tracking-wider text-slate-400">Flow</span>{steps.map((step, i) => <div key={step} className="flex shrink-0 items-center gap-2"><span className="grid h-7 w-7 place-items-center rounded-full bg-slate-100 text-[10px] font-bold text-slate-600">{i + 1}</span><span className="text-xs font-semibold text-slate-600">{step}</span>{i < steps.length - 1 && <span className="mx-1 text-slate-300">→</span>}</div>)}</div></div>; }
