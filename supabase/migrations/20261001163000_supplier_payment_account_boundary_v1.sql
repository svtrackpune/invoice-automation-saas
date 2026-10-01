BEGIN;

CREATE OR REPLACE FUNCTION public.guard_vendor_bill_payment_account()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,mm_private AS $$
BEGIN
  IF NEW.direction='outbound' AND NEW.bill_id IS NOT NULL THEN
    IF NOT EXISTS(
      SELECT 1
      FROM public.accounts
      WHERE id=NEW.account_id
        AND business_id=NEW.business_id
        AND is_active
        AND account_subtype IN ('cash','bank')
    ) THEN
      RAISE EXCEPTION 'Supplier bill payments must use an active Cash or Bank account';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_vendor_bill_payment_account_guard ON public.payments;
CREATE TRIGGER trg_vendor_bill_payment_account_guard
BEFORE INSERT OR UPDATE OF account_id,direction,bill_id,business_id
ON public.payments
FOR EACH ROW
EXECUTE FUNCTION public.guard_vendor_bill_payment_account();

REVOKE ALL ON FUNCTION public.guard_vendor_bill_payment_account() FROM public,anon,authenticated;

COMMIT;