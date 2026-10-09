'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase, type BusinessContext } from '@/lib/supabase';
import { PageHeader } from '@/components/ui/finops/PageHeader';
import { StatCard } from '@/components/ui/finops/StatCard';

type Summary = {
  shift_date: string;
  status: string;
  opening_float: number;
  cash_sales: number;
  cash_inflow: number;
  cash_expenses: number;
  bank_deposits: number;
  expected_closing: number;
  actual_closing: number;
  variance: number;
  notes: string;
};

function todayInTimezone(timeZone?: string) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function num(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function money(value: number, currency: string) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: currency || 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num(value));
}

export default function DailyCashBookPage() {
  const [ctx, setCtx] = useState<BusinessContext | null>(null);
  const [date, setDate] = useState('');
  const [openingFloat, setOpeningFloat] = useState('0.00');
  const [actualClosing, setActualClosing] = useState('');
  const [notes, setNotes] = useState('');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const response = await supabase.rpc('get_my_business_context');
      const business = (response.data || [])[0] as BusinessContext | undefined;
      if (cancelled) return;
      if (!business) {
        window.location.href = '/';
        return;
      }
      setCtx(business);
      setDate(todayInTimezone(business.timezone));
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!ctx || !date) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError('');
      const response = await supabase.rpc('get_daily_cash_summary', {
        p_business_id: ctx.business_id,
        p_date: date,
        p_opening_float: num(openingFloat),
      });
      if (cancelled) return;
      if (response.error) {
        setSummary(null);
        setError(response.error.message);
        setLoading(false);
        return;
      }
      const next = response.data as Summary;
      setSummary(next);
      if (next.status === 'closed' || next.status === 'audited') {
        setOpeningFloat(num(next.opening_float).toFixed(2));
        setActualClosing(num(next.actual_closing).toFixed(2));
        setNotes(next.notes || '');
      } else {
        setOpeningFloat(num(next.opening_float).toFixed(2));
        setNotes(next.notes || '');
        setActualClosing('');
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [ctx?.business_id, ctx?.timezone, date]);

  const currency = ctx?.currency_code || 'INR';
  const expected = num(summary?.expected_closing);
  const actual = actualClosing.trim() === '' ? 0 : num(actualClosing);
  const variance = useMemo(
    () => Math.round((actual - expected + Number.EPSILON) * 100) / 100,
    [actual, expected],
  );
  const closed = summary?.status === 'closed' || summary?.status === 'audited';

  const refresh = async () => {
    if (!ctx || !date) return;
    const response = await supabase.rpc('get_daily_cash_summary', {
      p_business_id: ctx.business_id,
      p_date: date,
      p_opening_float: num(openingFloat),
    });
    if (response.error) {
      setError(response.error.message);
      return;
    }
    const next = response.data as Summary;
    setSummary(next);
    setOpeningFloat(num(next.opening_float).toFixed(2));
    if (next.status === 'closed' || next.status === 'audited') {
      setActualClosing(num(next.actual_closing).toFixed(2));
      setNotes(next.notes || '');
    }
  };

  const closeShift = async () => {
    if (!ctx || !summary || closed || submitting) return;
    if (actualClosing.trim() === '' || actual < 0) {
      setError('Enter the physical cash counted in the drawer before closing the shift.');
      return;
    }

    if (variance !== 0) {
      const signed = variance > 0 ? '+' + money(variance, currency) : money(variance, currency);
      const confirmed = window.confirm(
        'A variance of ' + signed + ' will be automatically posted to Account 6250 (Cash Short/Over). Proceed?',
      );
      if (!confirmed) return;
    }

    setSubmitting(true);
    setError('');
    setNotice('');
    const response = await supabase.rpc('close_daily_cash_shift', {
      p_business_id: ctx.business_id,
      p_date: date,
      p_opening_float: num(openingFloat),
      p_actual_closing: actual,
      p_notes: notes.trim() || null,
    });

    if (response.error) {
      setError(response.error.message);
      setSubmitting(false);
      return;
    }

    const result = response.data as { expected: number; actual: number; variance: number };
    setNotice(
      num(result.variance) === 0
        ? 'Drawer balanced. Shift is now closed and locked.'
        : 'Shift closed and variance of ' + money(num(result.variance), currency) + ' posted to Account 6250.',
    );
    await refresh();
    setSubmitting(false);
  };

  if (!ctx || (loading && !summary)) {
    return <div className="grid min-h-[70vh] place-items-center bg-slate-50 text-sm text-slate-500">Loading Daily Cash Book…</div>;
  }

  return (
    <main className="min-h-[calc(100vh-100px)] bg-slate-50 p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl">
        <PageHeader
          breadcrumbs={[{ label: 'Workspace', href: '/next-workspace' }, { label: 'Reports & compliance' }, { label: 'Daily Cash Book' }]}
          title="Daily Cash Book"
          subtitle="Reconcile the physical cash drawer against posted Cash Bills, cash collections, cash expenses and bank deposits."
          badge={{ label: closed ? 'Shift Closed & Locked' : 'Open', variant: closed ? 'statutory' : 'treasury' }}
          actions={<label className="text-[9px] font-bold uppercase tracking-wider text-finops-neutral-muted">Date<input type="date" value={date} onChange={event => setDate(event.target.value)} className="mt-1 block h-10 rounded-lg border border-finops-neutral-border bg-white px-3 text-xs font-semibold text-finops-neutral-text" /></label>}
        />

        {error ? <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-semibold text-rose-800">{error}</div> : null}
        {notice ? <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-semibold text-emerald-800">{notice}</div> : null}

        <section className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <article className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,.03)]">
            <p className="text-[9px] font-bold uppercase tracking-[.14em] text-slate-400">Opening Float</p>
            <input type="number" min="0" step="0.01" value={openingFloat} readOnly={closed} onChange={event => setOpeningFloat(event.target.value)} onBlur={() => void refresh()} className="mt-3 h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-right font-mono text-lg font-bold tabular-nums outline-none focus:border-indigo-400 read-only:bg-slate-50" />
          </article>
          <StatCard title="Total Inflow" value={money(num(summary?.cash_sales) + num(summary?.cash_inflow), currency)} tone="inflow" className="min-h-[124px] p-4"><div className="mt-2 space-y-1 text-[10px] text-finops-neutral-muted"><div className="flex justify-between"><span>Cash Bills</span><b>{money(num(summary?.cash_sales), currency)}</b></div><div className="flex justify-between"><span>Invoice collections</span><b>{money(num(summary?.cash_inflow), currency)}</b></div></div></StatCard>
          <StatCard title="Total Outflow" value={money(num(summary?.cash_expenses) + num(summary?.bank_deposits), currency)} tone="outflow" className="min-h-[124px] p-4"><div className="mt-2 space-y-1 text-[10px] text-finops-neutral-muted"><div className="flex justify-between"><span>Cash expenses</span><b>{money(num(summary?.cash_expenses), currency)}</b></div><div className="flex justify-between"><span>Bank deposits</span><b>{money(num(summary?.bank_deposits), currency)}</b></div></div></StatCard>
          <StatCard title="Expected Closing Drawer" value={money(expected, currency)} tone="treasury" className="min-h-[124px] p-4"><span className="text-[10px] text-finops-neutral-muted">Opening + inflow − outflow</span></StatCard>
        </section>

        <section className="mt-5 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,.03)] sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-[9px] font-bold uppercase tracking-[.15em] text-indigo-600">Physical reconciliation</p>
              <h2 className="mt-1 text-xl font-semibold text-slate-950">Count the drawer before handover</h2>
              <p className="mt-1 text-xs text-slate-500">Record the actual cash physically present. The variance is posted automatically when the shift is locked.</p>
            </div>
            <div className={variance === 0
              ? 'rounded-xl bg-emerald-50 px-4 py-3 text-right ring-1 ring-emerald-200'
              : variance < 0
                ? 'rounded-xl bg-rose-50 px-4 py-3 text-right ring-1 ring-rose-200'
                : 'rounded-xl bg-sky-50 px-4 py-3 text-right ring-1 ring-sky-200'}>
              <p className="text-[9px] font-bold uppercase tracking-[.14em] text-slate-500">Variance</p>
              <p className={variance === 0 ? 'mt-1 font-mono text-lg font-bold text-emerald-700' : variance < 0 ? 'mt-1 font-mono text-lg font-bold text-rose-700' : 'mt-1 font-mono text-lg font-bold text-sky-700'}>
                {variance === 0 ? 'Balanced: ' + money(0, currency) : variance < 0 ? 'Shortage: ' + money(variance, currency) : 'Surplus: +' + money(variance, currency)}
              </p>
              <p className="text-[9px] text-slate-500">{variance < 0 ? 'Debits Account 6250' : variance > 0 ? 'Credits Account 6250' : 'No journal variance'}</p>
            </div>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,340px)_1fr]">
            <label className="text-[9px] font-bold uppercase tracking-[.14em] text-slate-400">
              Actual Drawer Cash (Physical Count)
              <input type="number" min="0" step="0.01" value={actualClosing} readOnly={closed} onChange={event => setActualClosing(event.target.value)} placeholder="0.00" className="mt-2 h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-right font-mono text-xl font-bold tabular-nums outline-none focus:border-indigo-500 read-only:bg-slate-50" />
            </label>
            <label className="text-[9px] font-bold uppercase tracking-[.14em] text-slate-400">
              Notes
              <textarea rows={4} value={notes} readOnly={closed} onChange={event => setNotes(event.target.value)} placeholder="Optional shift handover notes..." className="mt-2 w-full rounded-xl border border-slate-200 bg-white p-3 text-sm outline-none focus:border-indigo-400 read-only:bg-slate-50" />
            </label>
          </div>

          <div className="mt-5 flex flex-col gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-[10px] text-slate-400">{closed ? 'This shift is locked. Create a controlled accounting adjustment for any later correction.' : 'Closing posts the over/short variance once and locks the shift.'}</div>
            <button type="button" disabled={closed || submitting || !summary} onClick={() => void closeShift()} className="rounded-xl bg-slate-900 px-5 py-3 text-xs font-bold text-white shadow-sm hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40">
              {submitting ? 'Reconciling…' : 'Lock Shift & Reconcile Drawer'}
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
