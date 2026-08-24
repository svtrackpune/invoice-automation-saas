import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

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
      .select("id,invoice_number,customer_id,total,balance_due,currency_code,status")
      .eq("id", invoiceId)
      .eq("business_id", businessId)
      .single();

    if (invoiceError || !invoice) return json({ error: "Invoice not found" }, 404);
    if (Number(invoice.balance_due) <= 0) return json({ error: "Invoice has no outstanding balance" }, 400);
    if (invoice.status === "void") return json({ error: "Cannot create a payment link for a void invoice" }, 400);

    const { data: existing } = await admin
      .from("payment_links")
      .select("*")
      .eq("business_id", businessId)
      .eq("invoice_id", invoice.id)
      .in("status", ["created", "paid", "partially_paid"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing?.short_url) {
      await admin
        .from("invoices")
        .update({ payment_link: existing.short_url, payment_qr_payload: existing.short_url })
        .eq("id", invoice.id)
        .eq("business_id", businessId);
      return json({ payment_link: existing });
    }

    const { data: customer } = await admin
      .from("customers")
      .select("display_name,email,phone")
      .eq("id", invoice.customer_id)
      .eq("business_id", businessId)
      .single();

    const key = Deno.env.get("RAZORPAY_KEY_ID");
    const secret = Deno.env.get("RAZORPAY_KEY_SECRET");
    if (!key || !secret) return json({ error: "Razorpay credentials are not configured" }, 503);

    const amount = Math.round(Number(invoice.balance_due) * 100);
    const expires = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
    const payload = {
      amount,
      currency: invoice.currency_code || "INR",
      accept_partial: true,
      first_min_partial_amount: 100,
      expire_by: expires,
      reference_id: invoice.invoice_number,
      description: `Payment for invoice ${invoice.invoice_number}`,
      customer: {
        name: customer?.display_name || "Customer",
        contact: customer?.phone || undefined,
        email: customer?.email || undefined,
      },
      notify: { sms: false, email: false },
      reminder_enable: false,
      notes: { business_id: businessId, invoice_id: invoice.id },
    };

    const token = btoa(`${key}:${secret}`);
    const razorpayResponse = await fetch("https://api.razorpay.com/v1/payment_links", {
      method: "POST",
      headers: {
        Authorization: `Basic ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const razorpayJson = await razorpayResponse.json();
    if (!razorpayResponse.ok) {
      return json({ error: razorpayJson?.error?.description || "Razorpay payment link creation failed" }, 502);
    }

    const { data: link, error: linkError } = await admin
      .from("payment_links")
      .insert({
        business_id: businessId,
        invoice_id: invoice.id,
        provider: "razorpay",
        provider_link_id: razorpayJson.id,
        short_url: razorpayJson.short_url,
        amount: Number(invoice.balance_due),
        currency_code: invoice.currency_code || "INR",
        status: "created",
        expires_at: new Date(expires * 1000).toISOString(),
        metadata: { reference_id: invoice.invoice_number },
        created_by: user.id,
      })
      .select("*")
      .single();

    if (linkError) return json({ error: linkError.message }, 500);

    await admin
      .from("invoices")
      .update({ payment_link: razorpayJson.short_url, payment_qr_payload: razorpayJson.short_url })
      .eq("id", invoice.id)
      .eq("business_id", businessId);

    await admin.rpc("enqueue_payment_link_notification", {
      p_business_id: businessId,
      p_payment_link_id: link.id,
    });

    return json({ payment_link: link });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unexpected error" }, 500);
  }
});