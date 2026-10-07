-- Canonical four-step onboarding wizard and atomic business synthesis.
-- Adapted to the live production schema and authoritative business factory.

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS designation TEXT;

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS operating_models TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS default_terms_template TEXT;

CREATE OR REPLACE FUNCTION public.complete_onboarding_wizard(
  p_business_name TEXT,
  p_designation TEXT,
  p_operating_models TEXT[],
  p_category_id UUID,
  p_subcategory_id UUID,
  p_gst_registered BOOLEAN,
  p_gstin TEXT,
  p_tax_state TEXT,
  p_terms TEXT,
  p_brand_color TEXT,
  p_invoice_prefix TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, mm_private, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_business_id UUID;
  v_models TEXT[] := ARRAY(
    SELECT lower(btrim(x))
    FROM unnest(coalesce(p_operating_models, '{}'::text[])) AS x
    WHERE nullif(btrim(x),'') IS NOT NULL
  );
  v_selling_model TEXT;
  v_has_product_model BOOLEAN;
  v_has_service_model BOOLEAN;
  v_has_inventory BOOLEAN;
  v_tax_mode TEXT;
  v_tax_region TEXT;
  v_tax_state TEXT := nullif(btrim(p_tax_state),'');
  v_gstin TEXT := nullif(upper(btrim(p_gstin)),'');
  v_terms TEXT := nullif(btrim(p_terms),'');
  v_prefix TEXT := coalesce(nullif(btrim(p_invoice_prefix),''),'INV-');
  v_brand_color TEXT := coalesce(nullif(btrim(p_brand_color),''),'#4f46e5');
  v_industry_preset TEXT := 'custom';
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF nullif(btrim(p_business_name),'') IS NULL THEN
    RAISE EXCEPTION 'Business name is required';
  END IF;
  IF length(btrim(p_business_name)) > 160 THEN
    RAISE EXCEPTION 'Business name must be 160 characters or fewer';
  END IF;

  IF nullif(btrim(p_designation),'') IS NULL THEN
    RAISE EXCEPTION 'Designation is required';
  END IF;
  IF length(btrim(p_designation)) > 80 THEN
    RAISE EXCEPTION 'Designation must be 80 characters or fewer';
  END IF;

  IF coalesce(cardinality(v_models),0) = 0 THEN
    RAISE EXCEPTION 'At least one operating model is required';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(v_models) AS x
    WHERE x NOT IN (
      'retailer','wholesaler','manufacturer',
      'service_provider','freelancer','contractor','ecommerce'
    )
  ) THEN
    RAISE EXCEPTION 'Unsupported operating model';
  END IF;

  IF p_category_id IS NULL OR p_subcategory_id IS NULL THEN
    RAISE EXCEPTION 'Industry category and sub-category are required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.business_categories
    WHERE id=p_category_id AND is_active
  ) THEN
    RAISE EXCEPTION 'Invalid business category';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.business_subcategories
    WHERE id=p_subcategory_id
      AND category_id=p_category_id
      AND is_active
  ) THEN
    RAISE EXCEPTION 'Invalid business sub-category';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.businesses b
    JOIN public.organization_members om ON om.organization_id=b.organization_id
    WHERE om.user_id=v_user_id
      AND om.is_active
      AND b.is_active
  ) THEN
    RAISE EXCEPTION 'Onboarding has already been completed for this account';
  END IF;

  IF length(v_prefix) > 20 THEN
    RAISE EXCEPTION 'Invoice prefix must be 20 characters or fewer';
  END IF;

  IF v_brand_color !~* '^#[0-9A-F]{6}$' THEN
    RAISE EXCEPTION 'Brand color must be a six-digit hexadecimal color';
  END IF;

  IF length(coalesce(v_terms,'')) > 4000 THEN
    RAISE EXCEPTION 'Terms must be 4000 characters or fewer';
  END IF;

  IF p_gst_registered AND nullif(v_tax_state,'') IS NULL THEN
    RAISE EXCEPTION 'Tax state is required for GST-registered businesses';
  END IF;

  IF p_gst_registered
     AND v_gstin IS NOT NULL
     AND v_gstin !~ '^[0-9]{2}[A-Z0-9]{13}$'
  THEN
    RAISE EXCEPTION 'GSTIN must be 15 characters in a valid GSTIN format';
  END IF;

  v_has_product_model := EXISTS (
    SELECT 1 FROM unnest(v_models) x
    WHERE x IN ('retailer','wholesaler','manufacturer','ecommerce')
  );

  v_has_service_model := EXISTS (
    SELECT 1 FROM unnest(v_models) x
    WHERE x IN ('service_provider','freelancer','contractor')
  );

  v_has_inventory := EXISTS (
    SELECT 1 FROM unnest(v_models) x
    WHERE x IN ('retailer','wholesaler','manufacturer')
  );

  v_selling_model := CASE
    WHEN v_has_product_model AND v_has_service_model THEN 'both'
    WHEN v_has_service_model THEN 'services'
    ELSE 'products'
  END;

  v_tax_mode := CASE WHEN p_gst_registered THEN 'gst' ELSE 'non_gst' END;

  v_tax_region := CASE upper(coalesce(v_tax_state,''))
    WHEN 'MAHARASHTRA' THEN 'IN-MH'
    WHEN 'KARNATAKA' THEN 'IN-KA'
    WHEN 'TELANGANA' THEN 'IN-TS'
    WHEN 'GUJARAT' THEN 'IN-GJ'
    WHEN 'DELHI' THEN 'IN-DL'
    WHEN 'TAMIL NADU' THEN 'IN-TN'
    WHEN 'UTTAR PRADESH' THEN 'IN-UP'
    WHEN 'RAJASTHAN' THEN 'IN-RJ'
    WHEN 'MADHYA PRADESH' THEN 'IN-MP'
    WHEN 'OTHER' THEN 'IN-OT'
    ELSE CASE WHEN p_gst_registered THEN 'IN-OT' ELSE NULL END
  END;

  SELECT CASE
    WHEN lower(name)='retail' THEN 'retail'
    WHEN lower(name)='wholesale & distribution' THEN 'wholesale'
    WHEN lower(name)='manufacturing' THEN 'manufacturing'
    WHEN lower(name) IN ('professional services','consulting') THEN 'professional_services'
    WHEN lower(name)='construction & contractors' THEN 'construction'
    WHEN lower(name) IN ('restaurants & food','hotels & hospitality') THEN 'hospitality'
    WHEN lower(name)='healthcare' THEN 'healthcare'
    WHEN lower(name)='e-commerce' THEN 'ecommerce'
    ELSE 'custom'
  END
  INTO v_industry_preset
  FROM public.business_categories
  WHERE id=p_category_id;

  v_business_id := public.create_business_for_current_user(
    p_business_name := btrim(p_business_name),
    p_business_type := 'sole_proprietorship'::public.business_type,
    p_country_code := 'IN',
    p_currency_code := 'INR',
    p_tax_enabled := p_gst_registered,
    p_tax_region := v_tax_region,
    p_tax_mode := v_tax_mode,
    p_notification_email := true,
    p_notification_whatsapp := true,
    p_notification_sms := false,
    p_category_id := p_category_id,
    p_subcategory_id := p_subcategory_id,
    p_selling_model := v_selling_model,
    p_sales_channels := '[]'::jsonb,
    p_team_size := NULL,
    p_tax_state := CASE WHEN p_gst_registered THEN v_tax_state ELSE NULL END,
    p_gstin := CASE WHEN p_gst_registered THEN v_gstin ELSE NULL END,
    p_feature_flags := jsonb_build_object(
      'version',1,
      'has_physical_inventory',v_has_inventory,
      'track_batch_serial',false,
      'has_manufacturing',('manufacturer'=ANY(v_models)),
      'has_services_projects',v_has_service_model,
      'has_recurring_subscriptions',('service_provider'=ANY(v_models) OR 'freelancer'=ANY(v_models)),
      'is_b2b',('wholesaler'=ANY(v_models) OR 'manufacturer'=ANY(v_models) OR 'service_provider'=ANY(v_models) OR 'contractor'=ANY(v_models)),
      'is_b2c_retail',('retailer'=ANY(v_models) OR 'ecommerce'=ANY(v_models)),
      'requires_approval_workflows',false,
      'is_tax_registered',p_gst_registered,
      'multi_currency',false,
      'has_credit_terms',('wholesaler'=ANY(v_models) OR 'manufacturer'=ANY(v_models) OR 'service_provider'=ANY(v_models) OR 'contractor'=ANY(v_models)),
      'has_multi_location',('wholesaler'=ANY(v_models) OR 'manufacturer'=ANY(v_models)),
      'industry_preset',coalesce(v_industry_preset,'custom')
    )
  );

  UPDATE public.user_profiles
  SET designation=btrim(p_designation),
      active_business_id=v_business_id,
      updated_at=now()
  WHERE user_id=v_user_id;

  IF NOT FOUND THEN
    INSERT INTO public.user_profiles(user_id,display_name,designation,active_business_id)
    SELECT v_user_id,
           coalesce(raw_user_meta_data->>'display_name',raw_user_meta_data->>'full_name',email),
           btrim(p_designation),
           v_business_id
    FROM auth.users
    WHERE id=v_user_id
    ON CONFLICT(user_id) DO UPDATE
    SET designation=excluded.designation,
        active_business_id=excluded.active_business_id,
        updated_at=now();
  END IF;

  UPDATE public.businesses
  SET category_id=p_category_id,
      subcategory_id=p_subcategory_id,
      operating_models=v_models,
      brand_primary_color=v_brand_color,
      contact_person_designation=btrim(p_designation),
      onboarding_complete=true,
      onboarding_step='completed',
      default_terms_template=v_terms,
      tax_settings=jsonb_build_object(
        'enabled',p_gst_registered,
        'mode',v_tax_mode,
        'region',v_tax_region
      ),
      updated_at=now()
  WHERE id=v_business_id;

  UPDATE public.business_tax_profiles
  SET tax_regime=CASE WHEN p_gst_registered THEN 'GST' ELSE 'NONE' END,
      gst_registration_type=CASE WHEN p_gst_registered THEN 'REGULAR' ELSE 'NONE' END,
      gstin=CASE WHEN p_gst_registered THEN v_gstin ELSE NULL END,
      tax_state=CASE WHEN p_gst_registered THEN v_tax_state ELSE NULL END,
      tax_country='IN',
      updated_at=now()
  WHERE business_id=v_business_id;

  IF p_gst_registered THEN
    INSERT INTO public.tax_rates(
      business_id,name,rate,tax_kind,component_code,is_compound,is_active,metadata
    )
    SELECT
      v_business_id,x.name,x.rate,'sales','GST',false,true,
      jsonb_build_object('source','canonical_onboarding','tax_group','GST')
    FROM (
      VALUES
        ('GST 0%',numeric '0'),
        ('GST 5%',numeric '5'),
        ('GST 12%',numeric '12'),
        ('GST 18%',numeric '18'),
        ('GST 28%',numeric '28'),
        ('GST 40%',numeric '40')
    ) AS x(name,rate)
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.tax_rates t
      WHERE t.business_id=v_business_id
        AND t.rate=x.rate
        AND t.tax_kind='sales'
        AND t.is_active
    );
  END IF;

  UPDATE public.business_settings
  SET invoice_prefix=v_prefix,
      invoice_notes=v_terms,
      default_payment_terms=v_terms,
      default_tax_rate_id=CASE
        WHEN p_gst_registered THEN (
          SELECT id
          FROM public.tax_rates
          WHERE business_id=v_business_id
            AND rate=18
            AND tax_kind='sales'
            AND is_active
          ORDER BY created_at DESC
          LIMIT 1
        )
        ELSE NULL
      END,
      updated_at=now()
  WHERE business_id=v_business_id;

  UPDATE public.business_document_preferences
  SET primary_color=v_brand_color,
      secondary_color='#0F172A',
      accent_color=v_brand_color,
      updated_at=now()
  WHERE business_id=v_business_id
    AND document_type IN ('invoice','quotation','receipt');

  IF v_has_inventory THEN
    PERFORM public.enable_business_inventory(v_business_id);
  END IF;

  RETURN jsonb_build_object(
    'success',true,
    'business_id',v_business_id,
    'message','Business successfully provisioned and configured',
    'selling_model',v_selling_model,
    'tax_mode',v_tax_mode,
    'inventory_enabled',v_has_inventory
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.complete_onboarding_wizard(
  TEXT,TEXT,TEXT[],UUID,UUID,BOOLEAN,TEXT,TEXT,TEXT,TEXT,TEXT
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.complete_onboarding_wizard(
  TEXT,TEXT,TEXT[],UUID,UUID,BOOLEAN,TEXT,TEXT,TEXT,TEXT,TEXT
) TO authenticated;
