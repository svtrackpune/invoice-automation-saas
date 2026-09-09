import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

async function sendEmail(job: any) {
  const key = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("RESEND_FROM_EMAIL");
  if (!key || !from) throw new Error("Email provider is not configured");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [job.recipient], subject: job.subject || "Notification", text: job.message }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.message || "Email delivery failed");
  return data?.id || null;
}

async function sendWhatsApp(job: any) {
  const token = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
  const phoneId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  if (!token || !phoneId) throw new Error("WhatsApp provider is not configured");
  const response = await fetch("https://graph.facebook.com/v23.0/" + phoneId + "/messages", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp", to: job.recipient, type: "text",
      text: { preview_url: Boolean(job.action_url), body: job.action_url ? job.message + "\n\n" + job.action_url : job.message },
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
  const body = new URLSearchParams({
    To: job.recipient, From: from, Body: job.action_url ? job.message + " " + job.action_url : job.message,
  });
  const response = await fetch("https://api.twilio.com/2010-04-01/Accounts/" + sid + "/Messages.json", {
    method: "POST",
    headers: { Authorization: "Basic " + btoa(sid + ":" + token), "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.message || "SMS delivery failed");
  return data?.sid || null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  try {
    const { data: jobs, error } = await admin.rpc("claim_notification_jobs", { p_limit: 20 });
    if (error) throw error;
    let sent = 0, failed = 0;
    for (const job of jobs || []) {
      try {
        let providerId: string | null = null;
        switch (String(job.channel).toLowerCase()) {
          case "email": providerId = await sendEmail(job); break;
          case "whatsapp": providerId = await sendWhatsApp(job); break;
          case "sms": providerId = await sendSms(job); break;
          default: throw new Error("Unsupported notification channel: " + job.channel);
        }
        await admin.from("notification_jobs").update({
          status: "sent", sent_at: new Date().toISOString(), provider_message_id: providerId,
          last_error: null, updated_at: new Date().toISOString(),
        }).eq("id", job.id);
        sent++;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Notification delivery failed";
        const terminal = Number(job.attempts) >= 5;
        await admin.from("notification_jobs").update({
          status: terminal ? "failed" : "queued", last_error: message, updated_at: new Date().toISOString(),
        }).eq("id", job.id);
        failed++;
      }
    }
    return json({ ok: true, claimed: (jobs || []).length, sent, failed });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Notification worker failed" }, 500);
  }
});