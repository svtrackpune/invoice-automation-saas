-- Production hardening tranche 3: financial reconciliation health check.
CREATE OR REPLACE FUNCTION public.get_financial_integrity_summary(p_business_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, mm_private
AS $$
DECLARE
  v_invoice_balance integer := 0;
  v_invoice_alloc integer := 0;
  v_bill_balance integer := 0;
  v_bill_alloc integer := 0;
  v_unbalanced_journal integer := 0;
  v_negative_inventory integer := 0;
  v_unsettled_cash_bill integer := 0;
  v_missing_payment_journal integer := 0;
  v_missing_receipt_payment integer := 0;
BEGIN
  IF NOT mm_private.has_business_permission(p_business_id,'accounting.view') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT count(*) INTO v_invoice_balance
  FROM public.invoices i
  WHERE i.business_id=p_business_id AND i.status<>'void'
    AND abs(coalesce(i.balance_due,0)-greatest(coalesce(i.total,0)-coalesce(i.amount_paid,0),0))>0.01;

  SELECT count(*) INTO v_invoice_alloc
  FROM public.invoices i
  WHERE i.business_id=p_business_id AND i.status<>'void'
    AND abs(coalesce(i.amount_paid,0)-coalesce((
      SELECT sum(pa.amount) FROM public.payment_allocations pa WHERE pa.invoice_id=i.id
    ),0))>0.01;

  SELECT count(*) INTO v_bill_balance
  FROM public.bills b
  WHERE b.business_id=p_business_id AND b.status<>'void'
    AND abs(coalesce(b.balance_due,0)-greatest(coalesce(b.total,0)-coalesce(b.amount_paid,0),0))>0.01;

  SELECT count(*) INTO v_bill_alloc
  FROM public.bills b
  WHERE b.business_id=p_business_id AND b.status<>'void'
    AND abs(coalesce(b.amount_paid,0)-coalesce((
      SELECT sum(vpa.amount) FROM public.vendor_payment_allocations vpa WHERE vpa.bill_id=b.id
    ),0))>0.01;

  SELECT count(*) INTO v_unbalanced_journal
  FROM public.journal_entries je
  WHERE je.business_id=p_business_id AND je.status='posted'
    AND abs(
      coalesce((SELECT sum(jl.debit-jl.credit) FROM public.journal_lines jl WHERE jl.journal_entry_id=je.id),0)
    )>0.01;

  SELECT count(*) INTO v_negative_inventory
  FROM public.inventory_balances ib
  WHERE ib.business_id=p_business_id AND ib.quantity_on_hand < -0.000001;

  SELECT count(*) INTO v_unsettled_cash_bill
  FROM public.invoices i
  WHERE i.business_id=p_business_id
    AND i.document_kind='cash_bill'
    AND i.status<>'void'
    AND (
      coalesce(i.balance_due,0)>0.01
      OR NOT EXISTS(
        SELECT 1 FROM public.payment_allocations pa
        WHERE pa.invoice_id=i.id AND pa.amount>0
      )
    );

  SELECT count(*) INTO v_missing_payment_journal
  FROM public.payments p
  WHERE p.business_id=p_business_id
    AND p.direction IN ('inbound','outbound')
    AND p.amount>0
    AND p.journal_entry_id IS NULL;

  SELECT count(*) INTO v_missing_receipt_payment
  FROM public.receipts r
  WHERE r.business_id=p_business_id
    AND r.payment_id IS NULL;

  RETURN jsonb_build_object(
    'business_id',p_business_id,
    'invoice_balance_mismatches',v_invoice_balance,
    'invoice_allocation_mismatches',v_invoice_alloc,
    'bill_balance_mismatches',v_bill_balance,
    'bill_allocation_mismatches',v_bill_alloc,
    'unbalanced_posted_journals',v_unbalanced_journal,
    'negative_inventory_balances',v_negative_inventory,
    'unsettled_cash_bills',v_unsettled_cash_bill,
    'payments_missing_journal',v_missing_payment_journal,
    'receipts_missing_payment',v_missing_receipt_payment,
    'healthy',(
      v_invoice_balance=0 AND v_invoice_alloc=0 AND v_bill_balance=0
      AND v_bill_alloc=0 AND v_unbalanced_journal=0
      AND v_negative_inventory=0 AND v_unsettled_cash_bill=0
      AND v_missing_payment_journal=0 AND v_missing_receipt_payment=0
    )
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_financial_integrity_summary(uuid) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.get_financial_integrity_summary(uuid) TO authenticated;
