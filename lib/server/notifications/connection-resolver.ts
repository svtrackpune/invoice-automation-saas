import { createClient } from '@supabase/supabase-js';

export type NotificationChannel = 'whatsapp' | 'telegram' | 'email' | 'sms';
export type TenantNotificationConnection = {
  id: string;
  business_id: string;
  channel: NotificationChannel;
  provider: 'wapi' | 'telegram-bot' | 'resend' | 'smtp' | 'sendgrid' | 'twilio' | 'fast2sms' | 'msg91' | 'textlocal' | 'generic_http';
  display_name: string;
  endpoint_url: string | null;
  external_instance_id: string | null;
  secret_ref: string | null;
  secret: string | null;
  sender: string | null;
  default_recipient: string | null;
  priority: number;
  failover_group: string | null;
  enabled: boolean;
  health_status: 'healthy' | 'degraded' | 'failing';
  config: Record<string, unknown>;
};

const getAdmin = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Server Supabase environment is not configured.');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
};

export async function resolveBusinessNotificationConnection(
  businessId: string,
  channel: NotificationChannel,
  externalInstanceId?: string | null,
): Promise<TenantNotificationConnection | null> {
  const db = getAdmin();
  const { data, error } = await db.rpc('resolve_business_notification_connection', {
    p_business_id: businessId,
    p_channel: channel,
    p_external_instance_id: externalInstanceId ?? null,
  });
  if (error) throw new Error('Notification connection resolution failed.');
  return (data ?? null) as TenantNotificationConnection | null;
}

export { getAdmin };