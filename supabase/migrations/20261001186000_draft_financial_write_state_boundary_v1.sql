BEGIN;

DROP POLICY IF EXISTS bills_member_insert ON public.bills;
DROP POLICY IF EXISTS bills_member_update ON public.bills;
DROP POLICY IF EXISTS bills_member_delete ON public.bills;

CREATE POLICY bills_member_insert ON public.bills FOR INSERT TO authenticated
WITH CHECK (
  mm_private.is_org_member(mm_private.business_org(business_id))
  AND mm_private.has_business_permission(business_id,'purchases.manage')
  AND status = 'draft'::bill_status
  AND journal_entry_id IS NULL
  AND coalesce(amount_paid,0) = 0
);

CREATE POLICY bills_member_update ON public.bills FOR UPDATE TO authenticated
USING (
  mm_private.is_org_member(mm_private.business_org(business_id))
  AND mm_private.has_business_permission(business_id,'purchases.manage')
  AND status = 'draft'::bill_status
  AND journal_entry_id IS NULL
)
WITH CHECK (
  mm_private.is_org_member(mm_private.business_org(business_id))
  AND mm_private.has_business_permission(business_id,'purchases.manage')
  AND status = 'draft'::bill_status
  AND journal_entry_id IS NULL
);

CREATE POLICY bills_member_delete ON public.bills FOR DELETE TO authenticated
USING (
  mm_private.is_org_member(mm_private.business_org(business_id))
  AND mm_private.has_business_permission(business_id,'purchases.manage')
  AND status = 'draft'::bill_status
  AND journal_entry_id IS NULL
);

DROP POLICY IF EXISTS bill_items_member_insert ON public.bill_items;
DROP POLICY IF EXISTS bill_items_member_update ON public.bill_items;
DROP POLICY IF EXISTS bill_items_member_delete ON public.bill_items;

CREATE POLICY bill_items_member_insert ON public.bill_items FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.bills b
    WHERE b.id = bill_items.bill_id
      AND b.status = 'draft'::bill_status
      AND b.journal_entry_id IS NULL
      AND mm_private.is_org_member(mm_private.business_org(b.business_id))
      AND mm_private.has_business_permission(b.business_id,'purchases.manage')
  )
);

CREATE POLICY bill_items_member_update ON public.bill_items FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.bills b
    WHERE b.id = bill_items.bill_id
      AND b.status = 'draft'::bill_status
      AND b.journal_entry_id IS NULL
      AND mm_private.is_org_member(mm_private.business_org(b.business_id))
      AND mm_private.has_business_permission(b.business_id,'purchases.manage')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.bills b
    WHERE b.id = bill_items.bill_id
      AND b.status = 'draft'::bill_status
      AND b.journal_entry_id IS NULL
      AND mm_private.is_org_member(mm_private.business_org(b.business_id))
      AND mm_private.has_business_permission(b.business_id,'purchases.manage')
  )
);

CREATE POLICY bill_items_member_delete ON public.bill_items FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.bills b
    WHERE b.id = bill_items.bill_id
      AND b.status = 'draft'::bill_status
      AND b.journal_entry_id IS NULL
      AND mm_private.is_org_member(mm_private.business_org(b.business_id))
      AND mm_private.has_business_permission(b.business_id,'purchases.manage')
  )
);

DROP POLICY IF EXISTS expenses_member_insert ON public.expenses;
DROP POLICY IF EXISTS expenses_member_update ON public.expenses;
DROP POLICY IF EXISTS expenses_member_delete ON public.expenses;

CREATE POLICY expenses_member_insert ON public.expenses FOR INSERT TO authenticated
WITH CHECK (
  mm_private.is_org_member(mm_private.business_org(business_id))
  AND mm_private.has_business_permission(business_id,'expenses.manage')
  AND journal_entry_id IS NULL
);

CREATE POLICY expenses_member_update ON public.expenses FOR UPDATE TO authenticated
USING (
  mm_private.is_org_member(mm_private.business_org(business_id))
  AND mm_private.has_business_permission(business_id,'expenses.manage')
  AND journal_entry_id IS NULL
)
WITH CHECK (
  mm_private.is_org_member(mm_private.business_org(business_id))
  AND mm_private.has_business_permission(business_id,'expenses.manage')
  AND journal_entry_id IS NULL
);

CREATE POLICY expenses_member_delete ON public.expenses FOR DELETE TO authenticated
USING (
  mm_private.is_org_member(mm_private.business_org(business_id))
  AND mm_private.has_business_permission(business_id,'expenses.manage')
  AND journal_entry_id IS NULL
);

COMMIT;