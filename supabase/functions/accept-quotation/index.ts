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
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  try {
    const body = await req.json();
    const token = String(body.public_accept_token || "").trim();
    if (!token || token.length < 32) return json({ error: "Invalid quotation acceptance link" }, 400);

    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const url = Deno.env.get("SUPABASE_URL");
    if (!serviceKey || !url) return json({ error: "Acceptance service is not configured" }, 503);

    const admin = createClient(url, serviceKey);

    const { data: quote, error: quoteError } = await admin
      .rpc("get_public_quotation", { p_public_accept_token: token });

    if (quoteError || !quote) return json({ error: quoteError?.message || "Quotation not found" }, 404);

    const invoiceDate = new Date().toISOString().slice(0, 10);
    const { data: invoiceId, error: convertError } = await admin
      .rpc("convert_quotation_to_invoice", {
        p_quotation_id: quote.id,
        p_invoice_date: invoiceDate,
        p_due_date: null,
        p_public_accept_token: token,
      });

    if (convertError || !invoiceId) {
      return json({ error: convertError?.message || "Unable to create invoice from quotation" }, 409);
    }

    const { data: invoice, error: invoiceError } = await admin
      .from("invoices")
      .select("id,invoice_number,total,balance_due,currency_code,payment_display_mode,payment_bank_account_id,business_id")
      .eq("id", invoiceId)
      .single();

    if (invoiceError || !invoice) return json({ error: invoiceError?.message || "Invoice created but could not be loaded" }, 500);

    let paymentLink: any = null;

    if (invoice.payment_display_mode === "online" && Number(invoice.balance_due) > 0) {
      const { data: existing } = await admin
        .from("payment_links")
        .select("*")
        .eq("business_id", invoice.business_id)
        .eq("invoice_id", invoice.id)
        .in("status", ["created", "paid", "partially_paid"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existing?.short_url) {
        paymentLink = existing;
      } else {
        const key = Deno.env.get("RAZORPAY_KEY_ID");
        const secret = Deno.env.get("RAZORPAY_KEY_SECRET");
        if (!key || !secret) return json({ error: "Invoice created, but online payment is not configured" }, 503);

        const { data: customer } = await admin
          .from("customers")
          .select("display_name,email,phone")
          .eq("id", quote.customer?.id || "")
          .eq("business_id", invoice.business_id)
          .maybeSingle();

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
            name: customer?.display_name || quote.customer?.display_name || "Customer",
            contact: customer?.phone || quote.customer?.phone || undefined,
            email: customer?.email || quote.customer?.email || undefined,
          },
          notify: { sms: false, email: false },
          reminder_enable: false,
          notes: { business_id: invoice.business_id, invoice_id: invoice.id },
        };

        const basic = btoa(`${key}:${secret}`);
        const razorpayResponse = await fetch("https://api.razorpay.com/v1/payment_links", {
          method: "POST",
          headers: {
            Authorization: `Basic ${basic}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        const razorpayJson = await razorpayResponse.json();
        if (!razorpayResponse.ok) {
          return json({ error: razorpayJson?.error?.description || "Online payment link creation failed" }, 502);
        }

        const { data: link, error: linkError } = await admin
          .from("payment_links")
          .insert({
            business_id: invoice.business_id,
            invoice_id: invoice.id,
            provider: "razorpay",
            provider_link_id: razorpayJson.id,
            short_url: razorpayJson.short_url,
            amount: Number(invoice.balance_due),
            currency_code: invoice.currency_code || "INR",
            status: "created",
            expires_at: new Date(expires * 1000).toISOString(),
            metadata: { reference_id: invoice.invoice_number },
            created_by: null,
          })
          .select("*")
          .single();

        if (linkError) return json({ error: linkError.message }, 500);

        await admin
          .from("invoices")
          .update({ payment_link: razorpayJson.short_url, payment_qr_payload: razorpayJson.short_url })
          .eq("id", invoice.id)
          .eq("business_id", invoice.business_id);

        paymentLink = link;
      }
    }

    let bankDetails: any = null;
    if (invoice.payment_display_mode === "bank" && invoice.payment_bank_account_id) {
      const { data: bank } = await admin
        .from("bank_accounts")
        .select("name,institution_name,account_holder_name,ifsc_code,branch_name,account_type,currency_code,account_last4")
        .eq("id", invoice.payment_bank_account_id)
        .eq("business_id", invoice.business_id)
        .eq("is_active", true)
        .maybeSingle();
      bankDetails = bank || null;
    }

    return json({
      success: true,
      quotation_id: quote.id,
      quotation_number: quote.quotation_number,
      invoice_id: invoice.id,
      invoice_number: invoice.invoice_number,
      payment_display_mode: invoice.payment_display_mode || "none",
      payment_link: paymentLink?.short_url || null,
      bank_details: bankDetails,
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unexpected error" }, 500);
  }
});
