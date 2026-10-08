import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  absoluteUrl,
  admin,
  connectionCandidates,
  resolveTenantConnection,
  type NotificationChannel,
  type TenantNotificationConnection,
} from "../_shared/tenant-notifications.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

type NotificationJob = {
  id: string;
  business_id: string;
  customer_id: string | null;
  invoice_id: string | null;
  channel: NotificationChannel;
  notification_type: string;
  recipient: string;
  subject: string | null;
  message: string;
  action_url: string | null;
  scheduled_for: string;
  sent_at: string | null;
  status: string;
  attempts: number;
  last_error: string | null;
  provider_message_id: string | null;
  metadata: Record<string, unknown>;
  delivery_idempotency_key: string | null;
};

const retryDelayMs = (attempt: number) =>
  Math.min(
    60 * 60 * 1000,
    Math.max(60 * 1000, 2 ** Math.max(attempt - 1, 0) * 60 * 1000),
  );

function attemptedChannels(
  metadata: Record<string, unknown>,
  current: NotificationChannel,
) {
  const values = Array.isArray(metadata.attempted_channels)
    ? metadata.attempted_channels.filter(
        (value): value is NotificationChannel =>
          typeof value === "string" &&
          ["whatsapp", "telegram", "email", "sms"].includes(value),
      )
    : [];

  return Array.from(new Set([...values, current]));
}

async function send(
  connection: TenantNotificationConnection,
  job: NotificationJob,
) {
  const actionUrl = absoluteUrl(job.action_url);

  if (connection.provider === "wapi") {
    const endpoint = connection.endpoint_url?.replace(/\/+$/, "");
    if (!endpoint || !connection.secret) {
      throw new Error("Wapi connection is incomplete.");
    }

    const response = await fetch(endpoint + "/message/sendText", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + connection.secret,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        number: job.recipient,
        text: actionUrl
          ? job.message + "\n\n" + actionUrl
          : job.message,
      }),
    });

    if (!response.ok) throw new Error("Wapi delivery failed.");

    const payload: unknown = await response.json().catch(() => null);
    if (!payload || typeof payload !== "object") return null;

    const record = payload as Record<string, unknown>;
    const id = record.message_id ?? record.id;
    return typeof id === "string" || typeof id === "number"
      ? String(id)
      : null;
  }

  if (connection.provider === "telegram-bot") {
    if (!connection.secret) {
      throw new Error("Telegram connection is incomplete.");
    }

    const linkLabel = "View receipt";
    const text = actionUrl
      ? job.message + "\n\n" + linkLabel
      : job.message;

    const entities = actionUrl
      ? [{
          type: "text_link",
          offset: text.length - linkLabel.length,
          length: linkLabel.length,
          url: actionUrl,
        }]
      : undefined;

    const response = await fetch(
      "https://api.telegram.org/bot" + connection.secret + "/sendMessage",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: job.recipient,
          text,
          ...(entities ? { entities } : {}),
          disable_web_page_preview: true,
        }),
      },
    );

    const payload: unknown = await response.json().catch(() => null);
    if (
      !response.ok ||
      !payload ||
      typeof payload !== "object" ||
      (payload as Record<string, unknown>).ok !== true
    ) {
      throw new Error("Telegram delivery failed.");
    }

    const result = (payload as Record<string, unknown>).result;
    if (!result || typeof result !== "object") return null;

    const id = (result as Record<string, unknown>).message_id;
    return typeof id === "string" || typeof id === "number"
      ? String(id)
      : null;
  }

  if (connection.provider === "resend") {
    if (!connection.secret || !connection.sender) {
      throw new Error("Email connection is incomplete.");
    }

    const endpoint =
      connection.endpoint_url?.replace(/\/+$/, "") ||
      "https://api.resend.com";

    const response = await fetch(endpoint + "/emails", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + connection.secret,
        "Content-Type": "application/json",
        "Idempotency-Key":
          job.delivery_idempotency_key ||
          "notification-job:" + job.id,
      },
      body: JSON.stringify({
        from: connection.sender,
        to: [job.recipient],
        subject: job.subject || "Notification",
        text: actionUrl
          ? job.message + "\n\n" + actionUrl
          : job.message,
      }),
    });

    const payload: unknown = await response.json().catch(() => null);
    if (
      !response.ok ||
      !payload ||
      typeof payload !== "object"
    ) {
      throw new Error("Email delivery failed.");
    }

    const id = (payload as Record<string, unknown>).id;
    return typeof id === "string" ? id : null;
  }

  if (connection.provider === "twilio") {
    if (!connection.secret || !connection.sender) {
      throw new Error("SMS connection is incomplete.");
    }

    const accountSid = connection.config.account_sid;
    if (typeof accountSid !== "string" || !accountSid) {
      throw new Error("SMS account configuration is incomplete.");
    }

    const body = new URLSearchParams({
      To: job.recipient,
      From: connection.sender,
      Body: actionUrl
        ? job.message + " " + actionUrl
        : job.message,
    });

    const response = await fetch(
      "https://api.twilio.com/2010-04-01/Accounts/" +
        encodeURIComponent(accountSid) +
        "/Messages.json",
      {
        method: "POST",
        headers: {
          Authorization:
            "Basic " + btoa(accountSid + ":" + connection.secret),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      },
    );

    const payload: unknown = await response.json().catch(() => null);
    if (
      !response.ok ||
      !payload ||
      typeof payload !== "object"
    ) {
      throw new Error("SMS delivery failed.");
    }

    const sid = (payload as Record<string, unknown>).sid;
    return typeof sid === "string" ? sid : null;
  }


  if (connection.provider === "fast2sms") {
    const endpoint = connection.endpoint_url?.trim() || "https://www.fast2sms.com/dev/bulkV2";
    const templateId = typeof connection.config.template_id === "string"
      ? connection.config.template_id
      : typeof connection.config.invoice_template_id === "string" && job.notification_type === "invoice"
        ? connection.config.invoice_template_id
        : typeof connection.config.reminder_template_id === "string" && ["due_soon","overdue","reminder"].includes(job.notification_type)
          ? connection.config.reminder_template_id : null;
    if (!connection.secret || !connection.sender || !templateId) throw new Error("Fast2SMS DLT configuration is incomplete.");
    const variables = typeof connection.config.variables_values === "string"
      ? connection.config.variables_values.replaceAll("{message}", job.message).replaceAll("{action_url}", actionUrl || "").replaceAll("{recipient}", job.recipient)
      : job.message;
    const response = await fetch(endpoint, { method:"POST", headers:{Authorization:connection.secret,"Content-Type":"application/json"},
      body:JSON.stringify({route:"dlt",sender_id:connection.sender,message:templateId,variables_values:variables,numbers:job.recipient.replace(/\D/g,"").slice(-15)}) });
    const payload:unknown=await response.json().catch(()=>null);
    if(!response.ok)throw new Error("Fast2SMS delivery failed.");
    const record=payload&&typeof payload==="object"?payload as Record<string,unknown>:{};
    return typeof record.request_id==="string"?record.request_id:null;
  }

  if (connection.provider === "msg91") {
    const endpoint=connection.endpoint_url?.trim()||"https://control.msg91.com/api/v5/flow/";
    const templateId=typeof connection.config.template_id==="string"?connection.config.template_id
      : typeof connection.config.invoice_template_id==="string"&&job.notification_type==="invoice"?connection.config.invoice_template_id
      : typeof connection.config.reminder_template_id==="string"&&["due_soon","overdue","reminder"].includes(job.notification_type)?connection.config.reminder_template_id:null;
    if(!connection.secret||!templateId)throw new Error("MSG91 flow configuration is incomplete.");
    const response=await fetch(endpoint,{method:"POST",headers:{authkey:connection.secret,"Content-Type":"application/json"},
      body:JSON.stringify({template_id:templateId,recipients:[{mobiles:job.recipient.replace(/\D/g,""),VAR1:job.message,...(actionUrl?{VAR2:actionUrl}:{})}]})});
    const payload:unknown=await response.json().catch(()=>null);
    if(!response.ok)throw new Error("MSG91 delivery failed.");
    const record=payload&&typeof payload==="object"?payload as Record<string,unknown>:{};
    return typeof record.request_id==="string"?record.request_id:null;
  }

  if (connection.provider === "textlocal") {
    const endpoint=connection.endpoint_url?.trim()||"https://api.textlocal.in/send/";
    if(!connection.secret||!connection.sender)throw new Error("Textlocal configuration is incomplete.");
    const body=new URLSearchParams({apiKey:connection.secret,numbers:job.recipient.replace(/\D/g,""),sender:connection.sender,message:actionUrl?job.message+" "+actionUrl:job.message});
    const response=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body});
    const payload:unknown=await response.json().catch(()=>null);
    if(!response.ok)throw new Error("Textlocal delivery failed.");
    const record=payload&&typeof payload==="object"?payload as Record<string,unknown>:{},messages=record.messages;
    if(Array.isArray(messages)&&messages[0]&&typeof messages[0]==="object"){const id=(messages[0] as Record<string,unknown>).id;return typeof id==="string"?id:null;}
    return null;
  }

  if (connection.provider === "generic_http") {
    const endpoint=connection.endpoint_url?.trim();
    if(!endpoint||!/^https:\/\//i.test(endpoint))throw new Error("Generic HTTP gateway requires an HTTPS endpoint.");
    if(!connection.secret)throw new Error("Generic HTTP gateway secret is missing.");
    const headerName=typeof connection.config.auth_header_name==="string"?connection.config.auth_header_name:"Authorization";
    const authPrefix=typeof connection.config.auth_prefix==="string"?connection.config.auth_prefix:"Bearer ";
    const response=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json",[headerName]:authPrefix+connection.secret},
      body:JSON.stringify({phone:job.recipient,message:actionUrl?job.message+" "+actionUrl:job.message,sender_id:connection.sender||null,notification_type:job.notification_type})});
    if(!response.ok)throw new Error("Generic SMS gateway delivery failed.");
    const payload:unknown=await response.json().catch(()=>null);
    if(payload&&typeof payload==="object"){const record=payload as Record<string,unknown>,id=record.message_id??record.id??record.request_id;return typeof id==="string"||typeof id==="number"?String(id):null;}
    return null;
  }

  if (connection.provider === "smtp") {
    const host=connection.endpoint_url?.trim();
    if(!host||!connection.secret||!connection.sender)throw new Error("SMTP connection is incomplete.");
    const {default:nodemailer}=await import("npm:nodemailer");
    const port=Number(connection.config.port||465),secure=typeof connection.config.secure==="boolean"?connection.config.secure:true;
    const username=typeof connection.config.username==="string"?connection.config.username:connection.sender;
    const fromName=typeof connection.config.from_name==="string"?connection.config.from_name:"";
    const transporter=nodemailer.createTransport({host,port,secure,auth:{user:username,pass:connection.secret}});
    const result=await transporter.sendMail({from:fromName?fromName+" <"+connection.sender+">":connection.sender,to:job.recipient,subject:job.subject||"Notification",text:actionUrl?job.message+"\n\n"+actionUrl:job.message,headers:job.delivery_idempotency_key?{"X-Moneymatters-Delivery-Key":job.delivery_idempotency_key}:undefined});
    return typeof result.messageId==="string"?result.messageId:null;
  }

  if (connection.provider === "sendgrid") {
    if (!connection.secret || !connection.sender) throw new Error("SendGrid connection is incomplete.");
    const response=await fetch(connection.endpoint_url?.trim()||"https://api.sendgrid.com/v3/mail/send",{
      method:"POST",
      headers:{Authorization:"Bearer "+connection.secret,"Content-Type":"application/json"},
      body:JSON.stringify({personalizations:[{to:[{email:job.recipient}]}],from:{email:connection.sender},subject:job.subject||"Notification",
        content:[{type:"text/plain",value:actionUrl?job.message+"\n\n"+actionUrl:job.message}]}),
    });
    if(!response.ok)throw new Error("SendGrid delivery failed.");
    return response.headers.get("x-message-id");
  }

  throw new Error("Notification provider is not supported by this worker.");
}

async function markConnectionHealth(
  connectionId: string,
  healthStatus: "healthy" | "degraded" | "failing",
  lastError: string | null,
) {
  await admin
    .from("business_notification_connections")
    .update({
      health_status: healthStatus,
      last_health_check_at: new Date().toISOString(),
      last_error: lastError,
      updated_at: new Date().toISOString(),
    })
    .eq("id", connectionId);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return json({ error: "POST required" }, 405);
  }

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const requestedJobId = typeof body.job_id === "string" && body.job_id.trim()
      ? body.job_id.trim()
      : null;
    const { data: jobs, error } = requestedJobId
      ? await admin.rpc("claim_notification_job", { p_job_id: requestedJobId })
      : await admin.rpc("claim_notification_jobs", { p_limit: 20 });

    if (error) throw error;

    let sent = 0;
    let failed = 0;
    let failedOver = 0;

    for (const job of (jobs || []) as NotificationJob[]) {
      try {
        const connection = await resolveTenantConnection(
          job.business_id,
          job.channel,
        );

        if (!connection?.secret) {
          throw new Error(
            "No active tenant notification connection is configured.",
          );
        }

        const providerId = await send(connection, job);
        const attempt = Math.max(Number(job.attempts) || 1, 1);
        const metadata = {
          ...job.metadata,
          connection_id: connection.id,
          provider: connection.provider,
          delivery_idempotency_key: job.delivery_idempotency_key,
          delivery_attempt: attempt,
          attempted_channels: attemptedChannels(
            job.metadata,
            job.channel,
          ),
        };

        await admin
          .from("notification_jobs")
          .update({
            status: "sent",
            sent_at: new Date().toISOString(),
            provider_message_id: providerId,
            last_error: null,
            metadata,
            updated_at: new Date().toISOString(),
          })
          .eq("id", job.id)
          .eq("business_id", job.business_id);

        await markConnectionHealth(connection.id, "healthy", null);
        await admin.rpc("record_communication_dispatch_log",{p_business_id:job.business_id,p_document_type:String(job.metadata.document_type||job.notification_type||"invoice"),p_document_id:typeof job.metadata.document_id==="string"?job.metadata.document_id:job.invoice_id,p_customer_id:job.customer_id,p_channel:job.channel,p_recipient_target:job.recipient,p_payload_content:job.message,p_dispatch_status:"sent",p_error_message:null});
        sent++;
      } catch (deliveryError) {
        const message =
          deliveryError instanceof Error
            ? deliveryError.message
            : "Notification delivery failed.";

        const attempts = Math.max(Number(job.attempts) || 1, 1);
        const attempted = attemptedChannels(
          job.metadata,
          job.channel,
        );
        const key =
          job.delivery_idempotency_key ||
          (typeof job.metadata.idempotency_key === "string"
            ? job.metadata.idempotency_key
            : "notification-job:" + job.id);

        const failedConnection =
          await resolveTenantConnection(
            job.business_id,
            job.channel,
          );

        if (failedConnection) {
          await markConnectionHealth(
            failedConnection.id,
            attempts >= 3 ? "failing" : "degraded",
            "Notification delivery failed.",
          );
        }

        const candidates =
          attempts < 5
            ? await connectionCandidates(
                job.business_id,
                attempted,
              )
            : [];

        const fallback = candidates[0] || null;

        await admin.rpc("record_communication_dispatch_log",{p_business_id:job.business_id,p_document_type:String(job.metadata.document_type||job.notification_type||"invoice"),p_document_id:typeof job.metadata.document_id==="string"?job.metadata.document_id:job.invoice_id,p_customer_id:job.customer_id,p_channel:job.channel,p_recipient_target:job.recipient,p_payload_content:job.message,p_dispatch_status:"failed",p_error_message:message});

        if (fallback) {
          const nextMetadata = {
            ...job.metadata,
            delivery_idempotency_key: key,
            idempotency_key: key,
            delivery_attempt: attempts + 1,
            attempted_channels: Array.from(
              new Set([...attempted, fallback.channel]),
            ),
            connection_id: fallback.id,
            provider: fallback.provider,
          };

          await admin
            .from("notification_jobs")
            .update({
              channel: fallback.channel,
              recipient:
                fallback.default_recipient || job.recipient,
              status: "queued",
              scheduled_for: new Date().toISOString(),
              last_error: message,
              metadata: nextMetadata,
              updated_at: new Date().toISOString(),
            })
            .eq("id", job.id)
            .eq("business_id", job.business_id);

          failedOver++;
          continue;
        }

        const terminal = attempts >= 5;
        await admin
          .from("notification_jobs")
          .update({
            status: terminal ? "failed" : "queued",
            scheduled_for: terminal
              ? job.scheduled_for
              : new Date(
                  Date.now() + retryDelayMs(attempts),
                ).toISOString(),
            last_error: message,
            updated_at: new Date().toISOString(),
          })
          .eq("id", job.id)
          .eq("business_id", job.business_id);

        failed++;
      }
    }

    return json({
      ok: true,
      claimed: (jobs || []).length,
      sent,
      failed,
      failed_over: failedOver,
    });
  } catch (error) {
    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Notification worker failed.",
      },
      500,
    );
  }
});