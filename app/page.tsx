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

type AuthMode = 'signin' | 'signup' | 'forgot';
type OAuthProvider = 'google' | 'facebook';

function Field({label,children}:{label:string;children:React.ReactNode}) {
  return <label className="block"><span className="mb-1.5 block text-xs font-semibold text-slate-600">{label}</span>{children}</label>;
}
function Input(props:React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 ${props.className||''}`}/>;
}
function Button({children,onClick,disabled=false}:{children:React.ReactNode;onClick?:()=>void;disabled?:boolean}) {
  return <button type="button" disabled={disabled} onClick={onClick} className="w-full rounded-xl bg-violet-600 px-5 py-3 text-sm font-semibold text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50">{children}</button>;
}
function PhoneField({country,setCountry,phone,setPhone}:{country:string;setCountry:(v:string)=>void;phone:string;setPhone:(v:string)=>void}) {
  const selected=COUNTRIES.find(x=>x[0]===country)||COUNTRIES[0];
  return <div className="grid grid-cols-[145px_1fr] gap-2">
    <select value={country} onChange={e=>setCountry(e.target.value)} aria-label="Country" className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100">
      {COUNTRIES.map(([code,dial,name])=><option key={code+name} value={code}>{name} ({dial})</option>)}
    </select>
    <Input type="tel" autoComplete="tel" inputMode="tel" value={phone} onChange={e=>setPhone(e.target.value.replace(/[^0-9\s()-]/g,''))} placeholder={`Mobile number ${selected[1]}`}/>
  </div>;
}

function phoneValidationError(country:string, rawPhone:string):string {
  const digits=rawPhone.replace(/\D/g,'');
  if(country==='IN'&&!/^[6-9]\d{9}$/.test(digits)) return 'Enter a valid 10-digit Indian mobile number starting with 6, 7, 8 or 9.';
  if(country!=='IN'&&!/^[1-9]\d{6,14}$/.test(digits)) return 'Enter a valid mobile number without the country calling code.';
  return '';
}
function metadataPhone(user:User):string {
  const value=user.user_metadata?.phone;
  return typeof value==='string' ? value.trim() : '';
}
function hasTrustedOAuthIdentity(user:User):boolean {
  const allowed=new Set(['google','facebook','github']);
  const primary=String(user.app_metadata?.provider||'').toLowerCase();
  return allowed.has(primary)||(user.identities||[]).some(identity=>allowed.has(String(identity.provider||'').toLowerCase()));
}

function Auth({onReady}:{onReady:()=>void}) {
  const[mode,setMode]=useState<AuthMode>('signin');
  const[email,setEmail]=useState(''),[password,setPassword]=useState(''),[name,setName]=useState('');
  const[country,setCountry]=useState('IN'),[phone,setPhone]=useState('');
  const[busy,setBusy]=useState(false),[error,setError]=useState('');
  const[emailConfirmationPending,setEmailConfirmationPending]=useState(false),[notice,setNotice]=useState('');

  async function submit() {
    setBusy(true);setError('');setNotice('');
    try {
      const normalizedEmail=email.trim().toLowerCase();
      if(!normalizedEmail) { setError('Enter your email address.'); return; }
      if(mode==='forgot') {
        const result=await supabase.auth.resetPasswordForEmail(normalizedEmail,{redirectTo:`${window.location.origin}/`});
        if(result.error) { setError(result.error.message); return; }
        setNotice('If an account exists for that email address, a password reset link will be sent. Check your inbox and spam folder.');
        return;
      }
      if(mode==='signup') {
        const invalidPhone=phoneValidationError(country,phone);
        if(!name.trim()||!password) { setError('Name and password are required.'); return; }
        if(invalidPhone) { setError(invalidPhone); return; }
        const selected=COUNTRIES.find(x=>x[0]===country)||COUNTRIES[0];
        const digits=phone.replace(/\D/g,'');
        const phoneValue=`${selected[1]}${digits}`;
        const result=await supabase.auth.signUp({
          email:normalizedEmail,
          password,
          options:{
            emailRedirectTo:`${window.location.origin}/`,
            data:{display_name:name.trim(),phone:phoneValue,mobile_number:digits,country_code:selected[0]},
          },
        });
        if(result.error) { setError(result.error.message); return; }
        if(result.data.session) {
          setEmailConfirmationPending(false);
          onReady();
          return;
        }
        setEmailConfirmationPending(true);
        setMode('signin');
        setNotice('Account created. Confirm your email from the message we sent, then sign in. Your mobile number is saved as profile information; SMS verification is not required.');
        return;
      }
      if(!password) { setError('Enter your password.'); return; }
      const result=await supabase.auth.signInWithPassword({email:normalizedEmail,password});
      if(result.error) { setError(result.error.message); return; }
      setEmailConfirmationPending(false);
      onReady();
    } catch(cause) {
      setError(cause instanceof Error ? cause.message : 'Authentication could not be completed. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function beginOAuth(provider:OAuthProvider) {
    setBusy(true);setError('');setNotice('');
    try {
      const result=await supabase.auth.signInWithOAuth({provider,options:{redirectTo:`${window.location.origin}/`}});
      if(result.error) setError(result.error.message);
      // Supabase redirects the browser when the provider is configured. A missing provider
      // configuration is surfaced as an error instead of silently breaking the sign-in form.
    } catch(cause) {
      setError(cause instanceof Error ? cause.message : `${provider} sign-in could not be started.`);
    } finally {
      setBusy(false);
    }
  }

  async function resendConfirmation() {
    if(!email.trim()) { setError('Enter your email address first.'); return; }
    setBusy(true);setError('');setNotice('');
    try {
      const result=await supabase.auth.resend({type:'signup',email:email.trim().toLowerCase(),options:{emailRedirectTo:`${window.location.origin}/`}});
      if(result.error) { setError(result.error.message); return; }
      setNotice('Confirmation email sent. Check your inbox and spam folder.');
    } catch(cause) {
      setError(cause instanceof Error ? cause.message : 'The confirmation email could not be sent.');
    } finally {
      setBusy(false);
    }
  }

  const title=mode==='signin'?'Sign in to your workspace':mode==='signup'?'Create your account':'Reset your password';
  const subtitle=mode==='signin'?'Continue to your business dashboard.':mode==='signup'?'Create your account using email confirmation.':'Enter your account email and we will send a secure password reset link.';

  return <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#ede9fe,transparent_34%),linear-gradient(135deg,#fafafa,#f5f3ff)] p-5">
    <div className="mx-auto flex min-h-[calc(100vh-40px)] max-w-6xl items-center justify-center">
      <div className="grid w-full overflow-hidden rounded-[32px] border border-white bg-white shadow-2xl md:grid-cols-[1.05fr_.95fr]">
        <div className="hidden bg-violet-950 p-12 text-white md:block">
          <div className="flex h-full flex-col justify-between">
            <div>
              <div className="mb-12 flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-white font-black text-violet-950">M</div><span className="text-lg font-bold">Moneymatters</span></div>
              <p className="max-w-md text-4xl font-semibold leading-tight">Your business. Your numbers. One intelligent workspace.</p>
              <p className="mt-5 max-w-md text-sm leading-6 text-violet-200">Invoices, customers, expenses, inventory, payments and accounting connected to the same source of truth.</p>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-2xl bg-white/10 p-4"><b>Sales</b><span className="mt-1 block text-xs text-violet-200">Invoice → payment</span></div>
              <div className="rounded-2xl bg-white/10 p-4"><b>Stock</b><span className="mt-1 block text-xs text-violet-200">Purchase → inventory</span></div>
              <div className="rounded-2xl bg-white/10 p-4"><b>Books</b><span className="mt-1 block text-xs text-violet-200">Automatic entries</span></div>
            </div>
          </div>
        </div>
        <div className="p-7 sm:p-12"><div className="mx-auto max-w-md">
          <p className="text-sm font-semibold text-violet-600">MONEYMATTERS</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-2 text-sm text-slate-500">{subtitle}</p>

          {notice&&<div role="status" className="mt-4 rounded-xl border border-sky-100 bg-sky-50 p-3 text-sm text-sky-800">{notice}</div>}

          {(mode==='signin'||mode==='signup')&&<>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <button type="button" disabled={busy} onClick={()=>beginOAuth('google')} className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                <span aria-hidden="true" className="text-base font-black text-[#4285F4]">G</span>Continue with Google
              </button>
              <button type="button" disabled={busy} onClick={()=>beginOAuth('facebook')} className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                <span aria-hidden="true" className="grid h-5 w-5 place-items-center rounded-full bg-[#1877F2] text-sm font-black text-white">f</span>Continue with Facebook
              </button>
            </div>
            <div className="my-5 flex items-center gap-3"><span className="h-px flex-1 bg-slate-200"/><span className="text-xs font-medium text-slate-400">or continue with email</span><span className="h-px flex-1 bg-slate-200"/></div>
          </>}

          {mode==='signup'&&<>
            <div className="mt-4"><Field label="Your name *"><Input autoComplete="name" value={name} onChange={e=>setName(e.target.value)} placeholder="Your name"/></Field></div>
            <div className="mt-4"><Field label="Mobile number *"><PhoneField country={country} setCountry={setCountry} phone={phone} setPhone={setPhone}/><span className="mt-1 block text-[11px] leading-4 text-slate-400">Saved to your profile for invoices and customer communication. No SMS OTP is used.</span></Field></div>
          </>}

          <div className="mt-4"><Field label="Email *"><Input required type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@company.com"/></Field></div>
          {(mode==='signin'||mode==='signup')&&<div className="mt-4"><Field label="Password *"><Input type="password" autoComplete={mode==='signup'?'new-password':'current-password'} value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••"/></Field></div>}

          {error&&<div role="alert" className="mt-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
          <div className="mt-6"><Button disabled={busy} onClick={submit}>{busy?'Please wait…':mode==='signup'?'Create account':mode==='forgot'?'Send password reset link':'Sign in'}</Button></div>
          {emailConfirmationPending&&mode==='signin'&&<button type="button" disabled={busy||!email.trim()} onClick={resendConfirmation} className="mt-4 text-sm font-semibold text-violet-700 underline disabled:opacity-50">Resend confirmation email</button>}
          <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold text-slate-500">
            {mode==='signin'&&<><button type="button" onClick={()=>{setMode('signup');setError('');setNotice('');setEmailConfirmationPending(false)}} className="hover:text-violet-700">Don’t have an account? Create one</button><button type="button" onClick={()=>{setMode('forgot');setError('');setNotice('')}} className="hover:text-violet-700">Forgot password?</button></>}
            {mode==='signup'&&<button type="button" onClick={()=>{setMode('signin');setError('');setNotice('')}} className="hover:text-violet-700">Already have an account? Sign in</button>}
            {mode==='forgot'&&<button type="button" onClick={()=>{setMode('signin');setError('');setNotice('')}} className="hover:text-violet-700">Back to sign in</button>}
          </div>
        </div></div>
      </div>
    </div>
  </main>;
}

function EmailVerificationGate({user,onSignOut}:{user:User;onSignOut:()=>void|Promise<void>}) {
  const[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  async function resend() {
    if(!user.email) { setError('This account has no email address. Sign out and use an email-based account.'); return; }
    setBusy(true);setError('');setNotice('');
    try {
      const result=await supabase.auth.resend({type:'signup',email:user.email,options:{emailRedirectTo:window.location.origin+'/'}});
      if(result.error) { setError(result.error.message); return; }
      setNotice('Confirmation email sent. Open the link in that message, then return here.');
    } catch(cause) {
      setError(cause instanceof Error ? cause.message : 'The confirmation email could not be sent.');
    } finally {
      setBusy(false);
    }
  }
  return <main className="grid min-h-screen place-items-center bg-[#fbfaff] p-5"><section className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-8 shadow-xl">
    <p className="text-sm font-bold tracking-widest text-violet-600">MONEYMATTERS</p><h1 className="mt-3 text-2xl font-semibold">Confirm your email</h1>
    <p className="mt-3 text-sm leading-6 text-slate-600">Confirm the email address on your account before launching your first workspace. Your mobile number does not need SMS verification.</p>
    {user.email&&<p className="mt-3 text-sm font-semibold text-slate-800">{user.email}</p>}
    {error&&<p role="alert" className="mt-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
    {notice&&<p role="status" className="mt-4 rounded-xl bg-sky-50 p-3 text-sm text-sky-800">{notice}</p>}
    <div className="mt-6 flex flex-wrap gap-3"><button type="button" disabled={busy} onClick={resend} className="rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">{busy?'Sending…':'Resend confirmation email'}</button><button type="button" onClick={onSignOut} className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700">Sign out</button></div>
  </section></main>;
}

function PhoneProfileCapture({user,onContinue}:{user:User;onContinue:()=>void|Promise<void>}) {
  const[country,setCountry]=useState('IN');
  const[phone,setPhone]=useState('');
  const[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const selected=COUNTRIES.find(x=>x[0]===country)||COUNTRIES[0];

  async function save() {
    const invalid=phoneValidationError(country,phone);
    if(invalid) { setError(invalid); return; }
    setBusy(true);setError('');setNotice('');
    try {
      const digits=phone.replace(/\D/g,'');
      const result=await supabase.auth.updateUser({data:{...user.user_metadata,phone:`${selected[1]}${digits}`,mobile_number:digits,country_code:selected[0]}});
      if(result.error) { setError(result.error.message); return; }
      await onContinue();
    } catch(cause) {
      setError(cause instanceof Error ? cause.message : 'The profile could not be updated.');
    } finally {
      setBusy(false);
    }
  }

  return <main className="grid min-h-screen place-items-center bg-[radial-gradient(circle_at_top_left,#ede9fe,transparent_34%),linear-gradient(135deg,#fafafa,#f5f3ff)] p-5">
    <section className="w-full max-w-lg rounded-3xl border border-white bg-white p-8 shadow-2xl">
      <p className="text-sm font-bold tracking-widest text-violet-600">MONEYMATTERS</p>
      <h1 className="mt-3 text-2xl font-semibold">Add a mobile number</h1>
      <p className="mt-3 text-sm leading-6 text-slate-600">A mobile number helps personalize invoice headers and customer communication. It is saved as profile metadata only and never requires SMS OTP.</p>
      <div className="mt-6"><Field label="Mobile number"><PhoneField country={country} setCountry={setCountry} phone={phone} setPhone={setPhone}/></Field></div>
      {error&&<p role="alert" className="mt-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
      {notice&&<p role="status" className="mt-4 rounded-xl bg-sky-50 p-3 text-sm text-sky-800">{notice}</p>}
      <div className="mt-6 grid gap-3 sm:grid-cols-2"><button type="button" disabled={busy} onClick={save} className="rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">{busy?'Saving…':'Save and continue'}</button><button type="button" disabled={busy} onClick={onContinue} className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 disabled:opacity-50">Continue without mobile</button></div>
    </section>
  </main>;
}

function PasswordRecoveryGate({onBack}:{onBack:()=>void}) {
  const[password,setPassword]=useState(''),[confirmation,setConfirmation]=useState('');
  const[busy,setBusy]=useState(false),[error,setError]=useState(''),[completed,setCompleted]=useState(false);

  async function updatePassword() {
    setError('');
    if(password.length<8) { setError('Use a password with at least 8 characters.'); return; }
    if(password!==confirmation) { setError('The passwords do not match.'); return; }
    setBusy(true);
    try {
      const result=await supabase.auth.updateUser({password});
      if(result.error) { setError(result.error.message); return; }
      setCompleted(true);
    } catch(cause) {
      setError(cause instanceof Error ? cause.message : 'The password could not be updated.');
    } finally {
      setBusy(false);
    }
  }

  return <main className="grid min-h-screen place-items-center bg-[radial-gradient(circle_at_top_left,#ede9fe,transparent_34%),linear-gradient(135deg,#fafafa,#f5f3ff)] p-5">
    <section className="w-full max-w-lg rounded-3xl border border-white bg-white p-8 shadow-2xl">
      <p className="text-sm font-bold tracking-widest text-violet-600">MONEYMATTERS</p>
      <h1 className="mt-3 text-2xl font-semibold">{completed?'Password updated':'Choose a new password'}</h1>
      {completed?<><p role="status" className="mt-3 text-sm leading-6 text-slate-600">Your password has been updated. Return to sign in with your new password.</p><button type="button" onClick={async()=>{await supabase.auth.signOut();onBack()}} className="mt-6 w-full rounded-xl bg-violet-600 px-5 py-3 text-sm font-semibold text-white">Return to sign in</button></>:<>
        <p className="mt-3 text-sm leading-6 text-slate-600">Enter a new password for your account.</p>
        <div className="mt-6"><Field label="New password"><Input type="password" autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="At least 8 characters"/></Field></div>
        <div className="mt-4"><Field label="Confirm new password"><Input type="password" autoComplete="new-password" value={confirmation} onChange={e=>setConfirmation(e.target.value)} placeholder="Re-enter new password"/></Field></div>
        {error&&<p role="alert" className="mt-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
        <button type="button" disabled={busy} onClick={updatePassword} className="mt-6 w-full rounded-xl bg-violet-600 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">{busy?'Updating…':'Update password'}</button>
      </>}
    </section>
  </main>;
}

export default function Page() {
  const[session,setSession]=useState<Session|null>(null);
  const[hasBusiness,setHasBusiness]=useState<boolean|null>(null);
  const[verificationUser,setVerificationUser]=useState<User|null>(null);
  const[needsEmailVerification,setNeedsEmailVerification]=useState(false);
  const[needsPhoneCapture,setNeedsPhoneCapture]=useState(false);
  const[isPasswordRecovery,setIsPasswordRecovery]=useState(false);
  const[pageError,setPageError]=useState('');
  const[loading,setLoading]=useState(true);

  const check=async(s:Session|null)=>{
    setSession(s);
    setPageError('');
    if(!s) {
      setHasBusiness(null);setVerificationUser(null);setNeedsEmailVerification(false);setNeedsPhoneCapture(false);setLoading(false);return;
    }
    const result=await supabase.rpc('get_my_business_context');
    if(result.error) { setHasBusiness(null);setPageError(result.error.message);setLoading(false);return; }
    const has=Array.isArray(result.data)&&result.data.length>0;
    setHasBusiness(has);

    // Email is the primary factor. A server-managed OAuth identity is also trusted.
    if(!has&&!s.user.email_confirmed_at&&!hasTrustedOAuthIdentity(s.user)) {
      setVerificationUser(s.user);setNeedsEmailVerification(true);setNeedsPhoneCapture(false);setLoading(false);return;
    }

    setVerificationUser(null);
    setNeedsEmailVerification(false);
    // OAuth users can optionally add profile-only mobile metadata. Skipping never blocks onboarding.
    setNeedsPhoneCapture(!has&&!metadataPhone(s.user));
    setLoading(false);
  };

  useEffect(()=>{
    const params=new URLSearchParams(window.location.search);
    const recovery=params.get('auth')==='reset'||window.location.hash.includes('type=recovery');
    if(recovery) setIsPasswordRecovery(true);

    void supabase.auth.getSession().then(({data})=>check(data.session)).catch(cause=>{
      setPageError(cause instanceof Error?cause.message:'Unable to initialize authentication.');
      setLoading(false);
    });
    const{data:{subscription}}=supabase.auth.onAuthStateChange((event,s)=>{
      if(event==='PASSWORD_RECOVERY') setIsPasswordRecovery(true);
      void check(s);
    });
    return()=>subscription.unsubscribe();
  },[]);

  useEffect(()=>{
    if(!isPasswordRecovery&&!loading&&session&&hasBusiness!==null&&!pageError&&!needsPhoneCapture&&!needsEmailVerification) {
      window.location.replace(hasBusiness?'/next-workspace':'/onboarding');
    }
  },[isPasswordRecovery,loading,session,hasBusiness,pageError,needsPhoneCapture,needsEmailVerification]);

  const returnToSignIn=()=>{
    window.history.replaceState({},document.title,window.location.pathname);
    setIsPasswordRecovery(false);
    setPageError('');
  };

  if(loading)return <div className="grid min-h-screen place-items-center bg-[#fbfaff] text-sm text-slate-500">Loading Moneymatters…</div>;
  if(isPasswordRecovery)return <PasswordRecoveryGate onBack={returnToSignIn}/>;
  if(session&&verificationUser&&needsEmailVerification)return <EmailVerificationGate user={verificationUser} onSignOut={async()=>{await supabase.auth.signOut();await check(null)}}/>;
  if(session&&needsPhoneCapture)return <PhoneProfileCapture user={session.user} onContinue={async()=>{setNeedsPhoneCapture(false);window.location.replace('/onboarding')}}/>;
  if(pageError&&session)return <main className="grid min-h-screen place-items-center bg-[#fbfaff] p-5"><section className="max-w-lg rounded-2xl border border-rose-100 bg-white p-6"><h1 className="text-lg font-semibold">Unable to open your workspace</h1><p role="alert" className="mt-2 text-sm text-rose-700">{pageError}</p><button type="button" onClick={()=>supabase.auth.getSession().then(({data})=>check(data.session))} className="mt-4 rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white">Retry</button></section></main>;
  if(!session)return <Auth onReady={()=>supabase.auth.getSession().then(({data})=>check(data.session))}/>;
  return <div className="grid min-h-screen place-items-center bg-[#fbfaff] text-sm text-slate-500">{hasBusiness?'Opening your workspace…':'Preparing your business setup…'}</div>;
}
