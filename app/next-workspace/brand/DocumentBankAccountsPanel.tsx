'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';

type DocType = 'invoice' | 'quotation' | 'receipt';
type Bank = { id: string; name: string; institution_name: string | null; account_last4: string | null; currency_code: string; is_active: boolean };
type Selection = { document_type: DocType; bank_account_id: string; display_order: number };

const docs: Array<{ key: DocType; label: string; description: string }> = [
  { key: 'invoice', label: 'Invoices', description: 'Show the selected business account on customer invoices.' },
  { key: 'quotation', label: 'Estimates / Quotations', description: 'Show payment instructions when an estimate includes bank details.' },
  { key: 'receipt', label: 'Receipts', description: 'Identify the account that received the payment.' },
];

function accountLabel(bank: Bank) {
  return `${bank.name}${bank.institution_name ? ` · ${bank.institution_name}` : ''}${bank.account_last4 ? ` · ••••${bank.account_last4}` : ''}`;
}

export default function DocumentBankAccountsPanel() {
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [selected, setSelected] = useState<Record<DocType, string>>({ invoice: '', quotation: '', receipt: '' });
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState<DocType | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    setBusy(true);
    setError('');
    const active = typeof window !== 'undefined' ? window.localStorage.getItem('moneymatters.activeBusinessId') : null;
    if (!active) { setBusinessId(null); setBusy(false); return; }
    setBusinessId(active);

    const [{ data: bankRows, error: bankError }, { data: selections, error: selectionError }] = await Promise.all([
      supabase.from('bank_accounts').select('id,name,institution_name,account_last4,currency_code,is_active').eq('business_id', active).eq('is_active', true).order('name'),
      supabase.from('business_document_bank_accounts').select('document_type,bank_account_id,display_order').eq('business_id', active).order('display_order'),
    ]);
    if (bankError) setError(bankError.message);
    else setBanks((bankRows || []) as Bank[]);
    if (selectionError) setError(selectionError.message);
    else {
      const next: Record<DocType, string> = { invoice: '', quotation: '', receipt: '' };
      ((selections || []) as Selection[]).forEach(row => { if (row.document_type in next && !next[row.document_type as DocType]) next[row.document_type as DocType] = row.bank_account_id; });
      setSelected(next);
    }
    setBusy(false);
  };

  useEffect(() => {
    load();
    const handler = () => load();
    window.addEventListener('moneymatters:business-changed', handler);
    return () => window.removeEventListener('moneymatters:business-changed', handler);
  }, []);

  const save = async (documentType: DocType, accountId: string) => {
    if (!businessId) return;
    setSaving(documentType); setMessage(''); setError('');
    const { error: deleteError } = await supabase.from('business_document_bank_accounts').delete().eq('business_id', businessId).eq('document_type', documentType);
    if (!deleteError && accountId) {
      const { error: insertError } = await supabase.from('business_document_bank_accounts').insert({ business_id: businessId, document_type: documentType, bank_account_id: accountId, display_order: 0 });
      if (insertError) setError(insertError.message); else setMessage(`${docs.find(d => d.key === documentType)?.label} bank account saved.`);
    } else if (deleteError) setError(deleteError.message);
    setSaving(null);
    if (!error) await load();
  };

  const bankCountText = useMemo(() => `${banks.length} active account${banks.length === 1 ? '' : 's'}`, [banks.length]);

  return <section className="mt-6 rounded-3xl border border-slate-200 bg-white shadow-[0_10px_35px_rgba(15,23,42,.05)]">
    <div className="border-b border-slate-100 p-5 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div><p className="text-[11px] font-bold uppercase tracking-[.18em] text-violet-600">Banking on documents</p><h2 className="mt-1 text-xl font-semibold text-slate-900">Choose which bank account appears</h2><p className="mt-1 max-w-2xl text-sm text-slate-500">A business can have multiple bank accounts. Choose one account independently for each document type; no account number is hard-coded into the document.</p></div>
        <a href="/next-workspace/banking" className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">Manage bank accounts</a>
      </div>
    </div>
    <div className="p-5 sm:p-6">
      {!businessId ? <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Select a business first to configure document bank accounts.</div> : busy ? <div className="rounded-2xl bg-slate-50 p-5 text-sm text-slate-500">Loading active bank accounts…</div> : banks.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5"><p className="font-semibold text-slate-800">No active bank accounts yet</p><p className="mt-1 text-sm text-slate-500">Add a bank account from Banking, then return here to select it for invoices, estimates or receipts.</p></div> : <div className="grid gap-4 lg:grid-cols-3">
        {docs.map(doc => <div key={doc.key} className="rounded-2xl border border-slate-200 p-4">
          <p className="font-semibold text-slate-900">{doc.label}</p><p className="mt-1 min-h-10 text-xs leading-5 text-slate-500">{doc.description}</p>
          <label className="mt-4 block text-xs font-semibold text-slate-700">Bank account<select value={selected[doc.key]} onChange={e => setSelected(v => ({ ...v, [doc.key]: e.target.value }))} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-violet-400">
            <option value="">No bank account</option>{banks.map(bank => <option key={bank.id} value={bank.id}>{accountLabel(bank)}</option>)}
          </select></label>
          <button type="button" disabled={saving === doc.key} onClick={() => save(doc.key, selected[doc.key])} className="mt-4 w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving === doc.key ? 'Saving…' : 'Save account'}</button>
        </div>)}
      </div>}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400"><span>{bankCountText}</span>{message && <span className="font-semibold text-emerald-600">{message}</span>}{error && <span className="font-semibold text-rose-600">{error}</span>}</div>
    </div>
  </section>;
}
