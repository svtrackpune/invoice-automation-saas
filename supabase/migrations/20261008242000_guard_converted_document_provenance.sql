BEGIN;

CREATE OR REPLACE FUNCTION mm_private.guard_converted_delivery_challan()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, mm_private, pg_temp
AS $function$
BEGIN
  IF OLD.converted_invoice_id IS NOT NULL THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION
        'Cannot delete delivery challan %: already converted to tax invoice %',
        OLD.challan_number,
        OLD.converted_invoice_id;
    END IF;

    IF NEW.converted_invoice_id IS DISTINCT FROM OLD.converted_invoice_id
       OR NEW.status IS DISTINCT FROM 'invoiced' THEN
      RAISE EXCEPTION 'Converted delivery challan lifecycle is immutable';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_converted_delivery_challan ON public.delivery_challans;
CREATE TRIGGER trg_guard_converted_delivery_challan
BEFORE UPDATE OR DELETE ON public.delivery_challans
FOR EACH ROW
EXECUTE FUNCTION mm_private.guard_converted_delivery_challan();

CREATE OR REPLACE FUNCTION mm_private.guard_converted_purchase_order()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, mm_private, pg_temp
AS $function$
BEGIN
  IF OLD.is_purchase_order AND OLD.converted_bill_id IS NOT NULL THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION
        'Cannot delete purchase order %: already converted to vendor bill %',
        OLD.bill_number,
        OLD.converted_bill_id;
    END IF;

    IF NEW.converted_bill_id IS DISTINCT FROM OLD.converted_bill_id
       OR NEW.po_status IS DISTINCT FROM 'fulfilled' THEN
      RAISE EXCEPTION 'Converted purchase order lifecycle is immutable';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_converted_purchase_order ON public.bills;
CREATE TRIGGER trg_guard_converted_purchase_order
BEFORE UPDATE OR DELETE ON public.bills
FOR EACH ROW
EXECUTE FUNCTION mm_private.guard_converted_purchase_order();

COMMIT;