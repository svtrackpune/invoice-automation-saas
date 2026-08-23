'use client';

import { useEffect } from 'react';

export default function Page() {
  useEffect(() => {
    localStorage.setItem('moneymatters.testMode', 'true');
    window.location.replace('/next-workspace');
  }, []);

  return (
    <main className="grid min-h-screen place-items-center bg-[#f7f6fb] p-6 text-slate-900">
      <div className="w-full max-w-md rounded-3xl border border-violet-100 bg-white p-8 text-center shadow-xl">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-violet-600 text-xl font-black text-white">M</div>
        <p className="mt-5 text-[11px] font-bold uppercase tracking-[.2em] text-violet-600">Testing workspace</p>
        <h1 className="mt-2 text-2xl font-semibold">Opening Moneymatters…</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">Login verification, account creation and outbound messaging integrations are intentionally bypassed in this testing build.</p>
      </div>
    </main>
  );
}
