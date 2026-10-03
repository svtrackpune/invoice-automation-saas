import { createClient } from "npm:@supabase/supabase-js@2";

export type NotificationChannel = "whatsapp" | "telegram" | "email" | "sms";

export type TenantNotificationConnection = {
  id: string;
  business_id: string;
  channel: NotificationChannel;
  provider: "wapi" | "telegram-bot" | "resend" | "smtp" | "twilio";
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
  health_status: "healthy" | "degraded" | "failing";
  config: Record<string, unknown>;
};

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

export async function resolveTenantConnection(
  businessId: string,
  channel: NotificationChannel,
  externalInstanceId?: string | null,
): Promise<TenantNotificationConnection | null> {
  const { data, error } = await admin.rpc("resolve_business_notification_connection", {
    p_business_id: businessId,
    p_channel: channel,
    p_external_instance_id: externalInstanceId ?? null,
  });

  if (error) throw new Error("Notification connection resolution failed.");
  return (data ?? null) as TenantNotificationConnection | null;
}

export function absoluteUrl(actionUrl: string | null | undefined) {
  if (!actionUrl) return null;
  const base = (Deno.env.get("MONEYMATTERS_PUBLIC_URL") || "").replace(/\/+$/, "");
  if (!base) throw new Error("Public application URL is not configured.");
  return base + (actionUrl.startsWith("/") ? actionUrl : "/" + actionUrl);
}

export async function connectionCandidates(
  businessId: string,
  attempted: NotificationChannel[],
) {
  const order: NotificationChannel[] = ["whatsapp", "email", "sms", "telegram"];
  const candidates: TenantNotificationConnection[] = [];

  for (const channel of order) {
    if (attempted.includes(channel)) continue;
    const connection = await resolveTenantConnection(businessId, channel);
    if (
      connection?.enabled &&
      connection.health_status !== "failing" &&
      connection.secret
    ) {
      candidates.push(connection);
    }
  }

  return candidates.sort((a, b) => a.priority - b.priority);
}

export { admin };