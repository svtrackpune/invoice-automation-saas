-- Moneymatters Step 1B: enforce product/service discount policy at the invoice-item boundary.
-- The UI already clamps discounts; this database trigger prevents bypasses and keeps stored
-- discount_value/discount/tax/line_total consistent for every invoice-item write path.

CREATE OR REPLACE FUNCTION public.normalize_invoice_item_discount()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public'
AS $function$
DECLARE
  p public.products_services%rowtype;
  inv_business_id uuid;
  tax_enabled boolean := false;
  tax_rate numeric := 0;
  base numeric;
  max_discount numeric := 0;
BEGIN
  IF NEW.product_service_id IS NULL THEN
    NEW.discount_type := CASE WHEN NEW.discount_type='amount' THEN 'fixed' WHEN NEW.discount_type='percentage' THEN 'percentage' ELSE NULL END;
    NEW.discount_value := greatest(coalesce(NEW.discount_value,0),0);
  ELSE
    SELECT * INTO p FROM public.products_services WHERE id=NEW.product_service_id;
    IF p.id IS NULL THEN
      RAISE EXCEPTION 'Product/service not found';
    END IF;

    NEW.discount_type := CASE
      WHEN NEW.discount_type='amount' THEN 'fixed'
      WHEN NEW.discount_type='percentage' THEN 'percentage'
      ELSE NULL
    END;
    NEW.discount_value := greatest(coalesce(NEW.discount_value,0),0);

    IF NOT coalesce(p.discount_enabled,false) THEN
      NEW.discount_type := NULL;
      NEW.discount_value := 0;
    ELSE
      IF p.max_discount_type='percent' THEN
        max_discount := greatest(coalesce(p.max_discount_value,0),0);
        IF NEW.discount_type='percentage' THEN
          NEW.discount_value := least(NEW.discount_value,max_discount);
        ELSIF NEW.discount_type='fixed' THEN
          base := round(coalesce(NEW.quantity,0)*coalesce(NEW.unit_price,0),2);
          NEW.discount_value := least(NEW.discount_value,round(base*max_discount/100,2));
        END IF;
      ELSIF p.max_discount_type='amount' THEN
        max_discount := greatest(coalesce(p.max_discount_value,0),0);
        IF NEW.discount_type='fixed' THEN
          NEW.discount_value := least(NEW.discount_value,max_discount);
        ELSIF NEW.discount_type='percentage' THEN
          base := round(coalesce(NEW.quantity,0)*coalesce(NEW.unit_price,0),2);
          IF base > 0 THEN
            NEW.discount_value := least(NEW.discount_value,round(max_discount*100/base,6));
          ELSE
            NEW.discount_value := 0;
          END IF;
        END IF;
      END IF;
    END IF;
  END IF;

  base := round(greatest(coalesce(NEW.quantity,0),0)*greatest(coalesce(NEW.unit_price,0),0),2);
  NEW.discount := public.calculate_invoice_discount(base,NEW.discount_type,NEW.discount_value);
  NEW.unit_price_before_discount := coalesce(NEW.unit_price_before_discount,NEW.unit_price);

  SELECT i.business_id INTO inv_business_id FROM public.invoices i WHERE i.id=NEW.invoice_id;
  SELECT CASE WHEN upper(coalesce(tp.tax_regime,'NONE'))='GST'
                   AND upper(coalesce(tp.gst_registration_type,'NONE'))<>'COMPOSITION'
              THEN true ELSE false END
    INTO tax_enabled
  FROM public.business_tax_profiles tp
  WHERE tp.business_id=inv_business_id;
  tax_enabled := coalesce(tax_enabled,false);

  IF tax_enabled AND NEW.tax_rate_id IS NOT NULL THEN
    SELECT coalesce(rate,0) INTO tax_rate
    FROM public.tax_rates
    WHERE id=NEW.tax_rate_id AND business_id=inv_business_id AND is_active;
  END IF;
  tax_rate := coalesce(tax_rate,0);
  NEW.tax_amount := round(greatest(base-NEW.discount,0)*tax_rate/100,2);
  NEW.line_total := round(greatest(base-NEW.discount,0)+NEW.tax_amount,2);

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_normalize_invoice_item_discount ON public.invoice_items;
CREATE TRIGGER trg_normalize_invoice_item_discount
BEFORE INSERT OR UPDATE OF product_service_id,quantity,unit_price,discount_type,discount_value,tax_rate_id
ON public.invoice_items
FOR EACH ROW
EXECUTE FUNCTION public.normalize_invoice_item_discount();
