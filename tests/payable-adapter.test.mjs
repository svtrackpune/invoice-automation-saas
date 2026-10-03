import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const read = (p) => readFile(new URL(p, root), 'utf8');

const loadPayableModule = async () => {
  const source = await read('lib/server/payments/payable.ts');
  const sanitized = source.replace("import 'server-only';\n", '');
  const compiled = ts.transpileModule(sanitized, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
    fileName: 'payable.ts',
  }).outputText;
  const url = 'data:text/javascript;base64,' + Buffer.from(compiled, 'utf8').toString('base64');
  return import(url);
};

test('Payable session creation sends the required normalized payload', async () => {
  process.env.PAYABLE_API_KEY = 'test-api-key';
  process.env.PAYABLE_API_URL = 'https://payable.test/v1/sessions';

  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    calls.push({ input: String(input), init });
    return new Response(JSON.stringify({
      id: 'sess_123',
      checkout_url: 'https://checkout.test/sess_123',
      metadata: { provider: 'payable-test' },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const { PayablePaymentAdapter } = await loadPayableModule();
    const adapter = new PayablePaymentAdapter();
    const session = await adapter.createPaymentSession({
      businessId: 'business-1',
      invoiceId: 'invoice-1',
      orderId: 'ORDER-1001',
      amount: 1250.5,
      currency: 'inr',
      successUrl: 'https://mm.test/success',
      cancelUrl: 'https://mm.test/cancel',
      callbackUrl: 'https://mm.test/callback',
      webhookUrl: 'https://mm.test/api/payments/payable/webhook',
      description: 'Invoice 1001',
      customerEmail: 'customer@example.com',
      customerPhone: '+919999999999',
    });

    assert.equal(session.provider, 'payable');
    assert.equal(session.providerReference, 'sess_123');
    assert.equal(session.checkoutUrl, 'https://checkout.test/sess_123');
    assert.equal(calls.length, 1);

    const sent = JSON.parse(calls[0].init.body);
    assert.deepEqual({
      order_id: sent.order_id,
      amount: sent.amount,
      currency: sent.currency,
      customer_email: sent.customer_email,
      customer_phone: sent.customer_phone,
      callback_url: sent.callback_url,
      webhook_url: sent.webhook_url,
    }, {
      order_id: 'ORDER-1001',
      amount: 1250.5,
      currency: 'INR',
      customer_email: 'customer@example.com',
      customer_phone: '+919999999999',
      callback_url: 'https://mm.test/callback',
      webhook_url: 'https://mm.test/api/payments/payable/webhook',
    });

    assert.equal(calls[0].init.headers.Authorization, 'Bearer test-api-key');
    assert.equal(calls[0].init.cache, 'no-store');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Payable HMAC-SHA256 accepts a valid signature and rejects invalid, forged, and stale payloads', async () => {
  const { signPayableWebhook, verifyPayableWebhookPayload } = await loadPayableModule();
  const body = JSON.stringify({ event_id: 'evt_1', payment_id: 'pay_1', order_id: 'ORDER-1', status: 'success' });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const secret = 'test-secret';
  const valid = signPayableWebhook(timestamp, body, secret);

  assert.deepEqual(
    verifyPayableWebhookPayload(body, valid, secret, timestamp),
    JSON.parse(body),
  );

  assert.throws(
    () => verifyPayableWebhookPayload(body, valid.slice(0, -1) + (valid.endsWith('0') ? '1' : '0'), secret, timestamp),
    /Invalid Payable webhook signature/,
  );

  const forgedPayload = body.replace('"status":"success"', '"status":"failed"');
  const forgedSignature = createHmac('sha256', secret).update(timestamp + '.' + forgedPayload).digest('hex');
  assert.throws(
    () => verifyPayableWebhookPayload(body, forgedSignature, secret, timestamp),
    /Invalid Payable webhook signature/,
  );

  const stale = String(Math.floor(Date.now() / 1000) - 301);
  const staleSignature = signPayableWebhook(stale, body, secret);
  assert.throws(
    () => verifyPayableWebhookPayload(body, staleSignature, secret, stale),
    /Expired Payable webhook signature/,
  );
});

test('Payable webhook normalization preserves gross, fee, net, status, and identifiers', async () => {
  const { PayablePaymentAdapter } = await loadPayableModule();
  const adapter = new PayablePaymentAdapter();

  const payload = adapter.normalizeWebhookPayload({
    event_id: 'evt_100',
    payment_id: 'pay_100',
    order_id: 'ORDER-100',
    event_type: 'payment.succeeded',
    status: 'SUCCESS',
    gross_amount: '1000.00',
    fee_amount: '25.00',
    net_amount: '975.00',
    currency: 'INR',
    paid_at: '2026-10-03T10:20:30Z',
    metadata: { source: 'unit-test' },
  });

  assert.equal(payload.eventId, 'evt_100');
  assert.equal(payload.providerTransactionId, 'pay_100');
  assert.equal(payload.providerLinkId, 'ORDER-100');
  assert.equal(payload.amount, 1000);
  assert.equal(payload.feeAmount, 25);
  assert.equal(payload.netAmount, 975);
  assert.equal(payload.status, 'success');
  assert.equal(payload.currency, 'INR');
  assert.equal(payload.paymentDate, '2026-10-03');
  assert.equal(payload.metadata.source, 'unit-test');
});

test('Payable webhook contract claims idempotency before ledger posting and uses gross/fee/net RPC arguments', async () => {
  const route = await read('app/api/payments/payable/webhook/route.ts');
  assert.match(route, /claim_payment_webhook_event/);
  assert.match(route, /if \(!claimed\) return json\(\{ ok: true, duplicate: true \}\)/);
  assert.match(route, /p_provider: 'payable'/);
  assert.match(route, /p_gross_amount: payload\.amount/);
  assert.match(route, /p_fee_amount: payload\.feeAmount/);
  assert.match(route, /p_net_amount: payload\.netAmount/);
  assert.match(route, /status: 'processed'/);
  assert.match(route, /status: 'failed'/);
});

test('Payable checkout session route is authenticated and tenant-scoped', async () => {
  const route = await read('app/api/payments/payable/session/route.ts');
  assert.match(route, /Authorization required/);
  assert.match(route, /get_my_business_context/);
  assert.match(route, /eq\('business_id', context\.business_id\)/);
  assert.match(route, /eq\('provider', 'payable'\)/);
  assert.match(route, /payment_link_id/);
});
