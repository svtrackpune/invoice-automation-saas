'use client';

import { useEffect, useState } from 'react';
import { supabase, type BusinessContext } from '@/lib/supabase';

const input='w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100';

type Bank={id:string;name:string;institution_name:string|null;account_last4:string|null;account_type:string|null};

export default function CashCarrySettings(){
  const [business,setBusiness]=useState<BusinessContext|null>(null);
  const [enabled,setEnabled]=useState(false);
  const [upiEnabled,setUpiEnabled]=useState(false);
  const [bankId,setBankId]=useState('');
  const [banks,setBanks]=useState<Bank[]>([]);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [message,setMessage]=useState('');
  const [error,setError]=useState('');

  useEffect(()=>{(async()=>{
    const c=await supabase.rpc('get_my_business_context');
    const b=c.data?.[0] as BusinessContext|undefined;
    if(!b){location.href='/';return;}
    setBusiness(b);
    const [settings,mapping,bankRows]=await Promise.all([
      supabase.from('business_settings').select('cash_bill_enabled').eq('business_id',b.business_id).maybeSingle(),
      supabase.from('business_payment_method_accounts').select('bank_account_id,is_active').eq('business_id',b.business_id).eq('payment_method','upi').maybeSingle(),
      supabase.from('bank_accounts').select('id,name,institution_name,account_last4,account_type').eq('business_id',b.business_id).eq('is_active',true).order('is_primary',{ascending:false}).order('name')
    ]);
    setEnabled(Boolean(settings.data?.cash_bill_enabled));
    const mapped=mapping.data?.is_active?String(mapping.data.bank_account_id):'';
    setBankId(mapped);
    setUpiEnabled(Boolean(mapped));
    setBanks((bankRows.data||[]) as Bank[]);
    setLoading(false);
  })();},[]);

  const save=async()=>{
    if(!business)return;
    if(upiEnabled&&!bankId){setError('Select the bank account that should receive Cash & Carry UPI payments.');return;}
    setSaving(true);setError('');setMessage('');
    const r=await supabase.rpc('configure_cash_and_carry',{p_business_id:business.business_id,p_enabled:enabled,p_upi_bank_account_id:upiEnabled?bankId:null});
    if(r.error){setError(r.error.message);setSaving(false);return}
    setMessage('Cash & Carry settings saved.');
    setSaving(false);
  };

  if(loading)return <div className="grid min-h-[70vh] place-items-center text-sm text-slate-500">Loading Cash & Carry settings…</div>;
  return <main className="min-h-[calc(100vh-100px)] bg-[#fbfaff] p-4 sm:p-7"><div className="mx-auto max-w-3xl">
    <div className="mb-6 flex items-center justify-between gap-4"><div><p className="text-[10px] font-bold uppercase tracking-[.18em] text-violet-600">Sales setup</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">Cash & Carry</h1><p className="mt-2 text-sm text-slate-500">Configure counter sales for this workspace. The workspace accounting type remains unchanged.</p></div><button type="button" onClick={()=>location.href='/next-workspace/cash-bill'} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700">Back</button></div>
    {error&&<div className="mb-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
    {message&&<div className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div>}
    <section className="rounded-3xl border border-violet-100 bg-white p-6 shadow-[0_18px_60px_rgba(70,60,120,.07)] sm:p-8">
      <div className="rounded-2xl border border-violet-100 bg-violet-50/60 p-5"><p className="text-xs font-bold uppercase tracking-[.14em] text-violet-700">Current workspace</p><h2 className="mt-2 text-lg font-semibold">{business?.business_name}</h2><p className="mt-1 text-xs text-slate-500">Cash & Carry uses this workspace's accounting, tax treatment and inventory. GST and Non-GST remain separate workspaces.</p></div>
      <div className="mt-6 rounded-2xl border border-slate-200 p-5"><label className="flex cursor-pointer items-start gap-3"><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)} className="mt-1 h-4 w-4 accent-violet-600"/><span><b className="block text-sm">Enable Cash & Carry</b><span className="mt-1 block text-xs leading-5 text-slate-500">Allow fast counter billing in this workspace. Every Cash & Carry bill requires the customer's mobile number.</span></span></label></div>
      {enabled&&<div className="mt-5 rounded-2xl border border-slate-200 p-5"><div className="flex items-start gap-3"><input type="checkbox" id="upi" checked={upiEnabled} onChange={e=>setUpiEnabled(e.target.checked)} className="mt-1 h-4 w-4 accent-violet-600"/><div className="flex-1"><label htmlFor="upi" className="block cursor-pointer text-sm font-semibold">Accept UPI at counter</label><p className="mt-1 text-xs leading-5 text-slate-500">Choose any active bank account in this workspace. It can be a current or savings account; Moneymatters does not assume a particular account type.</p>{upiEnabled&&<div className="mt-4"><label className="mb-1.5 block text-xs font-semibold text-slate-600">UPI settlement account *</label><select className={input} value={bankId} onChange={e=>setBankId(e.target.value)}><option value="">Select bank account…</option>{banks.map(b=><option key={b.id} value={b.id}>{b.name} · {b.institution_name||'Bank'}{b.account_last4?` · ••••${b.account_last4}`:''}{b.account_type?` · ${b.account_type}`:''}</option>)}</select>{!banks.length&&<p className="mt-2 text-xs text-rose-600">No active bank account exists in this workspace. Add/import a bank account first.</p>}</div>}</div></div></div>}
      <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-5"><p className="text-sm font-semibold">Payment routing</p><div className="mt-3 grid gap-3 sm:grid-cols-2"><div className="rounded-xl bg-white p-4"><b className="block text-sm">Cash</b><span className="mt-1 block text-xs text-slate-500">Posts to this workspace's Cash ledger.</span></div><div className="rounded-xl bg-white p-4"><b className="block text-sm">UPI</b><span className="mt-1 block text-xs text-slate-500">Posts to the bank account selected above through its linked bank ledger.</span></div></div></div>
      <div className="mt-7 flex flex-wrap justify-end gap-2"><button type="button" onClick={()=>location.href='/next-workspace/cash-bill'} className="rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700">Cancel</button><button type="button" onClick={save} disabled={saving||(upiEnabled&&!bankId)} className="rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{saving?'Saving…':'Save Cash & Carry settings'}</button></div>
    </section>
  </div></main>;
}
