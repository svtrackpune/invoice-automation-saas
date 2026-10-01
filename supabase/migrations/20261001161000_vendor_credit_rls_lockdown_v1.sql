BEGIN;
DROP POLICY IF EXISTS vendor_credits_access ON public.vendor_credits;
DROP POLICY IF EXISTS vendor_credit_items_access ON public.vendor_credit_items;
DROP POLICY IF EXISTS vendor_credits_member_all ON public.vendor_credits;
DROP POLICY IF EXISTS vendor_credit_items_member_all ON public.vendor_credit_items;
DROP POLICY IF EXISTS vendor_credit_ledger_access ON public.vendor_credit_ledger;
COMMIT;