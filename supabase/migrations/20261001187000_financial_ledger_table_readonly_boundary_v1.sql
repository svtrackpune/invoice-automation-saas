BEGIN;

DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'inventory_balances','inventory_movements','bank_transactions',
    'credit_notes','credit_note_items','customer_credit_ledger','customer_refunds',
    'vendor_credits','vendor_credit_items','vendor_credit_ledger','write_offs'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',tbl);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated',tbl);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated',tbl);
  END LOOP;
END $$;

DROP POLICY IF EXISTS bank_transactions_member_all ON public.bank_transactions;
DROP POLICY IF EXISTS inventory_balances_member_all ON public.inventory_balances;
DROP POLICY IF EXISTS inventory_movements_member_all ON public.inventory_movements;
DROP POLICY IF EXISTS write_offs_member ON public.write_offs;

DROP POLICY IF EXISTS bank_transactions_member_select ON public.bank_transactions;
DROP POLICY IF EXISTS inventory_balances_member_select ON public.inventory_balances;
DROP POLICY IF EXISTS inventory_movements_member_select ON public.inventory_movements;
DROP POLICY IF EXISTS write_offs_select ON public.write_offs;

CREATE POLICY bank_transactions_member_select ON public.bank_transactions
FOR SELECT TO authenticated
USING (
  mm_private.is_org_member(
    mm_private.business_org(
      (SELECT ba.business_id FROM public.bank_accounts ba WHERE ba.id=bank_transactions.bank_account_id)
    )
  )
);

CREATE POLICY inventory_balances_member_select ON public.inventory_balances
FOR SELECT TO authenticated
USING (mm_private.is_org_member(mm_private.business_org(business_id)));

CREATE POLICY inventory_movements_member_select ON public.inventory_movements
FOR SELECT TO authenticated
USING (mm_private.is_org_member(mm_private.business_org(business_id)));

CREATE POLICY write_offs_select ON public.write_offs
FOR SELECT TO authenticated
USING (mm_private.has_business_permission(business_id,'accounting.view'));

COMMIT;