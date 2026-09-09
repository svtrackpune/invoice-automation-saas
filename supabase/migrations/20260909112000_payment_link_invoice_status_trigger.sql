CREATE OR REPLACE FUNCTION public.guard_payment_link_invoice_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,mm_private AS $$
DECLARE v_status text;
BEGIN
  SELECT status::text INTO v_status FROM public.invoices
  WHERE id=NEW.invoice_id AND business_id=NEW.business_id;
  IF v_status IS NULL THEN RAISE EXCEPTION 'Payment link invoice not found'; END IF;
  IF v_status NOT IN ('sent','posted','partially_paid','overdue') THEN
    RAISE EXCEPTION 'Payment links require a posted or billable invoice';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_guard_payment_link_invoice_status ON public.payment_links;
CREATE TRIGGER trg_guard_payment_link_invoice_status
BEFORE INSERT OR UPDATE OF invoice_id,business_id ON public.payment_links
FOR EACH ROW EXECUTE FUNCTION public.guard_payment_link_invoice_status();
REVOKE ALL ON FUNCTION public.guard_payment_link_invoice_status() FROM PUBLIC,anon,authenticated;