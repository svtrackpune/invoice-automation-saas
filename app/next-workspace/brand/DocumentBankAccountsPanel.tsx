'use client';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';

type DocType = 'invoice' | 'quotation' | 'receipt';
type Bank = { id:string; name:string; institution_name:string|null; account_holder_name:string|null; account_last4:string|null; account_number:string|null; ifsc_code:string|null; branch_name:string|null; account_type:string|null; currency_code:string; is_active:boolean; is_primary:boolean; metadata?:Record<string,any>|null };
type Form = { name:string; institution_name:string; account_holder_name:string; account_number:string; account_type:string; ifsc_code:string; branch_name:string; currency_code:string; is_primary:boolean };

const docs:Array<{key:DocType;label:string;description:string}> = [
  { key:'invoice', label:'Invoices', description:'Show the selected business bank details on customer invoices.' },
  { key:'quotation', label:'Estimates / Quotations', description:'Show payment instructions when an estimate includes bank details.' },
  { key:'receipt', label:'Receipts', description:'Identify the account that received the payment.' },
];
const docLabels:Record<DocType,string> = { invoice:'Invoices', quotation:'Estimates / Quotations', receipt:'Receipts' };
const blank:Form = { name:'', institution_name:'', account_holder_name:'', account_number:'', account_type:'Current', ifsc_code:'', branch_name:'', currency_code:'INR', is_primary:false };
const label = (b:Bank) => `${b.name}${b.institution_name ? ` · ${b.institution_name}` : ''}${b.account_last4 ? ` · ••••${b.account_last4}` : ''}${b.is_primary ? ' · Primary' : ''}`;

export default function DocumentBankAccountsPanel(){
  const [businessId,setBusinessId] = useState<string|null>(null);
  const [banks,setBanks] = useState<Bank[]>([]);
  const [selected,setSelected] = useState<Record<DocType,string>>({ invoice:'', quotation:'', receipt:'' });
  const [busy,setBusy] = useState(true);
  const [saving,setSaving] = useState<DocType|null>(null);
  const [message,setMessage] = useState('');
  const [error,setError] = useState('');
  const [open,setOpen] = useState(false);
  const [editing,setEditing] = useState<string|null>(null);
  const [addBusy,setAddBusy] = useState(false);
  const [form,setForm] = useState<Form>(blank);

  const load = async () => {
    setBusy(true); setError('');
    const id = typeof window !== 'undefined' ? localStorage.getItem('moneymatters.activeBusinessId') : null;
    if(!id){ setBusinessId(null); setBusy(false); return; }
    setBusinessId(id);
    const [br,sr] = await Promise.all([
      supabase.from('bank_accounts').select('id,name,institution_name,account_holder_name,account_last4,account_number,ifsc_code,branch_name,account_type,currency_code,is_active,is_primary,metadata').eq('business_id',id).eq('is_active',true).order('is_primary',{ascending:false}).order('name'),
      supabase.from('business_document_bank_accounts').select('document_type,bank_account_id,display_order').eq('business_id',id).order('display_order'),
    ]);
    if(br.error) setError(br.error.message); else setBanks((br.data || []) as Bank[]);
    if(sr.error) setError(sr.error.message); else {
      const next:Record<DocType,string> = { invoice:'', quotation:'', receipt:'' };
      (sr.data || []).forEach((r:any) => { if(r.document_type in next && !next[r.document_type as DocType]) next[r.document_type as DocType] = r.bank_account_id; });
      setSelected(next);
    }
    setBusy(false);
  };

  useEffect(() => { void load(); const h = () => void load(); window.addEventListener('moneymatters:business-changed',h); return () => window.removeEventListener('moneymatters:business-changed',h); },[]);

  const openAdd = () => { setEditing(null); setForm({...blank}); setError(''); setOpen(true); };
  const openEdit = (b:Bank) => {
    const m = b.metadata || {};
    setEditing(b.id);
    setForm({
      name:b.name,
      institution_name:b.institution_name || '',
      account_holder_name:b.account_holder_name || '',
      account_number:b.account_number || m.account_number || '',
      account_type:b.account_type || m.account_type || 'Current',
      ifsc_code:b.ifsc_code || m.ifsc_code || '',
      branch_name:b.branch_name || m.branch_name || '',
      currency_code:b.currency_code || 'INR',
      is_primary:b.is_primary,
    });
    setError(''); setOpen(true);
  };

  const saveBank = async () => {
    if(!businessId || !form.name.trim()){ setError('Account name is required.'); return; }
    const number = form.account_number.replace(/\D/g,'');
    if(number.length < 4){ setError('Enter the complete bank account number.'); return; }
    setAddBusy(true); setError('');
    if(form.is_primary){
      const r = await supabase.from('bank_accounts').update({is_primary:false}).eq('business_id',businessId).eq('is_active',true);
      if(r.error){ setError(r.error.message); setAddBusy(false); return; }
    }
    const ifsc = form.ifsc_code.trim().toUpperCase() || null;
    const branch = form.branch_name.trim() || null;
    const type = form.account_type || 'Current';
    const metadata = { ...(editing ? banks.find(b=>b.id===editing)?.metadata || {} : {}), account_number:number, account_holder_name:form.account_holder_name.trim() || null, account_type:type, ifsc_code:ifsc, branch_name:branch };
    const payload = { business_id:businessId, name:form.name.trim(), institution_name:form.institution_name.trim() || null, account_holder_name:form.account_holder_name.trim() || null, account_number:number, account_last4:number.slice(-4), ifsc_code:ifsc, branch_name:branch, account_type:type, currency_code:form.currency_code.toUpperCase().slice(0,3) || 'INR', metadata, is_active:true, is_connected:false, is_primary:form.is_primary };
    const r = editing ? await supabase.from('bank_accounts').update(payload).eq('id',editing).eq('business_id',businessId) : await supabase.from('bank_accounts').insert(payload);
    if(r.error) setError(r.error.message); else { setMessage(editing ? 'Bank account updated.' : 'Bank account added.'); setOpen(false); await load(); }
    setAddBusy(false);
  };

  const makePrimary = async (id:string) => {
    if(!businessId) return;
    let r = await supabase.from('bank_accounts').update({is_primary:false}).eq('business_id',businessId).eq('is_active',true);
    if(r.error){ setError(r.error.message); return; }
    r = await supabase.from('bank_accounts').update({is_primary:true}).eq('id',id).eq('business_id',businessId);
    if(r.error) setError(r.error.message); else { setMessage('Primary bank account updated.'); await load(); }
  };

  const saveDoc = async (type:DocType,id:string) => {
    if(!businessId) return;
    setSaving(type); setError('');
    let r = await supabase.from('business_document_bank_accounts').delete().eq('business_id',businessId).eq('document_type',type);
    if(r.error){ setError(r.error.message); setSaving(null); return; }
    if(id){
      r = await supabase.from('business_document_bank_accounts').insert({business_id:businessId,document_type:type,bank_account_id:id,display_order:0});
      if(r.error){ setError(r.error.message); setSaving(null); return; }
    }
    setMessage(`${docLabels[type]} bank account saved.`); setSaving(null); await load();
  };

  const count = useMemo(() => `${banks.length} active account${banks.length===1?'':'s'}`,[banks.length]);

  return <section className="mt-6 rounded-3xl border border-slate-200 bg-white shadow-[0_10px_35px_rgba(15,23,42,.05)]">
    <div className="border-b border-slate-100 p-5 sm:p-6"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-[11px] font-bold uppercase tracking-[.18em] text-violet-600">Banking on documents</p><h2 className="mt-1 text-xl font-semibold">Bank account details</h2><p className="mt-1 max-w-2xl text-sm text-slate-500">Maintain multiple business bank accounts and choose which account appears on each document type.</p></div><div className="flex gap-2"><button type="button" onClick={openAdd} className="inline-flex h-10 items-center rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white">＋ Add bank account</button><a href="/next-workspace/banking" className="inline-flex h-10 items-center rounded-xl border border-slate-200 px-4 text-sm font-semibold">Banking</a></div></div></div>
    <div className="p-5 sm:p-6">{!businessId ? <div className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-800">Select a business first.</div> : busy ? <div className="rounded-2xl bg-slate-50 p-5 text-sm text-slate-500">Loading active bank accounts…</div> : <>
      <div className="mb-5 grid gap-3">{banks.map(b => <div key={b.id} className="flex flex-col gap-3 rounded-2xl border border-slate-200 p-4 sm:flex-row sm:items-center"><div className="min-w-0 flex-1"><p className="font-semibold">{label(b)}</p><p className="mt-1 text-xs text-slate-500">{b.account_holder_name || 'Account holder not specified'} · {b.account_type || 'Account'} · {b.branch_name || 'Branch not specified'}</p><p className="mt-1 text-xs text-slate-500">IFSC: {b.ifsc_code || 'Not specified'}{b.institution_name ? ` · ${b.institution_name}` : ''}</p></div><div className="flex gap-2"><button type="button" onClick={()=>openEdit(b)} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold">Edit</button>{!b.is_primary && <button type="button" onClick={()=>void makePrimary(b.id)} className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white">Make primary</button>}</div></div>)}{!banks.length && <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-500">No active bank accounts yet. Add the first account here.</div>}</div>
      <div className="grid gap-4 lg:grid-cols-3">{docs.map(d => <div key={d.key} className="rounded-2xl border border-slate-200 p-4"><p className="font-semibold">{d.label}</p><p className="mt-1 min-h-10 text-xs leading-5 text-slate-500">{d.description}</p><label className="mt-4 block text-xs font-semibold">Bank account<select value={selected[d.key]} onChange={e=>setSelected(v=>({...v,[d.key]:e.target.value}))} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm"><option value="">No bank account</option>{banks.map(b=><option key={b.id} value={b.id}>{label(b)}</option>)}</select></label><button type="button" disabled={saving===d.key} onClick={()=>void saveDoc(d.key,selected[d.key])} className="mt-4 w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white">{saving===d.key?'Saving…':'Save account'}</button></div>)}</div>
    </>}</div>
    <div className="px-5 pb-5 sm:px-6"><div className="flex flex-wrap justify-between gap-3 text-xs text-slate-400"><span>{count}</span>{message && <span className="font-semibold text-emerald-600">{message}</span>}{error && <span className="font-semibold text-rose-600">{error}</span>}</div></div>
    {open && <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/40 p-4"><div className="w-full max-w-2xl rounded-3xl bg-white p-6 shadow-2xl"><div className="flex items-start justify-between"><div><p className="text-[11px] font-bold uppercase tracking-[.18em] text-violet-600">Business banking</p><h3 className="mt-1 text-xl font-semibold">{editing ? 'Edit bank account' : 'Add bank account'}</h3><p className="mt-1 text-xs text-slate-500">These details are for business documents. Do not enter online-banking passwords or credentials.</p></div><button type="button" onClick={()=>setOpen(false)} className="grid h-9 w-9 place-items-center rounded-xl bg-slate-100">×</button></div><div className="mt-5 grid gap-4 sm:grid-cols-2"><Field label="Account name" value={form.name} onChange={v=>setForm(f=>({...f,name:v}))} placeholder="HDFC Current Account"/><Field label="Bank / institution" value={form.institution_name} onChange={v=>setForm(f=>({...f,institution_name:v}))} placeholder="HDFC Bank"/><Field label="Account holder name" value={form.account_holder_name} onChange={v=>setForm(f=>({...f,account_holder_name:v}))} placeholder="Business / proprietor name"/><Field label="Complete account number" value={form.account_number} onChange={v=>setForm(f=>({...f,account_number:v.replace(/\D/g,'')}))} placeholder="Enter full bank account number"/><Field label="IFSC" value={form.ifsc_code} onChange={v=>setForm(f=>({...f,ifsc_code:v.toUpperCase()}))} placeholder="HDFC0001234"/><Field label="Branch name" value={form.branch_name} onChange={v=>setForm(f=>({...f,branch_name:v}))} placeholder="Nilanga Branch"/><label className="text-xs font-semibold">Account type<select value={form.account_type} onChange={e=>setForm(f=>({...f,account_type:e.target.value}))} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"><option>Current</option><option>Savings</option><option>OD / Cash Credit</option><option>Other</option></select></label><Field label="Currency" value={form.currency_code} onChange={v=>setForm(f=>({...f,currency_code:v.toUpperCase().slice(0,3)}))} placeholder="INR"/><label className="flex items-center gap-2 text-xs font-semibold sm:col-span-2"><input type="checkbox" checked={form.is_primary} onChange={e=>setForm(f=>({...f,is_primary:e.target.checked}))}/> Use as primary business bank account</label></div><div className="mt-6 flex justify-end gap-2"><button type="button" onClick={()=>setOpen(false)} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold">Cancel</button><button type="button" disabled={addBusy} onClick={()=>void saveBank()} className="rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white">{addBusy?'Saving…':editing?'Save changes':'Add account'}</button></div></div></div>}
  </section>;
}

function Field({label,value,onChange,placeholder}:{label:string;value:string;onChange:(v:string)=>void;placeholder?:string}){return <label className="text-xs font-semibold">{label}<input value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"/></label>}
