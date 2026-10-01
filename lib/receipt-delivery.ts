import { supabase } from './supabase';

export type ReceiptChannel = 'email' | 'whatsapp' | 'sms' | 'telegram';

export async function queueReceiptNotification(receiptId: string, channel: ReceiptChannel) {
  const { data, error } = await supabase.rpc('queue_receipt_notification', {
    p_receipt_id: receiptId,
    p_channel: channel,
  });
  if (error) throw new Error(error.message);

  // Dispatch now for interactive sends. The database cron independently
  // retries queued jobs, including receipts created by gateway webhooks.
  try {
    await supabase.functions.invoke('process-notifications', {
      body: { source: 'receipt-delivery', receipt_id: receiptId, channel },
    });
  } catch {
    // The queue is authoritative; a worker invocation failure must never
    // make the accounting action appear to have failed.
  }

  return data as {
    queued: boolean;
    job_id: string | null;
    receipt_id: string;
    receipt_number: string;
    channel: ReceiptChannel;
    recipient: string;
  };
}

export async function createReceiptDigitalLink(receiptId: string) {
  const { data, error } = await supabase.rpc('create_receipt_access_token', {
    p_receipt_id: receiptId,
  });
  if (error || !data?.token) throw new Error(error?.message || 'Unable to create receipt link.');
  return {
    receiptNumber: String(data.receipt_number || ''),
    url: `${window.location.origin}/api/receipts/pdf?token=${encodeURIComponent(String(data.token))}`,
  };
}

export async function dispatchPendingNotifications() {
  try {
    await supabase.functions.invoke('process-notifications', {
      body: { source: 'receipt-delivery-manual-dispatch' },
    });
  } catch {
    // Background cron remains the retry path.
  }
}
