import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  CreatePaymentSessionParams,
  NormalizedWebhookPayload,
  PaymentProviderAdapter,
  PaymentSession,
  VerifiedWebhook,
} from './types';

const DEFAULT_TOLERANCE_SECONDS = 300;
const API_URL_ENV = 'PAYABLE_API_URL';
const API_KEY_ENV = 'PAYABLE_API_KEY';
const WEBHOOK_SECRET_ENV = 'PAYABLE_WEBHOOK_SECRET';

type RecordValue = Record<string, unknown>;

const asRecord = (value: unknown): RecordValue =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as RecordValue
    : {};

const firstString = (...values: unknown[]): string => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
};

const firstNumber = (...values: unknown[]): number | null => {
  for (const value of values) {
    const numeric = typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value)
        : NaN;
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
};

const toMetadata = (value: unknown): Record<string, string> =>
  Object.fromEntries(
    Object.entries(asRecord(value))
      .filter(([, item]) => item !== null && item !== undefined)
      .map(([key, item]) => [key, String(item)]),
  );

const normalizeSignature = (signature: string): string =>
  signature.trim().replace(/^sha256=/i, '').trim();

const timingSafeHexEqual = (expectedHex: string, provided: string): boolean => {
  const actualText = normalizeSignature(provided);
  if (!/^[0-9a-f]{64}$/i.test(actualText)) return false;
  const expected = Buffer.from(expectedHex, 'hex');
  const actual = Buffer.from(actualText, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
};

const timestampFromValue = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1e12 ? Math.floor(value / 1000) : Math.floor(value);
  }
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric > 1e12 ? Math.floor(numeric / 1000) : Math.floor(numeric);
    }
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return Math.floor(parsed / 1000);
  }
  return null;
};

const toDateOnly = (value: unknown): string => {
  const timestamp = timestampFromValue(value);
  return (timestamp === null ? new Date() : new Date(timestamp * 1000)).toISOString().slice(0, 10);
};

const pickNested = (root: RecordValue, key: string): unknown => {
  const data = asRecord(root.data);
  const payment = asRecord(data.payment);
  const payload = asRecord(root.payload);
  return root[key] ?? data[key] ?? payment[key] ?? payload[key];
};

const pickNestedNumber = (root: RecordValue, key: string): number | null => {
  const data = asRecord(root.data);
  const payment = asRecord(data.payment);
  const payload = asRecord(root.payload);
  return firstNumber(root[key], data[key], payment[key], payload[key]);
};

export const buildPayableSessionPayload = (params: CreatePaymentSessionParams): Record<string, unknown> => {
  if (!process.env[API_KEY_ENV]) throw new Error('Payable API key is not configured');

  const currency = params.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Valid ISO currency code is required');
  if (!Number.isFinite(params.amount) || params.amount <= 0) throw new Error('Payment amount must be greater than zero');

  const orderId = firstString(params.orderId, params.invoiceId);
  if (!orderId) throw new Error('Payable order id is required');

  const payload: Record<string, unknown> = {
    order_id: orderId,
    amount: Number(params.amount.toFixed(2)),
    currency,
    customer_email: params.customerEmail || undefined,
    customer_phone: params.customerPhone || undefined,
    callback_url: params.callbackUrl || params.successUrl,
    webhook_url: params.webhookUrl || undefined,
    description: params.description,
    cancel_url: params.cancelUrl,
    metadata: {
      moneymatters_business_id: params.businessId,
      moneymatters_invoice_id: params.invoiceId,
      ...(params.metadata ?? {}),
    },
  };

  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined && value !== null),
  );
};

const getApiUrl = (): string => {
  const value = process.env[API_URL_ENV];
  if (!value) throw new Error('Payable API URL is not configured');
  return value.replace(/\/$/, '');
};

const postPayable = async (payload: Record<string, unknown>): Promise<RecordValue> => {
  const apiKey = process.env[API_KEY_ENV];
  const response = await fetch(getApiUrl(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
    cache: 'no-store',
  });

  const data = asRecord(await response.json().catch(() => ({})));
  if (!response.ok) {
    const message = firstString(asRecord(data.error).message, data.message, data.error);
    throw new Error(message || `Payable request failed with HTTP ${response.status}`);
  }
  return data;
};

export const signPayableWebhook = (timestamp: string, rawBody: string, secret: string): string =>
  createHmac('sha256', secret).update(`${timestamp}.${rawBody}`, 'utf8').digest('hex');

export const verifyPayableWebhookPayload = (
  rawBody: string,
  signature: string,
  secret: string,
  timestampHeader: string,
  toleranceSeconds = DEFAULT_TOLERANCE_SECONDS,
  nowSeconds = Math.floor(Date.now() / 1000),
): unknown => {
  if (!/^\d{10,}$/.test(timestampHeader)) throw new Error('Invalid Payable webhook timestamp');

  const timestamp = Number(timestampHeader);
  if (!Number.isInteger(timestamp)) throw new Error('Invalid Payable webhook timestamp');
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) {
    throw new Error('Expired Payable webhook signature');
  }

  const expected = signPayableWebhook(timestampHeader, rawBody, secret);
  if (!timingSafeHexEqual(expected, signature)) {
    throw new Error('Invalid Payable webhook signature');
  }

  try {
    return JSON.parse(rawBody) as unknown;
  } catch {
    throw new Error('Invalid Payable webhook JSON payload');
  }
};

export class PayablePaymentAdapter implements PaymentProviderAdapter {
  readonly provider = 'payable';

  async createPaymentSession(params: CreatePaymentSessionParams): Promise<PaymentSession> {
    const payload = buildPayableSessionPayload(params);
    const data = await postPayable(payload);
    const nested = asRecord(data.data);

    const checkoutUrl = firstString(
      data.checkout_url,
      data.payment_url,
      data.url,
      data.redirect_url,
      nested.checkout_url,
      nested.payment_url,
      nested.url,
      nested.redirect_url,
    );

    const providerReference = firstString(
      data.payment_id,
      data.session_id,
      data.id,
      nested.payment_id,
      nested.session_id,
      nested.id,
      payload.order_id,
    );

    if (!checkoutUrl) throw new Error('Payable session did not return a checkout URL');
    if (!providerReference) throw new Error('Payable session did not return a provider reference');

    return {
      provider: this.provider,
      providerReference,
      mode: 'checkout',
      amount: Number(payload.amount),
      currency: String(payload.currency),
      checkoutUrl,
      metadata: toMetadata(data.metadata ?? nested.metadata),
    };
  }

  async verifyWebhook(req: Request): Promise<VerifiedWebhook> {
    const rawBody = await req.text();
    const signature = req.headers.get('x-payable-signature')
      ?? req.headers.get('x-payable-hmac-sha256')
      ?? '';
    const timestamp = req.headers.get('x-payable-timestamp') ?? '';
    const secret = process.env[WEBHOOK_SECRET_ENV];

    if (!secret || !signature || !timestamp) {
      throw new Error('Payable webhook configuration/headers missing');
    }

    const event = verifyPayableWebhookPayload(rawBody, signature, secret, timestamp);
    return { rawBody, event, signature };
  }

  normalizeWebhookPayload(event: unknown, _signature = ''): NormalizedWebhookPayload {
    const root = asRecord(event);
    const nested = asRecord(root.data);
    const payment = asRecord(nested.payment);

    const eventId = firstString(
      root.event_id, root.eventId, root.id,
      nested.event_id, nested.eventId,
      payment.event_id, payment.eventId,
    );

    const providerTransactionId = firstString(
      root.payment_id, root.paymentId, root.transaction_id, root.transactionId,
      nested.payment_id, nested.paymentId, nested.transaction_id,
      payment.payment_id, payment.paymentId, payment.id,
    );

    const providerLinkId = firstString(
      root.order_id, root.orderId,
      nested.order_id, nested.orderId,
      payment.order_id, payment.orderId,
    );

    const eventType = firstString(
      root.event_type, root.event, root.type,
      nested.event_type, nested.event,
    ) || 'payment.updated';

    const status = firstString(
      root.status, root.payment_status, root.status_text,
      nested.status, payment.status,
    ).toLowerCase();

    const currency = firstString(
      root.currency, root.currency_code,
      nested.currency, nested.currency_code,
      payment.currency, payment.currency_code,
    ).toUpperCase();

    const grossAmount =
      pickNestedNumber(root, 'gross_amount')
      ?? pickNestedNumber(root, 'amount')
      ?? pickNestedNumber(root, 'paid_amount');

    const feeAmount = pickNestedNumber(root, 'fee_amount')
      ?? pickNestedNumber(root, 'fee')
      ?? 0;

    const explicitNet = pickNestedNumber(root, 'net_amount')
      ?? pickNestedNumber(root, 'amount_received');

    const netAmount = explicitNet ?? (grossAmount === null ? null : grossAmount - feeAmount);

    if (!eventId) throw new Error('Payable webhook event id is missing');
    if (!providerTransactionId) throw new Error('Payable payment id is missing');
    if (!providerLinkId) throw new Error('Payable order id is missing');
    if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Payable webhook currency is missing or invalid');
    if (grossAmount === null || grossAmount <= 0) throw new Error('Payable webhook gross amount is invalid');
    if (feeAmount < 0) throw new Error('Payable webhook fee amount cannot be negative');
    if (netAmount === null || netAmount <= 0) throw new Error('Payable webhook net amount is invalid');
    if (Math.abs(grossAmount - feeAmount - netAmount) > 0.000001) {
      throw new Error('Payable webhook gross, fee and net amounts do not reconcile');
    }

    return {
      provider: this.provider,
      eventId,
      eventType,
      providerLinkId,
      providerTransactionId,
      amount: grossAmount,
      feeAmount,
      netAmount,
      status,
      currency,
      paymentDate: toDateOnly(
        pickNested(root, 'paid_at') ?? root.timestamp ?? root.created_at ?? nested.timestamp,
      ),
      notes: `Payable ${eventType}`,
      metadata: {
        ...toMetadata(root.metadata),
        ...toMetadata(nested.metadata),
      },
    };
  }
}
