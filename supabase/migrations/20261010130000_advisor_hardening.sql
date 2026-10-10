BEGIN;

DO $enable_public_rls$
DECLARE t record;
BEGIN
  FOR t IN SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
           WHERE n.nspname='public' AND c.relkind IN ('r','p') AND NOT c.relrowsecurity
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY',t.nspname,t.relname);
  END LOOP;
END;
$enable_public_rls$;

-- Current SECURITY DEFINER paths are pinned. Preserve mm_private dependencies
-- and intentionally empty paths instead of applying a breaking blanket path.
DO $path_postflight$
DECLARE v_missing integer; v_unsafe integer;
BEGIN
  SELECT count(*) INTO v_missing
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname IN ('public','mm_private') AND p.prosecdef AND p.prokind IN ('f','p')
    AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig,ARRAY[]::text[])) cfg WHERE cfg LIKE 'search_path=%');
  SELECT count(*) INTO v_unsafe
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname IN ('public','mm_private') AND p.prosecdef AND p.prokind IN ('f','p')
    AND EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig,ARRAY[]::text[])) cfg
      WHERE cfg LIKE 'search_path=%'
        AND substring(cfg FROM length('search_path=')+1) NOT IN ('','""')
        AND substring(cfg FROM length('search_path=')+1) !~ '(^|,)[[:space:]]*pg_temp[[:space:]]*$');
  IF v_missing>0 OR v_unsafe>0 THEN
    RAISE EXCEPTION 'SECURITY DEFINER path audit failed: % missing and % unsafe paths',v_missing,v_unsafe;
  END IF;
END;
$path_postflight$;

-- Correct production column names. Avoid duplicate indexes already present on
-- journal_lines and invoices; payments has separate customer/vendor columns.
CREATE INDEX IF NOT EXISTS idx_inventory_movements_product_service_fk ON public.inventory_movements(product_service_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_location_fk ON public.inventory_movements(location_id);
CREATE INDEX IF NOT EXISTS idx_delivery_challans_customer_fk ON public.delivery_challans(customer_id);
CREATE INDEX IF NOT EXISTS idx_payments_invoice_fk ON public.payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payments_customer_fk ON public.payments(customer_id);
CREATE INDEX IF NOT EXISTS idx_payments_vendor_fk ON public.payments(vendor_id);
CREATE INDEX IF NOT EXISTS idx_payments_bill_fk ON public.payments(bill_id);
CREATE INDEX IF NOT EXISTS idx_payments_account_fk ON public.payments(account_id);
CREATE INDEX IF NOT EXISTS idx_payments_journal_entry_fk ON public.payments(journal_entry_id);

-- This helper reveals a public share token from an invoice UUID. Retire the
-- UUID-to-token issuer endpoint; public invoice retrieval remains token-based.
REVOKE ALL ON FUNCTION public.get_public_invoice_share_token(uuid) FROM PUBLIC, anon, authenticated;

-- Trigger functions are not intended as directly-invokable RPCs.
REVOKE ALL ON FUNCTION public.guard_bank_reconciliation_rule_target_account() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_locked_reconciliation_mutation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_bank_transaction_identity() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reverse_locked_bank_reconciliation(uuid, uuid, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_locked_bank_reconciliation(uuid, uuid, text, date) TO authenticated;

COMMIT;
