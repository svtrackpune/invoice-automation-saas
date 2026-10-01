import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(supabaseUrl, serviceKey);
const publicAppUrl = (Deno.env.get("MONEYMATTERS_PUBLIC_URL") || "").replace(/\/$/, "");

function absoluteUrl(value: string | null | undefined) {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  if (!publicAppUrl) throw new Error("MONEYMATTERS_PUBLIC_URL is required for document delivery.");
  return publicAppUrl + (value.startsWith("/") ? value : "/" + value);
}

function receiptFilename(job: any) {
  const supplied = String(job?.metadata?.attachment_filename || "").trim();
  if (supplied) return supplied.replace(/[^a-zA-Z0-9._-]+/g, "-");
  const number = String(job?.metadata?.receipt_number || "receipt").trim();
  return `receipt-${number.replace(/[^a-zA-Z0-9._-]+/g, "-")}.pdf`;
}

async function fetchPdfBase64(url: string) {
  const response = await fetch(url, { headers: { Accept: "application/pdf" } });
  if (!response.ok) throw new Error(`Receipt PDF endpoint returned HTTP ${response.status}.`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function sendEmail(job: any) {
  const key = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("RESEND_FROM_EMAIL");
  if (!key || !from) throw new Error("Email provider is not configured");

  const attachment = job.metadata?.attachment_type === "receipt_pdf" && job.action_url
    ? {
        filename: receiptFilename(job),
        content: await fetchPdfBase64(absoluteUrl(job.action_url)!),
      }
    : null;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
      "Idempotency-Key": `notification-job/${job.id}`,
    },
    body: JSON.stringify({
      from,
      to: [job.recipient],
      subject: job.subject || "Notification",
      text: job.message,
      ...(attachment ? { attachments: [attachment] } : {}),
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.message || "Email delivery failed");
  return data?.id || null;
}

async function sendWhatsApp(job: any) {
  const token = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
  const phoneId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  if (!token || !phoneId) throw new Error("WhatsApp provider is not configured");

  const documentUrl = job.metadata?.attachment_type === "receipt_pdf" && job.action_url
    ? absoluteUrl(job.action_url)
    : null;
  const response = await fetch("https://graph.facebook.com/v23.0/" + phoneId + "/messages", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify(documentUrl ? {
      messaging_product: "whatsapp",
      to: job.recipient,
      type: "document",
      document: {
        link: documentUrl,
        filename: receiptFilename(job),
        caption: job.message,
      },
    } : {
      messaging_product: "whatsapp",
      to: job.recipient,
      type: "text",
      text: {
        preview_url: Boolean(job.action_url),
        body: job.action_url ? job.message + "\n\n" + absoluteUrl(job.action_url) : job.message,
      },
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || "WhatsApp delivery failed");
  return data?.messages?.[0]?.id || null;
}

async function sendSms(job: any) {
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const token = Deno.env.get("TWILIO_AUTH_TOKEN");
  const from = Deno.env.get("TWILIO_FROM_NUMBER");
  if (!sid || !token || !from) throw new Error("SMS provider is not configured");

  const link = job.action_url ? absoluteUrl(job.action_url) : null;
  const body = new URLSearchParams({
    To: job.recipient,
    From: from,
    Body: link ? job.message + " " + link : job.message,
  });
  const response = await fetch("https://api.twilio.com/2010-04-01/Accounts/" + sid + "/Messages.json", {
    method: "POST",
    headers: {
      Authorization: "Basic " + btoa(sid + ":" + token),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.message || "SMS delivery failed");
  return data?.sid || null;
}

async function sendTelegram(job: any) {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!token) throw new Error("Telegram provider is not configured");

  const documentUrl = job.metadata?.attachment_type === "receipt_pdf" && job.action_url
    ? absoluteUrl(job.action_url)
    : null;
  const endpoint = `https://api.telegram.org/bot${token}/${documentUrl ? "sendDocument" : "sendMessage"}`;
  const body = documentUrl
    ? {
        chat_id: job.recipient,
        document: documentUrl,
        caption: job.message,
      }
    : {
        chat_id: job.recipient,
        text: job.action_url ? job.message + "\n\n" + absoluteUrl(job.action_url) : job.message,
      };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok || data?.ok !== true) {
    throw new Error(data?.description || "Telegram delivery failed");
  }
  return data?.result?.message_id ? String(data.result.message_id) : null;
}

function retryDelayMs(attempt: number) {
  return Math.min(60 * 60 * 1000, Math.max(60 * 1000, 2 ** Math.max(attempt - 1, 0) * 60 * 1000));
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  try {
    const { data: jobs, error } = await admin.rpc("claim_notification_jobs", { p_limit: 20 });
    if (error) throw error;

    let sent = 0;
    let failed = 0;

    for (const job of jobs || []) {
      try {
        let providerId: string | null = null;
        switch (String(job.channel).toLowerCase()) {
          case "email":
            providerId = await sendEmail(job);
            break;
          case "whatsapp":
            providerId = await sendWhatsApp(job);
            break;
          case "sms":
            providerId = await sendSms(job);
            break;
          case "telegram":
            providerId = await sendTelegram(job);
            break;
          default:
            throw new Error("Unsupported notification channel: " + job.channel);
        }

        await admin.from("notification_jobs").update({
          status: "sent",
          sent_at: new Date().toISOString(),
          provider_message_id: providerId,
          last_error: null,
          updated_at: new Date().toISOString(),
        }).eq("id", job.id);

        sent++;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Notification delivery failed";
        const attempts = Number(job.attempts) || 1;
        const terminal = attempts >= 5;

        await admin.from("notification_jobs").update({
          status: terminal ? "failed" : "queued",
          scheduled_for: terminal
            ? job.scheduled_for
            : new Date(Date.now() + retryDelayMs(attempts)).toISOString(),
          last_error: message,
          updated_at: new Date().toISOString(),
        }).eq("id", job.id);

        failed++;
      }
    }

    return json({ ok: true, claimed: (jobs || []).length, sent, failed });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Notification worker failed" }, 500);
  }
});
