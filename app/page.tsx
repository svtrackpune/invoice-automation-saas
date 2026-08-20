'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

const COUNTRIES = [
  ['IN', '+91', 'India'], ['US', '+1', 'United States'], ['GB', '+44', 'United Kingdom'], ['AE', '+971', 'United Arab Emirates'],
  ['AU', '+61', 'Australia'], ['CA', '+1', 'Canada'], ['SG', '+65', 'Singapore'], ['DE', '+49', 'Germany'], ['FR', '+33', 'France'],
  ['SA', '+966', 'Saudi Arabia'], ['QA', '+974', 'Qatar'], ['OM', '+968', 'Oman'], ['NZ', '+64', 'New Zealand'], ['MY', '+60', 'Malaysia'],
  ['ZA', '+27', 'South Africa'], ['JP', '+81', 'Japan'], ['ES', '+34', 'Spain'], ['IT', '+39', 'Italy'], ['NL', '+31', 'Netherlands'],
] as const;

function Field({label,children}:{label:string;children:React.ReactNode}){return <label className="block"><span className="mb-1.5 block text-xs font-semibold text-slate-600">{label}</span>{children}</label>}
function Input(props:React.InputHTMLAttributes<HTMLInputElement>){return <input {...props} className={`w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 ${props.className||''}`}/>}
function Button({children,onClick,disabled=false}:{children:React.ReactNode;onClick?:()=>void;disabled?:boolean}){return <button disabled={disabled} onClick={onClick} className="rounded-xl bg-violet-600 px-5 py-3 text-sm font-semibold text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50">{children}</button>}
function PhoneField({country,setCountry,phone,setPhone}:{country:string;setCountry:(v:string)=>void;phone:string;setPhone:(v:string)=>void}){const selected=COUNTRIES.find(x=>x[0]===country)||COUNTRIES[0];return <div className="grid grid-cols-[145px_1fr] gap-2"><select value={country} onChange={e=>setCountry(e.target.value)} aria-label="Country" className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100">{COUNTRIES.map(([code,dial,name])=><option key={code+name} value={code}>{name} ({dial})</option>)}</select><Input required type="tel" inputMode="tel" value={phone} onChange={e=>setPhone(e.target.value.replace(/[^0-9\s()-]/g,''))} placeholder={`Mobile number ${selected[1]}`}/></div>}

function Auth({onReady}:{onReady:()=>void}){
  const[mode,setMode]=useState<'signin'|'signup'|'phone'>('signin');
  const[email,setEmail]=useState(''),[password,setPassword]=useState(''),[name,setName]=useState('');
  const[country,setCountry]=useState('IN'),[phone,setPhone]=useState(''),[otp,setOtp]=useState('');
  const[otpSent,setOtpSent]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const selected=COUNTRIES.find(x=>x[0]===country)||COUNTRIES[0];
  const e164=`${selected[1]}${phone.replace(/\D/g,'')}`;
  async function finishSignup(){const r=await supabase.auth.updateUser({email:email.trim().toLowerCase(),data:{display_name:name.trim(),phone:e164,country_code:selected[0]}});if(r.error){setError(r.error.message);return false}return true}
  async function submit(){
    setBusy(true);setError('');
    if(mode==='phone'){
      if(!phone.replace(/\D/g,'').length){setError('Mobile number is required.');setBusy(false);return}
      if(!otpSent){const r=await supabase.auth.signInWithOtp({phone:e164,options:{shouldCreateUser:false}});if(r.error){setError(r.error.message);setBusy(false);return}setOtpSent(true);setBusy(false);return}
      const r=await supabase.auth.verifyOtp({phone:e164,token:otp,type:'sms'});setBusy(false);if(r.error){setError(r.error.message);return}onReady();return;
    }
    if(mode==='signup'){
      if(!name.trim()||!email.trim()||!password||!phone.replace(/\D/g,'')){setError('Name, email, mobile number and password are required.');setBusy(false);return}
      if(!otpSent){
        const r=await supabase.auth.signUp({phone:e164,password,options:{data:{display_name:name.trim(),email:email.trim().toLowerCase(),phone:e164,country_code:selected[0]}}});
        if(r.error){setError(r.error.message);setBusy(false);return}
        if(r.data.session){const ok=await finishSignup();setBusy(false);if(ok)onReady();return}
        setOtpSent(true);setBusy(false);return;
      }
      const r=await supabase.auth.verifyOtp({phone:e164,token:otp,type:'sms'});
      if(r.error){setError(r.error.message);setBusy(false);return}
      const ok=await finishSignup();setBusy(false);if(ok)onReady();return;
    }
    const r=await supabase.auth.signInWithPassword({email:email.trim().toLowerCase(),password});setBusy(false);if(r.error){setError(r.error.message);return}onReady();
  }
  const title=mode==='signin'?'Sign in to your workspace':mode==='signup'?'Create your account':'Sign in with mobile OTP';
  return <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#ede9fe,transparent_34%),linear-gradient(135deg,#fafafa,#f5f3ff)] p-5"><div className="mx-auto flex min-h-[calc(100vh-40px)] max-w-6xl items-center justify-center"><div className="grid w-full overflow-hidden rounded-[32px] border border-white bg-white shadow-2xl md:grid-cols-[1.05fr_.95fr]"><div className="hidden bg-violet-950 p-12 text-white md:block"><div className="flex h-full flex-col justify-between"><div><div className="mb-12 flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-white text-violet-950 font-black">M</div><span className="text-lg font-bold">Moneymatters</span></div><p className="max-w-md text-4xl font-semibold leading-tight">Your business. Your numbers. One intelligent workspace.</p><p className="mt-5 max-w-md text-sm leading-6 text-violet-200">Invoices, customers, expenses, inventory, payments and accounting connected to the same source of truth.</p></div><div className="grid grid-cols-3 gap-3"><div className="rounded-2xl bg-white/10 p-4"><b>Sales</b><span className="mt-1 block text-xs text-violet-200">Invoice → payment</span></div><div className="rounded-2xl bg-white/10 p-4"><b>Stock</b><span className="mt-1 block text-xs text-violet-200">Purchase → inventory</span></div><div className="rounded-2xl bg-white/10 p-4"><b>Books</b><span className="mt-1 block text-xs text-violet-200">Automatic entries</span></div></div></div></div><div className="p-7 sm:p-12"><div className="mx-auto max-w-md"><p className="text-sm font-semibold text-violet-600">MONEYMATTERS</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">{title}</h1><p className="mt-2 text-sm text-slate-500">{mode==='signin'?'Continue to your business dashboard.':mode==='signup'?'Email is required for durable business communication; mobile is required for account recovery.':'Use the mobile number registered to your Moneymatters account from anywhere.'}</p>
  {mode==='signup'&&<><div className="mt-6"><Field label="Your name *"><Input required value={name} onChange={e=>setName(e.target.value)} placeholder="Your name"/></Field></div><div className="mt-4"><Field label="Mobile number *"><PhoneField country={country} setCountry={setCountry} phone={phone} setPhone={setPhone}/></Field></div></>}
  {mode!=='phone'&&<><div className="mt-4"><Field label="Email *"><Input required type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@company.com"/></Field></div><div className="mt-4"><Field label="Password *"><Input required type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••"/></Field></div></>}
  {mode==='phone'&&<><div className="mt-6"><Field label="Registered mobile number *"><PhoneField country={country} setCountry={setCountry} phone={phone} setPhone={setPhone}/></Field></div>{otpSent&&<div className="mt-4"><Field label="OTP *"><Input autoFocus inputMode="numeric" maxLength={6} value={otp} onChange={e=>setOtp(e.target.value.replace(/\D/g,''))} placeholder="6-digit OTP"/></Field></div>}</>}
  {mode==='signup'&&otpSent&&<div className="mt-3 rounded-xl bg-violet-50 p-3 text-xs text-violet-700">We sent an OTP to {e164}. Verify your mobile to finish creating the account.</div>}
  {error&&<div className="mt-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
  <div className="mt-6"><Button disabled={busy||((mode==='phone'||mode==='signup')&&otpSent&&!otp)} onClick={submit}>{busy?'Please wait…':mode==='phone'?(otpSent?'Verify OTP':'Send OTP'):mode==='signup'?(otpSent?'Verify mobile & finish':'Create account'):'Sign in'}</Button></div>
  <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold text-slate-500"><button onClick={()=>{setMode(mode==='signin'?'signup':'signin');setError('');setOtpSent(false);setOtp('')}} className="hover:text-violet-700">{mode==='signin'?"Don't have an account? Create one":"Already have an account? Sign in"}</button><button onClick={()=>{setMode(mode==='phone'?'signin':'phone');setError('');setOtpSent(false);setOtp('')}} className="hover:text-violet-700">{mode==='phone'?'Use email and password':'Forgot email? Sign in with mobile OTP'}</button></div>
</div></div></div></div></main>
}

function Setup({onDone}:{onDone:()=>void}){const[name,setName]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');async function create(){setBusy(true);setError('');const r=await supabase.rpc('create_business_for_current_user',{p_business_name:name,p_business_type:'sole_proprietorship',p_country_code:'IN',p_currency_code:'INR',p_tax_enabled:true,p_tax_region:'IN-MH'});setBusy(false);if(r.error){setError(r.error.message);return}onDone()}return <main className="grid min-h-screen place-items-center bg-[#fbfaff] p-5"><div className="w-full max-w-xl rounded-3xl border border-slate-200 bg-white p-8 shadow-xl sm:p-10"><div className="grid h-12 w-12 place-items-center rounded-2xl bg-violet-600 font-black text-white">M</div><p className="mt-6 text-xs font-bold uppercase tracking-[.18em] text-violet-600">First-time setup</p><h1 className="mt-2 text-3xl font-semibold">Create your business</h1><p className="mt-2 text-sm leading-6 text-slate-500">Set your business name now. You can manage the full legal, tax, numbering and branding profile from Business Settings after entering the workspace.</p><div className="mt-7"><Field label="Business name"><Input value={name} onChange={e=>setName(e.target.value)} placeholder="Your business name" autoFocus/></Field></div>{error&&<div className="mt-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}<div className="mt-7 flex justify-end"><Button disabled={busy||!name.trim()} onClick={create}>{busy?'Creating business…':'Create business →'}</Button></div></div></main>}

export default function Page(){const[session,setSession]=useState<any>(null),[hasBusiness,setHasBusiness]=useState<boolean|null>(null),[loading,setLoading]=useState(true);const check=async(s:any)=>{setSession(s);if(!s){setHasBusiness(null);setLoading(false);return}const r=await supabase.rpc('get_my_business_context');setHasBusiness(!!r.data?.length);setLoading(false)};useEffect(()=>{supabase.auth.getSession().then(({data})=>check(data.session));const{data:{subscription}}=supabase.auth.onAuthStateChange((_e,s)=>check(s));return()=>subscription.unsubscribe()},[]);useEffect(()=>{if(session&&hasBusiness){window.location.replace('/next-workspace')}},[session,hasBusiness]);if(loading)return <div className="grid min-h-screen place-items-center bg-[#fbfaff] text-sm text-slate-500">Loading Moneymatters…</div>;if(!session)return <Auth onReady={()=>supabase.auth.getSession().then(({data})=>check(data.session))}/>;if(!hasBusiness)return <Setup onDone={()=>check(session)}/>;return <div className="grid min-h-screen place-items-center bg-[#fbfaff] text-sm text-slate-500">Opening your workspace…</div>}
