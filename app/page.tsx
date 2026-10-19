'use client';

import type { Session, User } from '@supabase/supabase-js';
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
  const[emailConfirmationPending,setEmailConfirmationPending]=useState(false),[notice,setNotice]=useState('');
  const selected=COUNTRIES.find(x=>x[0]===country)||COUNTRIES[0];
  const e164=`${selected[1]}${phone.replace(/\D/g,'')}`;

  async function submit(){
    setBusy(true);setError('');setNotice('');
    if(mode==='phone'){
      if(!phone.replace(/\D/g,'').length){setError('Mobile number is required.');setBusy(false);return}
      if(!otpSent){const r=await supabase.auth.signInWithOtp({phone:e164,options:{shouldCreateUser:false}});if(r.error){setError(r.error.message);setBusy(false);return}setOtpSent(true);setBusy(false);return}
      const r=await supabase.auth.verifyOtp({phone:e164,token:otp,type:'sms'});setBusy(false);if(r.error){setError(r.error.message);return}onReady();return;
    }
    if(mode==='signup'){
      if(!name.trim()||!email.trim()||!password||!phone.replace(/\D/g,'')){setError('Name, email, mobile number and password are required.');setBusy(false);return}
      const r=await supabase.auth.signUp({email:email.trim().toLowerCase(),password,options:{emailRedirectTo:`${window.location.origin}/`,data:{display_name:name.trim(),phone:e164,country_code:selected[0]}}});
      if(r.error){setError(r.error.message);setBusy(false);return}
      if(r.data.session){setEmailConfirmationPending(false);setBusy(false);onReady();return}
      // Email confirmation happens first; mobile verification follows after the user signs in.
      setNotice('Account created. Confirm your email address, then sign in. We will verify your mobile number by SMS before your first workspace is launched.');
      setEmailConfirmationPending(true);setMode('signin');setBusy(false);return;
    }
    const r=await supabase.auth.signInWithPassword({email:email.trim().toLowerCase(),password});setBusy(false);if(r.error){setError(r.error.message);return}setEmailConfirmationPending(false);onReady();
  }

  async function resendConfirmation(){
    if(!email.trim()){setError('Enter your email address first.');return}
    setBusy(true);setError('');setNotice('');
    const r=await supabase.auth.resend({type:'signup',email:email.trim().toLowerCase(),options:{emailRedirectTo:`${window.location.origin}/`}});
    setBusy(false);
    if(r.error){setError(r.error.message);return}
    setNotice('Confirmation email sent. Check your inbox and spam folder.');
  }
  const title=mode==='signin'?'Sign in to your workspace':mode==='signup'?'Create your account':'Sign in with mobile OTP';
  return <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#ede9fe,transparent_34%),linear-gradient(135deg,#fafafa,#f5f3ff)] p-5"><div className="mx-auto flex min-h-[calc(100vh-40px)] max-w-6xl items-center justify-center"><div className="grid w-full overflow-hidden rounded-[32px] border border-white bg-white shadow-2xl md:grid-cols-[1.05fr_.95fr]"><div className="hidden bg-violet-950 p-12 text-white md:block"><div className="flex h-full flex-col justify-between"><div><div className="mb-12 flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-white text-violet-950 font-black">M</div><span className="text-lg font-bold">Moneymatters</span></div><p className="max-w-md text-4xl font-semibold leading-tight">Your business. Your numbers. One intelligent workspace.</p><p className="mt-5 max-w-md text-sm leading-6 text-violet-200">Invoices, customers, expenses, inventory, payments and accounting connected to the same source of truth.</p></div><div className="grid grid-cols-3 gap-3"><div className="rounded-2xl bg-white/10 p-4"><b>Sales</b><span className="mt-1 block text-xs text-violet-200">Invoice → payment</span></div><div className="rounded-2xl bg-white/10 p-4"><b>Stock</b><span className="mt-1 block text-xs text-violet-200">Purchase → inventory</span></div><div className="rounded-2xl bg-white/10 p-4"><b>Books</b><span className="mt-1 block text-xs text-violet-200">Automatic entries</span></div></div></div></div><div className="p-7 sm:p-12"><div className="mx-auto max-w-md"><p className="text-sm font-semibold text-violet-600">MONEYMATTERS</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">{title}</h1><p className="mt-2 text-sm text-slate-500">{mode==='signin'?'Continue to your business dashboard.':mode==='signup'?'Create your account with email verification enabled for production.':'Use the mobile number registered to your Moneymatters account from anywhere.'}</p>
  {notice&&<div className="mt-4 rounded-xl border border-sky-100 bg-sky-50 p-3 text-sm text-sky-800">{notice}</div>}
  {mode==='signup'&&<><div className="mt-6"><Field label="Your name *"><Input required value={name} onChange={e=>setName(e.target.value)} placeholder="Your name"/></Field></div><div className="mt-4"><Field label="Mobile number *"><PhoneField country={country} setCountry={setCountry} phone={phone} setPhone={setPhone}/></Field></div></>}
  {mode!=='phone'&&<><div className="mt-4"><Field label="Email *"><Input required type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@company.com"/></Field></div><div className="mt-4"><Field label="Password *"><Input required type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••"/></Field></div></>}
  {mode==='phone'&&<><div className="mt-6"><Field label="Registered mobile number *"><PhoneField country={country} setCountry={setCountry} phone={phone} setPhone={setPhone}/></Field></div>{otpSent&&<div className="mt-4"><Field label="OTP *"><Input autoFocus inputMode="numeric" maxLength={6} value={otp} onChange={e=>setOtp(e.target.value.replace(/\D/g,''))} placeholder="6-digit OTP"/></Field></div>}</>}
  
  {error&&<div className="mt-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
  <div className="mt-6"><Button disabled={busy||((mode==='phone')&&otpSent&&!otp)} onClick={submit}>{busy?'Please wait…':mode==='phone'?(otpSent?'Verify OTP':'Send OTP'):mode==='signup'?'Create account':'Sign in'}</Button></div>
  {emailConfirmationPending&&mode==='signin'&&<button type="button" disabled={busy||!email.trim()} onClick={resendConfirmation} className="mt-4 text-sm font-semibold text-violet-700 underline disabled:opacity-50">Resend confirmation email</button>}
  <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold text-slate-500"><button onClick={()=>{setMode(mode==='signin'?'signup':'signin');setError('');setNotice('');if(mode==='signin')setEmailConfirmationPending(false);setOtpSent(false);setOtp('')}} className="hover:text-violet-700">{mode==='signin'?"Don't have an account? Create one":"Already have an account? Sign in"}</button><button onClick={()=>{setMode(mode==='phone'?'signin':'phone');setError('');setOtpSent(false);setOtp('')}} className="hover:text-violet-700">{mode==='phone'?'Use email and password':'Forgot email? Sign in with mobile OTP'}</button></div>
</div></div></div></div></main>
}



function EmailVerificationGate({user,onSignOut}:{user:User;onSignOut:()=>void|Promise<void>}){
  const[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  async function resend(){
    if(!user.email){setError('This account has no email address. Sign out and create an account using email and password.');return}
    setBusy(true);setError('');setNotice('');
    const result=await supabase.auth.resend({type:'signup',email:user.email,options:{emailRedirectTo:window.location.origin+'/' }});
    setBusy(false);
    if(result.error){setError(result.error.message);return}
    setNotice('Confirmation email sent. Open the link in that message, then return here.');
  }
  return <main className="grid min-h-screen place-items-center bg-[#fbfaff] p-5"><section className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-8 shadow-xl">
    <p className="text-sm font-bold tracking-widest text-violet-600">MONEYMATTERS</p><h1 className="mt-3 text-2xl font-semibold">Confirm your email</h1>
    <p className="mt-3 text-sm leading-6 text-slate-600">Confirm the email address on your account before launching your first workspace. Mobile verification follows after email confirmation.</p>
    {user.email&&<p className="mt-3 text-sm font-semibold text-slate-800">{user.email}</p>}
    {error&&<p role="alert" className="mt-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
    {notice&&<p role="status" className="mt-4 rounded-xl bg-sky-50 p-3 text-sm text-sky-800">{notice}</p>}
    <div className="mt-6 flex flex-wrap gap-3"><button disabled={busy} onClick={resend} className="rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">{busy?'Sending…':'Resend confirmation email'}</button><button onClick={onSignOut} className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700">Sign out</button></div>
  </section></main>
}

function PhoneVerificationGate({user,onVerified,onSignOut}:{user:User;onVerified:()=>void|Promise<void>;onSignOut:()=>void|Promise<void>}){
  const metadataPhone=typeof user.user_metadata?.phone==='string'?user.user_metadata.phone:'';
  const[phone,setPhone]=useState(metadataPhone||user.phone||'');
  const[otp,setOtp]=useState(''),[sent,setSent]=useState(false),[requestedPhone,setRequestedPhone]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const normalizedPhone=phone.trim().replace(/[^\d+]/g,'');
  async function sendCode(){
    if(!/^\+[1-9]\d{7,14}$/.test(normalizedPhone)){setError('Enter a valid mobile number in international format, including + and the country code.');return}
    setBusy(true);setError('');setNotice('');
    const response=user.phone===normalizedPhone&&!user.phone_confirmed_at
      ? await supabase.auth.resend({type:'phone_change',phone:normalizedPhone})
      : await supabase.auth.updateUser({phone:normalizedPhone,data:{...user.user_metadata,phone:normalizedPhone}});
    setBusy(false);
    if(response.error){setError(response.error.message);return}
    setPhone(normalizedPhone);setRequestedPhone(normalizedPhone);setOtp('');setSent(true);setNotice('We sent a verification code to this mobile number. Enter it below to verify your account.');
  }
  async function verifyCode(){
    if(normalizedPhone!==requestedPhone){setError('The mobile number changed after the code was sent. Send a new code.');return}
    if(!/^\d{6}$/.test(otp)){setError('Enter the 6-digit code sent to your mobile.');return}
    setBusy(true);setError('');setNotice('');
    const response=await supabase.auth.verifyOtp({phone:requestedPhone,token:otp,type:'phone_change'});
    if(response.error){setBusy(false);setError(response.error.message);return}
    const refreshed=await supabase.auth.getUser();
    setBusy(false);
    if(refreshed.error){setError(refreshed.error.message);return}
    if(!refreshed.data.user?.phone_confirmed_at){setError('The mobile number is not confirmed yet. Request a new code and try again.');return}
    await onVerified();
  }
  return <main className="grid min-h-screen place-items-center bg-[radial-gradient(circle_at_top_left,#ede9fe,transparent_34%),linear-gradient(135deg,#fafafa,#f5f3ff)] p-5"><section className="w-full max-w-lg rounded-3xl border border-white bg-white p-8 shadow-2xl">
    <p className="text-sm font-bold tracking-widest text-violet-600">MONEYMATTERS</p><h1 className="mt-3 text-2xl font-semibold">Verify your mobile number</h1>
    <p className="mt-3 text-sm leading-6 text-slate-600">Your email is confirmed. Verify a mobile number on this signed-in account before we create your first business, membership and accounting defaults.</p>
    <label className="mt-6 block text-xs font-semibold text-slate-700">Mobile number (international format)</label><input type="tel" autoComplete="tel" inputMode="tel" value={phone} onChange={e=>setPhone(e.target.value.replace(/[^\d+()\s-]/g,''))} placeholder="+919876543210" className="mt-2 w-full rounded-xl border border-slate-200 px-3.5 py-3 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100" />
    {sent&&<><label className="mt-4 block text-xs font-semibold text-slate-700">6-digit SMS code</label><input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={otp} onChange={e=>setOtp(e.target.value.replace(/\D/g,''))} placeholder="123456" className="mt-2 w-full rounded-xl border border-slate-200 px-3.5 py-3 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100" /></>}
    {error&&<p role="alert" className="mt-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}{notice&&<p role="status" className="mt-4 rounded-xl bg-sky-50 p-3 text-sm text-sky-800">{notice}</p>}
    <div className="mt-6 flex flex-wrap gap-3"><button disabled={busy} onClick={sendCode} className="rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">{busy?'Please wait…':sent?'Resend SMS code':'Send SMS code'}</button>{sent&&<button disabled={busy||otp.length!==6} onClick={verifyCode} className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">{busy?'Verifying…':'Verify mobile'}</button>}<button disabled={busy} onClick={onSignOut} className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 disabled:opacity-50">Sign out</button></div>
    <p className="mt-5 text-xs leading-5 text-slate-400">SMS delivery depends on the phone provider configured in Supabase Auth. Verification is recorded by Supabase Auth, not by a browser-only flag.</p>
  </section></main>
}

export default function Page(){
  const[session,setSession]=useState<Session|null>(null);
  const[hasBusiness,setHasBusiness]=useState<boolean|null>(null);
  const[verificationUser,setVerificationUser]=useState<User|null>(null);
  const[needsEmailVerification,setNeedsEmailVerification]=useState(false);
  const[needsPhoneVerification,setNeedsPhoneVerification]=useState(false);
  const[pageError,setPageError]=useState('');
  const[loading,setLoading]=useState(true);

  const check=async(s:Session|null)=>{
    setSession(s);
    setPageError('');
    if(!s){
      setHasBusiness(null);setVerificationUser(null);setNeedsEmailVerification(false);setNeedsPhoneVerification(false);setLoading(false);return;
    }
    const r=await supabase.rpc('get_my_business_context');
    if(r.error){setHasBusiness(null);setPageError(r.error.message);setLoading(false);return}
    const has=Array.isArray(r.data)&&r.data.length>0;
    setHasBusiness(has);
    // Existing workspaces retain access. Dual verification is required before first-workspace launch.
    if(!has&&!s.user.email_confirmed_at){
      setVerificationUser(s.user);setNeedsEmailVerification(true);setNeedsPhoneVerification(false);setLoading(false);return;
    }
    if(!has&&!s.user.phone_confirmed_at){
      setVerificationUser(s.user);setNeedsEmailVerification(false);setNeedsPhoneVerification(true);setLoading(false);return;
    }
    setVerificationUser(null);setNeedsEmailVerification(false);setNeedsPhoneVerification(false);setLoading(false);
  };

  useEffect(()=>{
    supabase.auth.getSession().then(({data})=>check(data.session));
    const{data:{subscription}}=supabase.auth.onAuthStateChange((_event,s)=>check(s));
    return()=>subscription.unsubscribe();
  },[]);

  useEffect(()=>{
    if(!loading&&session&&hasBusiness!==null&&!pageError&&!needsPhoneVerification&&!needsEmailVerification){
      window.location.replace(hasBusiness?'/next-workspace':'/onboarding');
    }
  },[loading,session,hasBusiness,pageError,needsPhoneVerification,needsEmailVerification]);

  if(loading)return <div className="grid min-h-screen place-items-center bg-[#fbfaff] text-sm text-slate-500">Loading Moneymatters…</div>;
  if(session&&verificationUser&&needsEmailVerification)return <EmailVerificationGate user={verificationUser} onSignOut={async()=>{await supabase.auth.signOut();await check(null)}}/>;
  if(session&&verificationUser&&needsPhoneVerification)return <PhoneVerificationGate user={verificationUser} onVerified={async()=>{const{data}=await supabase.auth.getSession();await check(data.session)}} onSignOut={async()=>{await supabase.auth.signOut();await check(null)}}/>;
  if(pageError&&session)return <main className="grid min-h-screen place-items-center bg-[#fbfaff] p-5"><section className="max-w-lg rounded-2xl border border-rose-100 bg-white p-6"><h1 className="text-lg font-semibold">Unable to open your workspace</h1><p role="alert" className="mt-2 text-sm text-rose-700">{pageError}</p><button onClick={()=>supabase.auth.getSession().then(({data})=>check(data.session))} className="mt-4 rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white">Retry</button></section></main>;
  if(!session)return <Auth onReady={()=>supabase.auth.getSession().then(({data})=>check(data.session))}/>;
  return <div className="grid min-h-screen place-items-center bg-[#fbfaff] text-sm text-slate-500">{hasBusiness?'Opening your workspace…':'Preparing your business setup…'}</div>;
}
