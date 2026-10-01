import { supabase } from './supabase';

export type ReceiptDigitalLinkResult = {
  ok: boolean;
  url?: string;
  receiptNumber?: string;
  message?: string;
};

export type ReceiptWhatsAppResult = {
  ok: boolean;
  status: 'submitted' | 'delivered' | 'no_mobile' | 'failed';
  receiptNumber?: string;
  message?: string;
};

const publicPdfUrl = (token: string) => {
  if (typeof window === 'undefined') return '';
  return `${window.location.origin}/api/receipts/pdf?token=${encodeURIComponent(token)}`;
};

export async function prepareReceiptDigitalLink(receiptId: string): Promise<ReceiptDigitalLinkResult> {
  const { data, error } = await supabase.rpc('create_receipt_access_token', { p_receipt_id: receiptId });
  if (error || !data?.token) {
    return { ok: false, message: error?.message || 'Unable to prepare the digital receipt.' };
  }
  return {
    ok: true,
    url: publicPdfUrl(String(data.token)),
    receiptNumber: data.receipt_number || undefined,
  };
}

export async function sendReceiptWhatsApp(receiptId: string): Promise<ReceiptWhatsAppResult> {
  const { data, error } = await supabase.rpc('prepare_receipt_whatsapp_delivery', { p_receipt_id: receiptId });
  if (error) {
    return { ok: false, status: 'failed', message: error.message };
  }
  if (!data?.enabled) {
    return {
      ok: true,
      status: 'no_mobile',
      receiptNumber: data?.receipt_number || undefined,
      message: data?.reason === 'no_mobile'
        ? 'No mobile number supplied. Use Print or the digital receipt QR/link.'
        : 'A customer contact is not available for WhatsApp delivery.',
    };
  }
  const response = await fetch('/api/receipts/whatsapp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      deliveryId: data.delivery_id,
      token: data.token,
    }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result?.ok) {
    return {
      ok: false,
      status: 'failed',
      receiptNumber: data.receipt_number || undefined,
      message: result?.message || 'WhatsApp receipt delivery failed.',
    };
  }
  return {
    ok: true,
    status: result.status === 'delivered' ? 'delivered' : 'submitted',
    receiptNumber: result.receiptNumber || data.receipt_number || undefined,
    message: result.status === 'delivered'
      ? 'Receipt delivered through WhatsApp.'
      : 'Receipt PDF submitted to WhatsApp for delivery.',
  };
}
