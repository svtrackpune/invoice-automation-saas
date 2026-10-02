import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { StripePaymentAdapter } from '@/lib/server/payments/stripe';

export const runtime = 'nodejs';

const json = (body: unknown, status = 200) => NextResponse.json(body, { status });

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
    const invoiceId = String(body.invoice_id || '');
    const mode = body.mode === 'payment_intent' ? 'payment_intent' : 'checkout';
    if (!invoiceId) return json({ error: 'invoice_id is required' }, 400);

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: invoice, error: invoiceError } = await admin
      .from('invoices')
      .select('id,invoice_number,customer_id,total,balance_due,currency_code,status,journal_entry_id')
      .eq('id', invoiceId)
      .eq('business_id', context.business_id)
      .single();

    if (invoiceError || !invoice) return json({ error: 'Invoice not found' }, 404);
    if (!invoice.journal_entry_id || ['void','draft'].includes(String(invoice.status))) {
      return json({ error: 'Invoice must be posted before creating a payment session' }, 409);
    }
    if (Number(invoice.balance_due) <= 0) return json({ error: 'Invoice has no outstanding balance' }, 400);

    const { data: existing } = await admin
      .from('payment_links')
      .select('*')
      .eq('business_id', context.business_id)
      .eq('invoice_id', invoice.id)
      .eq('provider', 'stripe')
      .in('status', ['creating','created','paid','partially_paid'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing?.short_url && mode === 'checkout') return json({ payment_session: existing });

    const customer = invoice.customer_id
      ? (await admin.from('customers').select('display_name,email').eq('id', invoice.customer_id).eq('business_id', context.business_id).maybeSingle()).data
      : null;

    const adapter = new StripePaymentAdapter();
    const requestedAmount = Number(invoice.balance_due);
    const reservationId = crypto.randomUUID();

    const session = await adapter.createPaymentSession({
      businessId: context.business_id,
      invoiceId: invoice.id,
      amount: requestedAmount,
      currency: invoice.currency_code,
      successUrl: String(body.success_url || new URL('/next-workspace/payments?stripe=success', req.url).toString()),
      cancelUrl: String(body.cancel_url || new URL('/next-workspace/payments?stripe=cancelled', req.url).toString()),
      description: `Invoice ${invoice.invoice_number}`,
      customerEmail: customer?.email || null,
      mode,
      metadata: { moneymatters_payment_link_id: reservationId },
    });

    const { data: link, error: linkError } = await admin.from('payment_links').insert({
      id: reservationId,
      business_id: context.business_id,
      invoice_id: invoice.id,
      provider: 'stripe',
      provider_link_id: session.providerReference,
      amount: requestedAmount,
      currency_code: invoice.currency_code,
      status: 'created',
      short_url: session.checkoutUrl || null,
      expires_at: null,
      created_by: user.id,
      metadata: {
        mode,
        payment_intent_id: session.paymentIntentId || null,
        moneymatters_payment_link_id: reservationId,
      },
    }).select('*').single();

    if (linkError || !link) return json({ error: linkError?.message || 'Stripe payment session registration failed' }, 500);

    return json({
      payment_session: {
        ...session,
        payment_link_id: link.id,
        payment_link: link,
      },
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Unexpected error' }, 500);
  }
}
