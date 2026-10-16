BEGIN;

-- Cover the bill_items.bill_id foreign key and the common line-item ordering
-- used by purchase bill and purchase order screens.
CREATE INDEX IF NOT EXISTS bill_items_bill_id_sort_order_idx
  ON public.bill_items (bill_id, sort_order);

-- Pin the search path on the new vendor supply mapping timestamp trigger.
CREATE OR REPLACE FUNCTION public.set_vendor_supply_mapping_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

NOTIFY pgrst, 'reload schema';

COMMIT;
