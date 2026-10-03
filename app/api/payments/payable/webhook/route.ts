import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { PayablePaymentAdapter } from '@/lib/server/payments/payable';

export const runtime = 'nodejs';

const json = (body: unknown, status = 200) => NextResponse.json(body, { status });
const SUCCESS_STATUSES = new Set(['paid', 'success', 'succeeded', 'completed', 'captured', 'successful']);

export async function POST(req: Request) {
  const adapter = new PayablePaymentAdapter();
  let verified: Awaited<ReturnType<PayablePaymentAdapter['verifyWebhook']>>;

  try {
    verified = await adapter.verifyWebhook(req);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Invalid webhook' }, 401);
  }

  let payload;
  try {
    payload = adapter.normalizeWebhookPayload(verified.event, verified.signature);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Invalid webhook payload' }, 400);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return json({ error: 'Payment service is not configured' }, 503);

  const admin = createClient(supabaseUrl, serviceRoleKey);

  try {
    const { data: claimed, error: claimError } = await admin.rpc('claim_payment_webhook_event', {
      p_provider: 'payable',
      p_event_id: payload.eventId,
      p_event_type: payload.eventType,
      p_signature: verified.signature,
      p_payload: verified.event,
    });
    if (claimError) throw claimError;
    if (!claimed) return json({ ok: true, duplicate: true });

    const { data: link, error: linkError } = await admin
      .from('payment_links')
      .select('id,business_id,invoice_id,status,provider_link_id,amount,currency_code')
      .eq('provider', 'payable')
      .eq('provider_link_id', payload.providerLinkId)
      .single();

    if (linkError || !link) {
      await admin.from('payment_webhook_events').update({
        status: 'ignored',
        processed_at: new Date().toISOString(),
        error_message: 'Payable payment session is not registered',
      }).eq('event_id', payload.eventId).eq('provider', 'payable');
      return json({ ok: true, ignored: true });
    }

    if (!SUCCESS_STATUSES.has(payload.status || '')) {
      await admin.from('payment_webhook_events').update({
        status: 'processed',
        processed_at: new Date().toISOString(),
        error_message: null,
      }).eq('event_id', payload.eventId).eq('provider', 'payable');
      return json({ ok: true, ignored: true, status: payload.status });
    }

    if (payload.currency !== String(link.currency_code).toUpperCase()) {
      throw new Error('Payable webhook currency does not match the payment link currency');
    }
    if (payload.amount > Number(link.amount) + 0.000001) {
      throw new Error('Payable webhook amount exceeds the payment link amount');
    }

    const { error: settlementError } = await admin.rpc('record_gateway_payment', {
      p_provider: 'payable',
      p_provider_link_id: payload.providerLinkId,
      p_provider_transaction_id: payload.providerTransactionId,
      p_event_id: payload.eventId,
      p_gross_amount: payload.amount,
      p_fee_amount: payload.feeAmount ?? 0,
      p_net_amount: payload.netAmount ?? payload.amount,
      p_payment_date: payload.paymentDate,
      p_notes: payload.notes,
    });
    if (settlementError) throw settlementError;

    await admin.from('payment_links').update({
      status: 'paid',
      gateway_transaction_id: payload.providerTransactionId,
      updated_at: new Date().toISOString(),
      metadata: { provider_event_id: payload.eventId, ...payload.metadata },
    }).eq('id', link.id).eq('business_id', link.business_id);

    await admin.from('payment_webhook_events').update({
      status: 'processed',
      processed_at: new Date().toISOString(),
      error_message: null,
    }).eq('event_id', payload.eventId).eq('provider', 'payable');

    return json({ ok: true });
  } catch (error) {
    await admin.from('payment_webhook_events').update({
      status: 'failed',
      processed_at: new Date().toISOString(),
      error_message: error instanceof Error ? error.message : 'Processing failed',
    }).eq('event_id', payload.eventId).eq('provider', 'payable');
    return json({ error: error instanceof Error ? error.message : 'Webhook processing failed' }, 500);
  }
}
