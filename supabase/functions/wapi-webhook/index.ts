import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { admin, type NotificationChannel } from "../_shared/tenant-notifications.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

type WebhookPayload = Record<string, unknown>;

function pickString(payload: WebhookPayload, keys: string[]) {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function nestedString(payload: WebhookPayload, paths: string[][]) {
  for (const path of paths) {
    let current: unknown = payload;
    for (const key of path) {
      if (!current || typeof current !== "object") {
        current = null;
        break;
      }
      current = (current as Record<string, unknown>)[key];
    }
    if (typeof current === "string" && current.trim()) return current.trim();
  }
  return null;
}

function mapStatus(payload: WebhookPayload) {
  const raw = (
    pickString(payload, ["status", "event", "event_type"]) ||
    nestedString(payload, [
      ["data", "status"],
      ["data", "event"],
      ["message", "status"],
    ]) ||
    ""
  ).toLowerCase();

  if (raw.includes("deliver")) return "delivered";
  if (raw.includes("fail") || raw.includes("error")) return "failed";
  return "sent";
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  try {
    const payloadValue: unknown = await req.json();

    if (
      !payloadValue ||
      typeof payloadValue !== "object" ||
      Array.isArray(payloadValue)
    ) {
      return json({ error: "Invalid webhook payload" }, 400);
    }

    const payload = payloadValue as WebhookPayload;
    const instanceId =
      pickString(payload, ["instance_id", "instanceId"]) ||
      nestedString(payload, [
        ["instance", "id"],
        ["data", "instance_id"],
        ["data", "instanceId"],
      ]);

    const providerMessageId =
      pickString(payload, ["provider_message_id", "message_id", "messageId"]) ||
      nestedString(payload, [
        ["data", "provider_message_id"],
        ["data", "message_id"],
        ["message", "id"],
        ["data", "id"],
      ]);

    if (!instanceId || !providerMessageId) {
      return json(
        { error: "Webhook instance or message identifier is missing" },
        400,
      );
    }

    const { data: connection, error: connectionError } = await admin
      .from("business_notification_connections")
      .select("id,business_id,channel,provider,external_instance_id")
      .eq("channel", "whatsapp")
      .eq("provider", "wapi")
      .eq("external_instance_id", instanceId)
      .eq("enabled", true)
      .maybeSingle();

    if (
      connectionError ||
      !connection ||
      connection.channel !== ("whatsapp" as NotificationChannel) ||
      connection.provider !== "wapi"
    ) {
      return json({ error: "Unknown Wapi instance" }, 404);
    }

    const { data: resolved, error: resolveError } = await admin.rpc(
      "resolve_business_notification_connection",
      {
        p_business_id: connection.business_id,
        p_channel: "whatsapp",
        p_external_instance_id: instanceId,
      },
    );

    if (
      resolveError ||
      !resolved ||
      typeof resolved !== "object" ||
      typeof resolved.secret !== "string" ||
      !resolved.secret
    ) {
      return json({ error: "Webhook credential validation failed" }, 401);
    }

    const authorization = req.headers.get("authorization") || "";
    const supplied =
      req.headers.get("x-wapi-api-key") ||
      authorization.replace(/^Bearer\s+/i, "");

    if (!supplied || supplied !== resolved.secret) {
      return json({ error: "Unauthorized webhook" }, 401);
    }

    const { data: job, error: jobError } = await admin
      .from("notification_jobs")
      .select("id,business_id,metadata,provider_message_id")
      .eq("business_id", connection.business_id)
      .eq("provider_message_id", providerMessageId)
      .maybeSingle();

    if (jobError) throw jobError;
    if (!job) return json({ ok: true, matched: false });

    const status = mapStatus(payload);
    const metadata = {
      ...(job.metadata as Record<string, unknown>),
      webhook_event: {
        instance_id: instanceId,
        provider_message_id: providerMessageId,
        status,
        received_at: new Date().toISOString(),
      },
    };

    const { error: updateError } = await admin
      .from("notification_jobs")
      .update({
        status,
        metadata,
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id)
      .eq("business_id", connection.business_id);

    if (updateError) throw updateError;

    return json({ ok: true, matched: true, status });
  } catch (error) {
    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Webhook processing failed.",
      },
      500,
    );
  }
});