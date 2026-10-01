-- Production correction core: first-class Cash Bills + payment corrections.
-- Safe migration: document_kind is additive and defaults existing invoices to 'invoice'.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS document_kind text NOT NULL DEFAULT 'invoice';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'invoices_document_kind_check'
      AND conrelid = 'public.invoices'::regclass
  ) THEN
    ALTER TABLE public.invoices
      ADD CONSTRAINT invoices_document_kind_check
      CHECK (document_kind IN ('invoice','cash_bill'));
  END IF;
END $$;

UPDATE public.invoices
SET document_kind = 'cash_bill'
WHERE document_kind = 'invoice'
  AND notes ~* 'cash\s*&\s*carry';

CREATE INDEX IF NOT EXISTS idx_invoices_business_document_kind
  ON public.invoices (business_id, document_kind, invoice_date DESC);

CREATE OR REPLACE FUNCTION public.guard_invoice_void_with_payments()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, mm_private
AS $$
BEGIN
  IF NEW.status = 'void' AND OLD.status <> 'void'
     AND EXISTS (
       SELECT 1 FROM public.payment_allocations pa
       WHERE pa.invoice_id = OLD.id AND pa.amount > 0
     ) THEN
    RAISE EXCEPTION 'Paid or partially paid invoices cannot be voided. Correct the invoice or use the customer refund/credit workflow first.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_invoice_void_with_payments ON public.invoices;
CREATE TRIGGER trg_guard_invoice_void_with_payments
BEFORE UPDATE OF status ON public.invoices
FOR EACH ROW
EXECUTE FUNCTION public.guard_invoice_void_with_payments();

CREATE OR REPLACE FUNCTION public.update_customer_payment(
  p_payment_id uuid,
  p_amount numeric,
  p_method public.payment_method,
  p_account_id uuid,
  p_reference text DEFAULT NULL,
  p_payment_date date DEFAULT CURRENT_DATE,
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, mm_private
AS $$
DECLARE
  pay_row public.payments%rowtype;
  alloc_row public.payment_allocations%rowtype;
  inv public.invoices%rowtype;
  receipt_row public.receipts%rowtype;
  v_journal uuid;
  v_ar uuid;
  v_credit_acct uuid;
  v_old_credit numeric := 0;
  v_other_alloc numeric := 0;
  v_new_alloc numeric := 0;
  v_new_excess numeric := 0;
  v_entry_number bigint;
  v_invoice_paid numeric := 0;
  v_allocation_count integer;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be greater than zero';
  END IF;

  SELECT * INTO pay_row
  FROM public.payments
  WHERE id = p_payment_id
    AND direction = 'inbound'
  FOR UPDATE;

  IF pay_row.id IS NULL THEN
    RAISE EXCEPTION 'Customer payment not found';
  END IF;

  IF NOT mm_private.has_business_permission(pay_row.business_id, 'payments.receive') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT count(*) INTO v_allocation_count
  FROM public.payment_allocations
  WHERE payment_id = pay_row.id;

  IF v_allocation_count <> 1 THEN
    RAISE EXCEPTION 'Only customer payments with exactly one allocation can be corrected here. Use the credit/refund workflow for unapplied or multi-document payments.';
  END IF;

  SELECT * INTO alloc_row
  FROM public.payment_allocations
  WHERE payment_id = pay_row.id
  LIMIT 1
  FOR UPDATE;

  IF alloc_row.invoice_id IS NULL THEN
    RAISE EXCEPTION 'This payment is not allocated to an invoice.';
  END IF;

  SELECT * INTO inv
  FROM public.invoices
  WHERE id = alloc_row.invoice_id
    AND business_id = pay_row.business_id
    AND customer_id = pay_row.customer_id
  FOR UPDATE;

  IF inv.id IS NULL THEN
    RAISE EXCEPTION 'The payment invoice could not be found for the same business/customer.';
  END IF;

  IF inv.status = 'void' THEN
    RAISE EXCEPTION 'Cannot correct a payment allocated to a void invoice.';
  END IF;

  IF p_payment_date < inv.invoice_date THEN
    RAISE EXCEPTION 'Payment date cannot be before invoice date.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.accounts
    WHERE id = p_account_id
      AND business_id = pay_row.business_id
      AND is_active
      AND account_subtype IN ('cash','bank')
  ) THEN
    RAISE EXCEPTION 'Deposit account must be Cash or Bank.';
  END IF;

  PERFORM public.assert_accounting_period_open(pay_row.business_id, pay_row.payment_date);
  PERFORM public.assert_accounting_period_open(pay_row.business_id, p_payment_date);

  IF pay_row.journal_entry_id IS NOT NULL THEN
    IF NOT mm_private.has_business_permission(pay_row.business_id, 'accounting.adjust') THEN
      RAISE EXCEPTION 'Accounting adjustment permission required to correct a posted customer payment.';
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.journal_entries
      WHERE reversal_of_id = pay_row.journal_entry_id
    ) THEN
      RAISE EXCEPTION 'This payment has already been reversed and cannot be edited.';
    END IF;

    SELECT id INTO v_journal
    FROM public.journal_entries
    WHERE id = pay_row.journal_entry_id
    FOR UPDATE;
  END IF;

  SELECT coalesce(sum(amount), 0)
  INTO v_old_credit
  FROM public.customer_credit_ledger
  WHERE payment_id = pay_row.id;

  SELECT coalesce(sum(pa.amount), 0)
  INTO v_other_alloc
  FROM public.payment_allocations pa
  WHERE pa.invoice_id = inv.id
    AND pa.payment_id <> pay_row.id;

  v_new_alloc := least(p_amount, greatest(inv.total - v_other_alloc, 0));
  v_new_excess := greatest(p_amount - v_new_alloc, 0);

  IF v_new_excess > 0 OR v_old_credit <> 0 THEN
    INSERT INTO public.accounts (
      business_id, code, name, account_type, normal_balance,
      is_system, is_active, description
    )
    SELECT pay_row.business_id, '2150', 'Customer Credits', 'liability', 'credit',
           true, true, 'Customer overpayments and unapplied credits'
    WHERE NOT EXISTS (
      SELECT 1 FROM public.accounts
      WHERE business_id = pay_row.business_id AND code = '2150'
    );

    SELECT id INTO v_credit_acct
    FROM public.accounts
    WHERE business_id = pay_row.business_id
      AND code = '2150'
      AND is_active;

    IF v_credit_acct IS NULL THEN
      RAISE EXCEPTION 'Customer credit account is missing.';
    END IF;
  END IF;

  IF v_old_credit <> 0 THEN
    INSERT INTO public.customer_credit_ledger(
      business_id, customer_id, payment_id, entry_type, amount,
      currency_code, description, created_by
    )
    VALUES(
      pay_row.business_id, pay_row.customer_id, pay_row.id, 'adjustment', -v_old_credit,
      inv.currency_code, 'Payment correction reversed prior customer credit', auth.uid()
    );
  END IF;

  UPDATE public.payments
  SET amount = p_amount,
      method = p_method,
      account_id = p_account_id,
      reference = nullif(trim(p_reference), ''),
      payment_date = p_payment_date,
      notes = p_notes,
      updated_at = now()
  WHERE id = pay_row.id;

  UPDATE public.payment_allocations
  SET amount = v_new_alloc
  WHERE id = alloc_row.id;

  IF v_new_excess > 0 THEN
    INSERT INTO public.customer_credit_ledger(
      business_id, customer_id, payment_id, entry_type, amount,
      currency_code, description, created_by
    )
    VALUES(
      pay_row.business_id, pay_row.customer_id, pay_row.id, 'adjustment', v_new_excess,
      inv.currency_code, 'Payment correction created customer credit', auth.uid()
    );
  END IF;

  IF v_journal IS NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('journal-entry-number:' || pay_row.business_id::text));
    SELECT coalesce(max(entry_number), 0) + 1
    INTO v_entry_number
    FROM public.journal_entries
    WHERE business_id = pay_row.business_id;

    INSERT INTO public.journal_entries(
      business_id, entry_number, entry_date, description,
      source_type, source_id, status, posted_at, posted_by, created_by,
      currency_code, total_debit, total_credit, is_system_generated
    )
    VALUES(
      pay_row.business_id, v_entry_number, p_payment_date,
      'Payment correction for invoice ' || inv.invoice_number,
      'payment', pay_row.id, 'posted', now(), auth.uid(), auth.uid(),
      inv.currency_code, p_amount, p_amount, true
    )
    RETURNING id INTO v_journal;
  ELSE
    UPDATE public.journal_entries
    SET entry_date = p_payment_date,
        description = 'Payment received for invoice ' || inv.invoice_number,
        currency_code = inv.currency_code,
        total_debit = p_amount,
        total_credit = p_amount,
        updated_at = now()
    WHERE id = v_journal;

    DELETE FROM public.journal_lines
    WHERE journal_entry_id = v_journal;
  END IF;

  SELECT id INTO v_ar
  FROM public.accounts
  WHERE business_id = pay_row.business_id
    AND code = '1100'
    AND is_active;

  IF v_ar IS NULL THEN
    RAISE EXCEPTION 'Accounts receivable account is missing.';
  END IF;

  INSERT INTO public.journal_lines(
    journal_entry_id, account_id, description, debit, credit,
    currency_code, entity_type, entity_id
  )
  VALUES(
    v_journal, p_account_id, 'Customer payment', p_amount, 0,
    inv.currency_code, 'customer', pay_row.customer_id
  );

  IF v_new_alloc > 0 THEN
    INSERT INTO public.journal_lines(
      journal_entry_id, account_id, description, debit, credit,
      currency_code, entity_type, entity_id
    )
    VALUES(
      v_journal, v_ar, 'Receivable settlement', 0, v_new_alloc,
      inv.currency_code, 'customer', pay_row.customer_id
    );
  END IF;

  IF v_new_excess > 0 THEN
    INSERT INTO public.journal_lines(
      journal_entry_id, account_id, description, debit, credit,
      currency_code, entity_type, entity_id
    )
    VALUES(
      v_journal, v_credit_acct, 'Customer credit', 0, v_new_excess,
      inv.currency_code, 'customer', pay_row.customer_id
    );
  END IF;

  PERFORM public.validate_journal_entry_balance(v_journal);

  UPDATE public.payments
  SET journal_entry_id = v_journal,
      updated_at = now()
  WHERE id = pay_row.id;

  SELECT * INTO receipt_row
  FROM public.receipts
  WHERE payment_id = pay_row.id
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF receipt_row.id IS NULL THEN
    INSERT INTO public.receipts(
      business_id, customer_id, payment_id, receipt_number,
      receipt_date, amount, currency_code, payment_method,
      reference_number, notes, created_by
    )
    VALUES(
      pay_row.business_id, pay_row.customer_id, pay_row.id,
      public.next_document_number(pay_row.business_id, 'receipt'),
      p_payment_date, p_amount, inv.currency_code, p_method::text,
      nullif(trim(p_reference), ''), p_notes, auth.uid()
    );
  ELSE
    UPDATE public.receipts
    SET customer_id = pay_row.customer_id,
        receipt_date = p_payment_date,
        amount = p_amount,
        payment_method = p_method::text,
        reference_number = nullif(trim(p_reference), ''),
        notes = p_notes
    WHERE id = receipt_row.id;
  END IF;

  SELECT coalesce(sum(pa.amount), 0)
  INTO v_invoice_paid
  FROM public.payment_allocations pa
  WHERE pa.invoice_id = inv.id;

  UPDATE public.invoices
  SET amount_paid = v_invoice_paid,
      balance_due = greatest(total - v_invoice_paid, 0),
      status = CASE
        WHEN v_invoice_paid >= total THEN 'paid'::invoice_status
        WHEN v_invoice_paid > 0 AND due_date < current_date THEN 'overdue'::invoice_status
        WHEN v_invoice_paid > 0 THEN 'partially_paid'::invoice_status
        WHEN due_date < current_date THEN 'overdue'::invoice_status
        ELSE 'sent'::invoice_status
      END,
      updated_at = now()
  WHERE id = inv.id;

  RETURN pay_row.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_cash_bill(
  p_business_id uuid,
  p_phone text,
  p_invoice_date date,
  p_items jsonb,
  p_payment_method public.payment_method,
  p_account_id uuid,
  p_invoice_discount_type text DEFAULT NULL,
  p_invoice_discount_value numeric DEFAULT 0,
  p_notes text DEFAULT 'Cash & Carry',
  p_terms text DEFAULT 'Paid in full at counter.'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, mm_private
AS $$
DECLARE
  v_customer uuid;
  v_invoice uuid;
BEGIN
  IF NOT mm_private.has_business_permission(p_business_id, 'sales.create') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF p_payment_method NOT IN ('cash','upi') THEN
    RAISE EXCEPTION 'Cash Bill settlement must be Cash or UPI.';
  END IF;

  IF p_payment_method = 'cash' AND NOT EXISTS (
    SELECT 1 FROM public.accounts
    WHERE id = p_account_id AND business_id = p_business_id
      AND is_active AND account_subtype = 'cash'
  ) THEN
    RAISE EXCEPTION 'Select a Cash settlement account for a Cash Bill paid by cash.';
  END IF;

  IF p_payment_method = 'upi' AND NOT EXISTS (
    SELECT 1 FROM public.accounts
    WHERE id = p_account_id AND business_id = p_business_id
      AND is_active AND account_subtype = 'bank'
  ) THEN
    RAISE EXCEPTION 'Select a Bank settlement account for a Cash Bill paid by UPI.';
  END IF;

  v_customer := public.get_or_create_cash_customer_by_phone(
    p_business_id,
    p_phone
  );

  v_invoice := public.create_invoice_from_items(
    p_business_id,
    v_customer,
    p_invoice_date,
    p_invoice_date,
    p_items,
    p_invoice_discount_type,
    p_invoice_discount_value,
    p_notes,
    p_terms
  );

  UPDATE public.invoices
  SET document_kind = 'cash_bill',
      payment_display_mode = 'none',
      payment_bank_account_id = NULL,
      updated_at = now()
  WHERE id = v_invoice;

  PERFORM public.post_invoice(v_invoice, NULL);

  PERFORM public.record_customer_payment(
    p_business_id,
    v_customer,
    v_invoice,
    (SELECT total FROM public.invoices WHERE id = v_invoice),
    p_payment_method,
    p_account_id,
    NULL,
    NULL,
    p_invoice_date,
    p_notes
  );

  RETURN v_invoice;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_cash_bill_any_state(
  p_invoice_id uuid,
  p_customer_id uuid,
  p_invoice_date date,
  p_due_date date,
  p_items jsonb,
  p_invoice_discount_type text,
  p_invoice_discount_value numeric,
  p_notes text,
  p_terms text,
  p_template_id uuid,
  p_delivery_date date,
  p_location_id uuid,
  p_payment_method public.payment_method,
  p_payment_account_id uuid,
  p_payment_amount numeric,
  p_payment_reference text DEFAULT NULL,
  p_payment_date date DEFAULT CURRENT_DATE
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, mm_private
AS $$
DECLARE
  inv public.invoices%rowtype;
  payment_id uuid;
  payment_count integer;
  invoice_after public.invoices%rowtype;
  v_updated_first boolean := false;
BEGIN
  SELECT * INTO inv
  FROM public.invoices
  WHERE id = p_invoice_id
  FOR UPDATE;

  IF inv.id IS NULL THEN
    RAISE EXCEPTION 'Cash Bill not found';
  END IF;

  IF inv.document_kind <> 'cash_bill' THEN
    RAISE EXCEPTION 'This document is not a Cash Bill.';
  END IF;

  IF inv.status = 'void' THEN
    RAISE EXCEPTION 'Void Cash Bills cannot be edited.';
  END IF;

  IF NOT (
    mm_private.has_business_permission(inv.business_id, 'sales.edit')
    OR mm_private.has_business_permission(inv.business_id, 'sales.create')
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT count(*), min(p.id)
  INTO payment_count, payment_id
  FROM public.payments p
  WHERE p.business_id = inv.business_id
    AND p.invoice_id = inv.id
    AND p.direction = 'inbound';

  IF payment_count <> 1 OR payment_id IS NULL THEN
    RAISE EXCEPTION 'Cash Bill must have exactly one inbound settlement payment.';
  END IF;

  IF p_payment_method NOT IN ('cash','upi') THEN
    RAISE EXCEPTION 'Cash Bill settlement must be Cash or UPI.';
  END IF;

  IF p_payment_amount <= 0 THEN
    RAISE EXCEPTION 'Cash Bill payment amount must be greater than zero.';
  END IF;

  BEGIN
    PERFORM public.update_invoice_any_state(
      p_invoice_id,
      p_customer_id,
      p_invoice_date,
      p_due_date,
      p_items,
      p_invoice_discount_type,
      p_invoice_discount_value,
      p_notes,
      p_terms,
      p_template_id,
      p_delivery_date,
      p_location_id,
      'none',
      NULL
    );
    v_updated_first := true;
  EXCEPTION WHEN OTHERS THEN
    v_updated_first := false;
  END;

  PERFORM public.update_customer_payment(
    payment_id,
    p_payment_amount,
    p_payment_method,
    p_payment_account_id,
    p_payment_reference,
    p_payment_date,
    p_notes
  );

  IF NOT v_updated_first THEN
    PERFORM public.update_invoice_any_state(
      p_invoice_id,
      p_customer_id,
      p_invoice_date,
      p_due_date,
      p_items,
      p_invoice_discount_type,
      p_invoice_discount_value,
      p_notes,
      p_terms,
      p_template_id,
      p_delivery_date,
      p_location_id,
      'none',
      NULL
    );
  END IF;

  SELECT * INTO invoice_after
  FROM public.invoices
  WHERE id = p_invoice_id
  FOR UPDATE;

  IF invoice_after.total <> p_payment_amount
     OR invoice_after.balance_due <> 0
     OR invoice_after.document_kind <> 'cash_bill'
     OR invoice_after.status = 'void' THEN
    RAISE EXCEPTION 'Cash Bill correction must leave the bill fully settled at the corrected total.';
  END IF;

  RETURN invoice_after.id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_customer_payment(uuid,numeric,public.payment_method,uuid,text,date,text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.update_customer_payment(uuid,numeric,public.payment_method,uuid,text,date,text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.create_cash_bill(uuid,text,date,jsonb,public.payment_method,uuid,text,numeric,text,text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_cash_bill(uuid,text,date,jsonb,public.payment_method,uuid,text,numeric,text,text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.update_cash_bill_any_state(uuid,uuid,date,date,jsonb,text,numeric,text,text,uuid,date,uuid,public.payment_method,uuid,numeric,text,date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.update_cash_bill_any_state(uuid,uuid,date,date,jsonb,text,numeric,text,text,uuid,date,uuid,public.payment_method,uuid,numeric,text,date) TO authenticated;
