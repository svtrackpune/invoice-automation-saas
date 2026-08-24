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

function accountLabel(bank: Bank) { return `${bank.name}${bank.institution_name ? ` · ${bank.institution_name}` : ''}${bank.account_last4 ? ` · ••••${bank.account_last4}` : ''}`; }

export default function DocumentBankAccountsPanel() {
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [selected, setSelected] = useState<Record<DocType, string>>({ invoice: '', quotation: '', receipt: '' });
  const [busy, setBusy] = useState(true), [saving, setSaving] = useState<DocType | null>(null);
  const [message, setMessage] = useState(''), [error, setError] = useState('');
  const [addOpen, setAddOpen] = useState(false), [addBusy, setAddBusy] = useState(false);
  const [newBank, setNewBank] = useState({ name: '', institution_name: '', account_last4: '', currency_code: 'INR' });

  const load = async () => {
    setBusy(true); setError('');
    const active = typeof window !== 'undefined' ? window.localStorage.getItem('moneymatters.activeBusinessId') : null;
    if (!active) { setBusinessId(null); setBusy(false); return; }
    setBusinessId(active);
    const [{ data: bankRows, error: bankError }, { data: selections, error: selectionError }] = await Promise.all([
      supabase.from('bank_accounts').select('id,name,institution_name,account_last4,currency_code,is_active').eq('business_id', active).eq('is_active', true).order('name'),
      supabase.from('business_document_bank_accounts').select('document_type,bank_account_id,display_order').eq('business_id', active).order('display_order'),
    ]);
    if (bankError) setError(bankError.message); else setBanks((bankRows || []) as Bank[]);
    if (selectionError) setError(selectionError.message); else {
      const next: Record<DocType, string> = { invoice: '', quotation: '', receipt: '' };
      ((selections || []) as Selection[]).forEach(row => { if (row.document_type in next && !next[row.document_type as DocType]) next[row.document_type as DocType] = row.bank_account_id; });
      setSelected(next);
    }
    setBusy(false);
  };

  useEffect(() => { load(); const handler = () => load(); window.addEventListener('moneymatters:business-changed', handler); return () => window.removeEventListener('moneymatters:business-changed', handler); }, []);

  const save = async (documentType: DocType, accountId: string) => {
    if (!businessId) return;
    setSaving(documentType); setMessage(''); setError('');
    const { error: deleteError } = await supabase.from('business_document_bank_accounts').delete().eq('business_id', businessId).eq('document_type', documentType);
    if (deleteError) { setError(deleteError.message); setSaving(null); return; }
    if (accountId) {
      const { error: insertError } = await supabase.from('business_document_bank_accounts').insert({ business_id: businessId, document_type: documentType, bank_account_id: accountId, display_order: 0 });
      if (insertError) { setError(insertError.message); setSaving(null); return; }
      setMessage(`${docs.find(d => d.key === documentType)?.label} bank account saved.`);
    } else setMessage(`${docs.find(d => d.key === documentType)?.label} bank details cleared.`);
    setSaving(null); await load();
  };

  const addBank = async () => {
    if (!businessId || !newBank.name.trim()) { setError('Bank account name is required.'); return; }
    setAddBusy(true); setMessage(''); setError('');
    const { error: insertError } = await supabase.from('bank_accounts').insert({ business_id: businessId, name: newBank.name.trim(), institution_name: newBank.institution_name.trim() || null, account_last4: newBank.account_last4.trim() || null, currency_code: newBank.currency_code.trim() || 'INR', is_active: true, is_connected: false });
    if (insertError) setError(insertError.message); else { setMessage('Bank account added. You can now select it for documents.'); setNewBank({ name: '', institution_name: '', account_last4: '', currency_code: 'INR' }); setAddOpen(false); await load(); }
    setAddBusy(false);
  };

  const bankCountText = useMemo(() => `${banks.length} active account${banks.length === 1 ? '' : 's'}`, [banks.length]);

  return <section className="mt-6 rounded-3xl border border-slate-200 bg-white shadow-[0_10px_35px_rgba(15,23,42,.05)]">
    <div className="border-b border-slate-100 p-5 sm:p-6"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-[11px] font-bold uppercase tracking-[.18em] text-violet-600">Banking on documents</p><h2 className="mt-1 text-xl font-semibold text-slate-900">Choose which bank account appears</h2><p className="mt-1 max-w-2xl text-sm text-slate-500">A business can have multiple bank accounts. Choose an account independently for each document type; account details are business-scoped.</p></div><div className="flex gap-2"><button type="button" onClick={() => setAddOpen(true)} className="inline-flex h-10 items-center justify-center rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white">＋ Add bank account</button><a href="/next-workspace/banking" className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">Banking</a></div></div></div>
    <div className="p-5 sm:p-6">
      {!businessId ? <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Select a business first to configure document bank accounts.</div> : busy ? <div className="rounded-2xl bg-slate-50 p-5 text-sm text-slate-500">Loading active bank accounts…</div> : banks.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5"><p className="font-semibold text-slate-800">No active bank accounts yet</p><p className="mt-1 text-sm text-slate-500">Add the first account here. You can have multiple accounts for the same business.</p></div> : <div className="grid gap-4 lg:grid-cols-3">{docs.map(doc => <div key={doc.key} className="rounded-2xl border border-slate-200 p-4"><p className="font-semibold text-slate-900">{doc.label}</p><p className="mt-1 min-h-10 text-xs leading-5 text-slate-500">{doc.description}</p><label className="mt-4 block text-xs font-semibold text-slate-700">Bank account<select value={selected[doc.key]} onChange={e => setSelected(v => ({ ...v, [doc.key]: e.target.value }))} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-violet-400"><option value="">No bank account</option>{banks.map(bank => <option key={bank.id} value={bank.id}>{accountLabel(bank)}</option>)}</select></label><button type="button" disabled={saving === doc.key} onClick={() => save(doc.key, selected[doc.key])} className="mt-4 w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving === doc.key ? 'Saving…' : 'Save account'}</button></div>)}</div>}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400"><span>{bankCountText}</span>{message && <span className="font-semibold text-emerald-600">{message}</span>}{error && <span className="font-semibold text-rose-600">{error}</span>}</div>
    </div>
    {addOpen && <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/40 p-4" role="dialog" aria-modal="true" aria-labelledby="add-bank-title"><div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl"><div className="flex items-start justify-between"><div><p className="text-[11px] font-bold uppercase tracking-[.18em] text-violet-600">Business banking</p><h3 id="add-bank-title" className="mt-1 text-xl font-semibold">Add bank account</h3><p className="mt-1 text-xs text-slate-500">Only the display details needed on documents are stored here. Sensitive credentials are not requested.</p></div><button type="button" onClick={() => setAddOpen(false)} className="grid h-9 w-9 place-items-center rounded-xl bg-slate-100 text-lg" aria-label="Close">×</button></div><div className="mt-5 grid gap-4 sm:grid-cols-2"><label className="text-xs font-semibold text-slate-700">Account name<input value={newBank.name} onChange={e => setNewBank(v => ({ ...v, name: e.target.value }))} placeholder="HDFC Current Account" className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm" /></label><label className="text-xs font-semibold text-slate-700">Bank / institution<input value={newBank.institution_name} onChange={e => setNewBank(v => ({ ...v, institution_name: e.target.value }))} placeholder="HDFC Bank" className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm" /></label><label className="text-xs font-semibold text-slate-700">Last 4 digits<input inputMode="numeric" maxLength={4} value={newBank.account_last4} onChange={e => setNewBank(v => ({ ...v, account_last4: e.target.value.replace(/\D/g, '').slice(0,4) }))} placeholder="4521" className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm" /></label><label className="text-xs font-semibold text-slate-700">Currency<input value={newBank.currency_code} onChange={e => setNewBank(v => ({ ...v, currency_code: e.target.value.toUpperCase().slice(0,3) }))} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm" /></label></div><div className="mt-6 flex justify-end gap-2"><button type="button" onClick={() => setAddOpen(false)} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold">Cancel</button><button type="button" disabled={addBusy} onClick={addBank} className="rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{addBusy ? 'Adding…' : 'Add account'}</button></div></div></div>}
  </section>;
}
