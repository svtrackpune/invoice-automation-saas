'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, type BusinessContext } from '@/lib/supabase';

type Connection = {
  id: string;
  channel: 'whatsapp' | 'telegram' | 'email' | 'sms';
  provider: 'wapi' | 'telegram-bot' | 'resend' | 'smtp' | 'twilio';
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

const emptyWapi = {
  id: '',
  endpoint_url: '',
  external_instance_id: '',
  secret: '',
  display_name: 'Business Wapi',
  enabled: true,
};

const emptyTelegram = {
  id: '',
  secret: '',
  default_recipient: '',
  display_name: 'Business Telegram',
  enabled: true,
};

export default function WhatsApp() {
  const [ctx, setCtx] = useState<BusinessContext | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [wapi, setWapi] = useState(emptyWapi);
  const [telegram, setTelegram] = useState(emptyTelegram);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<'wapi' | 'telegram' | null>(null);
  const [message, setMessage] = useState('');

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
          'id,channel,provider,display_name,endpoint_url,external_instance_id,sender,default_recipient,enabled,health_status,last_health_check_at,last_error,secret_ref',
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

    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (channel: 'wapi' | 'telegram') => {
    if (!ctx) return;

    setSaving(channel);
    setMessage('');

    const isWapi = channel === 'wapi';
    const current = isWapi ? wapi : telegram;

    if (
      isWapi &&
      (!current.endpoint_url.trim() ||
        !current.external_instance_id.trim() ||
        (!current.secret.trim() && !current.id))
    ) {
      setMessage('Wapi requires API URL, Instance ID and API Key on first setup.');
      setSaving(null);
      return;
    }

    if (!isWapi && !current.secret.trim() && !current.id) {
      setMessage('Telegram Bot Token is required on first setup.');
      setSaving(null);
      return;
    }

    const result = await supabase.rpc('save_business_notification_connection', {
      p_business_id: ctx.business_id,
      p_channel: isWapi ? 'whatsapp' : 'telegram',
      p_provider: isWapi ? 'wapi' : 'telegram-bot',
      p_display_name: current.display_name.trim(),
      p_connection_id: current.id || null,
      p_endpoint_url: isWapi ? current.endpoint_url.trim() : null,
      p_external_instance_id: isWapi
        ? current.external_instance_id.trim()
        : null,
      p_secret: current.secret.trim() || null,
      p_sender: null,
      p_default_recipient: isWapi
        ? null
        : current.default_recipient.trim() || null,
      p_priority: 1,
      p_failover_group: 'customer-delivery',
      p_enabled: current.enabled,
      p_config: {},
    });

    setMessage(
      result.error
        ? result.error.message
        : isWapi
          ? 'Wapi connection saved securely.'
          : 'Telegram connection saved securely.',
    );
    setSaving(null);

    if (!result.error) {
      if (isWapi) {
        setWapi((value) => ({ ...value, secret: '' }));
      } else {
        setTelegram((value) => ({ ...value, secret: '' }));
      }
      await load();
    }
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
            WhatsApp & Telegram
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-500">
            Configure tenant-specific messaging connections. Credentials are
            sent to a Vault RPC and are never stored in application columns or
            returned to this page.
          </p>
        </header>

        {message && (
          <div className="mb-5 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-900">
            {message}
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-semibold">Wapi WhatsApp</h2>
                <p className="mt-1 text-xs text-slate-500">
                  One Wapi instance per business.
                </p>
              </div>
              <span
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
                <h2 className="font-semibold">Telegram Bot</h2>
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