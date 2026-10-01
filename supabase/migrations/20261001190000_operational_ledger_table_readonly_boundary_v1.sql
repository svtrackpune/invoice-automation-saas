BEGIN;

ALTER TABLE public.quotation_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS quotation_items_member_all ON public.quotation_items;
DROP POLICY IF EXISTS quotation_items_select ON public.quotation_items;
CREATE POLICY quotation_items_select ON public.quotation_items FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.quotations q WHERE q.id=quotation_items.quotation_id AND mm_private.has_business_permission(q.business_id,'sales.view')));
REVOKE ALL ON TABLE public.quotation_items FROM anon, authenticated;
GRANT SELECT ON TABLE public.quotation_items TO authenticated;

ALTER TABLE public.bank_reconciliations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bank_reconciliations_access ON public.bank_reconciliations;
DROP POLICY IF EXISTS bank_reconciliations_select ON public.bank_reconciliations;
CREATE POLICY bank_reconciliations_select ON public.bank_reconciliations FOR SELECT TO authenticated
USING (
  mm_private.has_business_permission(business_id,'banking.view')
  OR mm_private.has_business_permission(business_id,'banking.reconcile')
  OR mm_private.has_business_permission(business_id,'accounting.reconcile')
);
REVOKE ALL ON TABLE public.bank_reconciliations FROM anon, authenticated;
GRANT SELECT ON TABLE public.bank_reconciliations TO authenticated;

ALTER TABLE public.bank_reconciliation_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bank_reconciliation_items_access ON public.bank_reconciliation_items;
DROP POLICY IF EXISTS bank_reconciliation_items_select ON public.bank_reconciliation_items;
CREATE POLICY bank_reconciliation_items_select ON public.bank_reconciliation_items FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.bank_reconciliations r
    WHERE r.id=bank_reconciliation_items.reconciliation_id
      AND (
        mm_private.has_business_permission(r.business_id,'banking.view')
        OR mm_private.has_business_permission(r.business_id,'banking.reconcile')
        OR mm_private.has_business_permission(r.business_id,'accounting.reconcile')
      )
  )
);
REVOKE ALL ON TABLE public.bank_reconciliation_items FROM anon, authenticated;
GRANT SELECT ON TABLE public.bank_reconciliation_items TO authenticated;

ALTER TABLE public.inventory_transfers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inventory_transfers_member_all ON public.inventory_transfers;
DROP POLICY IF EXISTS inventory_transfers_select ON public.inventory_transfers;
CREATE POLICY inventory_transfers_select ON public.inventory_transfers FOR SELECT TO authenticated
USING (mm_private.is_org_member(mm_private.business_org(business_id)));
REVOKE ALL ON TABLE public.inventory_transfers FROM anon, authenticated;
GRANT SELECT ON TABLE public.inventory_transfers TO authenticated;

ALTER TABLE public.inventory_transfer_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inventory_transfer_items_member_all ON public.inventory_transfer_items;
DROP POLICY IF EXISTS inventory_transfer_items_select ON public.inventory_transfer_items;
CREATE POLICY inventory_transfer_items_select ON public.inventory_transfer_items FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.inventory_transfers t
    WHERE t.id=inventory_transfer_items.transfer_id
      AND mm_private.is_org_member(mm_private.business_org(t.business_id))
  )
);
REVOKE ALL ON TABLE public.inventory_transfer_items FROM anon, authenticated;
GRANT SELECT ON TABLE public.inventory_transfer_items TO authenticated;

COMMIT;