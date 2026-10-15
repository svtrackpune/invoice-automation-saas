-- Repair inventory location visibility for invoice entry and preflight the stock
-- that will actually be consumed by post_invoice. This is read-only: the movement
-- ledger remains the authority and negative stock is never silently enabled.

CREATE OR REPLACE FUNCTION public.get_active_inventory_locations(p_business_id uuid)
RETURNS TABLE(id uuid, name text, code text, is_default boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, mm_private, pg_temp
AS $function$
BEGIN
  IF NOT (
    mm_private.has_business_permission(p_business_id, 'sales.create', auth.uid())
    OR mm_private.has_business_permission(p_business_id, 'inventory.view', auth.uid())
    OR mm_private.has_business_permission(p_business_id, 'inventory.manage', auth.uid())
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT il.id, il.name, il.code, il.is_default
  FROM public.inventory_locations il
  WHERE il.business_id = p_business_id
    AND il.is_active
  ORDER BY il.is_default DESC, il.name, il.id;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_active_inventory_locations(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_active_inventory_locations(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_invoice_inventory_preflight(p_invoice_id uuid)
RETURNS TABLE(
  product_service_id uuid,
  product_name text,
  location_id uuid,
  location_name text,
  quantity_available numeric,
  quantity_requested numeric,
  sufficient boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, mm_private, pg_temp
AS $function$
DECLARE
  v_invoice public.invoices%ROWTYPE;
  v_location_id uuid;
BEGIN
  SELECT i.*
  INTO v_invoice
  FROM public.invoices i
  WHERE i.id = p_invoice_id;

  IF v_invoice.id IS NULL THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;

  IF NOT (
    mm_private.has_business_permission(v_invoice.business_id, 'accounting.post', auth.uid())
    OR mm_private.has_business_permission(v_invoice.business_id, 'sales.create', auth.uid())
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  -- Delivery-challan quantities already reduced inventory at dispatch. The
  -- invoice generated from that challan must not consume the same stock again.
  IF v_invoice.source_challan_id IS NOT NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.invoice_items ii
    JOIN public.products_services ps
      ON ps.id = ii.product_service_id
     AND ps.business_id = v_invoice.business_id
    WHERE ii.invoice_id = v_invoice.id
      AND ps.inventory_tracked
  ) THEN
    RETURN;
  END IF;

  v_location_id := v_invoice.inventory_location_id;
  IF v_location_id IS NULL THEN
    SELECT il.id
    INTO v_location_id
    FROM public.inventory_locations il
    WHERE il.business_id = v_invoice.business_id
      AND il.is_active
    ORDER BY il.is_default DESC, il.name, il.id
    LIMIT 1;
  END IF;

  IF v_location_id IS NULL THEN
    RAISE EXCEPTION 'No active inventory location is configured for this business. Create or activate a stock location before posting this invoice.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.inventory_locations il
    WHERE il.id = v_location_id
      AND il.business_id = v_invoice.business_id
      AND il.is_active
  ) THEN
    RAISE EXCEPTION 'The invoice inventory location is inactive or does not belong to this business.';
  END IF;

  RETURN QUERY
  SELECT
    ps.id,
    ps.name,
    il.id,
    il.name,
    coalesce(ib.quantity_on_hand, 0)::numeric,
    sum(ii.quantity)::numeric,
    coalesce(ib.quantity_on_hand, 0) >= sum(ii.quantity)
  FROM public.invoice_items ii
  JOIN public.products_services ps
    ON ps.id = ii.product_service_id
   AND ps.business_id = v_invoice.business_id
  JOIN public.inventory_locations il
    ON il.id = v_location_id
   AND il.business_id = v_invoice.business_id
   AND il.is_active
  LEFT JOIN public.inventory_balances ib
    ON ib.business_id = v_invoice.business_id
   AND ib.location_id = v_location_id
   AND ib.product_service_id = ps.id
  WHERE ii.invoice_id = v_invoice.id
    AND ps.inventory_tracked
  GROUP BY ps.id, ps.name, il.id, il.name, ib.quantity_on_hand
  ORDER BY ps.name;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_invoice_inventory_preflight(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_invoice_inventory_preflight(uuid) TO authenticated;
