'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, type BusinessContext } from '@/lib/supabase';

type Connection = {
  id: string;
  channel: 'whatsapp' | 'telegram' | 'email' | 'sms';
  provider: 'wapi' | 'telegram-bot' | 'resend' | 'smtp' | 'sendgrid' | 'twilio' | 'fast2sms' | 'msg91' | 'textlocal' | 'generic_http';
  display_name: string;
  endpoint_url: string | null;
  external_instance_id: string | null;
  sender: string | null;
  default_recipient: string | null;
  enabled: boolean;
  health_status: string;
  last_health_check_at: string | null;
  last_error: string | null;
  secret_ref: string | null;
  config: Record<string, unknown>;
};

type Template = {
  id: string;
  event_type: string;
  name: string;
  language: string;
  status: string;
  provider_status: string | null;
};

type Job = {
  id: string;
  event_type: string;
  recipient: string;
  status: string;
  scheduled_for: string;
  sent_at: string | null;
  last_error: string | null;
};

type WapiForm = {
  id: string;
  endpoint_url: string;
  external_instance_id: string;
  secret: string;
  display_name: string;
  enabled: boolean;
};

type TelegramForm = {
  id: string;
  secret: string;
  default_recipient: string;
  display_name: string;
  enabled: boolean;
};
type SmsForm={id:string;provider:'fast2sms'|'msg91'|'textlocal'|'generic_http';endpoint_url:string;sender:string;secret:string;template_id:string;invoice_template_id:string;reminder_template_id:string;display_name:string;enabled:boolean};
type SmtpForm={id:string;provider:'smtp'|'resend'|'sendgrid';host:string;port:string;username:string;from_email:string;from_name:string;password:string;secure:boolean;display_name:string;enabled:boolean};

const emptyWapi: WapiForm = {
  id: '',
  endpoint_url: '',
  external_instance_id: '',
  secret: '',
  display_name: 'Business Wapi',
  enabled: true,
};

const emptyTelegram: TelegramForm = {
  id: '',
  secret: '',
  default_recipient: '',
  display_name: 'Business Telegram',
  enabled: true,
};
const emptySms:SmsForm={id:'',provider:'fast2sms',endpoint_url:'',sender:'',secret:'',template_id:'',invoice_template_id:'',reminder_template_id:'',display_name:'Business SMS',enabled:true};
const emptySmtp:SmtpForm={id:'',provider:'smtp',host:'',port:'465',username:'',from_email:'',from_name:'',password:'',secure:true,display_name:'Business Email',enabled:true};

export default function WhatsApp() {
  const [ctx, setCtx] = useState<BusinessContext | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [wapi, setWapi] = useState(emptyWapi);
  const [telegram, setTelegram] = useState(emptyTelegram);
  const [sms,setSms]=useState(emptySms);
  const [smtp,setSmtp]=useState(emptySmtp);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<'wapi' | 'telegram' | 'sms' | 'smtp' | null>(null);
  const [message, setMessage] = useState('');
  const [testingChannel, setTestingChannel] = useState('');
  const [testTargets, setTestTargets] = useState<Record<string,string>>({ whatsapp:'', sms:'', telegram:'', email:'' });

  const load = useCallback(async () => {
    const c = await supabase.rpc('get_my_business_context');
    const business = c.data?.[0] as BusinessContext | undefined;
    if (!business) {
      location.href = '/';
      return;
    }

    setCtx(business);

    const [cn, te, jo] = await Promise.all([
      supabase
        .from('business_notification_connections')
        .select(
          'id,channel,provider,display_name,endpoint_url,external_instance_id,sender,default_recipient,enabled,health_status,last_health_check_at,last_error,secret_ref,config',
        )
        .eq('business_id', business.business_id)
        .order('channel')
        .order('priority'),
      supabase
        .from('whatsapp_templates')
        .select('id,event_type,name,language,status,provider_status')
        .eq('business_id', business.business_id)
        .order('event_type'),
      supabase
        .from('notification_jobs')
        .select('id,notification_type,recipient,status,scheduled_for,sent_at,last_error')
        .eq('business_id', business.business_id)
        .eq('channel', 'whatsapp')
        .order('created_at', { ascending: false })
        .limit(50),
    ]);

    const rows = (cn.data || []) as Connection[];
    setConnections(rows);
    setTemplates((te.data || []) as Template[]);
    setJobs(
      (jo.data || []).map((row) => ({
        id: row.id,
        event_type: row.notification_type,
        recipient: row.recipient,
        status: row.status,
        scheduled_for: row.scheduled_for,
        sent_at: row.sent_at,
        last_error: row.last_error,
      })) as Job[],
    );

    const wc = rows.find(
      (row) => row.channel === 'whatsapp' && row.provider === 'wapi',
    );
    if (wc) {
      setWapi({
        id: wc.id,
        endpoint_url: wc.endpoint_url || '',
        external_instance_id: wc.external_instance_id || '',
        secret: '',
        display_name: wc.display_name,
        enabled: wc.enabled,
      });
    }

    const tc = rows.find(
      (row) => row.channel === 'telegram' && row.provider === 'telegram-bot',
    );
    if (tc) {
      setTelegram({
        id: tc.id,
        secret: '',
        default_recipient: tc.default_recipient || '',
        display_name: tc.display_name,
        enabled: tc.enabled,
      });
    }

    const sc=rows.find((row)=>row.channel==='sms'&&['fast2sms','msg91','textlocal','generic_http'].includes(row.provider));
    if(sc)setSms({id:sc.id,provider:sc.provider as SmsForm['provider'],endpoint_url:sc.endpoint_url||'',sender:sc.sender||'',secret:'',template_id:typeof sc.config?.template_id==='string'?sc.config.template_id:'',invoice_template_id:typeof sc.config?.invoice_template_id==='string'?sc.config.invoice_template_id:'',reminder_template_id:typeof sc.config?.reminder_template_id==='string'?sc.config.reminder_template_id:'',display_name:sc.display_name,enabled:sc.enabled});
    const ec=rows.find((row)=>row.channel==='email'&&['smtp','resend','sendgrid'].includes(row.provider));
    if(ec)setSmtp({id:ec.id,provider:ec.provider as SmtpForm['provider'],host:ec.endpoint_url||'',port:String(ec.config?.port||465),username:typeof ec.config?.username==='string'?ec.config.username:'',from_email:ec.sender||'',from_name:typeof ec.config?.from_name==='string'?ec.config.from_name:'',password:'',secure:typeof ec.config?.secure==='boolean'?ec.config.secure:true,display_name:ec.display_name,enabled:ec.enabled});
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const sendTest = async (channel: 'whatsapp' | 'telegram' | 'sms' | 'email') => {
    if (!ctx) return;
    const recipient = String(testTargets[channel] || '').trim();
    if (!recipient) { setMessage('Enter a test recipient first.'); return; }
    setTestingChannel(channel); setMessage('');
    const queued = await supabase.rpc('queue_notification_test', {
      p_business_id: ctx.business_id,
      p_channel: channel,
      p_recipient: recipient,
      p_subject: 'Moneymatters connectivity test',
      p_message: 'This is a test notification from Moneymatters.',
    });
    if (queued.error) {
      setMessage(queued.error.message);
      setTestingChannel('');
      return;
    }
    const dispatched = await supabase.functions.invoke('process-notifications', { body: { job_id: queued.data } });
    setMessage(dispatched.error
      ? 'Test queued. The notification worker will retry automatically.'
      : 'Test notification dispatched to the provider.');
    setTestingChannel('');
    await load();
  };

  const save = async (channel: 'wapi' | 'telegram' | 'sms' | 'smtp') => {
    if(!ctx)return;setSaving(channel);setMessage('');
    if(channel==='wapi'&&(!wapi.endpoint_url.trim()||!wapi.external_instance_id.trim()||(!wapi.secret.trim()&&!wapi.id))){setMessage('Wapi requires API URL, Instance ID and API Key on first setup.');setSaving(null);return;}
    if(channel==='telegram'&&!telegram.secret.trim()&&!telegram.id){setMessage('Telegram Bot Token is required on first setup.');setSaving(null);return;}
    if(channel==='sms'&&sms.sender.trim().length!==6){setMessage('SMS Sender ID must be exactly 6 characters.');setSaving(null);return;}
    if(channel==='smtp'&&(!smtp.from_email.trim()||(!smtp.password.trim()&&!smtp.id)|| (smtp.provider==='smtp'&&!smtp.host.trim()))){setMessage(smtp.provider==='smtp'?'SMTP host, From email and password are required on first setup.':'Email sender and API key are required on first setup.');setSaving(null);return;}
    const isWapi=channel==='wapi',isTelegram=channel==='telegram',isSms=channel==='sms';
    const result=await supabase.rpc('save_business_notification_connection',{
      p_business_id:ctx.business_id,p_channel:isWapi?'whatsapp':isTelegram?'telegram':isSms?'sms':'email',
      p_provider:isWapi?'wapi':isTelegram?'telegram-bot':isSms?sms.provider:smtp.provider,
      p_display_name:isWapi?wapi.display_name:isTelegram?telegram.display_name:isSms?sms.display_name:smtp.display_name,
      p_connection_id:isWapi?wapi.id||null:isTelegram?telegram.id||null:isSms?sms.id||null:smtp.id||null,
      p_endpoint_url:isWapi?wapi.endpoint_url.trim():isSms?sms.endpoint_url.trim()||null:smtp.provider==='smtp'?smtp.host.trim():null,
      p_external_instance_id:isWapi?wapi.external_instance_id.trim():null,
      p_secret:isWapi?wapi.secret.trim()||null:isTelegram?telegram.secret.trim()||null:isSms?sms.secret.trim()||null:smtp.password.trim()||null,
      p_sender:isSms?sms.sender.trim()||null:channel==='smtp'?smtp.from_email.trim():null,
      p_default_recipient:isTelegram?telegram.default_recipient.trim()||null:null,
      p_priority:1,p_failover_group:'customer-delivery',p_enabled:isWapi?wapi.enabled:isTelegram?telegram.enabled:isSms?sms.enabled:smtp.enabled,
      p_config:isSms?{template_id:sms.template_id.trim()||undefined,invoice_template_id:sms.invoice_template_id.trim()||undefined,reminder_template_id:sms.reminder_template_id.trim()||undefined}:channel==='smtp'&&smtp.provider==='smtp'?{port:465,secure:true,username:smtp.username.trim()||smtp.from_email.trim(),from_name:smtp.from_name.trim()||undefined}:{},
    });
    setMessage(result.error?result.error.message:'Connection saved securely in Supabase Vault.');setSaving(null);
    if(!result.error){if(isWapi)setWapi(v=>({...v,secret:''}));else if(isTelegram)setTelegram(v=>({...v,secret:''}));else if(isSms)setSms(v=>({...v,secret:''}));else setSmtp(v=>({...v,password:''}));await load();}
  };

  const wapiConnection = useMemo(
    () =>
      connections.find(
        (row) => row.channel === 'whatsapp' && row.provider === 'wapi',
      ),
    [connections],
  );

  const telegramConnection = useMemo(
    () =>
      connections.find(
        (row) => row.channel === 'telegram' && row.provider === 'telegram-bot',
      ),
    [connections],
  );

  if (loading) {
    return (
      <div className="grid min-h-[70vh] place-items-center text-sm text-slate-500">
        Loading notification settings…
      </div>
    );
  }

  return (
    <main className="min-h-[calc(100vh-100px)] bg-[#fbfaff] p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-[1250px]">
        <header className="mb-7">
          <p className="text-[10px] font-bold uppercase tracking-[.18em] text-violet-600">
            Automation
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">
            Communications & Alerts
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-500">
            Configure WAPI WhatsApp, transactional SMS, Telegram and outgoing email. Credentials stay in Supabase Vault and are never returned here.
          </p>
        </header>

        {message && (
          <div className="mb-5 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-900">
            {message}
          </div>
        )}

<div className="mt-6 grid gap-6 lg:grid-cols-2"><section className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold">Transactional Bulk SMS</h2><p className="mt-1 text-xs text-slate-500">DLT templates for invoices and overdue reminders.</p></div><label className="flex items-center gap-2 text-xs font-semibold"><input type="checkbox" checked={sms.enabled} onChange={e=>setSms(v=>({...v,enabled:e.target.checked}))}/> Enabled</label></div><p className="mt-1 text-xs text-slate-500">Fast2SMS, MSG91, Textlocal or Generic HTTPS. Configure the merchant-approved DLT/Flow template ID where required.</p><div className="mt-4 grid gap-3"><select value={sms.provider} onChange={e=>setSms(v=>({...v,provider:e.target.value as SmsForm['provider']}))} className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm"><option value="fast2sms">Fast2SMS</option><option value="msg91">MSG91</option><option value="textlocal">Textlocal</option><option value="generic_http">Generic HTTP</option></select><input value={sms.sender} maxLength={6} onChange={e=>setSms(v=>({...v,sender:e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,'')}))} placeholder="6-character Sender ID" className="rounded-xl border border-slate-200 px-3 py-2.5"/><input value={sms.endpoint_url} onChange={e=>setSms(v=>({...v,endpoint_url:e.target.value}))} placeholder="Endpoint (optional)" className="rounded-xl border border-slate-200 px-3 py-2.5"/><div className="grid gap-3 md:grid-cols-2"><input value={sms.invoice_template_id} onChange={e=>setSms(v=>({...v,invoice_template_id:e.target.value}))} placeholder="DLT invoice template ID" className="rounded-xl border border-slate-200 px-3 py-2.5"/><input value={sms.reminder_template_id} onChange={e=>setSms(v=>({...v,reminder_template_id:e.target.value}))} placeholder="DLT overdue template ID" className="rounded-xl border border-slate-200 px-3 py-2.5"/></div><input value={sms.template_id} onChange={e=>setSms(v=>({...v,template_id:e.target.value}))} placeholder="Fallback / legacy template ID (optional)" className="rounded-xl border border-slate-200 px-3 py-2.5"/><input type="password" value={sms.secret} onChange={e=>setSms(v=>({...v,secret:e.target.value}))} placeholder="API key / auth secret" className="rounded-xl border border-slate-200 px-3 py-2.5" autoComplete="new-password"/><div className="flex gap-2"><button type="button" disabled={saving==='sms'} onClick={()=>save('sms')} className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white">{saving==='sms'?'Saving…':'Save SMS gateway'}</button><input value={testTargets.sms} onChange={e=>setTestTargets(v=>({...v,sms:e.target.value}))} placeholder="Test mobile" className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2.5 text-sm"/><button type="button" disabled={testingChannel==='sms'} onClick={()=>void sendTest('sms')} className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-semibold">{testingChannel==='sms'?'Testing…':'Send Test SMS'}</button></div></div></section><section className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold">Outgoing Email</h2><p className="mt-1 text-xs text-slate-500">Custom SMTP on SSL 465, Resend or SendGrid.</p></div><label className="flex items-center gap-2 text-xs font-semibold"><input type="checkbox" checked={smtp.enabled} onChange={e=>setSmtp(v=>({...v,enabled:e.target.checked}))}/> Enabled</label></div><p className="mt-1 text-xs text-slate-500">Use merchant SMTP or an API transport. Credentials remain in Supabase Vault.</p><div className="mt-4 grid gap-3"><select value={smtp.provider} onChange={e=>setSmtp(v=>({...v,provider:e.target.value as SmtpForm['provider']}))} className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm"><option value="smtp">Custom SMTP</option><option value="resend">Resend API</option><option value="sendgrid">SendGrid API</option></select>{smtp.provider==='smtp'&&<><div className="grid grid-cols-2 gap-3"><input value={smtp.host} onChange={e=>setSmtp(v=>({...v,host:e.target.value}))} placeholder="SMTP host" className="rounded-xl border border-slate-200 px-3 py-2.5"/><input type="number" value={smtp.port} readOnly={smtp.provider==='smtp'} onChange={e=>setSmtp(v=>({...v,port:e.target.value}))} placeholder="465" className="rounded-xl border border-slate-200 px-3 py-2.5"/></div><input value={smtp.username} onChange={e=>setSmtp(v=>({...v,username:e.target.value}))} placeholder="Username" className="rounded-xl border border-slate-200 px-3 py-2.5"/><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={smtp.secure} onChange={e=>setSmtp(v=>({...v,secure:e.target.checked}))}/> Secure TLS transport</label></>}{smtp.provider!=='smtp'&&<p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600">The API endpoint uses the provider default transport. For SendGrid or Resend, enter the API key below.</p>}<input value={smtp.from_email} onChange={e=>setSmtp(v=>({...v,from_email:e.target.value}))} placeholder="From email" className="rounded-xl border border-slate-200 px-3 py-2.5"/><input value={smtp.from_name} onChange={e=>setSmtp(v=>({...v,from_name:e.target.value}))} placeholder="From name" className="rounded-xl border border-slate-200 px-3 py-2.5"/><input type="password" value={smtp.password} onChange={e=>setSmtp(v=>({...v,password:e.target.value}))} placeholder={connections.some(r=>r.channel==='email'&&r.provider===smtp.provider)?'Leave blank to keep existing credential':'API key / SMTP password'} className="rounded-xl border border-slate-200 px-3 py-2.5" autoComplete="new-password"/><div className="flex gap-2"><button type="button" disabled={saving==='smtp'} onClick={()=>save('smtp')} className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white">{saving==='smtp'?'Saving…':'Save email transport'}</button><input value={testTargets.email} onChange={e=>setTestTargets(v=>({...v,email:e.target.value}))} placeholder="Test recipient email" className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2.5 text-sm"/><button type="button" disabled={testingChannel==='email'} onClick={()=>void sendTest('email')} className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-semibold">{testingChannel==='email'?'Testing…':'Send Test Email'}</button></div></div></section></div>        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-semibold">WhatsApp (WAPI)</h2>
                <p className="mt-1 text-xs text-slate-500">
                  One Wapi instance per business.
                </p>
              </div>
              <label className="mr-2 flex items-center gap-2 text-xs font-semibold"><input type="checkbox" checked={wapi.enabled} onChange={e=>setWapi(v=>({...v,enabled:e.target.checked}))}/> Enabled</label><label className="mr-2 flex items-center gap-2 text-xs font-semibold"><input type="checkbox" checked={telegram.enabled} onChange={e=>setTelegram(v=>({...v,enabled:e.target.checked}))}/> Enabled</label><span
                className={
                  'rounded-full px-3 py-1 text-xs font-semibold ' +
                  (wapiConnection?.health_status === 'healthy'
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'bg-amber-50 text-amber-700')
                }
              >
                {wapiConnection ? 'Configured' : 'Not configured'}
              </span>
            </div>
            <div className="mt-5 grid gap-3">
              <label className="text-xs font-semibold text-slate-600">
                Instance ID
                <input
                  value={wapi.external_instance_id}
                  onChange={(e) =>
                    setWapi((v) => ({
                      ...v,
                      external_instance_id: e.target.value,
                    }))
                  }
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5"
                  placeholder="Wapi instance ID"
                />
              </label>
              <label className="text-xs font-semibold text-slate-600">
                API URL
                <input
                  value={wapi.endpoint_url}
                  onChange={(e) =>
                    setWapi((v) => ({ ...v, endpoint_url: e.target.value }))
                  }
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5"
                  placeholder="https://..."
                />
              </label>
              <label className="text-xs font-semibold text-slate-600">
                API Key
                <input
                  type="password"
                  value={wapi.secret}
                  onChange={(e) =>
                    setWapi((v) => ({ ...v, secret: e.target.value }))
                  }
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5"
                  placeholder={
                    wapiConnection?.secret_ref
                      ? 'Leave blank to keep existing key'
                      : 'Wapi API key'
                  }
                  autoComplete="new-password"
                />
              </label>
              <button
                type="button"
                disabled={saving === 'wapi'}
                onClick={() => save('wapi')}
                className="rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                {saving === 'wapi'
                  ? 'Saving securely…'
                  : 'Save Wapi connection'}
              </button>
              <div className="flex gap-2"><input value={testTargets.whatsapp} onChange={e=>setTestTargets(v=>({...v,whatsapp:e.target.value}))} placeholder="Test mobile" className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2.5 text-sm"/><button type="button" disabled={testingChannel==='whatsapp'} onClick={()=>void sendTest('whatsapp')} className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-semibold">{testingChannel==='whatsapp'?'Testing…':'Send Test WhatsApp Message'}</button></div>
            </div>
            {wapiConnection?.last_error && (
              <p className="mt-3 rounded-xl bg-rose-50 p-3 text-xs text-rose-700">
                {wapiConnection.last_error}
              </p>
            )}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-semibold">Telegram Channel & Bot</h2>
                <p className="mt-1 text-xs text-slate-500">
                  Bot token stays in Vault; Chat ID is non-secret routing metadata.
                </p>
              </div>
              <span
                className={
                  'rounded-full px-3 py-1 text-xs font-semibold ' +
                  (telegramConnection?.health_status === 'healthy'
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'bg-amber-50 text-amber-700')
                }
              >
                {telegramConnection ? 'Configured' : 'Not configured'}
              </span>
            </div>
            <div className="mt-5 grid gap-3">
              <label className="text-xs font-semibold text-slate-600">
                Bot Token
                <input
                  type="password"
                  value={telegram.secret}
                  onChange={(e) =>
                    setTelegram((v) => ({ ...v, secret: e.target.value }))
                  }
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5"
                  placeholder={
                    telegramConnection?.secret_ref
                      ? 'Leave blank to keep existing token'
                      : 'Telegram bot token'
                  }
                  autoComplete="new-password"
                />
              </label>
              <label className="text-xs font-semibold text-slate-600">
                Default Chat ID
                <input
                  value={telegram.default_recipient}
                  onChange={(e) =>
                    setTelegram((v) => ({
                      ...v,
                      default_recipient: e.target.value,
                    }))
                  }
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5"
                  placeholder="123456789"
                />
              </label>
              <button
                type="button"
                disabled={saving === 'telegram'}
                onClick={() => save('telegram')}
                className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                {saving === 'telegram'
                  ? 'Saving securely…'
                  : 'Save Telegram connection'}
              </button>
              <div className="flex gap-2"><input value={testTargets.telegram} onChange={e=>setTestTargets(v=>({...v,telegram:e.target.value}))} placeholder="Test chat / group ID" className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2.5 text-sm"/><button type="button" disabled={testingChannel==='telegram'} onClick={()=>void sendTest('telegram')} className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-semibold">{testingChannel==='telegram'?'Testing…':'Send Test Bot Message'}</button></div>
            </div>
            {telegramConnection?.last_error && (
              <p className="mt-3 rounded-xl bg-rose-50 p-3 text-xs text-rose-700">
                {telegramConnection.last_error}
              </p>
            )}
          </section>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 p-5">
              <h2 className="font-semibold">Approved WhatsApp templates</h2>
              <p className="mt-1 text-xs text-slate-500">
                Existing template catalogue remains business-scoped.
              </p>
            </div>
            <div className="divide-y divide-slate-100">
              {templates.map((t) => (
                <div key={t.id} className="flex items-center gap-3 px-5 py-4">
                  <span className="grid h-9 w-9 place-items-center rounded-xl bg-violet-50 text-violet-700">
                    T
                  </span>
                  <span className="min-w-0 flex-1">
                    <b className="block truncate text-sm">{t.name}</b>
                    <span className="text-xs text-slate-400">
                      {t.event_type} · {t.language}
                    </span>
                  </span>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold text-slate-600">
                    {t.status}
                  </span>
                </div>
              ))}
              {!templates.length && (
                <div className="p-8 text-center text-sm text-slate-500">
                  No templates configured yet.
                </div>
              )}
            </div>
          </section>

          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 p-5">
              <h2 className="font-semibold">WhatsApp notification queue</h2>
              <p className="mt-1 text-xs text-slate-500">
                Delivery remains asynchronous and business-scoped.
              </p>
            </div>
            <div className="divide-y divide-slate-100">
              {jobs.slice(0, 12).map((j) => (
                <div key={j.id} className="px-5 py-4">
                  <div className="flex items-center gap-3">
                    <span className="min-w-0 flex-1">
                      <b className="block text-sm">
                        {j.event_type.replaceAll('_', ' ')}
                      </b>
                      <span className="text-xs text-slate-400">
                        {j.recipient} ·{' '}
                        {new Date(j.scheduled_for).toLocaleString('en-IN')}
                      </span>
                    </span>
                    <span
                      className={
                        'rounded-full px-2.5 py-1 text-[10px] font-semibold ' +
                        (j.status === 'delivered' || j.status === 'sent'
                          ? 'bg-emerald-50 text-emerald-700'
                          : j.status === 'failed'
                            ? 'bg-rose-50 text-rose-700'
                            : 'bg-violet-50 text-violet-700')
                      }
                    >
                      {j.status}
                    </span>
                  </div>
                  {j.last_error && (
                    <p className="mt-2 text-xs text-rose-600">{j.last_error}</p>
                  )}
                </div>
              ))}
              {!jobs.length && (
                <div className="p-8 text-center text-sm text-slate-500">
                  No WhatsApp notifications have been queued.
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}