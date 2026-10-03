import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { PayablePaymentAdapter } from '@/lib/server/payments/payable';

export const runtime = 'nodejs';

const json = (body: unknown, status = 200) => NextResponse.json(body, { status });

const isSafeRedirect = (value: unknown, origin: string, fallbackPath: string): string => {
  if (typeof value !== 'string' || !value.trim()) return new URL(fallbackPath, origin).toString();
  const candidate = new URL(value, origin);
  if (candidate.origin !== origin || !['http:', 'https:'].includes(candidate.protocol)) {
    throw new Error('Redirect URL must use the MoneyMatters origin');
  }
  return candidate.toString();
};

export async function POST(req: Request) {
  try {
    const authorization = req.headers.get('authorization');
    if (!authorization) return json({ error: 'Authorization required' }, 401);

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !publishableKey || !serviceRoleKey) return json({ error: 'Payment service is not configured' }, 503);

    const userClient = createClient(supabaseUrl, publishableKey, {
      global: { headers: { Authorization: authorization } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: 'Unauthorized' }, 401);

    const { data: contexts, error: contextError } = await userClient.rpc('get_my_business_context');
    const context = contexts?.[0];
    if (contextError || !context) return json({ error: contextError?.message || 'Business context not found' }, 403);

    const body = await req.json();
    const invoiceId = typeof body.invoice_id === 'string' ? body.invoice_id : '';
    const paymentLinkId = typeof body.payment_link_id === 'string' ? body.payment_link_id : '';
    if (!invoiceId && !paymentLinkId) return json({ error: 'invoice_id or payment_link_id is required' }, 400);

    const admin = createClient(supabaseUrl, serviceRoleKey);
    let link: Record<string, any> | null = null;

    if (paymentLinkId) {
      const { data, error } = await admin.from('payment_links')
        .select('*')
        .eq('id', paymentLinkId)
        .eq('business_id', context.business_id)
        .eq('provider', 'payable')
        .maybeSingle();

      if (error) return json({ error: error.message }, 500);
      if (!data) return json({ error: 'Payable payment link not found' }, 404);
      link = data;

      if (link.short_url && ['created', 'paid', 'partially_paid'].includes(String(link.status))) {
        return json({ payment_session: link });
      }
    }

    const targetInvoiceId = invoiceId || String(link?.invoice_id || '');
    if (!targetInvoiceId) return json({ error: 'invoice_id is required for this payment link' }, 400);

    const { data: invoice, error: invoiceError } = await admin.from('invoices')
      .select('id,invoice_number,customer_id,total,balance_due,currency_code,status,journal_entry_id')
      .eq('id', targetInvoiceId)
      .eq('business_id', context.business_id)
      .single();

    if (invoiceError || !invoice) return json({ error: 'Invoice not found' }, 404);
    if (!invoice.journal_entry_id || ['void', 'draft'].includes(String(invoice.status))) {
      return json({ error: 'Invoice must be posted before creating a payment session' }, 409);
    }
    if (Number(invoice.balance_due) <= 0) return json({ error: 'Invoice has no outstanding balance' }, 400);

    if (!link) {
      const { data: existing, error: existingError } = await admin.from('payment_links')
        .select('*')
        .eq('business_id', context.business_id)
        .eq('invoice_id', invoice.id)
        .eq('provider', 'payable')
        .in('status', ['creating', 'created', 'paid', 'partially_paid'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingError) return json({ error: existingError.message }, 500);
      link = existing;
      if (existing?.short_url) return json({ payment_session: existing });
    }

    const customer = invoice.customer_id
      ? (await admin.from('customers')
        .select('display_name,email,phone')
        .eq('id', invoice.customer_id)
        .eq('business_id', context.business_id)
        .maybeSingle()).data
      : null;

    const origin = new URL(req.url).origin;
    const callbackUrl = isSafeRedirect(
      body.callback_url || body.success_url,
      origin,
      '/next-workspace/payments?payable=success',
    );
    const cancelUrl = isSafeRedirect(
      body.cancel_url,
      origin,
      '/next-workspace/payments?payable=cancelled',
    );
    const webhookUrl = new URL('/api/payments/payable/webhook', origin).toString();

    const localLinkId = link?.id || crypto.randomUUID();
    const compactId = localLinkId.replaceAll('-', '').slice(0, 8);
    const orderId = 'MM-' + String(invoice.invoice_number).slice(0, 40) + '-' + compactId;

    const adapter = new PayablePaymentAdapter();
    const paymentSession = await adapter.createPaymentSession({
      businessId: context.business_id,
      invoiceId: invoice.id,
      amount: Number(invoice.balance_due),
      currency: invoice.currency_code,
      successUrl: callbackUrl,
      cancelUrl,
      callbackUrl,
      webhookUrl,
      customerEmail: customer?.email || null,
      customerPhone: customer?.phone || null,
      description: 'Invoice ' + invoice.invoice_number,
      orderId,
      metadata: {
        moneymatters_business_id: context.business_id,
        moneymatters_invoice_id: invoice.id,
        moneymatters_payment_link_id: localLinkId,
      },
    });

    const { data: savedLink, error: saveError } = await admin.from('payment_links').upsert({
      id: localLinkId,
      business_id: context.business_id,
      invoice_id: invoice.id,
      provider: 'payable',
      provider_link_id: paymentSession.providerReference,
      amount: Number(invoice.balance_due),
      currency_code: invoice.currency_code,
      status: 'created',
      short_url: paymentSession.checkoutUrl || null,
      expires_at: null,
      created_by: user.id,
      metadata: {
        order_id: orderId,
        provider: 'payable',
        ...(paymentSession.metadata || {}),
      },
    }, { onConflict: 'id' }).select('*').single();

    if (saveError || !savedLink) {
      return json({ error: saveError?.message || 'Payable payment-link registration failed' }, 500);
    }

    await admin.from('invoices').update({
      payment_link: paymentSession.checkoutUrl || null,
      payment_qr_payload: paymentSession.checkoutUrl || null,
    }).eq('id', invoice.id).eq('business_id', context.business_id);

    return json({
      payment_session: {
        ...paymentSession,
        payment_link_id: savedLink.id,
        payment_link: savedLink,
      },
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Unexpected error' }, 500);
  }
}
