'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { SUPPORTED_LOCALES, resolveSupportedLocale } from '@/lib/i18n';
import { useLocale } from '@/lib/locale-context';
import { translate, translatedLocaleCoverage } from '@/lib/translations';
import { PageHeader } from '@/components/ui/finops/PageHeader';

const input='w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100';
const Field=({label,children}:{label:string;children:React.ReactNode})=><label className="block"><span className="mb-1.5 block text-xs font-semibold text-slate-600">{label}</span>{children}</label>;
const Toggle=({label,help,value,onChange}:{label:string;help:string;value:boolean;onChange:(v:boolean)=>void})=><label className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 p-4"><span><b className="block text-sm">{label}</b><span className="text-xs text-slate-500">{help}</span></span><input type="checkbox" className="h-5 w-5 accent-violet-600" checked={value} onChange={e=>onChange(e.target.checked)}/></label>;

export default function Profile(){const router=useRouter();const {locale}=useLocale();const t=(value:string)=>translate(locale,value);const[user,setUser]=useState<any>(null),[profile,setProfile]=useState<any>({display_name:'',phone:'',locale:'en-IN',timezone:'Asia/Kolkata'}),[notify,setNotify]=useState<any>({whatsapp_enabled:true,email_enabled:true,push_enabled:true,invoice_sent:true,payment_received:true,invoice_due:true,invoice_overdue:true,bank_activity:true,payroll_reminders:true,automation_alerts:true}),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[message,setMessage]=useState('');useEffect(()=>{supabase.auth.getUser().then(async({data})=>{setUser(data.user);if(!data.user){setLoading(false);return}const[p,n]=await Promise.all([supabase.from('user_profiles').select('display_name,phone,locale,timezone').eq('user_id',data.user.id).maybeSingle(),supabase.from('notification_preferences').select('*').eq('user_id',data.user.id).maybeSingle()]);setProfile(p.data?{...p.data,locale:resolveSupportedLocale(p.data.locale)||'en-IN'}:{display_name:data.user.user_metadata?.display_name||'',phone:'',locale:'en-IN',timezone:'Asia/Kolkata'});setNotify(n.data||{whatsapp_enabled:true,email_enabled:true,push_enabled:true,invoice_sent:true,payment_received:true,invoice_due:true,invoice_overdue:true,bank_activity:true,payroll_reminders:true,automation_alerts:true});setLoading(false)})},[]);async function save(){
 if(!user)return;
 setSaving(true);setMessage('');
 const selectedLocale=resolveSupportedLocale(String(profile.locale||'en-IN'))||'en-IN';
 const nextProfile={...profile,locale:selectedLocale};
 const[p,n]=await Promise.all([
  supabase.from('user_profiles').upsert({user_id:user.id,...nextProfile},{onConflict:'user_id'}),
  supabase.from('notification_preferences').upsert({user_id:user.id,...notify},{onConflict:'user_id'})
 ]);
 const issues:string[]=[];
 if(p.error){issues.push(p.error.message);}
 else{
  setProfile(nextProfile);
  try{
   const cookieResponse=await fetch('/api/preferences/locale',{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({locale:selectedLocale})
   });
   if(!cookieResponse.ok)throw new Error('Locale cookie sync failed.');
   window.dispatchEvent(new CustomEvent('moneymatters:locale-changed',{detail:{locale:selectedLocale}}));
   router.refresh();
  }catch{
   window.dispatchEvent(new CustomEvent('moneymatters:locale-changed',{detail:{locale:selectedLocale}}));
   issues.push(t('Language saved, but the locale cookie could not be synchronized.'));
  }
 }
 if(n.error)issues.push(n.error.message);
 setMessage(issues.join(' · ')||t('Profile and notification preferences saved.'));
 setSaving(false);
}if(loading)return <div className="grid min-h-[70vh] place-items-center text-sm text-slate-500">Loading profile…</div>;return <main className="min-h-[calc(100vh-100px)] bg-[#fbfaff] p-4 sm:p-7"><div className="mx-auto max-w-5xl"><PageHeader breadcrumbs={[{label:'Workspace',href:'/next-workspace'},{label:'System'},{label:'Profile & notifications'}]} title={t('Profile & notifications')} subtitle={t('Control your personal details, language, region and notifications.')} badge={{label:'Your account',variant:'neutral'}} className="mb-6"/><div className="grid gap-5 lg:grid-cols-[.9fr_1.1fr]"><section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_5px_24px_rgba(70,60,120,.045)]"><h2 className="text-lg font-semibold">{t('Profile & regional settings')}</h2><div className="mt-5 space-y-4"><Field label={t('Email')}><input className={`${input} bg-slate-50`} value={user?.email||''} readOnly/></Field><Field label={t('Display name')}><input className={input} value={profile.display_name||''} onChange={e=>setProfile((p:any)=>({...p,display_name:e.target.value}))}/></Field><Field label={t('Phone')}><input className={input} value={profile.phone||''} onChange={e=>setProfile((p:any)=>({...p,phone:e.target.value}))} placeholder="+…"/></Field><Field label={t('Language / locale')}><select className={input} value={profile.locale||'en-IN'} onChange={e=>setProfile((p:any)=>({...p,locale:e.target.value}))}>{SUPPORTED_LOCALES.map(locale=><option key={locale.code} value={locale.code}>{locale.name} — {locale.code}</option>)}</select></Field><p className="-mt-2 text-[11px] leading-5 text-slate-400">{t('The locale is stored as a standard BCP 47 language tag so additional languages can be added without changing the database model.')}</p>{translatedLocaleCoverage(profile.locale)==='english-fallback'&&<p className="-mt-2 text-[11px] leading-5 text-amber-700">{t('Interface translations currently cover English, Hindi and Marathi. This locale will use English interface labels while keeping locale-aware date and currency formatting.')}</p>}<Field label={t('Timezone')}><input className={input} value={profile.timezone||''} onChange={e=>setProfile((p:any)=>({...p,timezone:e.target.value}))} placeholder="e.g. Europe/London"/></Field></div></section><section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_5px_24px_rgba(70,60,120,.045)]"><h2 className="text-lg font-semibold">{t('Notification controls')}</h2><p className="mt-1 text-xs text-slate-500">{t('These are your personal delivery preferences. Business/customer settings remain separate.')}</p><div className="mt-5 space-y-2"><Toggle label={t('WhatsApp')} help={t('Allow business notifications through WAPI.')} value={!!notify.whatsapp_enabled} onChange={v=>setNotify((n:any)=>({...n,whatsapp_enabled:v}))}/><Toggle label={t('Email')} help={t('Receive email notifications.')} value={!!notify.email_enabled} onChange={v=>setNotify((n:any)=>({...n,email_enabled:v}))}/><Toggle label={t('Invoice sent')} help={t('Know when an invoice is sent.')} value={!!notify.invoice_sent} onChange={v=>setNotify((n:any)=>({...n,invoice_sent:v}))}/><Toggle label={t('Payment received')} help={t('Know when a customer payment is recorded.')} value={!!notify.payment_received} onChange={v=>setNotify((n:any)=>({...n,payment_received:v}))}/><Toggle label={t('Invoice due')} help={t('Upcoming payment reminders.')} value={!!notify.invoice_due} onChange={v=>setNotify((n:any)=>({...n,invoice_due:v}))}/><Toggle label={t('Invoice overdue')} help={t('Collections and overdue alerts.')} value={!!notify.invoice_overdue} onChange={v=>setNotify((n:any)=>({...n,invoice_overdue:v}))}/><Toggle label={t('Bank activity')} help={t('Bank matching and reconciliation updates.')} value={!!notify.bank_activity} onChange={v=>setNotify((n:any)=>({...n,bank_activity:v}))}/><Toggle label={t('Automation alerts')} help={t('Failures and important automation events.')} value={!!notify.automation_alerts} onChange={v=>setNotify((n:any)=>({...n,automation_alerts:v}))}/></div></section></div><div className="mt-5 flex items-center justify-end gap-3"><span className="text-sm text-emerald-700">{message}</span><button disabled={saving} onClick={save} className="rounded-xl bg-violet-600 px-5 py-3 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50">{saving?t('Saving…'):t('Save profile')}</button></div></div></main>}
