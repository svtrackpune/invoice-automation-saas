BEGIN;
ALTER TABLE public.customers ADD CONSTRAINT uq_customers_business_id_id UNIQUE (business_id,id);
ALTER TABLE public.products_services ADD CONSTRAINT uq_products_services_business_id_id UNIQUE (business_id,id);
ALTER TABLE public.delivery_challans ADD CONSTRAINT delivery_challans_customer_tenant_fk FOREIGN KEY (business_id,customer_id) REFERENCES public.customers(business_id,id);
ALTER TABLE public.delivery_challan_items ADD COLUMN IF NOT EXISTS business_id UUID;
UPDATE public.delivery_challan_items dci SET business_id=dc.business_id FROM public.delivery_challans dc WHERE dc.id=dci.challan_id AND dci.business_id IS NULL;
ALTER TABLE public.delivery_challan_items ALTER COLUMN business_id SET NOT NULL;
ALTER TABLE public.delivery_challan_items ADD CONSTRAINT delivery_challan_items_business_fk FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE;
ALTER TABLE public.delivery_challan_items ADD CONSTRAINT delivery_challan_items_product_tenant_fk FOREIGN KEY (business_id,product_service_id) REFERENCES public.products_services(business_id,id);
CREATE INDEX IF NOT EXISTS idx_delivery_challan_items_business ON public.delivery_challan_items(business_id);

DROP POLICY IF EXISTS delivery_challans_member ON public.delivery_challans;
CREATE POLICY delivery_challans_view ON public.delivery_challans FOR SELECT TO authenticated
USING (mm_private.has_business_permission(business_id,'inventory.view') OR mm_private.has_business_permission(business_id,'inventory.manage'));
CREATE POLICY delivery_challans_manage_insert ON public.delivery_challans FOR INSERT TO authenticated
WITH CHECK (mm_private.has_business_permission(business_id,'inventory.manage'));
CREATE POLICY delivery_challans_manage_update ON public.delivery_challans FOR UPDATE TO authenticated
USING (mm_private.has_business_permission(business_id,'inventory.manage'))
WITH CHECK (mm_private.has_business_permission(business_id,'inventory.manage'));
CREATE POLICY delivery_challans_manage_delete ON public.delivery_challans FOR DELETE TO authenticated
USING (mm_private.has_business_permission(business_id,'inventory.manage'));

DROP POLICY IF EXISTS delivery_challan_items_member ON public.delivery_challan_items;
CREATE POLICY delivery_challan_items_view ON public.delivery_challan_items FOR SELECT TO authenticated
USING (mm_private.has_business_permission(business_id,'inventory.view') OR mm_private.has_business_permission(business_id,'inventory.manage'));
CREATE POLICY delivery_challan_items_manage_insert ON public.delivery_challan_items FOR INSERT TO authenticated
WITH CHECK (mm_private.has_business_permission(business_id,'inventory.manage'));
CREATE POLICY delivery_challan_items_manage_update ON public.delivery_challan_items FOR UPDATE TO authenticated
USING (mm_private.has_business_permission(business_id,'inventory.manage'))
WITH CHECK (mm_private.has_business_permission(business_id,'inventory.manage'));
CREATE POLICY delivery_challan_items_manage_delete ON public.delivery_challan_items FOR DELETE TO authenticated
USING (mm_private.has_business_permission(business_id,'inventory.manage'));
COMMIT;