'use client';

import { useMemo, useState } from 'react';

type NavItem = { label: string; icon: string; badge?: string };

const nav: NavItem[] = [
  { label: 'Dashboard', icon: '⌂' },
  { label: 'Sales', icon: '↗' },
  { label: 'Purchases', icon: '↙' },
  { label: 'Expenses', icon: '₹' },
  { label: 'Customers', icon: '◎' },
  { label: 'Vendors', icon: '◇' },
  { label: 'Banking', icon: '▣' },
  { label: 'Payroll', icon: '♙' },
  { label: 'Accounting', icon: '∑' },
  { label: 'Reports', icon: '▤' },
  { label: 'Automations', icon: '⚡', badge: '3' },
];

const attention = [
  { title: '3 invoices are overdue', detail: '₹42,500 outstanding', action: 'Review' },
  { title: '2 bank transactions need review', detail: 'AI has prepared categories', action: 'Review' },
  { title: 'Payroll is due in 7 days', detail: '12 employees · August', action: 'Open' },
];

export default function MoneyMattersHome() {
  const [active, setActive] = useState('Dashboard');
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [businessReady, setBusinessReady] = useState(true);
  const [toast, setToast] = useState('');

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  }, []);

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(''), 3500);
  }

  if (!businessReady) {
    return (
      <main className="min-h-screen bg-[#f7f8fa] px-5 py-8 text-slate-900">
        <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-3xl items-center justify-center">
          <div className="w-full rounded-3xl border border-slate-200 bg-white p-8 shadow-[0_24px_80px_rgba(15,23,42,.08)] md:p-12">
            <div className="mb-8 flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-2xl bg-slate-950 text-lg font-bold text-white">M</div>
              <div><div className="font-semibold">Moneymatters</div><div className="text-xs text-slate-500">Business setup</div></div>
            </div>
            <h1 className="text-3xl font-semibold tracking-tight">Let&apos;s get your business ready.</h1>
            <p className="mt-2 max-w-xl text-slate-500">We&apos;ll configure the accounting engine automatically. You only provide the information Moneymatters actually needs.</p>
            <div className="mt-8 grid gap-3 md:grid-cols-2">
              {['Business profile', 'Financial year & currency', 'Tax preferences', 'Opening balances'].map((item, i) => (
                <div key={item} className="flex items-center gap-3 rounded-2xl border border-slate-200 p-4">
                  <span className="grid h-8 w-8 place-items-center rounded-full bg-slate-100 text-sm font-semibold">{i + 1}</span>
                  <span className="text-sm font-medium">{item}</span>
                  <span className="ml-auto text-xs text-slate-400">Automatic</span>
                </div>
              ))}
            </div>
            <button onClick={() => setBusinessReady(true)} className="mt-8 w-full rounded-2xl bg-slate-950 px-5 py-3.5 text-sm font-semibold text-white transition hover:bg-slate-800">Continue setup</button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-[#f7f8fa] text-slate-900">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-slate-200 bg-white lg:flex lg:flex-col">
        <div className="flex h-20 items-center gap-3 border-b border-slate-100 px-6">
          <div className="grid h-10 w-10 place-items-center rounded-2xl bg-slate-950 font-bold text-white">M</div>
          <div><div className="font-semibold tracking-tight">Moneymatters</div><div className="text-[11px] text-slate-400">Business finance, simplified</div></div>
        </div>
        <div className="px-4 pt-5">
          <button onClick={() => notify('Quick action menu ready')} className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800">＋ Quick action</button>
        </div>
        <nav className="mt-5 flex-1 space-y-1 px-3">
          {nav.map((item) => (
            <button key={item.label} onClick={() => setActive(item.label)} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${active === item.label ? 'bg-slate-100 font-semibold text-slate-950' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'}`}>
              <span className="grid w-5 place-items-center text-base">{item.icon}</span><span>{item.label}</span>{item.badge && <span className="ml-auto rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">{item.badge}</span>}
            </button>
          ))}
        </nav>
        <div className="border-t border-slate-100 p-4">
          <button onClick={() => setShowOnboarding(true)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-slate-50">
            <div className="grid h-9 w-9 place-items-center rounded-full bg-slate-200 text-xs font-bold">VH</div>
            <div className="min-w-0"><div className="truncate text-sm font-medium">Business Admin</div><div className="truncate text-xs text-slate-400">Settings & business</div></div>
          </button>
        </div>
      </aside>

      <main className="lg:pl-64">
        <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-[#f7f8fa]/90 px-5 py-4 backdrop-blur md:px-8">
          <div className="mx-auto flex max-w-[1500px] items-center gap-4">
            <div className="lg:hidden grid h-9 w-9 place-items-center rounded-xl bg-slate-950 font-bold text-white">M</div>
            <div className="relative flex-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">⌕</span>
              <input aria-label="Search Moneymatters" className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-20 text-sm outline-none transition focus:border-slate-400" placeholder="Search customers, invoices, transactions…" />
              <span className="absolute right-3 top-1/2 hidden -translate-y-1/2 rounded-md bg-slate-100 px-2 py-1 text-[10px] text-slate-400 md:block">Ctrl K</span>
            </div>
            <button onClick={() => notify('No new notifications')} className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 bg-white text-slate-500">♢</button>
            <button onClick={() => setShowOnboarding(true)} className="hidden rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium md:block">Business</button>
          </div>
        </header>

        <div className="mx-auto max-w-[1500px] space-y-7 px-5 py-7 md:px-8">
          <section className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
            <div><p className="text-sm font-medium text-slate-400">Tuesday, 18 August 2026</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">{greeting}, Vishnu.</h1><p className="mt-1 text-sm text-slate-500">Here&apos;s what needs your attention today.</p></div>
            <div className="flex gap-2"><button onClick={() => notify('Invoice workflow opened')} className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800">＋ Create invoice</button><button onClick={() => notify('AI assistant is ready')} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold hover:bg-slate-50">✦ Ask Moneymatters</button></div>
          </section>

          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {[['Cash & bank','₹4,82,650','+8.4% vs last month'],['Receivables','₹1,26,400','6 invoices outstanding'],['Payables','₹74,200','3 bills due soon'],['Profit this month','₹60,660','+12.1% vs last month']].map(([label,value,sub]) => (
              <div key={label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,.03)]"><p className="text-sm text-slate-500">{label}</p><p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p><p className="mt-2 text-xs font-medium text-emerald-600">{sub}</p></div>
            ))}
          </section>

          <section className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
            <div className="rounded-2xl border border-slate-200 bg-white p-6">
              <div className="flex items-start justify-between"><div><h2 className="font-semibold">Cash flow</h2><p className="mt-1 text-xs text-slate-400">Money in and out · last 6 months</p></div><button onClick={() => setActive('Reports')} className="text-xs font-semibold text-slate-500 hover:text-slate-900">View report →</button></div>
              <div className="mt-8 flex h-52 items-end gap-3 border-b border-slate-100 pb-0 sm:gap-6">
                {[58,72,48,86,66,94,78,61,89,74,96,83].map((h,i)=><div key={i} className="group flex flex-1 flex-col justify-end"><div className="mx-auto w-full max-w-8 rounded-t-lg bg-slate-900 transition group-hover:bg-slate-700" style={{height:`${h}%`}} /><span className="mt-2 text-center text-[10px] text-slate-400">{['Mar','Mar','Apr','Apr','May','May','Jun','Jun','Jul','Jul','Aug','Aug'][i]}</span></div>)}
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-6"><div className="flex items-start justify-between"><div><h2 className="font-semibold">Needs attention</h2><p className="mt-1 text-xs text-slate-400">Moneymatters found these for you</p></div><span className="rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-bold text-amber-700">3 items</span></div><div className="mt-5 space-y-3">{attention.map((item)=><div key={item.title} className="rounded-xl border border-slate-100 p-4"><div className="flex items-start gap-3"><span className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full bg-amber-400"/><div className="min-w-0 flex-1"><p className="text-sm font-medium">{item.title}</p><p className="mt-1 text-xs text-slate-400">{item.detail}</p></div><button onClick={() => notify(`${item.title}: ${item.action} workflow opened`)} className="text-xs font-semibold text-slate-600">{item.action}</button></div></div>)}</div></div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-6">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><h2 className="font-semibold">Recent activity</h2><p className="mt-1 text-xs text-slate-400">Transactions and business events</p></div><button onClick={() => setActive('Accounting')} className="text-xs font-semibold text-slate-500">View all →</button></div>
            <div className="mt-5 overflow-x-auto"><table className="w-full min-w-[680px] text-left text-sm"><thead><tr className="border-b border-slate-100 text-xs text-slate-400"><th className="pb-3 font-medium">Activity</th><th className="pb-3 font-medium">Account</th><th className="pb-3 font-medium">Date</th><th className="pb-3 text-right font-medium">Amount</th><th className="pb-3 text-right font-medium">Status</th></tr></thead><tbody>{[['Payment received · ABC Traders','Bank','18 Aug','₹25,000','Completed'],['Invoice created · INV-000124','Accounts receivable','18 Aug','₹18,700','Sent'],['Expense · Transport','Operating expenses','17 Aug','₹3,850','Posted'],['Salary processed · August','Payroll','16 Aug','₹1,42,000','Posted']].map(r=><tr key={r[0]} className="border-b border-slate-50 last:border-0"><td className="py-4 font-medium">{r[0]}</td><td className="py-4 text-slate-500">{r[1]}</td><td className="py-4 text-slate-500">{r[2]}</td><td className="py-4 text-right font-medium">{r[3]}</td><td className="py-4 text-right"><span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-semibold text-emerald-700">{r[4]}</span></td></tr>)}</tbody></table></div>
          </section>
        </div>
      </main>

      {showOnboarding && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/30 p-5 backdrop-blur-sm"><div className="w-full max-w-lg rounded-3xl bg-white p-7 shadow-2xl"><div className="flex items-center justify-between"><div><p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Business setup</p><h2 className="mt-1 text-xl font-semibold">Moneymatters is ready to configure</h2></div><button onClick={() => setShowOnboarding(false)} className="text-xl text-slate-400">×</button></div><div className="mt-6 space-y-2">{['Business profile','Currency & financial year','Tax preference (optional)','Opening balances','Default chart of accounts'].map((x,i)=><div key={x} className="flex items-center gap-3 rounded-xl bg-slate-50 px-4 py-3"><span className="grid h-7 w-7 place-items-center rounded-full bg-white text-xs font-semibold shadow-sm">{i+1}</span><span className="text-sm">{x}</span><span className="ml-auto text-xs text-emerald-600">Automatic</span></div>)}</div><button onClick={() => {setShowOnboarding(false); notify('Business setup workflow started')}} className="mt-6 w-full rounded-xl bg-slate-950 py-3 text-sm font-semibold text-white">Start setup</button></div></div>}
      {toast && <div className="fixed bottom-5 right-5 z-[60] max-w-sm rounded-xl bg-slate-950 px-4 py-3 text-sm font-medium text-white shadow-xl">{toast}</div>}
    </div>
  );
}
