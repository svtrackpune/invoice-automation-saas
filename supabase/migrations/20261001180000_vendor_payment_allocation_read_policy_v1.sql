BEGIN;

DROP POLICY IF EXISTS vendor_payment_allocations_select ON public.vendor_payment_allocations;

CREATE POLICY vendor_payment_allocations_select
  ON public.vendor_payment_allocations
  FOR SELECT
  TO authenticated
  USING (
    mm_private.has_business_permission(business_id,'payments.pay')
    OR mm_private.has_business_permission(business_id,'accounting.view')
    OR mm_private.has_business_permission(business_id,'purchases.manage')
    OR mm_private.has_business_permission(business_id,'vendors.manage')
  );

COMMIT;