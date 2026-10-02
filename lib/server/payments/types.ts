export type PaymentSessionMode = 'checkout' | 'payment_intent';

export interface CreatePaymentSessionParams {
  businessId: string;
  invoiceId: string;
  amount: number;
  currency: string;
  successUrl: string;
  cancelUrl: string;
  description: string;
  customerEmail?: string | null;
  mode?: PaymentSessionMode;
  metadata?: Record<string, string | number | boolean | null | undefined>;
}

export interface PaymentSession {
  provider: string;
  providerReference: string;
  mode: PaymentSessionMode;
  amount: number;
  currency: string;
  checkoutUrl?: string;
  paymentIntentId?: string;
  clientSecret?: string;
  metadata?: Record<string, string>;
}

export interface VerifiedWebhook {
  rawBody: string;
  event: unknown;
  signature: string;
}

export interface NormalizedWebhookPayload {
  provider: string;
  eventId: string;
  eventType: string;
  providerLinkId: string;
  providerTransactionId: string;
  amount: number;
  currency: string;
  paymentDate: string;
  notes: string;
  metadata: Record<string, string>;
}

export interface PaymentProviderAdapter {
  createPaymentSession(params: CreatePaymentSessionParams): Promise<PaymentSession>;
  verifyWebhook(req: Request): Promise<VerifiedWebhook>;
  normalizeWebhookPayload(event: unknown, signature?: string): NormalizedWebhookPayload;
}
