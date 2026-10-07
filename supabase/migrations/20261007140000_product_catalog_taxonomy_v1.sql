BEGIN;

CREATE TABLE IF NOT EXISTS public.product_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  default_hsn_sac TEXT,
  default_tax_rate_id UUID,
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_product_categories_business_name UNIQUE (business_id, name),
  CONSTRAINT ck_product_categories_name_nonempty CHECK (btrim(name) <> '')
);

CREATE TABLE IF NOT EXISTS public.product_subcategories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  category_id UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_product_subcategories_cat_name UNIQUE (category_id, name),
  CONSTRAINT ck_product_subcategories_name_nonempty CHECK (btrim(name) <> '')
);

ALTER TABLE public.products_services
  ADD COLUMN IF NOT EXISTS category_id UUID,
  ADD COLUMN IF NOT EXISTS subcategory_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.product_categories'::regclass AND conname='uq_product_categories_business_id_id') THEN
    ALTER TABLE public.product_categories ADD CONSTRAINT uq_product_categories_business_id_id UNIQUE (business_id, id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.product_subcategories'::regclass AND conname='uq_product_subcategories_business_id_id') THEN
    ALTER TABLE public.product_subcategories ADD CONSTRAINT uq_product_subcategories_business_id_id UNIQUE (business_id, id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.product_subcategories'::regclass AND conname='uq_product_subcategories_business_category_id_id') THEN
    ALTER TABLE public.product_subcategories ADD CONSTRAINT uq_product_subcategories_business_category_id_id UNIQUE (business_id, category_id, id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.tax_rates'::regclass AND conname='uq_tax_rates_business_id_id') THEN
    ALTER TABLE public.tax_rates ADD CONSTRAINT uq_tax_rates_business_id_id UNIQUE (business_id, id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.product_categories'::regclass AND conname='product_categories_tax_tenant_fk') THEN
    ALTER TABLE public.product_categories
      ADD CONSTRAINT product_categories_tax_tenant_fk
      FOREIGN KEY (business_id, default_tax_rate_id)
      REFERENCES public.tax_rates (business_id, id)
      ON DELETE SET NULL (default_tax_rate_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.product_subcategories'::regclass AND conname='product_subcategories_category_tenant_fk') THEN
    ALTER TABLE public.product_subcategories
      ADD CONSTRAINT product_subcategories_category_tenant_fk
      FOREIGN KEY (business_id, category_id)
      REFERENCES public.product_categories (business_id, id)
      ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.products_services'::regclass AND conname='products_services_category_tenant_fk') THEN
    ALTER TABLE public.products_services
      ADD CONSTRAINT products_services_category_tenant_fk
      FOREIGN KEY (business_id, category_id)
      REFERENCES public.product_categories (business_id, id)
      ON DELETE SET NULL (category_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.products_services'::regclass AND conname='products_services_subcategory_tenant_fk') THEN
    ALTER TABLE public.products_services
      ADD CONSTRAINT products_services_subcategory_tenant_fk
      FOREIGN KEY (business_id, subcategory_id)
      REFERENCES public.product_subcategories (business_id, id)
      ON DELETE SET NULL (subcategory_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.products_services'::regclass AND conname='products_services_subcategory_category_tenant_fk') THEN
    ALTER TABLE public.products_services
      ADD CONSTRAINT products_services_subcategory_category_tenant_fk
      FOREIGN KEY (business_id, category_id, subcategory_id)
      REFERENCES public.product_subcategories (business_id, category_id, id)
      ON DELETE SET NULL (subcategory_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_product_categories_biz ON public.product_categories(business_id);
CREATE INDEX IF NOT EXISTS idx_product_subcategories_biz_cat ON public.product_subcategories(business_id, category_id);
CREATE INDEX IF NOT EXISTS idx_product_subcategories_biz ON public.product_subcategories(business_id);
CREATE INDEX IF NOT EXISTS idx_products_services_cat ON public.products_services(business_id, category_id);
CREATE INDEX IF NOT EXISTS idx_products_services_subcat ON public.products_services(business_id, subcategory_id);

ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_subcategories ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.product_categories, public.product_subcategories FROM anon, public;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.product_categories, public.product_subcategories TO authenticated;
GRANT ALL ON TABLE public.product_categories, public.product_subcategories TO service_role;

DROP POLICY IF EXISTS "product_categories_member_select" ON public.product_categories;
DROP POLICY IF EXISTS "product_categories_manage_insert" ON public.product_categories;
DROP POLICY IF EXISTS "product_categories_manage_update" ON public.product_categories;
DROP POLICY IF EXISTS "product_categories_manage_delete" ON public.product_categories;
DROP POLICY IF EXISTS "product_subcategories_member_select" ON public.product_subcategories;
DROP POLICY IF EXISTS "product_subcategories_manage_insert" ON public.product_subcategories;
DROP POLICY IF EXISTS "product_subcategories_manage_update" ON public.product_subcategories;
DROP POLICY IF EXISTS "product_subcategories_manage_delete" ON public.product_subcategories;

CREATE POLICY "product_categories_member_select"
  ON public.product_categories FOR SELECT TO authenticated
  USING (
    mm_private.is_org_member(mm_private.business_org(business_id))
    AND (mm_private.has_business_permission(business_id, 'inventory.view'::text, (SELECT auth.uid()))
      OR mm_private.has_business_permission(business_id, 'inventory.manage'::text, (SELECT auth.uid())))
  );

CREATE POLICY "product_categories_manage_insert"
  ON public.product_categories FOR INSERT TO authenticated
  WITH CHECK (mm_private.has_business_permission(business_id, 'inventory.manage'::text, (SELECT auth.uid())));

CREATE POLICY "product_categories_manage_update"
  ON public.product_categories FOR UPDATE TO authenticated
  USING (mm_private.has_business_permission(business_id, 'inventory.manage'::text, (SELECT auth.uid())))
  WITH CHECK (mm_private.has_business_permission(business_id, 'inventory.manage'::text, (SELECT auth.uid())));

CREATE POLICY "product_categories_manage_delete"
  ON public.product_categories FOR DELETE TO authenticated
  USING (mm_private.has_business_permission(business_id, 'inventory.manage'::text, (SELECT auth.uid())));

CREATE POLICY "product_subcategories_member_select"
  ON public.product_subcategories FOR SELECT TO authenticated
  USING (
    mm_private.is_org_member(mm_private.business_org(business_id))
    AND (mm_private.has_business_permission(business_id, 'inventory.view'::text, (SELECT auth.uid()))
      OR mm_private.has_business_permission(business_id, 'inventory.manage'::text, (SELECT auth.uid())))
  );

CREATE POLICY "product_subcategories_manage_insert"
  ON public.product_subcategories FOR INSERT TO authenticated
  WITH CHECK (mm_private.has_business_permission(business_id, 'inventory.manage'::text, (SELECT auth.uid())));

CREATE POLICY "product_subcategories_manage_update"
  ON public.product_subcategories FOR UPDATE TO authenticated
  USING (mm_private.has_business_permission(business_id, 'inventory.manage'::text, (SELECT auth.uid())))
  WITH CHECK (mm_private.has_business_permission(business_id, 'inventory.manage'::text, (SELECT auth.uid())));

CREATE POLICY "product_subcategories_manage_delete"
  ON public.product_subcategories FOR DELETE TO authenticated
  USING (mm_private.has_business_permission(business_id, 'inventory.manage'::text, (SELECT auth.uid())));

COMMIT;