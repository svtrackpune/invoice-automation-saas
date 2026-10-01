BEGIN;

ALTER TABLE public.payment_allocations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payment_allocations_member_all ON public.payment_allocations;
DROP POLICY IF EXISTS payment_allocations_member_insert ON public.payment_allocations;
DROP POLICY IF EXISTS payment_allocations_member_select ON public.payment_allocations;
CREATE POLICY payment_allocations_select ON public.payment_allocations FOR SELECT TO authenticated
USING (mm_private.is_org_member(mm_private.business_org(business_id)));
REVOKE ALL ON TABLE public.payment_allocations FROM anon, authenticated;
GRANT SELECT ON TABLE public.payment_allocations TO authenticated;

ALTER TABLE public.bills ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bills_member_all ON public.bills;
DROP POLICY IF EXISTS bills_member_select ON public.bills;
DROP POLICY IF EXISTS bills_member_insert ON public.bills;
DROP POLICY IF EXISTS bills_member_update ON public.bills;
DROP POLICY IF EXISTS bills_member_delete ON public.bills;
CREATE POLICY bills_member_select ON public.bills FOR SELECT TO authenticated
USING (mm_private.is_org_member(mm_private.business_org(business_id)));
CREATE POLICY bills_member_insert ON public.bills FOR INSERT TO authenticated
WITH CHECK (mm_private.is_org_member(mm_private.business_org(business_id)) AND mm_private.has_business_permission(business_id,'purchases.manage'));
CREATE POLICY bills_member_update ON public.bills FOR UPDATE TO authenticated
USING (mm_private.is_org_member(mm_private.business_org(business_id)) AND mm_private.has_business_permission(business_id,'purchases.manage'))
WITH CHECK (mm_private.is_org_member(mm_private.business_org(business_id)) AND mm_private.has_business_permission(business_id,'purchases.manage'));
CREATE POLICY bills_member_delete ON public.bills FOR DELETE TO authenticated
USING (mm_private.is_org_member(mm_private.business_org(business_id)) AND mm_private.has_business_permission(business_id,'purchases.manage'));
REVOKE ALL ON TABLE public.bills FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.bills TO authenticated;

ALTER TABLE public.bill_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bill_items_member_all ON public.bill_items;
DROP POLICY IF EXISTS bill_items_member_select ON public.bill_items;
DROP POLICY IF EXISTS bill_items_member_insert ON public.bill_items;
DROP POLICY IF EXISTS bill_items_member_update ON public.bill_items;
DROP POLICY IF EXISTS bill_items_member_delete ON public.bill_items;
CREATE POLICY bill_items_member_select ON public.bill_items FOR SELECT TO authenticated
USING (mm_private.is_org_member(mm_private.business_org((SELECT b.business_id FROM public.bills b WHERE b.id=bill_items.bill_id))));
CREATE POLICY bill_items_member_insert ON public.bill_items FOR INSERT TO authenticated
WITH CHECK (EXISTS (SELECT 1 FROM public.bills b WHERE b.id=bill_items.bill_id AND mm_private.is_org_member(mm_private.business_org(b.business_id)) AND mm_private.has_business_permission(b.business_id,'purchases.manage')));
CREATE POLICY bill_items_member_update ON public.bill_items FOR UPDATE TO authenticated
USING (EXISTS (SELECT 1 FROM public.bills b WHERE b.id=bill_items.bill_id AND mm_private.is_org_member(mm_private.business_org(b.business_id)) AND mm_private.has_business_permission(b.business_id,'purchases.manage')))
WITH CHECK (EXISTS (SELECT 1 FROM public.bills b WHERE b.id=bill_items.bill_id AND mm_private.is_org_member(mm_private.business_org(b.business_id)) AND mm_private.has_business_permission(b.business_id,'purchases.manage')));
CREATE POLICY bill_items_member_delete ON public.bill_items FOR DELETE TO authenticated
USING (EXISTS (SELECT 1 FROM public.bills b WHERE b.id=bill_items.bill_id AND mm_private.is_org_member(mm_private.business_org(b.business_id)) AND mm_private.has_business_permission(b.business_id,'purchases.manage')));
REVOKE ALL ON TABLE public.bill_items FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.bill_items TO authenticated;

ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS expenses_member_all ON public.expenses;
DROP POLICY IF EXISTS expenses_member_select ON public.expenses;
DROP POLICY IF EXISTS expenses_member_insert ON public.expenses;
DROP POLICY IF EXISTS expenses_member_update ON public.expenses;
DROP POLICY IF EXISTS expenses_member_delete ON public.expenses;
CREATE POLICY expenses_member_select ON public.expenses FOR SELECT TO authenticated
USING (mm_private.is_org_member(mm_private.business_org(business_id)));
CREATE POLICY expenses_member_insert ON public.expenses FOR INSERT TO authenticated
WITH CHECK (mm_private.is_org_member(mm_private.business_org(business_id)) AND mm_private.has_business_permission(business_id,'expenses.manage'));
CREATE POLICY expenses_member_update ON public.expenses FOR UPDATE TO authenticated
USING (mm_private.is_org_member(mm_private.business_org(business_id)) AND mm_private.has_business_permission(business_id,'expenses.manage'))
WITH CHECK (mm_private.is_org_member(mm_private.business_org(business_id)) AND mm_private.has_business_permission(business_id,'expenses.manage'));
CREATE POLICY expenses_member_delete ON public.expenses FOR DELETE TO authenticated
USING (mm_private.is_org_member(mm_private.business_org(business_id)) AND mm_private.has_business_permission(business_id,'expenses.manage'));
REVOKE ALL ON TABLE public.expenses FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.expenses TO authenticated;

ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS invoice_items_member_all ON public.invoice_items;
DROP POLICY IF EXISTS invoice_items_member_select ON public.invoice_items;
CREATE POLICY invoice_items_member_select ON public.invoice_items FOR SELECT TO authenticated
USING (mm_private.is_org_member(mm_private.business_org((SELECT i.business_id FROM public.invoices i WHERE i.id=invoice_items.invoice_id))));
REVOKE ALL ON TABLE public.invoice_items FROM anon, authenticated;
GRANT SELECT ON TABLE public.invoice_items TO authenticated;

COMMIT;