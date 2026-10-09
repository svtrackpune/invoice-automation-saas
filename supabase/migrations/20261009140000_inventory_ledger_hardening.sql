BEGIN;

-- Expand the existing check constraint before adding new ledger movement types.
-- Keep legacy types accepted while allowing the canonical aliases used by the
-- trigger, stock audit, POS, challan dispatch, and vendor return workflows.
ALTER TABLE public.inventory_movements
  DROP CONSTRAINT IF EXISTS inventory_movements_movement_type_check;

ALTER TABLE public.inventory_movements
  ADD CONSTRAINT inventory_movements_movement_type_check
  CHECK (movement_type IN (
    'opening',
    'opening_stock',
    'purchase',
    'purchase_in',
    'sale',
    'pos_sale',
    'sale_return',
    'customer_return',
    'purchase_return',
    'return_to_vendor',
    'adjustment_in',
    'adjustment_out',
    'stock_adjustment_in',
    'stock_adjustment_out',
    'transfer_in',
    'transfer_out',
    'delivery_challan_out',
    'damage',
    'damaged',
    'writeoff',
    'sale_reversal'
  ));

-- Inventory balances are a projection of the movement ledger. Every supported
-- movement type is classified here; unknown types fail closed rather than
-- silently changing a ledger without changing the balance.
DROP TRIGGER IF EXISTS trg_inventory_movement_balance ON public.inventory_movements;
DROP FUNCTION IF EXISTS public.apply_inventory_movement_to_balance();

CREATE OR REPLACE FUNCTION public.process_inventory_movement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, mm_private, pg_temp
AS $function$
DECLARE
  v_delta numeric;
  v_old_qty numeric := 0;
  v_old_cost numeric := 0;
  v_new_qty numeric;
  v_new_cost numeric;
  v_reorder_level numeric := 0;
  v_inventory_settings jsonb;
  v_feature_flags jsonb;
  v_allow_negative boolean := false;
  v_product_tracked boolean;
BEGIN
  IF NEW.quantity IS NULL OR NEW.quantity <= 0 THEN
    RAISE EXCEPTION 'Inventory movement quantity must be greater than zero';
  END IF;

  SELECT ps.inventory_tracked, coalesce(ps.reorder_level, 0)
    INTO v_product_tracked, v_reorder_level
  FROM public.products_services ps
  WHERE ps.id = NEW.product_service_id
    AND ps.business_id = NEW.business_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inventory movement product is not part of the supplied business';
  END IF;
  IF NOT coalesce(v_product_tracked, false) THEN
    RAISE EXCEPTION 'Inventory movements are only permitted for inventory-tracked products';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.inventory_locations il
    WHERE il.id = NEW.location_id
      AND il.business_id = NEW.business_id
  ) THEN
    RAISE EXCEPTION 'Inventory movement location is not part of the supplied business';
  END IF;

  SELECT b.inventory_settings, b.feature_flags
    INTO v_inventory_settings, v_feature_flags
  FROM public.businesses b
  WHERE b.id = NEW.business_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inventory movement business does not exist';
  END IF;

  v_allow_negative :=
    coalesce(lower(nullif(v_inventory_settings->>'allow_negative_stock', '')) IN ('true','1','yes','on'), false)
    OR coalesce(lower(nullif(v_inventory_settings->>'allow_negative_inventory', '')) IN ('true','1','yes','on'), false)
    OR coalesce(lower(nullif(v_feature_flags->>'allow_negative_stock', '')) IN ('true','1','yes','on'), false);

  CASE NEW.movement_type
    WHEN 'opening' THEN v_delta := NEW.quantity;
    WHEN 'opening_stock' THEN v_delta := NEW.quantity;
    WHEN 'purchase' THEN v_delta := NEW.quantity;
    WHEN 'purchase_in' THEN v_delta := NEW.quantity;
    WHEN 'sale_return' THEN v_delta := NEW.quantity;
    WHEN 'customer_return' THEN v_delta := NEW.quantity;
    WHEN 'adjustment_in' THEN v_delta := NEW.quantity;
    WHEN 'stock_adjustment_in' THEN v_delta := NEW.quantity;
    WHEN 'transfer_in' THEN v_delta := NEW.quantity;
    WHEN 'sale_reversal' THEN v_delta := NEW.quantity;

    WHEN 'sale' THEN v_delta := -NEW.quantity;
    WHEN 'pos_sale' THEN v_delta := -NEW.quantity;
    WHEN 'delivery_challan_out' THEN v_delta := -NEW.quantity;
    WHEN 'transfer_out' THEN v_delta := -NEW.quantity;
    WHEN 'purchase_return' THEN v_delta := -NEW.quantity;
    WHEN 'return_to_vendor' THEN v_delta := -NEW.quantity;
    WHEN 'adjustment_out' THEN v_delta := -NEW.quantity;
    WHEN 'stock_adjustment_out' THEN v_delta := -NEW.quantity;
    WHEN 'damage' THEN v_delta := -NEW.quantity;
    WHEN 'damaged' THEN v_delta := -NEW.quantity;
    WHEN 'writeoff' THEN v_delta := -NEW.quantity;
    ELSE
      RAISE EXCEPTION 'Unsupported inventory movement type: %', NEW.movement_type;
  END CASE;

  -- Serialize balance creation as well as updates. SELECT FOR UPDATE alone
  -- does not lock a balance row that has not been created yet.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      NEW.business_id::text || ':' || NEW.location_id::text || ':' || NEW.product_service_id::text,
      0
    )
  );

  SELECT coalesce(ib.quantity_on_hand, 0), coalesce(ib.average_cost, 0)
    INTO v_old_qty, v_old_cost
  FROM public.inventory_balances ib
  WHERE ib.business_id = NEW.business_id
    AND ib.location_id = NEW.location_id
    AND ib.product_service_id = NEW.product_service_id
  FOR UPDATE;

  IF NOT FOUND THEN
    v_old_qty := 0;
    v_old_cost := 0;
  END IF;

  v_new_qty := v_old_qty + v_delta;
  IF v_new_qty < 0 AND NOT v_allow_negative THEN
    RAISE EXCEPTION
      'Insufficient stock for product % at location % (on hand %, requested %). Negative stock is disabled for this business.',
      NEW.product_service_id, NEW.location_id, v_old_qty, NEW.quantity;
  END IF;

  v_new_cost := v_old_cost;
  IF v_delta > 0 AND coalesce(NEW.unit_cost, 0) > 0 THEN
    IF v_old_qty > 0 THEN
      v_new_cost := ((v_old_qty * v_old_cost) + (v_delta * NEW.unit_cost)) / v_new_qty;
    ELSE
      v_new_cost := NEW.unit_cost;
    END IF;
  END IF;

  INSERT INTO public.inventory_balances (
    business_id, location_id, product_service_id,
    quantity_on_hand, average_cost, reorder_level, updated_at
  )
  VALUES (
    NEW.business_id, NEW.location_id, NEW.product_service_id,
    v_new_qty, coalesce(v_new_cost, 0), coalesce(v_reorder_level, 0), now()
  )
  ON CONFLICT (business_id, location_id, product_service_id)
  DO UPDATE SET
    quantity_on_hand = EXCLUDED.quantity_on_hand,
    average_cost = EXCLUDED.average_cost,
    updated_at = now();

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.process_inventory_movement() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER trg_inventory_movement_balance
AFTER INSERT ON public.inventory_movements
FOR EACH ROW
EXECUTE FUNCTION public.process_inventory_movement();

-- Direct client DML is not a supported inventory write path. The SECURITY
-- DEFINER movement trigger is the only application path which writes balances.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
ON TABLE public.inventory_balances FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.inventory_balances TO authenticated, service_role;

-- Products created with opening-stock metadata are initialized into the
-- movement ledger at the default active location (or the first active location).
-- Changing opening-stock metadata later does not create a second movement.
CREATE OR REPLACE FUNCTION mm_private.initialize_product_opening_stock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, mm_private, pg_temp
AS $function$
DECLARE
  v_location_id uuid;
  v_unit_cost numeric;
BEGIN
  IF NOT coalesce(NEW.inventory_tracked, false) THEN
    RETURN NEW;
  END IF;

  IF coalesce(NEW.opening_stock, 0) < 0 THEN
    RAISE EXCEPTION 'Opening stock cannot be negative';
  END IF;
  IF coalesce(NEW.opening_stock_cost, 0) < 0 THEN
    RAISE EXCEPTION 'Opening stock cost cannot be negative';
  END IF;
  IF coalesce(NEW.opening_stock, 0) = 0 THEN
    RETURN NEW;
  END IF;

  SELECT il.id INTO v_location_id
  FROM public.inventory_locations il
  WHERE il.business_id = NEW.business_id
    AND il.is_active
  ORDER BY il.is_default DESC, il.name, il.id
  LIMIT 1;

  IF v_location_id IS NULL THEN
    RAISE EXCEPTION 'Create an active inventory location before initializing opening stock';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.inventory_movements im
    WHERE im.business_id = NEW.business_id
      AND im.reference_type = 'opening_stock'
      AND im.reference_id = NEW.id
      AND im.movement_type = 'opening_stock'
  ) THEN
    RETURN NEW;
  END IF;

  -- opening_stock_cost is the authoritative total valuation; an explicit zero
  -- stays zero rather than inventing a cost from the current purchase price.
  v_unit_cost := coalesce(NEW.opening_stock_cost, 0) / nullif(NEW.opening_stock, 0);
  v_unit_cost := greatest(coalesce(v_unit_cost, 0), 0);

  INSERT INTO public.inventory_movements (
    business_id, location_id, product_service_id, movement_type,
    quantity, unit_cost, reference_type, reference_id, notes, created_by
  )
  VALUES (
    NEW.business_id, v_location_id, NEW.id, 'opening_stock',
    NEW.opening_stock, greatest(v_unit_cost, 0), 'opening_stock', NEW.id,
    'Opening stock initialized from product master data', auth.uid()
  );

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION mm_private.initialize_product_opening_stock() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS trg_products_services_opening_stock ON public.products_services;
CREATE TRIGGER trg_products_services_opening_stock
AFTER INSERT ON public.products_services
FOR EACH ROW
EXECUTE FUNCTION mm_private.initialize_product_opening_stock();

CREATE UNIQUE INDEX IF NOT EXISTS inventory_movements_opening_stock_once_idx
ON public.inventory_movements (business_id, reference_id)
WHERE movement_type = 'opening_stock'
  AND reference_type = 'opening_stock'
  AND reference_id IS NOT NULL;

-- One-time, non-destructive initialization: only products with positive
-- opening metadata and no existing movement or balance are seeded. This avoids
-- replaying opening stock for any item whose ledger is already active.
-- Opening-stock metadata is an explicit inventory initialization request.
-- Only businesses with no location rows at all and no existing inventory history
-- receive a canonical Main Store. Existing/inactive warehouse records are never
-- repurposed or reactivated.
INSERT INTO public.inventory_locations (
  business_id, name, code, address, is_default, is_active
)
SELECT DISTINCT
  ps.business_id, 'Main Store', 'MAIN', '{}'::jsonb, true, true
FROM public.products_services ps
WHERE ps.inventory_tracked
  AND coalesce(ps.opening_stock, 0) > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.inventory_movements im
    WHERE im.business_id = ps.business_id
      AND im.product_service_id = ps.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.inventory_balances ib
    WHERE ib.business_id = ps.business_id
      AND ib.product_service_id = ps.id
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.inventory_locations il
    WHERE il.business_id = ps.business_id
  )
ON CONFLICT DO NOTHING;

-- The backfill below only posts stock for a real active location. Businesses
-- with only inactive locations remain deferred; no existing warehouse is
-- silently reassigned.

INSERT INTO public.inventory_movements (
  business_id, location_id, product_service_id, movement_type,
  quantity, unit_cost, reference_type, reference_id, notes
)
SELECT
  ps.business_id,
  loc.id,
  ps.id,
  'opening_stock',
  ps.opening_stock,
  greatest(coalesce(ps.opening_stock_cost, 0) / nullif(ps.opening_stock, 0), 0),
  'opening_stock',
  ps.id,
  'Opening stock initialized from existing product master data'
FROM public.products_services ps
CROSS JOIN LATERAL (
  SELECT il.id
  FROM public.inventory_locations il
  WHERE il.business_id = ps.business_id
    AND il.is_active
  ORDER BY il.is_default DESC, il.name, il.id
  LIMIT 1
) loc
WHERE ps.inventory_tracked
  AND coalesce(ps.opening_stock, 0) > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.inventory_movements im
    WHERE im.business_id = ps.business_id
      AND im.product_service_id = ps.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.inventory_balances ib
    WHERE ib.business_id = ps.business_id
      AND ib.product_service_id = ps.id
  );

-- Temporary, migration-only helper for safe, exact rewrites of already-deployed
-- RPCs. Every patch asserts its unique target before replacing the function.
CREATE OR REPLACE FUNCTION mm_private._inventory_ledger_patch(
  p_target regprocedure,
  p_old text,
  p_new text
)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public, mm_private, pg_temp
AS $function$
DECLARE
  v_definition text;
  v_old_occurrences integer;
  v_new_occurrences integer;
BEGIN
  SELECT pg_get_functiondef(p_target) INTO v_definition;
  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'Inventory ledger patch target % was not found', p_target;
  END IF;

  IF p_old IS NULL OR length(p_old) = 0 THEN
    RAISE EXCEPTION 'Inventory ledger patch for % has an empty match string', p_target;
  END IF;

  -- The production database may already contain this patch from an earlier
  -- migration version. Never apply the replacement twice.
  IF p_new IS NOT NULL AND length(p_new) > 0 THEN
    v_new_occurrences :=
      (length(v_definition) - length(replace(v_definition, p_new, ''))) / length(p_new);
    IF v_new_occurrences > 0 THEN
      RETURN;
    END IF;
  END IF;

  v_old_occurrences :=
    (length(v_definition) - length(replace(v_definition, p_old, ''))) / length(p_old);

  -- A missing old fragment means the behavior may already be fixed under a
  -- semantically equivalent implementation. The postflight contract checks
  -- below are authoritative and fail the migration if a required invariant is absent.
  IF v_old_occurrences = 0 THEN
    RETURN;
  END IF;
  IF v_old_occurrences <> 1 THEN
    RAISE EXCEPTION 'Inventory ledger patch for % expected one old match, found %', p_target, v_old_occurrences;
  END IF;

  EXECUTE replace(v_definition, p_old, p_new);
END;
$function$;

REVOKE ALL ON FUNCTION mm_private._inventory_ledger_patch(regprocedure, text, text) FROM PUBLIC, anon, authenticated, service_role;

-- Replace the direct balance writes in every deployed inventory RPC. The
-- inventory_movements trigger now performs each balance delta exactly once.
SELECT mm_private._inventory_ledger_patch(
  'public.post_invoice(uuid,uuid)'::regprocedure,
  $old$        UPDATE public.inventory_balances
        SET quantity_on_hand=quantity_on_hand-v_product.quantity,updated_at=now()
        WHERE business_id=inv.business_id
          AND location_id=v_location
          AND product_service_id=v_product.product_service_id;

$old$,
  ''
);

SELECT mm_private._inventory_ledger_patch(
  'public.post_invoice(uuid,uuid)'::regprocedure,
  $old$        IF v_cost IS NULL OR v_qty < v_product.quantity
        THEN
          RAISE EXCEPTION 'Insufficient inventory for product %',v_product.product_service_id;
        END IF;$old$,
  $new$        -- The movement trigger is the authoritative stock guard and honors
        -- the business allow_negative_stock policy. Use purchase price as the
        -- COGS fallback when this location has no balance yet.
        IF v_cost IS NULL THEN
          SELECT coalesce(ps.purchase_price, 0)
          INTO v_cost
          FROM public.products_services ps
          WHERE ps.id = v_product.product_service_id
            AND ps.business_id = inv.business_id;
        END IF;
        v_cost := coalesce(v_cost, 0);$new$
);

SELECT mm_private._inventory_ledger_patch(
  'public.post_invoice(uuid,uuid)'::regprocedure,
  $old$        IF v_challan_movement_qty < v_challan_qty THEN$old$,
  $new$        IF round(v_challan_movement_qty, 6) <> round(v_challan_qty, 6) THEN$new$
);

SELECT mm_private._inventory_ledger_patch(
  'public.create_delivery_challan(uuid,uuid,date,uuid,jsonb,text,text,text,text,text)'::regprocedure,
  $old$  IF NOT EXISTS (SELECT 1 FROM inventory_locations WHERE id=p_location_id AND business_id=p_business_id AND is_active) THEN RAISE EXCEPTION 'Inventory location is invalid'; END IF;$old$,
  $new$  IF NOT EXISTS (SELECT 1 FROM inventory_locations WHERE id=p_location_id AND business_id=p_business_id AND is_active) THEN RAISE EXCEPTION 'Inventory location is invalid'; END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Delivery challan items must be a JSON array';
  END IF;
  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Delivery challan must contain at least one item';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_items) AS x(product_service_id uuid, description text, quantity numeric)
    WHERE coalesce(x.quantity, 0) <= 0
       OR nullif(btrim(x.description), '') IS NULL
  ) THEN
    RAISE EXCEPTION 'Delivery challan items require a description and positive quantity';
  END IF;$new$
);

SELECT mm_private._inventory_ledger_patch(
  'public.create_delivery_challan(uuid,uuid,date,uuid,jsonb,text,text,text,text,text)'::regprocedure,
  $old$      UPDATE inventory_balances SET quantity_on_hand=quantity_on_hand-v_item.quantity,updated_at=now() WHERE business_id=p_business_id AND product_service_id=v_item.product_service_id AND location_id=p_location_id;
$old$,
  ''
);

SELECT mm_private._inventory_ledger_patch(
  'public.commit_stock_audit_adjustment(uuid,uuid,jsonb)'::regprocedure,
  $old$  v_item RECORD; v_diff NUMERIC; v_cost NUMERIC; v_variance NUMERIC:=0;$old$,
  $new$  v_item RECORD; v_diff NUMERIC; v_cost NUMERIC; v_variance NUMERIC:=0; v_current_qty NUMERIC;$new$
);

SELECT mm_private._inventory_ledger_patch(
  'public.commit_stock_audit_adjustment(uuid,uuid,jsonb)'::regprocedure,
  $old$    v_diff:=v_item.audited_qty-v_item.recorded_qty;$old$,
  $new$    IF v_item.audited_qty IS NULL OR v_item.audited_qty < 0 OR v_item.recorded_qty IS NULL THEN
      RAISE EXCEPTION 'Recorded and audited stock quantities are required and audited quantity cannot be negative';
    END IF;
    SELECT ib.quantity_on_hand INTO v_current_qty
    FROM public.inventory_balances ib
    WHERE ib.business_id = p_business_id
      AND ib.product_service_id = v_item.product_id
      AND ib.location_id = p_location_id
    FOR UPDATE;
    v_current_qty := coalesce(v_current_qty, 0);
    IF round(v_current_qty, 6) <> round(v_item.recorded_qty, 6) THEN
      RAISE EXCEPTION 'Inventory changed since this stock audit was loaded. Refresh stock levels before committing.';
    END IF;
    v_diff := v_item.audited_qty - v_current_qty;$new$
);

SELECT mm_private._inventory_ledger_patch(
  'public.commit_stock_audit_adjustment(uuid,uuid,jsonb)'::regprocedure,
  $old$      UPDATE inventory_balances SET quantity_on_hand=v_item.audited_qty,updated_at=now()
      WHERE business_id=p_business_id AND product_service_id=v_item.product_id AND location_id=p_location_id;
      IF NOT FOUND THEN
        INSERT INTO inventory_balances(business_id,product_service_id,location_id,quantity_on_hand,average_cost,reorder_level)
        VALUES(p_business_id,v_item.product_id,p_location_id,v_item.audited_qty,v_cost,0);
      END IF;$old$,
  ''
);

SELECT mm_private._inventory_ledger_patch(
  'public.post_bill_legacy(uuid)'::regprocedure,
  $old$        if v_old_qty is null then
          insert into public.inventory_balances(business_id,location_id,product_service_id,quantity_on_hand,average_cost,reorder_level) values(b.business_id,v_location,v_line.product_service_id,v_line.quantity,coalesce(v_base/nullif(v_line.quantity,0),v_line.purchase_price,0),coalesce((select reorder_level from public.products_services where id=v_line.product_service_id),0));
        else
          v_new_qty:=v_old_qty+v_line.quantity;
          v_new_cost:=case when v_new_qty=0 then 0 else round(((v_old_qty*coalesce(v_old_cost,0))+(v_line.quantity*coalesce(v_base/nullif(v_line.quantity,0),v_line.purchase_price,0)))/v_new_qty,4) end;
          update public.inventory_balances set quantity_on_hand=v_new_qty,average_cost=v_new_cost,updated_at=now() where business_id=b.business_id and location_id=v_location and product_service_id=v_line.product_service_id;
        end if;$old$,
  ''
);

SELECT mm_private._inventory_ledger_patch(
  'public.post_credit_note(uuid,uuid)'::regprocedure,
  $old$      UPDATE public.inventory_balances
      SET quantity_on_hand=quantity_on_hand+r.quantity,
          updated_at=now()
      WHERE business_id=n.business_id
        AND location_id=loc
        AND product_service_id=r.product_service_id;
$old$,
  ''
);

SELECT mm_private._inventory_ledger_patch(
  'public.post_vendor_credit(uuid,uuid)'::regprocedure,
  $old$      UPDATE public.inventory_balances
      SET quantity_on_hand=greatest(quantity_on_hand-line.quantity,0),
          updated_at=now()
      WHERE business_id=n.business_id
        AND location_id=loc
        AND product_service_id=line.product_service_id;
$old$,
  ''
);

SELECT mm_private._inventory_ledger_patch(
  'public.update_bill_any_state(uuid,uuid,date,date,jsonb,text,boolean,boolean,text,text)'::regprocedure,
  $old$      UPDATE public.inventory_balances
      SET quantity_on_hand = quantity_on_hand - v_line.quantity,
          updated_at = now()
      WHERE business_id = b.business_id
        AND location_id = v_line.location_id
        AND product_service_id = v_line.product_service_id;
$old$,
  ''
);

SELECT mm_private._inventory_ledger_patch(
  'public.update_bill_any_state(uuid,uuid,date,date,jsonb,text,boolean,boolean,text,text)'::regprocedure,
  $old$          IF v_old_qty IS NULL THEN
            INSERT INTO public.inventory_balances(
              business_id,location_id,product_service_id,quantity_on_hand,average_cost,reorder_level
            )
            VALUES(
              b.business_id,v_location,v_line.product_service_id,v_line.quantity,v_unit_cost,
              coalesce((SELECT reorder_level FROM public.products_services WHERE id=v_line.product_service_id),0)
            );
          ELSE
            UPDATE public.inventory_balances
            SET quantity_on_hand=v_old_qty+v_line.quantity,
                average_cost=CASE
                  WHEN v_old_qty+v_line.quantity=0 THEN 0
                  ELSE round(((v_old_qty*coalesce(v_old_cost,0))+(v_line.quantity*v_unit_cost))/(v_old_qty+v_line.quantity),4)
                END,
                updated_at=now()
            WHERE business_id=b.business_id AND location_id=v_location AND product_service_id=v_line.product_service_id;
          END IF;$old$,
  ''
);

SELECT mm_private._inventory_ledger_patch(
  'public.update_invoice_any_state(uuid,uuid,date,date,jsonb,text,numeric,text,text,uuid,date,uuid,text,uuid)'::regprocedure,
  $old$      UPDATE public.inventory_balances SET quantity_on_hand=quantity_on_hand+v_product_row.quantity,updated_at=now()
      WHERE business_id=inv.business_id AND location_id=v_product_row.location_id AND product_service_id=v_product_row.product_service_id;
      IF NOT FOUND THEN
        INSERT INTO public.inventory_balances(business_id,location_id,product_service_id,quantity_on_hand,average_cost,updated_at)
        VALUES(inv.business_id,v_product_row.location_id,v_product_row.product_service_id,v_product_row.quantity,v_product_row.unit_cost,now());
      END IF;$old$,
  ''
);

SELECT mm_private._inventory_ledger_patch(
  'public.update_invoice_any_state(uuid,uuid,date,date,jsonb,text,numeric,text,text,uuid,date,uuid,text,uuid)'::regprocedure,
  $old$        IF v_cost IS NULL OR v_stock < v_product_row.quantity THEN RAISE EXCEPTION 'Insufficient inventory for product %',v_product_row.product_service_id; END IF;$old$,
  $new$        -- The movement trigger enforces stock policy on the eventual sale
        -- movement; retain cost information for COGS even when negative stock is allowed.
        IF v_cost IS NULL THEN
          SELECT coalesce(ps.purchase_price, 0) INTO v_cost
          FROM public.products_services ps
          WHERE ps.id = v_product_row.product_service_id
            AND ps.business_id = inv.business_id;
        END IF;
        v_cost := coalesce(v_cost, 0);$new$
);

SELECT mm_private._inventory_ledger_patch(
  'public.update_invoice_any_state(uuid,uuid,date,date,jsonb,text,numeric,text,text,uuid,date,uuid,text,uuid)'::regprocedure,
  $old$        UPDATE public.inventory_balances SET quantity_on_hand=quantity_on_hand-v_product_row.quantity,updated_at=now() WHERE business_id=inv.business_id AND location_id=v_location AND product_service_id=v_product_row.product_service_id;$old$,
  ''
);

SELECT mm_private._inventory_ledger_patch(
  'public.update_invoice_any_state(uuid,uuid,date,date,jsonb,text,numeric,text,text,uuid,date,uuid,text,uuid)'::regprocedure,
  $old$  CREATE TEMP TABLE IF NOT EXISTS pg_temp.mm_invoice_amend_totals(subtotal numeric,discount numeric,tax numeric,total numeric) ON COMMIT DROP;$old$,
  $new$  IF inv.source_challan_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.delivery_challans dc
      WHERE dc.id = inv.source_challan_id
        AND dc.business_id = inv.business_id
        AND dc.status = 'invoiced'
        AND dc.converted_invoice_id = inv.id
    ) THEN
      RAISE EXCEPTION 'Source delivery challan is invalid for this invoice';
    END IF;

    IF EXISTS (
      (SELECT product_service_id, round(sum(quantity), 6) AS quantity
       FROM pg_temp.mm_invoice_amend_lines GROUP BY product_service_id)
      EXCEPT
      (SELECT product_service_id, round(sum(quantity), 6) AS quantity
       FROM public.delivery_challan_items WHERE challan_id = inv.source_challan_id
       GROUP BY product_service_id)
    ) OR EXISTS (
      (SELECT product_service_id, round(sum(quantity), 6) AS quantity
       FROM public.delivery_challan_items WHERE challan_id = inv.source_challan_id
       GROUP BY product_service_id)
      EXCEPT
      (SELECT product_service_id, round(sum(quantity), 6) AS quantity
       FROM pg_temp.mm_invoice_amend_lines GROUP BY product_service_id)
    ) THEN
      RAISE EXCEPTION 'Source delivery challan quantities must match invoice quantities';
    END IF;
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.mm_invoice_amend_totals(subtotal numeric,discount numeric,tax numeric,total numeric) ON COMMIT DROP;$new$
);

SELECT mm_private._inventory_ledger_patch(
  'public.update_invoice_any_state(uuid,uuid,date,date,jsonb,text,numeric,text,text,uuid,date,uuid,text,uuid)'::regprocedure,
  $old$  IF inv.journal_entry_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.businesses WHERE id=inv.business_id AND inventory_enabled) THEN$old$,
  $new$  IF inv.journal_entry_id IS NOT NULL
     AND inv.source_challan_id IS NOT NULL
     AND EXISTS(SELECT 1 FROM public.businesses WHERE id=inv.business_id AND inventory_enabled)
  THEN
    -- Challan dispatch already moved stock. Recompute COGS from its movements;
    -- never create invoice sale movements for a challan-sourced invoice.
    FOR v_product_row IN
      SELECT l.product_service_id, sum(l.quantity) AS quantity
      FROM pg_temp.mm_invoice_amend_lines l
      JOIN public.products_services ps ON ps.id = l.product_service_id
      WHERE ps.business_id = inv.business_id
        AND ps.inventory_tracked
      GROUP BY l.product_service_id
    LOOP
      SELECT coalesce(sum(im.quantity), 0),
             coalesce(sum(im.quantity * im.unit_cost), 0)
        INTO v_stock, v_cost
      FROM public.inventory_movements im
      WHERE im.business_id = inv.business_id
        AND im.reference_type = 'delivery_challan'
        AND im.reference_id = inv.source_challan_id
        AND im.movement_type = 'delivery_challan_out'
        AND im.product_service_id = v_product_row.product_service_id;

      IF round(coalesce(v_stock, 0), 6) <> round(v_product_row.quantity, 6) THEN
        RAISE EXCEPTION 'Delivery challan inventory movement is missing or duplicated for product %',
          v_product_row.product_service_id;
      END IF;
      v_cogs_total := v_cogs_total + round(coalesce(v_cost, 0), 2);
    END LOOP;
  END IF;

  IF inv.journal_entry_id IS NOT NULL AND inv.source_challan_id IS NULL AND EXISTS(SELECT 1 FROM public.businesses WHERE id=inv.business_id AND inventory_enabled) THEN$new$
);

-- Reverse/repost the source-challan COGS from the original dispatch ledger above,
-- without creating a second inventory deduction for the invoice amendment.

SELECT mm_private._inventory_ledger_patch(
  'public.void_invoice(uuid,text)'::regprocedure,
  $old$   update public.inventory_balances set quantity_on_hand=quantity_on_hand+mov.quantity,updated_at=now() where business_id=inv.business_id and location_id=mov.location_id and product_service_id=mov.product_service_id;
   if not found then insert into public.inventory_balances(business_id,location_id,product_service_id,quantity_on_hand,average_cost,updated_at) values(inv.business_id,mov.location_id,mov.product_service_id,mov.quantity,mov.unit_cost,now()); end if;$old$,
  ''
);

DO $inventory_ledger_postflight$
DECLARE
  v_body text;
  v_direct_writer text;
  v_required text;
BEGIN
  SELECT p.prosrc INTO v_body
  FROM pg_proc p
  WHERE p.oid = 'public.process_inventory_movement()'::regprocedure;
  IF v_body IS NULL THEN
    RAISE EXCEPTION 'Inventory ledger movement trigger function is missing';
  END IF;

  FOREACH v_required IN ARRAY ARRAY[
    'WHEN ''sale'' THEN',
    'WHEN ''pos_sale'' THEN',
    'WHEN ''delivery_challan_out'' THEN',
    'WHEN ''transfer_out'' THEN',
    'WHEN ''return_to_vendor'' THEN',
    'WHEN ''damaged'' THEN',
    'WHEN ''purchase_in'' THEN',
    'WHEN ''transfer_in'' THEN',
    'WHEN ''customer_return'' THEN',
    'WHEN ''opening_stock'' THEN',
    'WHEN ''stock_adjustment_in'' THEN'
  ]
  LOOP
    IF position(v_required IN v_body) = 0 THEN
      RAISE EXCEPTION 'Inventory trigger movement mapping is missing: %', v_required;
    END IF;
  END LOOP;

  IF position('Insufficient stock for product' IN v_body) = 0
     OR position('allow_negative_stock' IN v_body) = 0
     OR position('pg_advisory_xact_lock' IN v_body) = 0 THEN
    RAISE EXCEPTION 'Inventory trigger stock-policy or concurrency guards are missing';
  END IF;

  -- The movement trigger is the only function allowed to write the balance
  -- projection; operational RPCs must express deltas as inventory movements.
  SELECT format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))
  INTO v_direct_writer
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  CROSS JOIN LATERAL regexp_split_to_table(p.prosrc, E'\n') AS source_line(line)
  WHERE n.nspname IN ('public', 'mm_private')
    AND p.prokind = 'f'
    AND p.oid <> 'public.process_inventory_movement()'::regprocedure
    AND source_line.line ~* '^[[:space:]]*(update[[:space:]]+(public\.)?inventory_balances|insert[[:space:]]+into[[:space:]]+(public\.)?inventory_balances|delete[[:space:]]+from[[:space:]]+(public\.)?inventory_balances)'
  LIMIT 1;
  IF v_direct_writer IS NOT NULL THEN
    RAISE EXCEPTION 'Inventory RPC writes directly to inventory_balances: %', v_direct_writer;
  END IF;

  SELECT lower(p.prosrc) INTO v_body
  FROM pg_proc p
  WHERE p.oid = 'public.post_invoice(uuid,uuid)'::regprocedure;
  IF position('ps.inventory_tracked' IN v_body) = 0
     OR position('insert into public.inventory_movements' IN v_body) = 0
     OR position('round(v_challan_movement_qty, 6) <> round(v_challan_qty, 6)' IN v_body) = 0 THEN
    RAISE EXCEPTION 'Invoice posting must use movement-ledger stock posting and exact challan movement validation';
  END IF;

  SELECT lower(p.prosrc) INTO v_body
  FROM pg_proc p
  WHERE p.oid = 'public.update_invoice_any_state(uuid,uuid,date,date,jsonb,text,numeric,text,text,uuid,date,uuid,text,uuid)'::regprocedure;
  IF position('inv.source_challan_id is not null' IN v_body) = 0
     OR position('inv.source_challan_id is null' IN v_body) = 0
     OR position('never create invoice sale movements for a challan-sourced invoice' IN v_body) = 0
     OR position('source delivery challan quantities must match invoice quantities' IN v_body) = 0 THEN
    RAISE EXCEPTION 'Invoice amendment must preserve the dispatch-first challan inventory invariant';
  END IF;

  SELECT lower(p.prosrc) INTO v_body
  FROM pg_proc p
  WHERE p.oid = 'public.commit_stock_audit_adjustment(uuid,uuid,jsonb)'::regprocedure;
  IF position('inventory changed since this stock audit was loaded' IN v_body) = 0
     OR position('insert into inventory_movements' IN v_body) = 0 THEN
    RAISE EXCEPTION 'Stock audit must use a locked live balance and post adjustments through inventory_movements';
  END IF;

  SELECT lower(p.prosrc) INTO v_body
  FROM pg_proc p
  WHERE p.oid = 'public.transfer_inventory_between_locations(uuid,uuid,uuid,jsonb,date,text)'::regprocedure;
  IF v_body IS NULL
     OR position('has_business_permission' IN v_body) = 0
     OR position('transfer_out' IN v_body) = 0
     OR position('transfer_in' IN v_body) = 0
     OR position('inventory_transfer' IN v_body) = 0 THEN
    RAISE EXCEPTION 'Warehouse transfer must be authenticated, tenant-scoped, atomic movement-ledger posting';
  END IF;

  IF has_table_privilege('authenticated', 'public.inventory_balances', 'INSERT')
     OR has_table_privilege('authenticated', 'public.inventory_balances', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.inventory_balances', 'DELETE')
     OR has_table_privilege('service_role', 'public.inventory_balances', 'INSERT')
     OR has_table_privilege('service_role', 'public.inventory_balances', 'UPDATE')
     OR has_table_privilege('service_role', 'public.inventory_balances', 'DELETE') THEN
    RAISE EXCEPTION 'Direct inventory_balances DML privileges must remain revoked';
  END IF;

  -- Every positive opening-stock metadata row without an existing movement or
  -- balance must be posted into an active warehouse or the migration rolls back.
  IF EXISTS (
    SELECT 1
    FROM public.products_services ps
    WHERE ps.inventory_tracked
      AND coalesce(ps.opening_stock, 0) > 0
      AND NOT EXISTS (
        SELECT 1 FROM public.inventory_movements im
        WHERE im.business_id = ps.business_id
          AND im.product_service_id = ps.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.inventory_balances ib
        WHERE ib.business_id = ps.business_id
          AND ib.product_service_id = ps.id
      )
  ) THEN
    RAISE EXCEPTION 'Opening stock initialization incomplete: tracked products still have no inventory ledger or balance';
  END IF;
END;
$inventory_ledger_postflight$;

DROP FUNCTION mm_private._inventory_ledger_patch(regprocedure, text, text);

-- Warehouse transfers are operational ledger entries, not tax invoices. Both
-- legs are committed atomically; any insufficient-stock exception rolls back
-- the header, lines, and both movement sets.
CREATE OR REPLACE FUNCTION public.transfer_inventory_between_locations(
  p_business_id uuid,
  p_from_location_id uuid,
  p_to_location_id uuid,
  p_items jsonb,
  p_transfer_date date DEFAULT current_date,
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, mm_private, pg_temp
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_transfer_id uuid;
  v_item record;
  v_on_hand numeric;
  v_average_cost numeric;
  v_purchase_price numeric;
  v_unit_cost numeric;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF NOT mm_private.has_business_permission(p_business_id, 'inventory.manage', v_user_id) THEN
    RAISE EXCEPTION 'Access denied: inventory.manage permission required';
  END IF;
  IF p_from_location_id IS NULL OR p_to_location_id IS NULL OR p_from_location_id = p_to_location_id THEN
    RAISE EXCEPTION 'Select two different inventory locations';
  END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Transfer items must be a JSON array';
  END IF;
  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Inventory transfer must contain at least one item';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.inventory_locations il
    WHERE il.id = p_from_location_id AND il.business_id = p_business_id AND il.is_active
  ) THEN
    RAISE EXCEPTION 'Source inventory location is invalid';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.inventory_locations il
    WHERE il.id = p_to_location_id AND il.business_id = p_business_id AND il.is_active
  ) THEN
    RAISE EXCEPTION 'Destination inventory location is invalid';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_items) AS x(product_service_id uuid, quantity numeric)
    WHERE x.product_service_id IS NULL OR x.quantity IS NULL OR x.quantity <= 0
  ) THEN
    RAISE EXCEPTION 'Transfer items require a product and positive quantity';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_items) AS x(product_service_id uuid, quantity numeric)
    LEFT JOIN public.products_services ps
      ON ps.id = x.product_service_id
     AND ps.business_id = p_business_id
     AND ps.is_active
     AND ps.inventory_tracked
    WHERE ps.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Transfer items must reference active inventory-tracked products in this business';
  END IF;

  INSERT INTO public.inventory_transfers (
    business_id, from_location_id, to_location_id, transfer_date, status, notes, created_by
  )
  VALUES (
    p_business_id, p_from_location_id, p_to_location_id,
    coalesce(p_transfer_date, current_date), 'completed', nullif(btrim(p_notes), ''), v_user_id
  )
  RETURNING id INTO v_transfer_id;

  FOR v_item IN
    SELECT * FROM jsonb_to_recordset(p_items) AS x(
      product_service_id uuid, quantity numeric, batch_number text, serial_number text
    )
  LOOP
    SELECT ib.quantity_on_hand, ib.average_cost, ps.purchase_price
      INTO v_on_hand, v_average_cost, v_purchase_price
    FROM public.products_services ps
    LEFT JOIN public.inventory_balances ib
      ON ib.business_id = ps.business_id
     AND ib.product_service_id = ps.id
     AND ib.location_id = p_from_location_id
    WHERE ps.id = v_item.product_service_id
      AND ps.business_id = p_business_id
      AND ps.is_active
      AND ps.inventory_tracked
    FOR UPDATE OF ps;

    IF NOT FOUND OR coalesce(v_on_hand, 0) < v_item.quantity THEN
      RAISE EXCEPTION 'Insufficient stock at the source location for product %',
        v_item.product_service_id;
    END IF;

    v_unit_cost := coalesce(nullif(v_average_cost, 0), v_purchase_price, 0);

    INSERT INTO public.inventory_transfer_items (
      transfer_id, product_service_id, quantity, unit_cost, batch_number, serial_number
    )
    VALUES (
      v_transfer_id, v_item.product_service_id, v_item.quantity, v_unit_cost,
      nullif(btrim(v_item.batch_number), ''), nullif(btrim(v_item.serial_number), '')
    );

    INSERT INTO public.inventory_movements (
      business_id, location_id, product_service_id, movement_type, quantity,
      unit_cost, reference_type, reference_id, batch_number, serial_number, notes, created_by
    )
    VALUES (
      p_business_id, p_from_location_id, v_item.product_service_id, 'transfer_out',
      v_item.quantity, v_unit_cost, 'inventory_transfer', v_transfer_id,
      nullif(btrim(v_item.batch_number), ''), nullif(btrim(v_item.serial_number), ''),
      'Warehouse transfer out', v_user_id
    );

    INSERT INTO public.inventory_movements (
      business_id, location_id, product_service_id, movement_type, quantity,
      unit_cost, reference_type, reference_id, batch_number, serial_number, notes, created_by
    )
    VALUES (
      p_business_id, p_to_location_id, v_item.product_service_id, 'transfer_in',
      v_item.quantity, v_unit_cost, 'inventory_transfer', v_transfer_id,
      nullif(btrim(v_item.batch_number), ''), nullif(btrim(v_item.serial_number), ''),
      'Warehouse transfer in', v_user_id
    );
  END LOOP;

  RETURN v_transfer_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.transfer_inventory_between_locations(uuid, uuid, uuid, jsonb, date, text)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transfer_inventory_between_locations(uuid, uuid, uuid, jsonb, date, text)
TO authenticated;

COMMIT;
