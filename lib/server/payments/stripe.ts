import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  CreatePaymentSessionParams,
  NormalizedWebhookPayload,
  PaymentProviderAdapter,
  PaymentSession,
  VerifiedWebhook,
} from './types';

const STRIPE_API = 'https://api.stripe.com/v1';
const WEBHOOK_TOLERANCE_SECONDS = 300;

const getSecret = (override?: string) => {
  const secret = override || process.env.STRIPE_SECRET_KEY;
  if (!secret) throw new Error('Stripe secret key is not configured');
  return secret;
};

const currencyExponent = (currency: string) => {
  const code = currency.toUpperCase();
  if (new Set(['BIF','CLP','DJF','GNF','ISK','JPY','KMF','KRW','PYG','RWF','UGX','VND','VUV','XAF','XOF','XPF']).has(code)) return 0;
  if (new Set(['BHD','IQD','JOD','KWD','LYD','OMR','TND']).has(code)) return 3;
  return 2;
};

const toMinorUnit = (amount: number, currency: string) => {
  const factor = 10 ** currencyExponent(currency);
  const minor = Math.round(amount * factor);
  if (!Number.isFinite(minor) || minor <= 0) throw new Error('Payment amount must be greater than zero');
  return minor;
};

const fromMinorUnit = (amount: unknown, currency: string) => {
  const numeric = Number(amount);
  if (!Number.isFinite(numeric)) throw new Error('Invalid provider amount');
  return numeric / (10 ** currencyExponent(currency));
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? value as Record<string, unknown> : {};

const metadataToStrings = (value: unknown): Record<string, string> =>
  Object.fromEntries(
    Object.entries(asRecord(value))
      .filter(([, item]) => item !== null && item !== undefined)
      .map(([key, item]) => [key, String(item)]),
  );

const postStripe = async (path: string, body: URLSearchParams, secretOverride?: string) => {
  const response = await fetch(`${STRIPE_API}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getSecret(secretOverride)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
    cache: 'no-store',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = asRecord(data).error;
    const detail = asRecord(message).message;
    throw new Error(typeof detail === 'string' ? detail : `Stripe request failed with HTTP ${response.status}`);
  }
  return asRecord(data);
};

export class StripePaymentAdapter implements PaymentProviderAdapter {
  readonly provider = 'stripe';
  constructor(private readonly secretOverride?: string) {}

  async createPaymentSession(params: CreatePaymentSessionParams): Promise<PaymentSession> {
    const currency = params.currency.trim().toLowerCase();
    if (!/^[a-z]{3}$/.test(currency)) throw new Error('Valid ISO currency code is required');
    if (!Number.isFinite(params.amount) || params.amount <= 0) throw new Error('Payment amount must be greater than zero');

    const metadata = {
      moneymatters_business_id: params.businessId,
      moneymatters_invoice_id: params.invoiceId,
      ...(params.metadata ?? {}),
    };

    if ((params.mode ?? 'checkout') === 'payment_intent') {
      const body = new URLSearchParams();
      body.set('amount', String(toMinorUnit(params.amount, currency)));
      body.set('currency', currency);
      Object.entries(metadata).forEach(([key, value]) => {
        if (value !== undefined && value !== null) body.set(`metadata[${key}]`, String(value));
      });
      const intent = await postStripe('/payment_intents', body, this.secretOverride);
      return {
        provider: this.provider,
        providerReference: String(intent.id),
        mode: 'payment_intent',
        amount: params.amount,
        currency: currency.toUpperCase(),
        paymentIntentId: String(intent.id),
        clientSecret: typeof intent.client_secret === 'string' ? intent.client_secret : undefined,
        metadata: metadataToStrings(intent.metadata),
      };
    }

    const body = new URLSearchParams();
    body.set('mode', 'payment');
    body.set('success_url', params.successUrl);
    body.set('cancel_url', params.cancelUrl);
    body.set('line_items[0][price_data][currency]', currency);
    body.set('line_items[0][price_data][product_data][name]', params.description);
    body.set('line_items[0][price_data][unit_amount]', String(toMinorUnit(params.amount, currency)));
    body.set('line_items[0][quantity]', '1');
    if (params.customerEmail) body.set('customer_email', params.customerEmail);
    Object.entries(metadata).forEach(([key, value]) => {
      if (value !== undefined && value !== null) body.set(`metadata[${key}]`, String(value));
    });

    const session = await postStripe('/checkout/sessions', body, this.secretOverride);
    if (typeof session.url !== 'string') throw new Error('Stripe Checkout session did not return a URL');

    return {
      provider: this.provider,
      providerReference: String(session.id),
      mode: 'checkout',
      amount: params.amount,
      currency: currency.toUpperCase(),
      checkoutUrl: session.url,
      paymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : undefined,
      metadata: metadataToStrings(session.metadata),
    };
  }

  async verifyWebhook(req: Request): Promise<VerifiedWebhook> {
    const rawBody = await req.text();
    const signature = req.headers.get('stripe-signature') ?? '';
    const secret = this.secretOverride || process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret || !signature) throw new Error('Stripe webhook configuration/headers missing');

    const parts: Record<string, string> = {};
    signature.split(',').forEach((item) => {
      const index = item.indexOf('=');
      if (index > 0) parts[item.slice(0,index)] = item.slice(index + 1);
    });

    const timestamp = Number(parts.t);
    const provided = parts.v1 ?? '';
    if (!Number.isInteger(timestamp) || !/^[0-9a-f]{64}$/i.test(provided)) throw new Error('Invalid Stripe webhook signature');
    if (Math.abs(Math.floor(Date.now()/1000) - timestamp) > WEBHOOK_TOLERANCE_SECONDS) throw new Error('Expired Stripe webhook signature');

    const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`, 'utf8').digest('hex');
    const expectedBuffer = Buffer.from(expected,'hex');
    const providedBuffer = Buffer.from(provided,'hex');
    if (!timingSafeEqual(expectedBuffer,providedBuffer)) throw new Error('Invalid Stripe webhook signature');

    const event = JSON.parse(rawBody) as unknown;
    const eventId = asRecord(event).id;
    if (typeof eventId !== 'string' || !eventId) throw new Error('Stripe webhook event id is missing');

    return { rawBody,event,signature };
  }

  normalizeWebhookPayload(event: unknown, _signature = ''): NormalizedWebhookPayload {
    const root=asRecord(event);
    const eventType=typeof root.type==='string' ? root.type : '';
    const eventId=typeof root.id==='string' ? root.id : '';
    if (!['checkout.session.completed','payment_intent.succeeded'].includes(eventType)) {
      throw new Error(`Unsupported Stripe webhook event: ${eventType || 'unknown'}`);
    }
    if (!eventId) throw new Error('Stripe webhook event id is missing');

    const object=asRecord(asRecord(root.data).object);
    const currency=typeof object.currency==='string' ? object.currency.toUpperCase() : '';
    if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Stripe webhook currency is missing or invalid');

    const amountRaw=eventType==='checkout.session.completed'
      ? object.amount_total
      : object.amount_received ?? object.amount;
    const amount=fromMinorUnit(amountRaw,currency);

    const providerLinkId=typeof object.id==='string'
      ? object.id
      : typeof object.payment_intent==='string' ? object.payment_intent : '';
    const providerTransactionId=eventType==='checkout.session.completed'
      ? (typeof object.payment_intent==='string' ? object.payment_intent : String(object.id ?? ''))
      : String(object.id ?? '');

    if (!providerLinkId || !providerTransactionId) throw new Error('Stripe payment identifiers are missing');

    const created=Number(object.created ?? Math.floor(Date.now()/1000));
    return {
      provider:this.provider,
      eventId,
      eventType,
      providerLinkId,
      providerTransactionId,
      amount,
      currency,
      paymentDate:new Date((Number.isFinite(created)?created:Math.floor(Date.now()/1000))*1000).toISOString().slice(0,10),
      notes:`Stripe ${eventType}`,
      metadata:metadataToStrings(object.metadata),
    };
  }
}
