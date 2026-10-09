BEGIN;

-- When a business has catalog items explicitly marked inventory_tracked, use
-- that line-level setting to decide whether stock must be posted. A legacy or
-- incomplete business capability flag must not disable ledger posting.
CREATE OR REPLACE FUNCTION mm_private._tracked_item_inventory_patch(
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
  v_occurrences integer;
BEGIN
  SELECT pg_get_functiondef(p_target) INTO v_definition;
  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'Tracked-item inventory patch target % was not found', p_target;
  END IF;
  IF p_old IS NULL OR length(p_old) = 0 THEN
    RAISE EXCEPTION 'Tracked-item inventory patch for % has an empty match string', p_target;
  END IF;

  v_occurrences :=
    (length(v_definition) - length(replace(v_definition, p_old, ''))) / length(p_old);
  IF v_occurrences <> 1 THEN
    RAISE EXCEPTION 'Tracked-item inventory patch for % expected one match, found %', p_target, v_occurrences;
  END IF;

  EXECUTE replace(v_definition, p_old, p_new);
END;
$function$;

REVOKE ALL ON FUNCTION mm_private._tracked_item_inventory_patch(regprocedure, text, text)
FROM PUBLIC, anon, authenticated, service_role;

-- Invoice/POS posting: tracked line items activate inventory posting even when
-- the business-wide feature flag is stale or off.
SELECT mm_private._tracked_item_inventory_patch(
  'public.post_invoice(uuid,uuid)'::regprocedure,
  $old$  SELECT coalesce((b.feature_flags->>'has_physical_inventory')::boolean,false),
         coalesce((b.feature_flags->>'track_batch_serial')::boolean,false)
    INTO v_physical,v_track
  FROM public.businesses b WHERE b.id=inv.business_id;$old$,
  $new$  SELECT coalesce((b.feature_flags->>'has_physical_inventory')::boolean,false),
         coalesce((b.feature_flags->>'track_batch_serial')::boolean,false)
    INTO v_physical,v_track
  FROM public.businesses b WHERE b.id=inv.business_id;

  IF EXISTS (
    SELECT 1
    FROM public.invoice_items ii
    JOIN public.products_services ps
      ON ps.id = ii.product_service_id
     AND ps.business_id = inv.business_id
    WHERE ii.invoice_id = inv.id
      AND ps.inventory_tracked
  ) THEN
    v_physical := true;
  END IF;$new$
);

-- Cash Bills call post_invoice(..., NULL). Resolve a safe same-business active
-- default location for tracked products rather than skipping stock posting.
SELECT mm_private._tracked_item_inventory_patch(
  'public.post_invoice(uuid,uuid)'::regprocedure,
  $old$v_location:=coalesce(p_location_id,inv.inventory_location_id);$old$,
  $new$v_location := coalesce(
        p_location_id,
        inv.inventory_location_id,
        (
          SELECT il.id
          FROM public.inventory_locations il
          WHERE il.business_id = inv.business_id
            AND il.is_active
          ORDER BY il.is_default DESC, il.name, il.id
          LIMIT 1
        )
      );$new$
);

-- Posted challan invoices still use the already-committed dispatch movements,
-- but their COGS integrity checks cannot depend on the business-wide flag.
SELECT mm_private._tracked_item_inventory_patch(
  'public.update_invoice_any_state(uuid,uuid,date,date,jsonb,text,numeric,text,text,uuid,date,uuid,text,uuid)'::regprocedure,
  $old$IF inv.journal_entry_id IS NOT NULL
     AND inv.source_challan_id IS NOT NULL
     AND EXISTS(SELECT 1 FROM public.businesses WHERE id=inv.business_id AND inventory_enabled)
  THEN$old$,
  $new$IF inv.journal_entry_id IS NOT NULL
     AND inv.source_challan_id IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM pg_temp.mm_invoice_amend_lines l
       JOIN public.products_services ps
         ON ps.id = l.product_service_id
       WHERE ps.business_id = inv.business_id
         AND ps.inventory_tracked
     )
  THEN$new$
);

-- Ordinary posted-invoice amendments also use tracked line items to decide
-- whether to reverse/repost stock movements.
SELECT mm_private._tracked_item_inventory_patch(
  'public.update_invoice_any_state(uuid,uuid,date,date,jsonb,text,numeric,text,text,uuid,date,uuid,text,uuid)'::regprocedure,
  $old$IF inv.journal_entry_id IS NOT NULL AND inv.source_challan_id IS NULL AND EXISTS(SELECT 1 FROM public.businesses WHERE id=inv.business_id AND inventory_enabled) THEN$old$,
  $new$IF inv.journal_entry_id IS NOT NULL
     AND inv.source_challan_id IS NULL
     AND EXISTS (
       SELECT 1
       FROM pg_temp.mm_invoice_amend_lines l
       JOIN public.products_services ps
         ON ps.id = l.product_service_id
       WHERE ps.business_id = inv.business_id
         AND ps.inventory_tracked
     )
  THEN$new$
);

-- A tracked line cannot silently skip inventory on invoice amendment when no
-- usable location exists. An explicit location must be active in this business.
SELECT mm_private._tracked_item_inventory_patch(
  'public.update_invoice_any_state(uuid,uuid,date,date,jsonb,text,numeric,text,text,uuid,date,uuid,text,uuid)'::regprocedure,
  $old$SELECT coalesce(p_location_id,(SELECT id FROM public.inventory_locations WHERE business_id=inv.business_id AND is_default AND is_active LIMIT 1)) INTO v_location;$old$,
  $new$SELECT coalesce(
      p_location_id,
      (
        SELECT il.id
        FROM public.inventory_locations il
        WHERE il.business_id = inv.business_id
          AND il.is_active
        ORDER BY il.is_default DESC, il.name, il.id
        LIMIT 1
      )
    ) INTO v_location;

    IF v_location IS NULL THEN
      RAISE EXCEPTION 'Inventory location is required before amending a tracked-item invoice';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.inventory_locations il
      WHERE il.id = v_location
        AND il.business_id = inv.business_id
        AND il.is_active
    ) THEN
      RAISE EXCEPTION 'Inventory location is invalid';
    END IF;$new$
);

-- Credit notes returning tracked products need a default active location based
-- on the actual line items, not businesses.inventory_enabled.
SELECT mm_private._tracked_item_inventory_patch(
  'public.post_credit_note(uuid,uuid)'::regprocedure,
  $old$IF p_location_id IS NULL
     AND EXISTS(
       SELECT 1 FROM public.businesses
       WHERE id=n.business_id
         AND inventory_enabled
     ) THEN$old$,
  $new$IF p_location_id IS NULL
     AND EXISTS (
       SELECT 1
       FROM public.credit_note_items cni
       JOIN public.products_services ps
         ON ps.id = cni.product_service_id
        AND ps.business_id = n.business_id
       WHERE cni.credit_note_id = n.id
         AND cni.product_service_id IS NOT NULL
         AND ps.inventory_tracked
     ) THEN$new$
);

SELECT mm_private._tracked_item_inventory_patch(
  'public.post_credit_note(uuid,uuid)'::regprocedure,
  $old$    SELECT id INTO loc
    FROM public.inventory_locations
    WHERE business_id=n.business_id
      AND is_default
      AND is_active
    LIMIT 1;$old$,
  $new$    SELECT il.id INTO loc
    FROM public.inventory_locations il
    WHERE il.business_id = n.business_id
      AND il.is_active
    ORDER BY il.is_default DESC, il.name, il.id
    LIMIT 1;

    IF loc IS NULL THEN
      RAISE EXCEPTION 'Inventory location is required to return tracked items on a credit note';
    END IF;$new$
);

DROP FUNCTION mm_private._tracked_item_inventory_patch(regprocedure, text, text);

COMMIT;
