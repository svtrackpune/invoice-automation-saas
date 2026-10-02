BEGIN;

-- Remove the redundant prototype added during receipt-delivery reconciliation.
-- The authoritative receipt-delivery trigger is trg_enqueue_receipt_delivery_notifications.
DROP TRIGGER IF EXISTS trg_queue_receipt_whatsapp_on_insert ON public.receipts;
DROP FUNCTION IF EXISTS public.queue_receipt_whatsapp_on_insert();
DROP FUNCTION IF EXISTS public.queue_receipt_notification(uuid,text);

COMMIT;
