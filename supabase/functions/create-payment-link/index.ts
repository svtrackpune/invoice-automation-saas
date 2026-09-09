import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const BILLABLE_STATUSES = ["sent", "posted", "partially_paid", "overdue"] as const;
const ACTIVE_LINK_STATUSES = ["creating", "created", "paid", "partially_paid"] as const;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "Authorization required" }, 401);

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json();
    const invoiceId = String(body.invoice_id || "");
    if (!invoiceId) return json({ error: "invoice_id is required" }, 400);

    const { data: ctx, error: contextError } = await userClient.rpc("get_my_business_context");
    if (contextError || !ctx?.[0]) {
      return json({ error: contextError?.message || "Business context not found" }, 403);
    }
    const businessId = ctx[0].business_id;

    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!serviceKey) return json({ error: "Payment service is not configured" }, 503);
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

    const { data: invoice, error: invoiceError } = await admin
      .from("invoices")
      .select("id,invoice_number,customer_id,total,balance_due,currency_code,status,journal_entry_id")
      .eq("id", invoiceId)
      .eq("business_id", businessId)
      .single();

    if (invoiceError || !invoice) return json({ error: "Invoice not found" }, 404);
    if (!BILLABLE_STATUSES.includes(String(invoice.status) as typeof BILLABLE_STATUSES[number])) {
      return json({ error: "Payment links require a posted or billable invoice" }, 409);
    }
    if (!invoice.journal_entry_id) {
      return json({ error: "Invoice must be posted before creating a payment link" }, 409);
    }
    if (Number(invoice.balance_due) <= 0) {
      return json({ error: "Invoice has no outstanding balance" }, 400);
    }

    const { data: existing } = await admin
      .from("payment_links")
      .select("*")
      .eq("business_id", businessId)
      .eq("invoice_id", invoice.id)
      .in("status", ACTIVE_LINK_STATUSES)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing?.short_url) {
      await admin.from("invoices").update({
        payment_link: existing.short_url,
        payment_qr_payload: existing.short_url,
      }).eq("id", invoice.id).eq("business_id", businessId);
      return json({ payment_link: existing });
    }

    if (existing?.status === "creating") {
      const ageMs = Date.now() - new Date(existing.created_at).getTime();
      if (ageMs < 10 * 60 * 1000) {
        return json({ error: "Payment link creation is already in progress. Please retry shortly." }, 409);
      }
      await admin.from("payment_links").update({
        status: "failed",
        metadata: { ...(existing.metadata || {}), error: "stale_creation_reservation" },
        updated_at: new Date().toISOString(),
      }).eq("id", existing.id).eq("business_id", businessId);
    }

    const customerResult = await admin
      .from("customers")
      .select("display_name,email,phone")
      .eq("id", invoice.customer_id)
      .eq("business_id", businessId)
      .single();
    const customer = customerResult.data;

    const key = Deno.env.get("RAZORPAY_KEY_ID");
    const secret = Deno.env.get("RAZORPAY_KEY_SECRET");
    if (!key || !secret) return json({ error: "Razorpay credentials are not configured" }, 503);

    // Reserve the local payment-link identity before calling Razorpay. This makes
    // concurrent requests deterministic and gives each Razorpay reference_id a
    // unique value, as required by Razorpay.
    const reservationId = crypto.randomUUID();
    const compactId = reservationId.replaceAll("-", "").slice(0, 8);
    const referenceId = `${String(invoice.invoice_number).slice(0, 30)}-${compactId}`;
    const amount = Math.round(Number(invoice.balance_due) * 100);
    if (!Number.isInteger(amount) || amount < 100) {
      return json({ error: "Invoice balance is below Razorpay's minimum payment-link amount" }, 400);
    }

    const expires = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
    const { data: reservation, error: reservationError } = await admin
      .from("payment_links")
      .insert({
        id: reservationId,
        business_id: businessId,
        invoice_id: invoice.id,
        provider: "razorpay",
        amount: Number(invoice.balance_due),
        currency_code: invoice.currency_code || "INR",
        status: "creating",
        created_by: user.id,
        metadata: { reference_id: referenceId, state: "creating" },
      })
      .select("*")
      .single();

    if (reservationError || !reservation) {
      const { data: concurrent } = await admin
        .from("payment_links")
        .select("*")
        .eq("business_id", businessId)
        .eq("invoice_id", invoice.id)
        .in("status", ACTIVE_LINK_STATUSES)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (concurrent?.short_url) return json({ payment_link: concurrent });
      return json({ error: reservationError?.message || "Unable to reserve payment link creation" }, 409);
    }

    const payload = {
      amount,
      currency: invoice.currency_code || "INR",
      accept_partial: true,
      first_min_partial_amount: Math.min(100, amount),
      expire_by: expires,
      reference_id: referenceId,
      description: `Payment for invoice ${invoice.invoice_number}`,
      customer: {
        name: customer?.display_name || "Customer",
        contact: customer?.phone || undefined,
        email: customer?.email || undefined,
      },
      notify: { sms: false, email: false },
      reminder_enable: false,
      notes: {
        business_id: businessId,
        invoice_id: invoice.id,
        payment_link_id: reservationId,
      },
    };

    const token = btoa(`${key}:${secret}`);
    const razorpayResponse = await fetch("https://api.razorpay.com/v1/payment_links", {
      method: "POST",
      headers: { Authorization: `Basic ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const razorpayJson = await razorpayResponse.json();

    if (!razorpayResponse.ok) {
      await admin.from("payment_links").update({
        status: "failed",
        metadata: {
          ...(reservation.metadata || {}),
          state: "failed",
          provider_error: razorpayJson?.error?.description || "Razorpay payment link creation failed",
        },
        updated_at: new Date().toISOString(),
      }).eq("id", reservationId).eq("business_id", businessId);
      return json({ error: razorpayJson?.error?.description || "Razorpay payment link creation failed" }, 502);
    }

    const { data: link, error: linkError } = await admin
      .from("payment_links")
      .update({
        provider_link_id: razorpayJson.id,
        short_url: razorpayJson.short_url,
        status: "created",
        expires_at: new Date(expires * 1000).toISOString(),
        metadata: {
          ...(reservation.metadata || {}),
          state: "created",
          provider_link_id: razorpayJson.id,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", reservationId)
      .eq("business_id", businessId)
      .select("*")
      .single();

    if (linkError || !link) {
      return json({ error: linkError?.message || "Payment link registration failed" }, 500);
    }

    await admin.from("invoices").update({
      payment_link: razorpayJson.short_url,
      payment_qr_payload: razorpayJson.short_url,
    }).eq("id", invoice.id).eq("business_id", businessId);

    const { error: notificationError } = await admin.rpc("enqueue_payment_link_notification", {
      p_business_id: businessId,
      p_payment_link_id: link.id,
    });

    if (notificationError) {
      // Payment-link creation remains successful; the notification worker can be
      // retried independently without rolling back a customer-facing payment URL.
      await admin.from("payment_links").update({
        metadata: {
          ...(link.metadata || {}),
          notification_enqueue_error: notificationError.message,
        },
        updated_at: new Date().toISOString(),
      }).eq("id", link.id).eq("business_id", businessId);
    }

    return json({ payment_link: link });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unexpected error" }, 500);
  }
});
