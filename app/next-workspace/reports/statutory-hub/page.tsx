'use client';

import { useEffect, useState } from 'react';
import { supabase, type BusinessContext } from '@/lib/supabase';
import { PageHeader } from '@/components/ui/finops/PageHeader';
import {
  buildGstr1Export,
  buildTallyPrimeXml,
  downloadTextFile,
  type Gstr1Payload,
  type StatutoryExportWarning,
} from '@/lib/reports/statutory-exporters';

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function monthStart(period: string) {
  return period + '-01';
}

function monthEnd(period: string) {
  const [year, month] = period.split('-').map(Number);
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

function WarningList({ warnings }: { warnings: StatutoryExportWarning[] }) {
  if (!warnings.length) return <p className="mt-3 text-xs text-emerald-700">No compilation warnings.</p>;
  return (
    <div className="mt-3 space-y-2">
      {warnings.map((warning, index) => (
        <div key={warning.code + '-' + index} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
          <b>{warning.code}</b> · {warning.message}{warning.count ? ' (' + warning.count + ')' : ''}
        </div>
      ))}
    </div>
  );
}

export default function StatutoryHubPage() {
  const [ctx, setCtx] = useState<BusinessContext | null>(null);
  const [gstin, setGstin] = useState('');
  const [period, setPeriod] = useState(currentMonth());
  const [from, setFrom] = useState(currentMonth() ? monthStart(currentMonth()) : '');
  const [to, setTo] = useState(currentMonth() ? monthEnd(currentMonth()) : '');
  const [cashLedger, setCashLedger] = useState('Cash');
  const [salesLedger, setSalesLedger] = useState('Sales');
  const [cgstLedger, setCgstLedger] = useState('Output CGST');
  const [sgstLedger, setSgstLedger] = useState('Output SGST');
  const [igstLedger, setIgstLedger] = useState('Output IGST');
  const [busy, setBusy] = useState<'gstr' | 'tally' | ''>('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [gstrResult, setGstrResult] = useState<{ payload: Gstr1Payload; warnings: StatutoryExportWarning[]; invoiceCount: number } | null>(null);
  const [tallyResult, setTallyResult] = useState<{ warnings: StatutoryExportWarning[]; voucherCount: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await supabase.rpc('get_my_business_context');
      const business = (result.data || [])[0] as BusinessContext | undefined;
      if (cancelled) return;
      if (!business) {
        window.location.href = '/';
        return;
      }
      setCtx(business);
      const profile = await supabase
        .from('business_tax_profiles')
        .select('gstin')
        .eq('business_id', business.business_id)
        .maybeSingle();
      if (!cancelled) setGstin(profile.data?.gstin || '');
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    setFrom(monthStart(period));
    setTo(monthEnd(period));
    setGstrResult(null);
    setTallyResult(null);
  }, [period]);

  const generateGstr = async () => {
    if (!ctx || busy) return;
    setBusy('gstr');
    setError('');
    setNotice('');
    try {
      const result = await buildGstr1Export(ctx.business_id, period);
      setGstrResult(result);
      setGstin(result.payload.gstin);
      downloadTextFile(
        'GSTR1-' + result.payload.gstin + '-' + period.replace('-', '') + '.json',
        JSON.stringify(result.payload, null, 2),
        'application/json',
      );
      setNotice('GSTR-1 JSON generated and downloaded. Review warnings before uploading it in the GST Portal.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to generate GSTR-1 JSON.');
    } finally {
      setBusy('');
    }
  };

  const generateTally = async () => {
    if (!ctx || busy) return;
    if (!from || !to || from > to) {
      setError('Enter a valid Tally export date range.');
      return;
    }
    setBusy('tally');
    setError('');
    setNotice('');
    try {
      const result = await buildTallyPrimeXml(ctx.business_id, from, to, {
        cashLedger,
        salesLedger,
        cgstLedger,
        sgstLedger,
        igstLedger,
      });
      setTallyResult(result);
      downloadTextFile(
        'TallyPrime-Vouchers-' + from.replaceAll('-', '') + '-' + to.replaceAll('-', '') + '.xml',
        result.xml,
        'application/xml',
      );
      setNotice('TallyPrime XML generated and downloaded. Import it into the target Tally company after confirming ledger masters.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to generate TallyPrime XML.');
    } finally {
      setBusy('');
    }
  };

  if (!ctx) {
    return <div className="grid min-h-[70vh] place-items-center bg-slate-50 text-sm text-slate-500">Loading Statutory Hub…</div>;
  }

  return (
    <main className="min-h-[calc(100vh-100px)] bg-slate-50 p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl">
        <PageHeader
          breadcrumbs={[{ label: 'Workspace', href: '/next-workspace' }, { label: 'Reports & compliance' }, { label: 'Statutory Hub' }]}
          title="Statutory Hub"
          subtitle="Compile filing-ready GSTR-1 JSON for GST Portal offline upload and TallyPrime-compatible XML for your Chartered Accountant or books team."
          badge={{ label: 'Tax · Compliance · CA handoff', variant: 'statutory' }}
          actions={<div className="flex items-center gap-2">
            <a href="https://www.gst.gov.in/" target="_blank" rel="noreferrer" className="rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">Open GST Portal ↗</a>
            <button type="button" onClick={() => window.print()} className="rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-700">Print</button>
          </div>}
        />

        {error ? <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-semibold text-rose-800">{error}</div> : null}
        {notice ? <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-semibold text-emerald-800">{notice}</div> : null}

        <section className="mt-5 grid gap-5 xl:grid-cols-2">
          <article className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,.03)] sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[9px] font-bold uppercase tracking-[.15em] text-emerald-600">GSTN bridge</p>
                <h2 className="mt-1 text-xl font-semibold text-slate-950">GSTR-1 JSON</h2>
                <p className="mt-1 text-xs text-slate-500">B2B, B2CS, CDNR and HSN summary using the business GST profile and posted sales data.</p>
              </div>
              <span className={gstin ? 'rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700 ring-1 ring-emerald-200' : 'rounded-full bg-rose-50 px-2.5 py-1 text-[10px] font-bold text-rose-700 ring-1 ring-rose-200'}>
                {gstin ? 'GSTIN ' + gstin : 'GSTIN required'}
              </span>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <label className="text-[9px] font-bold uppercase tracking-wider text-slate-400">
                Return month
                <input type="month" value={period} onChange={event => setPeriod(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-xs font-semibold" />
              </label>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Filing period</p>
                <p className="mt-1 font-mono text-xs font-bold">{period.slice(5, 7) + period.slice(0, 4)}</p>
              </div>
            </div>

            <button type="button" disabled={busy === 'gstr'} onClick={() => void generateGstr()} className="mt-4 w-full rounded-xl bg-emerald-600 px-4 py-3 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
              {busy === 'gstr' ? 'Compiling GSTR-1…' : 'Generate & Download GSTR-1 JSON'}
            </button>

            {gstrResult ? (
              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs">
                <div className="flex justify-between"><span className="text-slate-500">Posted invoice records</span><b>{gstrResult.invoiceCount}</b></div>
                <div className="mt-1 flex justify-between"><span className="text-slate-500">B2B counterparties</span><b>{gstrResult.payload.b2b.length}</b></div>
                <div className="mt-1 flex justify-between"><span className="text-slate-500">B2CS buckets</span><b>{gstrResult.payload.b2cs.length}</b></div>
                <div className="mt-1 flex justify-between"><span className="text-slate-500">CDNR counterparties</span><b>{gstrResult.payload.cdnr.length}</b></div>
                <WarningList warnings={gstrResult.warnings} />
              </div>
            ) : null}
          </article>

          <article className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,.03)] sm:p-6">
            <div>
              <p className="text-[9px] font-bold uppercase tracking-[.15em] text-indigo-600">CA / Tally bridge</p>
              <h2 className="mt-1 text-xl font-semibold text-slate-950">TallyPrime XML</h2>
              <p className="mt-1 text-xs text-slate-500">Accounting voucher import bridge using your existing invoice and GST component ledger data.</p>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <label className="text-[9px] font-bold uppercase tracking-wider text-slate-400">From<input type="date" value={from} onChange={event => setFrom(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-xs font-semibold" /></label>
              <label className="text-[9px] font-bold uppercase tracking-wider text-slate-400">To<input type="date" value={to} onChange={event => setTo(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-xs font-semibold" /></label>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {[
                ['Cash ledger', cashLedger, setCashLedger],
                ['Sales ledger', salesLedger, setSalesLedger],
                ['Output CGST ledger', cgstLedger, setCgstLedger],
                ['Output SGST ledger', sgstLedger, setSgstLedger],
                ['Output IGST ledger', igstLedger, setIgstLedger],
              ].map(([label, value, setter]) => (
                <label key={label as string} className="text-[9px] font-bold uppercase tracking-wider text-slate-400">
                  {label as string}
                  <input value={value as string} onChange={event => (setter as (value: string) => void)(event.target.value)} className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-3 text-xs" />
                </label>
              ))}
            </div>

            <button type="button" disabled={busy === 'tally'} onClick={() => void generateTally()} className="mt-4 w-full rounded-xl bg-indigo-600 px-4 py-3 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-50">
              {busy === 'tally' ? 'Compiling Tally XML…' : 'Generate & Download TallyPrime XML'}
            </button>

            {tallyResult ? (
              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs">
                <div className="flex justify-between"><span className="text-slate-500">Sales vouchers</span><b>{tallyResult.voucherCount}</b></div>
                <WarningList warnings={tallyResult.warnings} />
              </div>
            ) : null}
          </article>
        </section>

        <section className="mt-5 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,.03)]">
          <p className="text-[9px] font-bold uppercase tracking-[.15em] text-slate-400">Control note</p>
          <p className="mt-2 max-w-4xl text-xs leading-5 text-slate-600">These are export bridges, not direct tax filing credentials. Validate the generated file and the business masters before upload/import. The GST Portal filing action and Tally company import remain controlled by the taxpayer or accounting team.</p>
        </section>
      </div>
    </main>
  );
}
