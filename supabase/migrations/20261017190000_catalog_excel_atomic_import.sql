BEGIN;

CREATE OR REPLACE FUNCTION public.import_product_catalog(p_business_id uuid, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'mm_private', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_row jsonb;
  v_ord bigint;
  v_row_number integer;
  v_category_name text;
  v_subcategory_name text;
  v_item_type text;
  v_item_name text;
  v_sku text;
  v_hsn text;
  v_unit text;
  v_description text;
  v_sale_price numeric;
  v_purchase_price numeric;
  v_tax_rate numeric;
  v_opening_stock numeric;
  v_tax_rate_id uuid;
  v_category_id uuid;
  v_subcategory_id uuid;
  v_item_id uuid;
  v_existing_type text;
  v_match_count integer;
  v_category_created boolean;
  v_subcategory_created boolean;
  v_imported integer := 0;
  v_updated integer := 0;
  v_skipped integer := 0;
  v_errors jsonb := '[]'::jsonb;
  v_new_categories text[] := ARRAY[]::text[];
  v_new_subcategories text[] := ARRAY[]::text[];
  v_subcategory_key text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF p_business_id IS NULL OR NOT mm_private.has_business_permission(p_business_id, 'inventory.manage', v_user_id) THEN
    RAISE EXCEPTION 'Access denied: inventory.manage permission is required for this business';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Catalog import rows must be a JSON array';
  END IF;
  IF jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'The workbook contains no data rows';
  END IF;
  IF jsonb_array_length(p_rows) > 5000 THEN
    RAISE EXCEPTION 'Catalog import is limited to 5000 rows per workbook';
  END IF;

  -- Serialize catalog imports per business to avoid duplicate category creation
  -- when two users import into the same business at the same time.
  PERFORM 1 FROM public.businesses WHERE id = p_business_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Business not found';
  END IF;

  FOR v_row, v_ord IN
    SELECT value, ordinality
    FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS rows(value, ordinality)
  LOOP
    v_row_number := v_ord::integer + 1;
    v_category_name := NULL;
    v_subcategory_name := NULL;
    v_item_type := NULL;
    v_item_name := NULL;
    v_sku := NULL;
    v_hsn := NULL;
    v_unit := NULL;
    v_description := NULL;
    v_sale_price := 0;
    v_purchase_price := 0;
    v_tax_rate := 0;
    v_opening_stock := 0;
    v_tax_rate_id := NULL;
    v_category_id := NULL;
    v_subcategory_id := NULL;
    v_item_id := NULL;
    v_existing_type := NULL;
    v_match_count := 0;
    v_category_created := false;
    v_subcategory_created := false;
    v_subcategory_key := NULL;

    -- Each row is a savepoint: a bad row is skipped without leaving behind
    -- an empty category, subcategory, product, or partial stock initialization.
    BEGIN
      v_row_number := coalesce(nullif(v_row->>'_sheet_row', '')::integer, v_row_number);
      IF jsonb_typeof(v_row) IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'Row must be a JSON object';
      END IF;

      v_category_name := nullif(btrim(v_row->>'category'), '');
      v_subcategory_name := nullif(btrim(v_row->>'subcategory'), '');
      v_item_type := lower(coalesce(nullif(btrim(v_row->>'type'), ''), 'product'));
      v_item_name := nullif(btrim(v_row->>'item_name'), '');
      v_sku := nullif(btrim(v_row->>'sku'), '');
      v_hsn := nullif(btrim(v_row->>'hsn_sac'), '');
      v_unit := nullif(btrim(v_row->>'unit'), '');
      v_description := nullif(btrim(v_row->>'description'), '');

      IF v_category_name IS NULL THEN RAISE EXCEPTION 'Category is required'; END IF;
      IF v_item_name IS NULL THEN RAISE EXCEPTION 'Item Name is required'; END IF;
      IF v_item_type NOT IN ('product', 'service') THEN
        RAISE EXCEPTION 'Type must be product or service';
      END IF;
      IF v_hsn IS NULL THEN
        RAISE EXCEPTION 'HSN/SAC is required (use the SAC code for services)';
      END IF;

      BEGIN
        v_sale_price := coalesce(nullif(btrim(v_row->>'sale_price'), '')::numeric, 0);
        v_purchase_price := coalesce(nullif(btrim(v_row->>'purchase_price'), '')::numeric, 0);
        v_tax_rate := coalesce(nullif(btrim(v_row->>'tax_rate'), '')::numeric, 0);
        v_opening_stock := coalesce(nullif(btrim(v_row->>'opening_stock'), '')::numeric, 0);
      EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        RAISE EXCEPTION 'Sale Price, Purchase Price, Tax Rate and Opening Stock must be valid numbers';
      END;

      IF v_sale_price < 0 OR v_purchase_price < 0 THEN
        RAISE EXCEPTION 'Sale Price and Purchase Price cannot be negative';
      END IF;
      IF v_tax_rate < 0 OR v_tax_rate > 100 THEN
        RAISE EXCEPTION 'Tax Rate must be between 0 and 100 percent';
      END IF;
      IF v_opening_stock < 0 THEN
        RAISE EXCEPTION 'Opening Stock cannot be negative';
      END IF;
      IF v_item_type = 'product' AND v_unit IS NULL THEN
        RAISE EXCEPTION 'Unit is required for goods/products';
      END IF;
      IF v_item_type = 'service' THEN
        v_unit := coalesce(v_unit, 'hrs');
        v_opening_stock := 0;
      END IF;

      IF v_tax_rate > 0 THEN
        SELECT tr.id INTO v_tax_rate_id
        FROM public.tax_rates tr
        WHERE tr.business_id = p_business_id
          AND tr.is_active
          AND round(tr.rate::numeric, 2) = round(v_tax_rate, 2)
        ORDER BY tr.name, tr.id
        LIMIT 1;
        IF v_tax_rate_id IS NULL THEN
          RAISE EXCEPTION 'No active tax rate configured for % percent; configure the tax rate before importing this row', v_tax_rate;
        END IF;
      ELSE
        SELECT tr.id INTO v_tax_rate_id
        FROM public.tax_rates tr
        WHERE tr.business_id = p_business_id
          AND tr.is_active
          AND round(tr.rate::numeric, 2) = 0
        ORDER BY tr.name, tr.id
        LIMIT 1;
      END IF;

      SELECT pc.id INTO v_category_id
      FROM public.product_categories pc
      WHERE pc.business_id = p_business_id
        AND lower(btrim(pc.name)) = lower(v_category_name)
      ORDER BY pc.is_active DESC, pc.id
      LIMIT 1;

      IF v_category_id IS NULL THEN
        INSERT INTO public.product_categories(
          business_id, name, default_hsn_sac, default_tax_rate_id, is_active
        ) VALUES (
          p_business_id, v_category_name, v_hsn, v_tax_rate_id, true
        )
        RETURNING id INTO v_category_id;
        v_category_created := true;
      ELSE
        UPDATE public.product_categories
        SET is_active = true
        WHERE id = v_category_id AND business_id = p_business_id AND NOT is_active;
      END IF;

      IF v_subcategory_name IS NOT NULL THEN
        SELECT ps.id INTO v_subcategory_id
        FROM public.product_subcategories ps
        WHERE ps.business_id = p_business_id
          AND ps.category_id = v_category_id
          AND lower(btrim(ps.name)) = lower(v_subcategory_name)
        ORDER BY ps.is_active DESC, ps.id
        LIMIT 1;

        IF v_subcategory_id IS NULL THEN
          INSERT INTO public.product_subcategories(business_id, category_id, name, is_active)
          VALUES (p_business_id, v_category_id, v_subcategory_name, true)
          RETURNING id INTO v_subcategory_id;
          v_subcategory_created := true;
        ELSE
          UPDATE public.product_subcategories
          SET is_active = true
          WHERE id = v_subcategory_id AND business_id = p_business_id AND NOT is_active;
        END IF;
        v_subcategory_key := v_category_id::text || ':' || lower(v_subcategory_name);
      END IF;

      -- Prefer SKU/code for upsert; if no SKU match exists, fall back to a
      -- unique business-scoped item name + type. Ambiguous matches are skipped.
      IF v_sku IS NOT NULL THEN
        SELECT count(*) INTO v_match_count
        FROM public.products_services ps
        WHERE ps.business_id = p_business_id
          AND lower(btrim(ps.sku)) = lower(v_sku);
        IF v_match_count > 1 THEN
          RAISE EXCEPTION 'Item Code / SKU matches more than one catalog item; resolve the duplicate SKU first';
        ELSIF v_match_count = 1 THEN
          SELECT ps.id, ps.item_type INTO v_item_id, v_existing_type
          FROM public.products_services ps
          WHERE ps.business_id = p_business_id
            AND lower(btrim(ps.sku)) = lower(v_sku)
          ORDER BY ps.created_at, ps.id
          LIMIT 1;
          IF v_existing_type <> v_item_type THEN
            RAISE EXCEPTION 'Item Code / SKU already belongs to a different item type; resolve it before importing';
          END IF;
        END IF;
      END IF;

      IF v_item_id IS NULL THEN
        SELECT count(*) INTO v_match_count
        FROM public.products_services ps
        WHERE ps.business_id = p_business_id
          AND ps.item_type = v_item_type
          AND lower(btrim(ps.name)) = lower(v_item_name);
        IF v_match_count > 1 THEN
          RAISE EXCEPTION 'Item name matches multiple catalog records; provide a unique Item Code / SKU';
        ELSIF v_match_count = 1 THEN
          SELECT ps.id, ps.item_type INTO v_item_id, v_existing_type
          FROM public.products_services ps
          WHERE ps.business_id = p_business_id
            AND ps.item_type = v_item_type
            AND lower(btrim(ps.name)) = lower(v_item_name)
          ORDER BY ps.created_at, ps.id
          LIMIT 1;
        END IF;
      END IF;

      IF v_item_id IS NOT NULL THEN
        UPDATE public.products_services
        SET name = v_item_name,
            sku = coalesce(v_sku, sku),
            description = v_description,
            item_type = v_item_type,
            unit = v_unit,
            hsn_sac = v_hsn,
            sales_price = v_sale_price,
            purchase_price = v_purchase_price,
            default_tax_rate_id = v_tax_rate_id,
            category_id = v_category_id,
            subcategory_id = v_subcategory_id,
            inventory_tracked = (v_item_type = 'product'),
            sell_enabled = true,
            purchase_enabled = true,
            is_active = true
        WHERE id = v_item_id AND business_id = p_business_id;
        v_updated := v_updated + 1;
      ELSE
        INSERT INTO public.products_services(
          business_id, name, sku, description, item_type, unit, hsn_sac,
          sales_price, purchase_price, default_tax_rate_id, category_id,
          subcategory_id, inventory_tracked, sell_enabled, purchase_enabled,
          opening_stock, opening_stock_cost, is_active
        ) VALUES (
          p_business_id, v_item_name, v_sku, v_description, v_item_type, v_unit, v_hsn,
          v_sale_price, v_purchase_price, v_tax_rate_id, v_category_id,
          v_subcategory_id, (v_item_type = 'product'), true, true,
          CASE WHEN v_item_type = 'product' THEN v_opening_stock ELSE 0 END,
          CASE WHEN v_item_type = 'product' THEN v_opening_stock * v_purchase_price ELSE 0 END,
          true
        )
        RETURNING id INTO v_item_id;
      END IF;

      v_imported := v_imported + 1;
      IF v_category_created AND NOT (lower(v_category_name) = ANY(v_new_categories)) THEN
        v_new_categories := array_append(v_new_categories, lower(v_category_name));
      END IF;
      IF v_subcategory_created AND v_subcategory_key IS NOT NULL
         AND NOT (v_subcategory_key = ANY(v_new_subcategories)) THEN
        v_new_subcategories := array_append(v_new_subcategories, v_subcategory_key);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_skipped := v_skipped + 1;
      IF jsonb_array_length(v_errors) < 100 THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'row', v_row_number,
          'item', coalesce(v_row->>'item_name', ''),
          'reason', left(SQLERRM, 300)
        ));
      END IF;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'imported', v_imported,
    'updated', v_updated,
    'categories_created', cardinality(v_new_categories),
    'subcategories_created', cardinality(v_new_subcategories),
    'skipped', v_skipped,
    'errors', v_errors
  );
END;
$function$
;

REVOKE ALL ON FUNCTION public.import_product_catalog(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_product_catalog(uuid, jsonb) TO authenticated;
NOTIFY pgrst, 'reload schema';

COMMIT;
