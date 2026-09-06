-- Restrict SECURITY DEFINER RPCs that are authenticated/internal-only.
-- Explicit authenticated grants are preserved where applicable.

REVOKE EXECUTE ON FUNCTION public.create_business_for_current_user(text,public.business_type,character,character,boolean,text,text,boolean,boolean,boolean,uuid,uuid,text,jsonb,text,text,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.generate_due_recurring_expense(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_or_create_cash_customer(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.normalize_invoice_item_discount() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_notification_delivery_evidence() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.void_invoice(uuid,text) FROM PUBLIC, anon;
