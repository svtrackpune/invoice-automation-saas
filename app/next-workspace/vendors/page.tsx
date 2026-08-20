'use client';
import {useEffect,useMemo,useState} from 'react';
import {supabase,type BusinessContext} from '@/lib/supabase';

type Vendor={id:string;display_name:string;legal_name:string|null;email:string|null;phone:string|null;tax_id:string|null;tax_type:string|null;address:any;payment_terms_days:number;notes:string|null;is_active:boolean};
const money=(n:number)=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:2}).format(Number(n||0));
const blank={name:'',legal:'',email:'',phone:'',tax:'',taxType:'GST',terms:'30',notes:'',address:''};
function Input(p:React.InputHTMLAttributes<HTMLInputElement>){return <input {...p} className={`w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 ${p.className||''}`}/>}
function Button({children,onClick,secondary=false,disabled=false}:{children:React.ReactNode;onClick?:()=>void;secondary?:boolean;disabled?:boolean}){return <button disabled={disabled} onClick={onClick} className={`rounded-xl px-4 py-2.5 text-sm font-semibold disabled:opacity-50 ${secondary?'border border-slate-200 bg-white text-slate-700':'bg-violet-600 text-white'}`}>{children}</button>}
export default function Vendors(){
 const[ctx,setCtx]=useState<BusinessContext|null>(null),[rows,setRows]=useState<Vendor[]>([]),[q,setQ]=useState(''),[inactive,setInactive]=useState(false),[editing,setEditing]=useState<Vendor|null>(null),[show,setShow]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[f,setF]=useState({...blank}),[balances,setBalances]=useState<Record<string,{billed:number;paid:number;balance_due:number}>>({});
 async function load(){
  const c=await supabase.rpc('get_my_business_context');
  const b=c.data?.[0] as BusinessContext|undefined;
  if(!b){location.href='/';return}
  setCtx(b);
  let query=supabase.from('vendors').select('id,display_name,legal_name,email,phone,tax_id,tax_type,address,payment_terms_days,notes,is_active').eq('business_id',b.business_id);
  if(!inactive)query=query.eq('is_active',true);
  const[r,bs]=await Promise.all([query.order('created_at',{ascending:false}),supabase.from('vendor_balances').select('vendor_id,billed,paid,balance_due').eq('business_id',b.business_id)]);
  setRows(r.data||[]);
  const map:Record<string,any>={};
  (bs.data||[]).forEach((x:any)=>map[x.vendor_id]=x);
  setBalances(map);
  if(r.error||bs.error)setError((r.error||bs.error)?.message||'Unable to load vendors.');
 }
 useEffect(()=>{load()},[inactive]);
 const filtered=useMemo(()=>rows.filter(x=>`${x.display_name} ${x.legal_name||''} ${x.phone||''} ${x.email||''} ${x.tax_id||''}`.toLowerCase().includes(q.toLowerCase())),[rows,q]);
 function reset(){setF({...blank});setEditing(null)}
 function edit(x:Vendor){setEditing(x);setF({name:x.display_name,legal:x.legal_name||'',email:x.email||'',phone:x.phone||'',tax:x.tax_id||'',taxType:x.tax_type||'GST',terms:String(x.payment_terms_days??30),notes:x.notes||'',address:x.address?JSON.stringify(x.address,null,2):''});setShow(true)}
 async function save(){
  if(!ctx||!f.name.trim())return;
  setBusy(true);setError('');
  let address:any={};
  try{address=f.address.trim()?JSON.parse(f.address):{}}catch{setError('Address must be valid JSON.');setBusy(false);return}
  const payload={business_id:ctx.business_id,display_name:f.name.trim(),legal_name:f.legal.trim()||null,email:f.email.trim()||null,phone:f.phone.trim()||null,tax_id:f.tax.trim()||null,tax_type:f.taxType||null,address,payment_terms_days:Math.max(0,Number(f.terms)||0),notes:f.notes.trim()||null,is_active:true};
  const r=editing?await supabase.from('vendors').update(payload).eq('id',editing.id).eq('business_id',ctx.business_id):await supabase.from('vendors').insert(payload).select().single();
  if(r.error)setError(r.error.message);else{setShow(false);reset();await load()}
  setBusy(false)
 }
 async function deactivate(x:Vendor){if(!ctx||!confirm(`Deactivate ${x.display_name}? Existing bills and payments remain intact.`))return;setBusy(true);const r=await supabase.from('vendors').update({is_active:false}).eq('id',x.id).eq('business_id',ctx.business_id);if(r.error)setError(r.error.message);else await load();setBusy(false)}
 async function restore(x:Vendor){if(!ctx)return;setBusy(true);const r=await supabase.from('vendors').update({is_active:true}).eq('id',x.id).eq('business_id',ctx.business_id);if(r.error)setError(r.error.message);else await load();setBusy(false)}
 const payable=rows.reduce((a,x)=>a+Number(balances[x.id]?.balance_due||0),0);
 return <main className="min-h-screen bg-[#fbfaff] p-4 sm:p-6 lg:p-8">
  <div className="mx-auto max-w-[1250px]">
   <header className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[.18em] text-violet-600">Money out</p><h1 className="mt-1 text-3xl font-semibold">Vendors</h1><p className="mt-2 text-sm text-slate-500">Add, view, edit and safely remove suppliers while preserving purchase history.</p></div><div className="flex gap-2"><label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs"><input type="checkbox" checked={inactive} onChange={e=>setInactive(e.target.checked)}/> Inactive</label><Button onClick={()=>{reset();setShow(true)}}>＋ Add vendor</Button></div></header>
   {error&&<p className="mb-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
   <div className="grid gap-4 sm:grid-cols-3"><K title="Vendors" value={String(rows.length)} note={inactive?'Including inactive':'Active suppliers'}/><K title="Amount to pay" value={money(payable)} note="Current payable balance"/><K title="Bills" value={String(rows.filter(x=>Number(balances[x.id]?.billed||0)>0).length)} note="Suppliers with bills"/></div>
   <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white"><div className="border-b border-slate-100 p-4"><Input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search vendor, phone, email or GSTIN…"/></div><div className="overflow-x-auto"><table className="w-full min-w-[1100px] text-left text-sm"><thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-400"><tr><th className="px-5 py-3">Vendor</th><th className="px-5 py-3">Contact</th><th className="px-5 py-3">Billed</th><th className="px-5 py-3">Paid</th><th className="px-5 py-3">Outstanding</th><th className="px-5 py-3 text-right">Actions</th></tr></thead><tbody>{filtered.map(v=>{const b=balances[v.id]||{billed:0,paid:0,balance_due:0};return <tr key={v.id} className="border-t border-slate-100 hover:bg-violet-50/30"><td className="px-5 py-4"><b className="block">{v.display_name}</b><span className="text-xs text-slate-400">{v.legal_name||'No legal name'} · {v.is_active?'Active':'Inactive'}</span></td><td className="px-5 py-4"><span className="block">{v.phone||'—'}</span><span className="text-xs text-slate-400">{v.email||'—'}</span></td><td className="px-5 py-4">{money(b.billed)}</td><td className="px-5 py-4">{money(b.paid)}</td><td className="px-5 py-4 font-semibold">{money(b.balance_due)}</td><td className="px-5 py-4 text-right"><div className="flex justify-end gap-2"><Button secondary onClick={()=>edit(v)}>Edit</Button>{v.is_active?<Button secondary onClick={()=>deactivate(v)}>Delete</Button>:<Button onClick={()=>restore(v)}>Restore</Button>}</div></td></tr>})}{!filtered.length&&<tr><td colSpan={6} className="p-10 text-center text-sm text-slate-500">No vendors found.</td></tr>}</tbody></table></div></section>
   {show&&<div className="fixed inset-0 z-50 bg-slate-950/40 p-4 sm:p-8"><div className="mx-auto h-full max-w-2xl overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl"><div className="flex items-center justify-between"><div><p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Vendor master</p><h2 className="text-xl font-semibold">{editing?'Edit vendor':'Add vendor'}</h2></div><button onClick={()=>setShow(false)} className="grid h-9 w-9 place-items-center rounded-xl bg-slate-100">×</button></div><div className="mt-5 grid gap-4 sm:grid-cols-2"><Field label="Display name *"><Input value={f.name} onChange={e=>setF({...f,name:e.target.value})}/></Field><Field label="Legal name"><Input value={f.legal} onChange={e=>setF({...f,legal:e.target.value})}/></Field><Field label="Phone"><Input value={f.phone} onChange={e=>setF({...f,phone:e.target.value})}/></Field><Field label="Email"><Input type="email" value={f.email} onChange={e=>setF({...f,email:e.target.value})}/></Field><Field label="GST / Tax ID"><Input value={f.tax} onChange={e=>setF({...f,tax:e.target.value})}/></Field><Field label="Tax type"><Input value={f.taxType} onChange={e=>setF({...f,taxType:e.target.value})}/></Field><Field label="Payment terms (days)"><Input type="number" min="0" value={f.terms} onChange={e=>setF({...f,terms:e.target.value})}/></Field><Field label="Notes"><Input value={f.notes} onChange={e=>setF({...f,notes:e.target.value})}/></Field><Field label="Address JSON"><textarea value={f.address} onChange={e=>setF({...f,address:e.target.value})} placeholder='{"address":"...","city":"...","state":"...","pincode":"..."}' className="min-h-32 w-full rounded-xl border border-slate-200 p-3 text-sm font-mono sm:col-span-2"/></Field></div><div className="mt-6 flex justify-end gap-2"><Button secondary onClick={()=>setShow(false)}>Cancel</Button><Button disabled={busy||!f.name.trim()} onClick={save}>{busy?'Saving…':editing?'Save changes':'Create vendor'}</Button></div></div></div>}
  </div>
 </main>
}
function K({title,value,note}:{title:string;value:string;note:string}){return <section className="rounded-2xl border border-slate-200 bg-white p-5"><span className="text-xs font-semibold text-slate-500">{title}</span><b className="mt-3 block text-2xl tracking-tight">{value}</b><span className="mt-1 block text-xs text-slate-400">{note}</span></section>}
function Field({label,children}:{label:string;children:React.ReactNode}){return <label className="block text-xs font-semibold text-slate-600">{label}<div className="mt-1">{children}</div></label>}
