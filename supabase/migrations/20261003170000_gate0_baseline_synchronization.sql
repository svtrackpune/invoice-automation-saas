BEGIN;

-- Gate 0: baseline synchronization.
-- 1) Provider-neutral gateway settlement RPC with explicit gross/fee/net accounting.
-- 2) Remove the unused legacy reconciliation model only when production is empty.
-- 3) Make the invoice <-> quotation relationship safely deferrable.

DROP FUNCTION IF EXISTS public.record_gateway_payment(
  text,text,text,text,numeric,date,text
);

CREATE OR REPLACE FUNCTION public.record_gateway_payment(
  p_provider text,
  p_provider_link_id text,
  p_provider_transaction_id text,
  p_event_id text,
  p_gross_amount numeric,
  p_fee_amount numeric DEFAULT 0,
  p_net_amount numeric DEFAULT NULL,
  p_payment_date date DEFAULT CURRENT_DATE,
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','mm_private'
AS $function$
DECLARE
  v_provider text := lower(btrim(coalesce(p_provider,'')));
  v_link public.payment_links%rowtype;
  v_inv public.invoices%rowtype;
  v_payment uuid;
  v_receipt uuid;
  v_entry uuid;
  v_ar uuid;
  v_account uuid;
  v_fee_account uuid;
  v_allocated numeric;
  v_receipt_number text;
  v_net_amount numeric;
BEGIN
  IF v_provider NOT IN ('razorpay','stripe','payable','manual') THEN
    RAISE EXCEPTION 'Unsupported payment provider: %', v_provider;
  END IF;

  IF nullif(trim(p_provider_link_id),'') IS NULL THEN
    RAISE EXCEPTION 'Provider link id is required';
  END IF;

  IF nullif(trim(p_provider_transaction_id),'') IS NULL THEN
    RAISE EXCEPTION 'Provider transaction id is required';
  END IF;

  IF nullif(trim(p_event_id),'') IS NULL THEN
    RAISE EXCEPTION 'Provider event id is required';
  END IF;

  IF p_gross_amount IS NULL OR p_gross_amount <= 0 THEN
    RAISE EXCEPTION 'Gateway gross amount must be greater than zero';
  END IF;

  IF p_fee_amount IS NULL OR p_fee_amount < 0 THEN
    RAISE EXCEPTION 'Gateway fee amount cannot be negative';
  END IF;

  v_net_amount := coalesce(p_net_amount, p_gross_amount - p_fee_amount);

  IF v_net_amount <= 0 THEN
    RAISE EXCEPTION 'Gateway net amount must be greater than zero';
  END IF;

  IF abs((p_gross_amount - p_fee_amount) - v_net_amount) > 0.000001 THEN
    RAISE EXCEPTION 'Gateway gross, fee and net amounts do not reconcile';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext(
      'gateway-transaction:' || v_provider || ':' || p_provider_transaction_id
    )
  );

  SELECT id
  INTO v_payment
  FROM public.payments
  WHERE gateway_transaction_id = p_provider_transaction_id
  LIMIT 1;

  IF v_payment IS NOT NULL THEN
    SELECT id
    INTO v_receipt
    FROM public.receipts
    WHERE payment_id = v_payment
    LIMIT 1;

    RETURN coalesce(v_receipt, v_payment);
  END IF;

  SELECT *
  INTO v_link
  FROM public.payment_links
  WHERE lower(provider) = v_provider
    AND provider_link_id = p_provider_link_id
  FOR UPDATE;

  IF v_link.id IS NULL THEN
    RAISE EXCEPTION 'Payment link not found for provider % and link %',
      v_provider, p_provider_link_id;
  END IF;

  SELECT *
  INTO v_inv
  FROM public.invoices
  WHERE id = v_link.invoice_id
    AND business_id = v_link.business_id
  FOR UPDATE;

  IF v_inv.id IS NULL THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;

  IF v_inv.status = 'void' THEN
    RAISE EXCEPTION 'Cannot record payment for void invoice';
  END IF;

  IF v_inv.journal_entry_id IS NULL THEN
    RAISE EXCEPTION 'Invoice must be posted before gateway payment';
  END IF;

  IF upper(v_link.currency_code) IS DISTINCT FROM upper(v_inv.currency_code) THEN
    RAISE EXCEPTION 'Payment link currency does not match invoice currency';
  END IF;

  IF p_gross_amount > greatest(v_inv.balance_due,0) THEN
    RAISE EXCEPTION 'Payment exceeds invoice balance';
  END IF;

  SELECT id
  INTO v_account
  FROM public.accounts
  WHERE business_id = v_link.business_id
    AND code = '1010'
    AND is_active
  LIMIT 1;

  IF v_account IS NULL THEN
    RAISE EXCEPTION 'Gateway payment account is missing';
  END IF;

  SELECT id
  INTO v_ar
  FROM public.accounts
  WHERE business_id = v_link.business_id
    AND code = '1100'
    AND is_active
  LIMIT 1;

  IF v_ar IS NULL THEN
    RAISE EXCEPTION 'Accounts receivable account is missing';
  END IF;

  IF p_fee_amount > 0 THEN
    SELECT id
    INTO v_fee_account
    FROM public.accounts
    WHERE business_id = v_link.business_id
      AND code = '6200'
      AND is_active
      AND lower(account_type::text) = 'expense'
    LIMIT 1;

    IF v_fee_account IS NULL THEN
      RAISE EXCEPTION 'Payment processing fee expense account is missing';
    END IF;
  END IF;

  INSERT INTO public.payments(
    business_id,
    direction,
    customer_id,
    invoice_id,
    account_id,
    amount,
    currency_code,
    payment_date,
    method,
    reference,
    gateway_transaction_id,
    notes,
    created_by
  )
  VALUES(
    v_link.business_id,
    'inbound',
    v_inv.customer_id,
    v_inv.id,
    v_account,
    p_gross_amount,
    v_inv.currency_code,
    p_payment_date,
    'payment_gateway'::public.payment_method,
    coalesce(p_provider_transaction_id,p_event_id),
    p_provider_transaction_id,
    coalesce(
      p_notes,
      'Gateway payment: ' || v_provider
        || CASE WHEN p_fee_amount > 0
                THEN ' (fee ' || p_fee_amount || ')'
                ELSE ''
           END
    ),
    NULL
  )
  RETURNING id INTO v_payment;

  INSERT INTO public.payment_allocations(
    business_id,
    payment_id,
    invoice_id,
    amount,
    currency_code
  )
  VALUES(
    v_link.business_id,
    v_payment,
    v_inv.id,
    p_gross_amount,
    v_inv.currency_code
  );

  PERFORM pg_advisory_xact_lock(
    hashtext('journal-entry-number:' || v_link.business_id::text)
  );

  INSERT INTO public.journal_entries(
    business_id,
    entry_number,
    entry_date,
    description,
    source_type,
    source_id,
    status,
    posted_at,
    posted_by,
    created_by,
    currency_code,
    total_debit,
    total_credit,
    is_system_generated
  )
  VALUES(
    v_link.business_id,
    (
      SELECT coalesce(max(entry_number),0) + 1
      FROM public.journal_entries
      WHERE business_id = v_link.business_id
    ),
    p_payment_date,
    'Gateway payment for invoice ' || v_inv.invoice_number,
    'payment',
    v_payment,
    'posted',
    now(),
    NULL,
    NULL,
    v_inv.currency_code,
    p_gross_amount,
    p_gross_amount,
    true
  )
  RETURNING id INTO v_entry;

  IF p_fee_amount > 0 THEN
    INSERT INTO public.journal_lines(
      journal_entry_id,
      account_id,
      description,
      debit,
      credit,
      currency_code,
      entity_type,
      entity_id
    )
    VALUES(
      v_entry,
      v_account,
      'Gateway settlement received',
      v_net_amount,
      0,
      v_inv.currency_code,
      'customer',
      v_inv.customer_id
    ),
    (
      v_entry,
      v_fee_account,
      'Payment processing fee',
      p_fee_amount,
      0,
      v_inv.currency_code,
      'customer',
      v_inv.customer_id
    ),
    (
      v_entry,
      v_ar,
      'Receivable settlement',
      0,
      p_gross_amount,
      v_inv.currency_code,
      'customer',
      v_inv.customer_id
    );
  ELSE
    INSERT INTO public.journal_lines(
      journal_entry_id,
      account_id,
      description,
      debit,
      credit,
      currency_code,
      entity_type,
      entity_id
    )
    VALUES(
      v_entry,
      v_account,
      'Gateway customer payment',
      p_gross_amount,
      0,
      v_inv.currency_code,
      'customer',
      v_inv.customer_id
    ),
    (
      v_entry,
      v_ar,
      'Receivable settlement',
      0,
      p_gross_amount,
      v_inv.currency_code,
      'customer',
      v_inv.customer_id
    );
  END IF;

  PERFORM public.validate_journal_entry_balance(v_entry);

  UPDATE public.payments
  SET journal_entry_id = v_entry
  WHERE id = v_payment;

  SELECT coalesce(sum(pa.amount),0)
  INTO v_allocated
  FROM public.payment_allocations pa
  WHERE pa.invoice_id = v_inv.id
    AND upper(pa.currency_code) = upper(v_inv.currency_code);

  UPDATE public.invoices
  SET amount_paid = v_allocated,
      balance_due = greatest(total - v_allocated,0),
      status = CASE
        WHEN v_allocated >= total THEN 'paid'::invoice_status
        WHEN v_allocated > 0 AND due_date < current_date THEN 'overdue'::invoice_status
        WHEN v_allocated > 0 THEN 'partially_paid'::invoice_status
        WHEN due_date < current_date THEN 'overdue'::invoice_status
        ELSE 'sent'::invoice_status
      END,
      updated_at = now()
  WHERE id = v_inv.id;

  v_receipt_number := public.next_document_number(
    v_link.business_id,
    'receipt'
  );

  INSERT INTO public.receipts(
    business_id,
    customer_id,
    payment_id,
    receipt_number,
    receipt_date,
    amount,
    currency_code,
    payment_method,
    reference_number,
    notes,
    created_by
  )
  VALUES(
    v_link.business_id,
    v_inv.customer_id,
    v_payment,
    v_receipt_number,
    p_payment_date,
    p_gross_amount,
    v_inv.currency_code,
    'payment_gateway',
    p_provider_transaction_id,
    p_notes,
    NULL
  )
  RETURNING id INTO v_receipt;

  RETURN v_receipt;
END;
$function$;

-- Backward-compatible wrapper for existing provider integrations that still
-- submit p_amount. New integrations must use the gross/fee/net contract.
CREATE OR REPLACE FUNCTION public.record_gateway_payment(
  p_provider text,
  p_provider_link_id text,
  p_provider_transaction_id text,
  p_event_id text,
  p_amount numeric,
  p_payment_date date DEFAULT CURRENT_DATE,
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','mm_private'
AS $function$
BEGIN
  RETURN public.record_gateway_payment(
    p_provider,
    p_provider_link_id,
    p_provider_transaction_id,
    p_event_id,
    p_amount,
    0,
    p_amount,
    p_payment_date,
    p_notes
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.record_gateway_payment(
  text,text,text,text,numeric,numeric,numeric,date,text
) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_gateway_payment(
  text,text,text,text,numeric,numeric,numeric,date,text
) TO service_role;

REVOKE ALL ON FUNCTION public.record_gateway_payment(
  text,text,text,text,numeric,date,text
) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_gateway_payment(
  text,text,text,text,numeric,date,text
) TO service_role;

-- Legacy reconciliation cleanup is deliberately fail-closed.
-- If production data or external FKs appear later, the migration aborts
-- instead of silently discarding state.
DO $$
DECLARE
  v_reconciliation_rows bigint;
  v_reconciliation_item_rows bigint;
  v_external_fks bigint;
BEGIN
  SELECT count(*) INTO v_reconciliation_rows
  FROM public.reconciliations;

  SELECT count(*) INTO v_reconciliation_item_rows
  FROM public.reconciliation_items;

  IF v_reconciliation_rows <> 0 OR v_reconciliation_item_rows <> 0 THEN
    RAISE EXCEPTION
      'Gate 0 refused to drop legacy reconciliation tables: data exists (% reconciliations, % items)',
      v_reconciliation_rows,
      v_reconciliation_item_rows;
  END IF;

  SELECT count(*) INTO v_external_fks
  FROM pg_constraint c
  WHERE c.contype = 'f'
    AND c.confrelid IN (
      'public.reconciliations'::regclass,
      'public.reconciliation_items'::regclass
    )
    AND c.conrelid NOT IN (
      'public.reconciliations'::regclass,
      'public.reconciliation_items'::regclass
    );

  IF v_external_fks <> 0 THEN
    RAISE EXCEPTION
      'Gate 0 refused to drop legacy reconciliation tables: % external foreign keys exist',
      v_external_fks;
  END IF;
END;
$$;

DROP TABLE IF EXISTS public.reconciliation_items;
DROP TABLE IF EXISTS public.reconciliations;

-- Replace the invoice <-> quotation foreign keys with deferred SET NULL
-- constraints. Both sides remain nullable and no delete can cascade into
-- financial documents.
ALTER TABLE public.invoices
  DROP CONSTRAINT IF EXISTS invoices_source_quotation_id_fkey;

ALTER TABLE public.quotations
  DROP CONSTRAINT IF EXISTS quotations_invoice_id_fkey;

ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_source_quotation_id_fkey
  FOREIGN KEY (source_quotation_id)
  REFERENCES public.quotations(id)
  ON DELETE SET NULL
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE public.quotations
  ADD CONSTRAINT quotations_invoice_id_fkey
  FOREIGN KEY (invoice_id)
  REFERENCES public.invoices(id)
  ON DELETE SET NULL
  DEFERRABLE INITIALLY DEFERRED;

COMMIT;
