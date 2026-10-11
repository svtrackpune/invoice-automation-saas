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

type PublicDispatchContext = {
  document_type: string;
  document_id: string;
  document_number: string;
  document_date: string;
  due_date: string | null;
  valid_until: string | null;
  status: string;
  currency_code: string;
  total_amount: number;
  amount_paid: number;
  balance_due: number;
  customer_outstanding_balance: number | null;
  business_name: string;
  customer_name: string;
  business_tax_id: string | null;
  customer_tax_id: string | null;
  public_path: string;
  pdf_path: string;
  public_url: string;
  pdf_url: string;
};

const PUBLIC_BASE_URL = (Deno.env.get("MONEYMATTERS_PUBLIC_URL") || "https://mm.nilanga.in").replace(/\/+$/, "");
const htmlEscape = (value: unknown) => String(value ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
const markdownEscape = (value: unknown) => String(value ?? "").replace(/([_*\x60\[\]])/g,"\\$1");
function publicAbsolute(path: string | null | undefined) {
  if (!path) return null;
  const url = new URL(path, PUBLIC_BASE_URL);
  const base = new URL(PUBLIC_BASE_URL);
  if (url.protocol !== "https:" || url.origin !== base.origin) throw new Error("Public document URL must be HTTPS on the configured Moneymatters domain.");
  return url.toString();
}
function documentLabel(type: string) {
  if (type === "invoice") return "Tax Invoice";
  if (type === "quotation") return "Quotation";
  if (type === "challan") return "Delivery Challan";
  if (type === "receipt") return "Payment Receipt";
  return "Document";
}
function formatDocumentMoney(value: number, currency: string) {
  const code = /^[A-Z]{3}$/.test(String(currency || "").toUpperCase()) ? String(currency).toUpperCase() : "INR";
  try { return new Intl.NumberFormat("en-IN", {style:"currency",currency:code,maximumFractionDigits:2}).format(Number(value || 0)); }
  catch { return "INR " + Number(value || 0).toFixed(2); }
}
async function resolveDispatchContext(job: NotificationJob): Promise<PublicDispatchContext | null> {
  const metadata = job.metadata || {};
  if (job.notification_type === "manual_test" || metadata.test === true) return null;
  const rawType = typeof metadata.document_type === "string" ? metadata.document_type : job.notification_type === "receipt" ? "receipt" : job.invoice_id ? "invoice" : "";
  const type = rawType === "reminder" || rawType === "due_soon" || rawType === "overdue" ? "invoice"
    : rawType === "delivery_challan" ? "challan" : rawType;
  if (!["invoice","quotation","challan","receipt"].includes(type)) return null;
  const id = String(metadata.document_id || metadata.receipt_id || (type === "invoice" ? job.invoice_id || "" : ""));
  if (!id) return null;

  let receiptToken: string | null = null;
  if (type === "receipt" && job.action_url) {
    try {
      const url = new URL(job.action_url, PUBLIC_BASE_URL);
      receiptToken = url.searchParams.get("token");
      if (!receiptToken) receiptToken = url.pathname.match(/^\/receipt\/([A-Fa-f0-9]{48,128})\/?$/)?.[1] || null;
    } catch { receiptToken = null; }
  }

  const { data, error } = await admin.rpc("resolve_public_document_dispatch", {
    p_business_id: job.business_id,
    p_document_type: type,
    p_document_id: id,
    p_receipt_token: receiptToken,
  });
  if (error || !data || typeof data !== "object") throw new Error("Public document link resolution failed; delivery was not sent.");
  const row = data as Record<string, unknown>;
  const publicPath = String(row.public_path || "");
  const pdfPath = String(row.pdf_path || "");
  const publicUrl = publicAbsolute(publicPath);
  const pdfUrl = publicAbsolute(pdfPath);
  if (!publicUrl || !pdfUrl) throw new Error("Public document or PDF URL is missing.");
  return {
    document_type: String(row.document_type || type),
    document_id: String(row.document_id || id),
    document_number: String(row.document_number || ""),
    document_date: String(row.document_date || ""),
    due_date: row.due_date ? String(row.due_date) : null,
    valid_until: row.valid_until ? String(row.valid_until) : null,
    status: String(row.status || ""),
    currency_code: String(row.currency_code || "INR"),
    total_amount: Number(row.total_amount || 0),
    amount_paid: Number(row.amount_paid || 0),
    balance_due: Number(row.balance_due || 0),
    customer_outstanding_balance: metadata.customer_outstanding_balance === undefined || metadata.customer_outstanding_balance === null
      || !Number.isFinite(Number(metadata.customer_outstanding_balance))
      ? null : Number(metadata.customer_outstanding_balance),
    business_name: String(row.business_name || "Business"),
    customer_name: String(row.customer_name || "Customer"),
    business_tax_id: row.business_tax_id ? String(row.business_tax_id) : null,
    customer_tax_id: row.customer_tax_id ? String(row.customer_tax_id) : null,
    public_path: publicPath,
    pdf_path: pdfPath,
    public_url: publicUrl,
    pdf_url: pdfUrl,
  };
}
function documentSubject(doc: PublicDispatchContext) {
  return `${doc.business_name}: ${documentLabel(doc.document_type)} #${doc.document_number} (Amount: ${formatDocumentMoney(doc.total_amount,doc.currency_code)})`;
}
function documentPlainText(doc: PublicDispatchContext) {
  return [
    `${documentLabel(doc.document_type)} from ${doc.business_name}`,
    `Dear ${doc.customer_name},`,
    `${documentLabel(doc.document_type)} number: ${doc.document_number}`,
    `Date: ${doc.document_date}`,
    doc.due_date ? `Due date: ${doc.due_date}` : doc.valid_until ? `Valid until: ${doc.valid_until}` : "",
    `Total amount: ${formatDocumentMoney(doc.total_amount,doc.currency_code)}`,
    doc.document_type === "invoice" ? `Amount paid: ${formatDocumentMoney(doc.amount_paid,doc.currency_code)}` : "",
    doc.document_type === "invoice" ? `Balance due: ${formatDocumentMoney(doc.balance_due,doc.currency_code)}` : "",
    doc.document_type === "receipt" && doc.customer_outstanding_balance !== null
      ? `Customer outstanding balance: ${formatDocumentMoney(doc.customer_outstanding_balance,doc.currency_code)}` : "",
    `Status: ${doc.status.replace(/_/g," ")}`,
    `View document: ${doc.public_url}`,
    doc.business_tax_id ? `GSTIN / Tax ID: ${doc.business_tax_id}` : "",
    "Sent securely via Moneymatters FinOps. Join Moneymatters for free at https://mm.nilanga.in",
  ].filter(Boolean).join("\n");
}
function documentSmsText(doc: PublicDispatchContext) {
  const amount = `${String(doc.currency_code || "INR").toUpperCase()} ${Number(doc.total_amount || 0).toFixed(2)}`;
  const due = doc.document_type === "invoice" ? ` Balance due ${String(doc.currency_code || "INR").toUpperCase()} ${Number(doc.balance_due || 0).toFixed(2)}.`
    : doc.document_type === "receipt" && doc.customer_outstanding_balance !== null
      ? ` Customer outstanding ${String(doc.currency_code || "INR").toUpperCase()} ${Number(doc.customer_outstanding_balance).toFixed(2)}.` : "";
  return `${documentLabel(doc.document_type)} #${doc.document_number} from ${doc.business_name}. Amount ${amount}.${due} View: ${doc.public_url} - Moneymatters FinOps`;
}
function documentCaption(doc: PublicDispatchContext) {
  const caption = [
    `📄 *${markdownEscape(documentLabel(doc.document_type))} from ${markdownEscape(doc.business_name)}*`,
    "",
    `Hello ${markdownEscape(doc.customer_name)},`,
    "Please find attached your document details below:",
    "",
    `• *Document No:* ${markdownEscape(doc.document_number)}`,
    `• *Date:* ${markdownEscape(doc.document_date)}`,
    doc.due_date ? `• *Due Date:* ${markdownEscape(doc.due_date)}` : doc.valid_until ? `• *Valid Until:* ${markdownEscape(doc.valid_until)}` : "",
    `• *Total Amount:* ${markdownEscape(formatDocumentMoney(doc.total_amount,doc.currency_code))}`,
    doc.document_type === "invoice" ? `• *Balance Due:* ${markdownEscape(formatDocumentMoney(doc.balance_due,doc.currency_code))}` : "",
    doc.document_type === "receipt" && doc.customer_outstanding_balance !== null
      ? `• *Customer Outstanding Balance:* ${markdownEscape(formatDocumentMoney(doc.customer_outstanding_balance,doc.currency_code))}` : "",
    `• *Status:* ${markdownEscape(doc.status.replace(/_/g," "))}`,
    "",
    `🔗 View ${doc.document_type === "invoice" ? "& Pay " : ""}Online: ${doc.public_url}`,
    "",
    "──────────────",
    "⚡ _Sent via Moneymatters FinOps — Join Moneymatters for free at https://mm.nilanga.in_",
  ].filter(Boolean).join("\n");
  return caption.length <= 1000 ? caption : caption.slice(0,900) + "\n" + doc.public_url;
}
function buildDocumentEmailHtml(input: { businessName: string; docType: string; docNumber: string; totalAmount: string; publicUrl: string; customerName: string; customerOutstandingBalance?: string | null }) {
  const label = documentLabel(input.docType);
  return `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a"><div style="max-width:640px;margin:24px auto;background:#fff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden"><div style="padding:24px 28px;background:#312e81;color:#fff"><div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;opacity:.85">${htmlEscape(label)}</div><h1 style="font-size:22px;margin:8px 0">${htmlEscape(input.docNumber)}</h1><div>${htmlEscape(input.businessName)}</div></div><div style="padding:24px 28px"><p>Dear ${htmlEscape(input.customerName)},</p><p>Your ${htmlEscape(label.toLowerCase())} is ready. A PDF copy is attached for your records.</p><p><strong>Total amount:</strong> ${htmlEscape(input.totalAmount)}</p>${input.docType === "receipt" && input.customerOutstandingBalance ? `<p><strong>Customer outstanding balance:</strong> ${htmlEscape(input.customerOutstandingBalance)}</p>` : ""}<p><a href="${htmlEscape(input.publicUrl)}">View document online</a></p><div style="margin-top:32px;padding-top:16px;border-top:1px solid #e2e8f0;text-align:center;font-size:12px;color:#64748b">Sent securely via <strong>Moneymatters</strong> FinOps.<br/><a href="https://mm.nilanga.in" style="color:#4f46e5;font-weight:600;text-decoration:none">Join Moneymatters for free</a> to automate invoicing, inventory &amp; GST.</div></div></div></body></html>`;
}
function documentHtml(doc: PublicDispatchContext) {
  const rows: Array<[string,string]> = [
    ["Document number",doc.document_number],["Date",doc.document_date],
    ...(doc.due_date ? [["Due date",doc.due_date] as [string,string]] : doc.valid_until ? [["Valid until",doc.valid_until] as [string,string]] : []),
    ["Total amount",formatDocumentMoney(doc.total_amount,doc.currency_code)],
    ...(doc.document_type === "invoice" ? [["Amount paid",formatDocumentMoney(doc.amount_paid,doc.currency_code)] as [string,string],["Balance due",formatDocumentMoney(doc.balance_due,doc.currency_code)] as [string,string]] : []),
    ...(doc.document_type === "receipt" && doc.customer_outstanding_balance !== null
      ? [["Customer outstanding balance",formatDocumentMoney(doc.customer_outstanding_balance,doc.currency_code)] as [string,string]] : []),
    ["Status",doc.status.replace(/_/g," ")],
  ];
  const tr = rows.map(([label,value]) => `<tr><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;color:#64748b">${htmlEscape(label)}</td><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font-weight:600;color:#0f172a;text-align:right">${htmlEscape(value)}</td></tr>`).join("");
  return `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a"><div style="max-width:640px;margin:24px auto;background:#fff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden"><div style="padding:24px 28px;background:#312e81;color:#fff"><div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;opacity:.85">${htmlEscape(documentLabel(doc.document_type))}</div><h1 style="font-size:22px;margin:8px 0">${htmlEscape(doc.document_number)}</h1><div>${htmlEscape(doc.business_name)}</div></div><div style="padding:24px 28px"><p>Dear ${htmlEscape(doc.customer_name)},</p><p>Your ${htmlEscape(documentLabel(doc.document_type).toLowerCase())} is ready. A PDF copy is attached for your records.</p><table style="width:100%;border-collapse:collapse;background:#f8fafc">${tr}</table><p style="margin:24px 0"><a href="${htmlEscape(doc.public_url)}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:700">View ${doc.document_type === "invoice" ? "and Pay Invoice" : "Document"} Online</a></p><hr style="border:0;border-top:1px solid #e2e8f0;margin:24px 0"/><p style="font-size:12px;color:#64748b;text-align:center">Sent securely via <strong>Moneymatters</strong> FinOps. <a href="https://mm.nilanga.in" style="color:#4f46e5;text-decoration:none">Join Moneymatters for free</a> to create, track, and automate your invoices.</p></div></div></body></html>`;
}
async function fetchDocumentPdf(doc: PublicDispatchContext) {
  const response = await fetch(doc.pdf_url,{headers:{Accept:"application/pdf"}});
  if(!response.ok)throw new Error("Document PDF could not be generated for email attachment.");
  if(!(response.headers.get("content-type")||"").toLowerCase().includes("application/pdf"))throw new Error("Document PDF endpoint did not return a PDF.");
  if(Number(response.headers.get("content-length")||0)>10*1024*1024)throw new Error("Document PDF exceeds the 10 MB email attachment limit.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if(!bytes.length||bytes.length>10*1024*1024)throw new Error("Document PDF is empty or exceeds the 10 MB email attachment limit.");
  return bytes;
}
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
  }
  return btoa(binary);
}
function attachmentFilename(doc: PublicDispatchContext) {
  const kind=doc.document_type==="invoice"?"Invoice":doc.document_type==="quotation"?"Quotation":doc.document_type==="challan"?"Delivery-Challan":"Receipt";
  const no=doc.document_number.replace(/[^A-Za-z0-9._-]+/g,"-").slice(0,90)||doc.document_id;
  return `${kind}_${no}.pdf`;
}

async function send(
  connection: TenantNotificationConnection,
  job: NotificationJob,
  dispatch: PublicDispatchContext | null,
) {
  const actionUrl = dispatch?.public_url || absoluteUrl(job.action_url);
  const message = dispatch ? (job.channel === "sms" ? documentSmsText(dispatch) : documentPlainText(dispatch)) : job.message;
  const subject = dispatch ? documentSubject(dispatch) : job.subject || "Notification";

  if (connection.provider === "wapi") {
    const configured = connection.endpoint_url?.replace(/\/+$/, "");
    if (!configured || !connection.secret) throw new Error("Wapi connection is incomplete.");
    const endpointBase = configured.replace(/\/message\/sendText\/?$/,"");
    if (dispatch?.pdf_url && !connection.external_instance_id) throw new Error("Wapi document delivery requires the configured instance ID.");
    const isDocument = Boolean(dispatch?.pdf_url);
    const url = isDocument
      ? endpointBase + "/message/sendMedia/" + encodeURIComponent(String(connection.external_instance_id))
      : endpointBase + "/message/sendText";
    const pdfBytes = isDocument ? await fetchDocumentPdf(dispatch!) : null;
    const body = isDocument
      ? { number:job.recipient,mediatype:"document",mimetype:"application/pdf",caption:documentCaption(dispatch!),media:bytesToBase64(pdfBytes!),fileName:attachmentFilename(dispatch!),type:"document",filename:attachmentFilename(dispatch!) }
      : { number:job.recipient,text:message+(actionUrl && dispatch===null ? "\n\n"+actionUrl : "") };
    const response = await fetch(url,{method:"POST",headers:{Authorization:"Bearer "+connection.secret,"Content-Type":"application/json"},body:JSON.stringify(body)});
    if(!response.ok)throw new Error("Wapi delivery failed.");
    const payload:unknown=await response.json().catch(()=>null);
    if(!payload||typeof payload!=="object")return null;
    const record=payload as Record<string,unknown>;
    const key=record.key&&typeof record.key==="object" ? record.key as Record<string,unknown> : {};
    const id=record.message_id??record.id??key.id;
    return typeof id==="string"||typeof id==="number"?String(id):null;
  }

  if (connection.provider === "telegram-bot") {
    if (!connection.secret) throw new Error("Telegram connection is incomplete.");
    let endpoint: string;
    let body: Record<string,unknown> = {};
    let multipart: FormData | null = null;
    if(dispatch?.pdf_url){
      endpoint="https://api.telegram.org/bot"+connection.secret+"/sendDocument";
      multipart = new FormData();
      multipart.set("chat_id", job.recipient);
      multipart.set("caption", documentCaption(dispatch));
      multipart.set("parse_mode", "Markdown");
      multipart.set("document", new Blob([await fetchDocumentPdf(dispatch)], { type: "application/pdf" }), attachmentFilename(dispatch));
    }else{
      const label="View document";
      const plainText=actionUrl?message+"\n\n"+label:message;
      const entities=actionUrl?[{type:"text_link",offset:plainText.length-label.length,length:label.length,url:actionUrl}]:undefined;
      endpoint="https://api.telegram.org/bot"+connection.secret+"/sendMessage";
      body={chat_id:job.recipient,text:plainText,...(entities?{entities}:{}),disable_web_page_preview:true};
    }
    const response=await fetch(endpoint,multipart
      ? {method:"POST",body:multipart}
      : {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
    const payload:unknown=await response.json().catch(()=>null);
    if(!response.ok||!payload||typeof payload!=="object"||(payload as Record<string,unknown>).ok!==true)throw new Error("Telegram delivery failed.");
    const result=(payload as Record<string,unknown>).result;
    if(!result||typeof result!=="object")return null;
    const id=(result as Record<string,unknown>).message_id;
    return typeof id==="string"||typeof id==="number"?String(id):null;
  }

  if (connection.provider === "resend") {
    if (!connection.secret || !connection.sender) throw new Error("Email connection is incomplete.");
    const endpoint = connection.endpoint_url?.replace(/\/+$/, "") || "https://api.resend.com";
    const attachments = dispatch ? [{ filename: attachmentFilename(dispatch), content: bytesToBase64(await fetchDocumentPdf(dispatch)), content_type: "application/pdf" }] : [];
    const textBody = dispatch ? documentPlainText(dispatch) : message + (actionUrl ? "\n\n" + actionUrl : "");
    const htmlBody = dispatch ? buildDocumentEmailHtml({ businessName: dispatch.business_name, docType: dispatch.document_type,
      docNumber: dispatch.document_number, totalAmount: formatDocumentMoney(dispatch.total_amount, dispatch.currency_code),
      publicUrl: dispatch.public_url, customerName: dispatch.customer_name,
      customerOutstandingBalance: dispatch.document_type === "receipt" && dispatch.customer_outstanding_balance !== null
        ? formatDocumentMoney(dispatch.customer_outstanding_balance, dispatch.currency_code) : null }) : undefined;
    const response = await fetch(endpoint + "/emails", { method: "POST",
      headers: { Authorization: "Bearer " + connection.secret, "Content-Type": "application/json",
        "Idempotency-Key": job.delivery_idempotency_key || "notification-job:" + job.id },
      body: JSON.stringify({ from: connection.sender, to: [job.recipient], subject, text: textBody,
        ...(htmlBody ? { html: htmlBody } : {}), ...(attachments.length ? { attachments } : {}) }) });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok || !payload || typeof payload !== "object") throw new Error("Email delivery failed.");
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
      Body: message + (actionUrl && dispatch === null ? " " + actionUrl : ""),
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
      ? connection.config.variables_values.replaceAll("{message}", message).replaceAll("{action_url}", actionUrl || "").replaceAll("{recipient}", job.recipient)
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
      body:JSON.stringify({template_id:templateId,recipients:[{mobiles:job.recipient.replace(/\D/g,""),VAR1:message,...(actionUrl?{VAR2:actionUrl}:{})}]})});
    const payload:unknown=await response.json().catch(()=>null);
    if(!response.ok)throw new Error("MSG91 delivery failed.");
    const record=payload&&typeof payload==="object"?payload as Record<string,unknown>:{};
    return typeof record.request_id==="string"?record.request_id:null;
  }

  if (connection.provider === "textlocal") {
    const endpoint=connection.endpoint_url?.trim()||"https://api.textlocal.in/send/";
    if(!connection.secret||!connection.sender)throw new Error("Textlocal configuration is incomplete.");
    const body=new URLSearchParams({apiKey:connection.secret,numbers:job.recipient.replace(/\D/g,""),sender:connection.sender,message:message+(actionUrl&&dispatch===null?" "+actionUrl:"")});
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
      body:JSON.stringify({phone:job.recipient,message:message+(actionUrl&&dispatch===null?" "+actionUrl:""),sender_id:connection.sender||null,notification_type:job.notification_type})});
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
    const attachments = dispatch ? [{filename:attachmentFilename(dispatch),content:await fetchDocumentPdf(dispatch),contentType:"application/pdf"}] : [];
    const textBody = dispatch ? documentPlainText(dispatch) : message + (actionUrl ? "\n\n" + actionUrl : "");
    const htmlBody = dispatch ? documentHtml(dispatch) : undefined;
    const result=await transporter.sendMail({
      from:fromName?fromName+" <"+connection.sender+">":connection.sender,
      to:job.recipient,subject,text:textBody,...(htmlBody?{html:htmlBody}:{}),
      ...(attachments.length?{attachments}:{}),
      headers:job.delivery_idempotency_key?{"X-Moneymatters-Delivery-Key":job.delivery_idempotency_key}:undefined
    });
    return typeof result.messageId==="string"?result.messageId:null;
  }

  if (connection.provider === "sendgrid") {
    if (!connection.secret || !connection.sender) throw new Error("SendGrid connection is incomplete.");
    const attachments = dispatch ? [{ content: Buffer.from(await fetchDocumentPdf(dispatch)).toString("base64"),
      filename: attachmentFilename(dispatch), type: "application/pdf", disposition: "attachment" }] : [];
    const textBody = dispatch ? documentPlainText(dispatch) : message + (actionUrl ? "\n\n" + actionUrl : "");
    const htmlBody = dispatch ? buildDocumentEmailHtml({ businessName: dispatch.business_name, docType: dispatch.document_type,
      docNumber: dispatch.document_number, totalAmount: formatDocumentMoney(dispatch.total_amount, dispatch.currency_code),
      publicUrl: dispatch.public_url, customerName: dispatch.customer_name,
      customerOutstandingBalance: dispatch.document_type === "receipt" && dispatch.customer_outstanding_balance !== null
        ? formatDocumentMoney(dispatch.customer_outstanding_balance, dispatch.currency_code) : null }) : undefined;
    const response = await fetch(connection.endpoint_url?.trim() || "https://api.sendgrid.com/v3/mail/send", {
      method: "POST", headers: { Authorization: "Bearer " + connection.secret, "Content-Type": "application/json" },
      body: JSON.stringify({ personalizations: [{ to: [{ email: job.recipient }] }], from: { email: connection.sender },
        subject: dispatch ? documentSubject(dispatch) : job.subject || "Notification",
        content: [{ type: "text/plain", value: textBody }, ...(htmlBody ? [{ type: "text/html", value: htmlBody }] : [])],
        ...(attachments.length ? { attachments } : {}) }) });
    if (!response.ok) throw new Error("SendGrid delivery failed.");
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

        const dispatch = await resolveDispatchContext(job);
        const deliveryJob = dispatch
          ? { ...job, message: documentPlainText(dispatch), subject: documentSubject(dispatch), action_url: dispatch.public_url }
          : job;
        const providerId = await send(connection, deliveryJob, dispatch);
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