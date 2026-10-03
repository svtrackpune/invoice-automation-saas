BEGIN;

-- Gate 3: Enterprise bank reconciliation hardening.
-- The bank_transactions table is historically tenant-scoped through bank_accounts.
-- Persisting business_id and a deterministic fingerprint makes the import contract
-- explicit and prevents duplicate rows across overlapping statement imports.

ALTER TABLE public.bank_transactions
  ADD COLUMN IF NOT EXISTS business_id uuid,
  ADD COLUMN IF NOT EXISTS fingerprint text;

UPDATE public.bank_transactions bt
SET business_id = ba.business_id
FROM public.bank_accounts ba
WHERE ba.id = bt.bank_account_id
  AND bt.business_id IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.bank_transactions WHERE business_id IS NULL) THEN
    RAISE EXCEPTION 'Gate 3 requires every bank transaction to resolve to a business';
  END IF;
END $$;

ALTER TABLE public.bank_transactions
  ALTER COLUMN business_id SET NOT NULL;

ALTER TABLE public.bank_transactions
  DROP CONSTRAINT IF EXISTS bank_transactions_business_id_fkey;

ALTER TABLE public.bank_transactions
  ADD CONSTRAINT bank_transactions_business_id_fkey
  FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION public.bank_transaction_fingerprint(
  p_business_id uuid,
  p_bank_account_id uuid,
  p_transaction_date date,
  p_signed_amount numeric,
  p_reference text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT encode(
    digest(
      p_business_id::text
      || p_bank_account_id::text
      || p_transaction_date::text
      || to_char(
           CASE
             WHEN p_signed_amount = 0 THEN 0
             ELSE round(p_signed_amount, 2)
           END,
           'FM999999999999999999990.00'
         )
      || encode(
           digest(
             regexp_replace(
               lower(trim(coalesce(p_reference, ''))),
               '[^a-z0-9]',
               '',
               'g'
             ),
             'sha256'
           ),
           'hex'
         ),
      'sha256'
    ),
    'hex'
  );
$fn$;

CREATE OR REPLACE FUNCTION public.sync_bank_transaction_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, mm_private
AS $fn$
DECLARE
  v_business_id uuid;
  v_signed_amount numeric;
BEGIN
  SELECT business_id
  INTO v_business_id
  FROM public.bank_accounts
  WHERE id = NEW.bank_account_id
    AND is_active;

  IF v_business_id IS NULL THEN
    RAISE EXCEPTION 'Bank account not found or inactive';
  END IF;

  IF NEW.business_id IS NOT NULL AND NEW.business_id IS DISTINCT FROM v_business_id THEN
    RAISE EXCEPTION 'Bank transaction business does not match bank account business';
  END IF;

  NEW.business_id := v_business_id;

  v_signed_amount :=
    CASE
      WHEN lower(NEW.direction::text) = 'inbound' THEN abs(NEW.amount)
      ELSE -abs(NEW.amount)
    END;

  NEW.fingerprint := public.bank_transaction_fingerprint(
    NEW.business_id,
    NEW.bank_account_id,
    NEW.transaction_date,
    v_signed_amount,
    NEW.reference
  );

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_bank_transaction_identity ON public.bank_transactions;
CREATE TRIGGER trg_bank_transaction_identity
BEFORE INSERT OR UPDATE OF business_id, bank_account_id, transaction_date, amount, direction, reference
ON public.bank_transactions
FOR EACH ROW
EXECUTE FUNCTION public.sync_bank_transaction_identity();

UPDATE public.bank_transactions bt
SET fingerprint = public.bank_transaction_fingerprint(
  bt.business_id,
  bt.bank_account_id,
  bt.transaction_date,
  CASE
    WHEN lower(bt.direction::text) = 'inbound' THEN abs(bt.amount)
    ELSE -abs(bt.amount)
  END,
  bt.reference
);

DO $
BEGIN
  IF EXISTS (
    SELECT business_id, bank_account_id, fingerprint
    FROM public.bank_transactions
    GROUP BY business_id, bank_account_id, fingerprint
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Gate 3 found duplicate historical bank transaction fingerprints; resolve them before enabling the unique constraint';
  END IF;
END $;

ALTER TABLE public.bank_transactions
  ALTER COLUMN fingerprint SET NOT NULL;

ALTER TABLE public.bank_transactions
  DROP CONSTRAINT IF EXISTS bank_transactions_business_bank_fingerprint_key;

ALTER TABLE public.bank_transactions
  ADD CONSTRAINT bank_transactions_business_bank_fingerprint_key
  UNIQUE (business_id, bank_account_id, fingerprint);

CREATE INDEX IF NOT EXISTS bank_transactions_business_date_idx
  ON public.bank_transactions(business_id, bank_account_id, transaction_date);

CREATE TABLE IF NOT EXISTS public.bank_statement_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  bank_account_id uuid NOT NULL REFERENCES public.bank_accounts(id) ON DELETE RESTRICT,
  source_format text NOT NULL CHECK (source_format IN ('csv','camt053','mt940','ofx','qbo')),
  filename text NOT NULL,
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  statement_start date,
  statement_end date,
  opening_balance numeric,
  closing_balance numeric,
  row_count integer NOT NULL CHECK (row_count >= 0),
  balance_verified boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing','completed','completed_unverified','failed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bank_statement_imports_business_idx
  ON public.bank_statement_imports(business_id, bank_account_id, created_at DESC);

ALTER TABLE public.bank_statement_imports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bank_statement_imports_select ON public.bank_statement_imports;
CREATE POLICY bank_statement_imports_select
ON public.bank_statement_imports
FOR SELECT TO authenticated
USING (
  mm_private.has_business_permission(business_id, 'banking.view')
  OR mm_private.has_business_permission(business_id, 'banking.reconcile')
  OR mm_private.has_business_permission(business_id, 'accounting.reconcile')
);

REVOKE INSERT, UPDATE, DELETE ON public.bank_statement_imports FROM anon, authenticated;
GRANT SELECT ON public.bank_statement_imports TO authenticated;

CREATE TABLE IF NOT EXISTS public.bank_reconciliation_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name text NOT NULL,
  priority integer NOT NULL DEFAULT 100,
  enabled boolean NOT NULL DEFAULT true,
  direction text NOT NULL DEFAULT 'both'
    CHECK (direction IN ('both','inbound','outbound')),
  reference_pattern text,
  description_pattern text,
  counterparty_pattern text,
  amount_min numeric,
  amount_max numeric,
  target_account_id uuid REFERENCES public.accounts(id) ON DELETE RESTRICT,
  auto_apply boolean NOT NULL DEFAULT false,
  confidence_threshold numeric NOT NULL DEFAULT 0.90
    CHECK (confidence_threshold >= 0 AND confidence_threshold <= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bank_reconciliation_rules_amount_range_chk
    CHECK (amount_min IS NULL OR amount_max IS NULL OR amount_min <= amount_max)
);

CREATE INDEX IF NOT EXISTS bank_reconciliation_rules_route_idx
  ON public.bank_reconciliation_rules(business_id, enabled, priority);

ALTER TABLE public.bank_reconciliation_rules ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bank_reconciliation_rules TO authenticated;

DROP POLICY IF EXISTS bank_reconciliation_rules_select ON public.bank_reconciliation_rules;
CREATE POLICY bank_reconciliation_rules_select
ON public.bank_reconciliation_rules
FOR SELECT TO authenticated
USING (
  mm_private.has_business_permission(business_id, 'accounting.view')
  OR mm_private.has_business_permission(business_id, 'banking.reconcile')
  OR mm_private.has_business_permission(business_id, 'accounting.reconcile')
);

DROP POLICY IF EXISTS bank_reconciliation_rules_insert ON public.bank_reconciliation_rules;
CREATE POLICY bank_reconciliation_rules_insert
ON public.bank_reconciliation_rules
FOR INSERT TO authenticated
WITH CHECK (
  mm_private.has_business_permission(business_id, 'accounting.adjust')
);

DROP POLICY IF EXISTS bank_reconciliation_rules_update ON public.bank_reconciliation_rules;
CREATE POLICY bank_reconciliation_rules_update
ON public.bank_reconciliation_rules
FOR UPDATE TO authenticated
USING (mm_private.has_business_permission(business_id, 'accounting.adjust'))
WITH CHECK (mm_private.has_business_permission(business_id, 'accounting.adjust'));

DROP POLICY IF EXISTS bank_reconciliation_rules_delete ON public.bank_reconciliation_rules;
CREATE POLICY bank_reconciliation_rules_delete
ON public.bank_reconciliation_rules
FOR DELETE TO authenticated
USING (mm_private.has_business_permission(business_id, 'accounting.adjust'));

CREATE OR REPLACE FUNCTION public.assert_accounting_period_open(
  p_business_id uuid,
  p_date date
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, mm_private
AS $fn$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.accounting_periods
    WHERE business_id = p_business_id
      AND p_date BETWEEN period_start AND period_end
      AND status IN ('closed','locked')
  ) THEN
    RAISE EXCEPTION 'Accounting period is closed or locked for %', p_date;
  END IF;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.create_bank_reconciliation(
  p_business_id uuid,
  p_bank_account_id uuid,
  p_period_start date,
  p_period_end date,
  p_statement_ending_balance numeric,
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, mm_private
AS $fn$
DECLARE
  v_id uuid;
  v_book numeric;
  v_diff numeric;
  v_existing_status text;
BEGIN
  IF NOT mm_private.has_business_permission(p_business_id, 'accounting.adjust') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  PERFORM public.assert_accounting_period_open(p_business_id, p_period_start);
  PERFORM public.assert_accounting_period_open(p_business_id, p_period_end);

  IF p_period_end < p_period_start THEN
    RAISE EXCEPTION 'Reconciliation period end cannot precede period start';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.bank_accounts
    WHERE id = p_bank_account_id
      AND business_id = p_business_id
      AND is_active
  ) THEN
    RAISE EXCEPTION 'Bank account not found';
  END IF;

  SELECT status
  INTO v_existing_status
  FROM public.bank_reconciliations
  WHERE bank_account_id = p_bank_account_id
    AND period_start = p_period_start
    AND period_end = p_period_end;

  IF v_existing_status = 'locked' THEN
    RAISE EXCEPTION 'Reconciliation is locked and cannot be reopened implicitly';
  END IF;

  SELECT coalesce((
    SELECT balance_after
    FROM public.bank_transactions
    WHERE bank_account_id = p_bank_account_id
      AND transaction_date <= p_period_end
    ORDER BY transaction_date DESC, imported_at DESC, id DESC
    LIMIT 1
  ),0)
  INTO v_book;

  v_diff := p_statement_ending_balance - v_book;

  INSERT INTO public.bank_reconciliations(
    business_id,
    bank_account_id,
    period_start,
    period_end,
    statement_ending_balance,
    book_ending_balance,
    difference,
    status,
    notes
  )
  VALUES(
    p_business_id,
    p_bank_account_id,
    p_period_start,
    p_period_end,
    p_statement_ending_balance,
    v_book,
    v_diff,
    'in_progress',
    p_notes
  )
  ON CONFLICT(bank_account_id,period_start,period_end)
  DO UPDATE SET
    statement_ending_balance = excluded.statement_ending_balance,
    book_ending_balance = excluded.book_ending_balance,
    difference = excluded.difference,
    status = 'in_progress',
    notes = excluded.notes,
    updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.match_bank_transaction(
  p_reconciliation_id uuid,
  p_bank_transaction_id uuid,
  p_match_type text,
  p_matched_record_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, mm_private
AS $fn$
DECLARE
  rid uuid;
  bid uuid;
  tx public.bank_transactions%rowtype;
  rec public.bank_reconciliations%rowtype;
  target_account uuid;
  source_account uuid;
  target_bank uuid;
  je uuid;
  v_entry_no bigint;
  existing public.bank_reconciliation_items%rowtype;
BEGIN
  SELECT * INTO rec
  FROM public.bank_reconciliations
  WHERE id = p_reconciliation_id
  FOR UPDATE;

  IF rec.id IS NULL THEN
    RAISE EXCEPTION 'Reconciliation not found';
  END IF;

  bid := rec.business_id;

  IF rec.status = 'locked' THEN
    RAISE EXCEPTION 'Reconciliation is locked';
  END IF;

  IF NOT mm_private.has_business_permission(bid,'accounting.adjust') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT * INTO tx
  FROM public.bank_transactions
  WHERE id = p_bank_transaction_id
    AND bank_account_id = rec.bank_account_id
  FOR UPDATE;

  IF tx.id IS NULL THEN
    RAISE EXCEPTION 'Bank transaction does not belong to reconciliation account';
  END IF;

  PERFORM public.assert_accounting_period_open(bid, tx.transaction_date);

  SELECT * INTO existing
  FROM public.bank_reconciliation_items
  WHERE reconciliation_id = rec.id
    AND bank_transaction_id = tx.id;

  IF existing.id IS NOT NULL AND existing.matched AND p_match_type <> 'none' THEN
    IF existing.match_type = p_match_type
       AND existing.matched_record_id = p_matched_record_id THEN
      RETURN existing.id;
    END IF;
    RAISE EXCEPTION 'Transaction is already matched; use an explicit reversal before changing the category';
  END IF;

  IF existing.id IS NOT NULL
     AND existing.matched
     AND p_match_type = 'none'
     AND existing.adjustment_journal_id IS NOT NULL THEN
    RAISE EXCEPTION 'Matched accounting adjustment requires an explicit reversal RPC before unmatching';
  END IF;

  IF p_match_type IN ('expense','journal','manual') AND p_matched_record_id IS NULL THEN
    RAISE EXCEPTION 'A target account is required for this match type';
  END IF;

  IF p_match_type IN ('expense','journal','manual')
     AND NOT EXISTS(
       SELECT 1 FROM public.accounts
       WHERE id = p_matched_record_id
         AND business_id = bid
         AND is_active
     ) THEN
    RAISE EXCEPTION 'Matched account is invalid';
  END IF;

  IF p_match_type = 'transfer' THEN
    target_bank := p_matched_record_id;
    IF target_bank IS NULL
       OR target_bank = rec.bank_account_id
       OR NOT EXISTS(
         SELECT 1 FROM public.bank_accounts
         WHERE id = target_bank
           AND business_id = bid
           AND is_active
       ) THEN
      RAISE EXCEPTION 'Target bank account is invalid';
    END IF;
  END IF;

  IF p_match_type NOT IN ('payment','expense','transfer','journal','manual','none') THEN
    RAISE EXCEPTION 'Unsupported match type';
  END IF;

  IF p_match_type IN ('expense','journal','manual','transfer') THEN
    IF NOT mm_private.has_business_permission(bid,'accounting.post') THEN
      RAISE EXCEPTION 'Accounting posting permission required';
    END IF;

    SELECT linked_account_id
    INTO source_account
    FROM public.bank_accounts
    WHERE id = rec.bank_account_id
      AND business_id = bid
      AND is_active;

    IF source_account IS NULL THEN
      RAISE EXCEPTION 'Source bank account is not linked to a chart-of-accounts account';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('journal-entry-number:'||bid::text));
    SELECT coalesce(max(entry_number),0)+1
    INTO v_entry_no
    FROM public.journal_entries
    WHERE business_id = bid;

    INSERT INTO public.journal_entries(
      business_id,entry_number,entry_date,description,source_type,source_id,status,
      posted_at,posted_by,created_by,currency_code,total_debit,total_credit,is_system_generated
    )
    VALUES(
      bid,
      v_entry_no,
      tx.transaction_date,
      CASE
        WHEN p_match_type='transfer'
        THEN 'Internal bank transfer: '||coalesce(tx.description,tx.reference,'Transfer')
        ELSE 'Bank transaction: '||coalesce(tx.description,tx.reference,'Transaction')
      END,
      CASE WHEN p_match_type='transfer' THEN 'bank_transfer' ELSE 'bank_transaction' END,
      tx.id,
      'posted',
      now(),
      auth.uid(),
      auth.uid(),
      (SELECT currency_code FROM public.bank_accounts WHERE id=rec.bank_account_id),
      tx.amount,
      tx.amount,
      true
    )
    RETURNING id INTO je;

    IF p_match_type='transfer' THEN
      SELECT linked_account_id
      INTO target_account
      FROM public.bank_accounts
      WHERE id = target_bank
        AND business_id = bid
        AND is_active;

      IF target_account IS NULL THEN
        RAISE EXCEPTION 'Target bank account is not linked to a chart-of-accounts account';
      END IF;

      IF lower(tx.direction::text)='outbound' THEN
        INSERT INTO public.journal_lines(
          journal_entry_id,account_id,description,debit,credit,currency_code
        )
        VALUES
        (
          je,target_account,'Transfer into bank account',tx.amount,0,
          (SELECT currency_code FROM public.bank_accounts WHERE id=rec.bank_account_id)
        ),
        (
          je,source_account,'Transfer from bank account',0,tx.amount,
          (SELECT currency_code FROM public.bank_accounts WHERE id=rec.bank_account_id)
        );
      ELSE
        INSERT INTO public.journal_lines(
          journal_entry_id,account_id,description,debit,credit,currency_code
        )
        VALUES
        (
          je,source_account,'Transfer into bank account',tx.amount,0,
          (SELECT currency_code FROM public.bank_accounts WHERE id=rec.bank_account_id)
        ),
        (
          je,target_account,'Transfer from bank account',0,tx.amount,
          (SELECT currency_code FROM public.bank_accounts WHERE id=rec.bank_account_id)
        );
      END IF;
    ELSE
      target_account := p_matched_record_id;

      IF lower(tx.direction::text)='outbound' THEN
        INSERT INTO public.journal_lines(
          journal_entry_id,account_id,description,debit,credit,currency_code
        )
        VALUES
        (
          je,target_account,coalesce(tx.description,'Bank expense'),tx.amount,0,
          (SELECT currency_code FROM public.bank_accounts WHERE id=rec.bank_account_id)
        ),
        (
          je,source_account,coalesce(tx.description,'Bank payment'),0,tx.amount,
          (SELECT currency_code FROM public.bank_accounts WHERE id=rec.bank_account_id)
        );
      ELSE
        INSERT INTO public.journal_lines(
          journal_entry_id,account_id,description,debit,credit,currency_code
        )
        VALUES
        (
          je,source_account,coalesce(tx.description,'Bank receipt'),tx.amount,0,
          (SELECT currency_code FROM public.bank_accounts WHERE id=rec.bank_account_id)
        ),
        (
          je,target_account,coalesce(tx.description,'Bank income'),0,tx.amount,
          (SELECT currency_code FROM public.bank_accounts WHERE id=rec.bank_account_id)
        );
      END IF;
    END IF;

    PERFORM public.validate_journal_entry_balance(je);
  END IF;

  INSERT INTO public.bank_reconciliation_items(
    reconciliation_id,
    bank_transaction_id,
    matched,
    match_type,
    matched_record_id,
    adjustment_journal_id,
    notes
  )
  VALUES(
    rec.id,
    tx.id,
    p_match_type <> 'none',
    p_match_type,
    p_matched_record_id,
    je,
    p_notes
  )
  ON CONFLICT(reconciliation_id,bank_transaction_id)
  DO UPDATE SET
    matched = excluded.matched,
    match_type = excluded.match_type,
    matched_record_id = excluded.matched_record_id,
    adjustment_journal_id = excluded.adjustment_journal_id,
    notes = excluded.notes
  RETURNING id INTO rid;

  UPDATE public.bank_transactions
  SET status = CASE
    WHEN p_match_type='none' THEN 'unreviewed'::bank_txn_status
    ELSE 'reconciled'::bank_txn_status
  END,
  reviewed_at = CASE WHEN p_match_type='none' THEN NULL ELSE now() END,
  reviewed_by = CASE WHEN p_match_type='none' THEN NULL ELSE auth.uid() END
  WHERE id = tx.id;

  RETURN rid;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.lock_bank_reconciliation(
  p_reconciliation_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, mm_private
AS $fn$
DECLARE
  r public.bank_reconciliations%rowtype;
  unmatched integer;
BEGIN
  SELECT * INTO r
  FROM public.bank_reconciliations
  WHERE id = p_reconciliation_id
  FOR UPDATE;

  IF r.id IS NULL THEN
    RAISE EXCEPTION 'Reconciliation not found';
  END IF;

  IF NOT mm_private.has_business_permission(r.business_id,'accounting.adjust') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF r.status='locked' THEN
    RETURN r.id;
  END IF;

  PERFORM public.assert_accounting_period_open(r.business_id, r.period_start);
  PERFORM public.assert_accounting_period_open(r.business_id, r.period_end);

  SELECT count(*)
  INTO unmatched
  FROM public.bank_transactions t
  WHERE t.bank_account_id = r.bank_account_id
    AND t.transaction_date BETWEEN r.period_start AND r.period_end
    AND coalesce(t.status::text,'') NOT IN ('reconciled','ignored');

  IF unmatched > 0 OR abs(r.difference) > 0.01 THEN
    RAISE EXCEPTION
      'Cannot lock: % bank transactions remain unreconciled or balance difference is %',
      unmatched,
      r.difference;
  END IF;

  UPDATE public.bank_reconciliations
  SET status='locked',
      locked_at=now(),
      locked_by=auth.uid(),
      reconciled_at=coalesce(reconciled_at,now()),
      reconciled_by=coalesce(reconciled_by,auth.uid()),
      updated_at=now()
  WHERE id=r.id;

  RETURN r.id;
END;
$fn$;

CREATE TABLE IF NOT EXISTS mm_private.bank_reversal_context (
  transaction_id bigint NOT NULL,
  reconciliation_id uuid NOT NULL,
  bank_transaction_id uuid NOT NULL,
  bank_reconciliation_item_id uuid NOT NULL,
  operation text NOT NULL,
  PRIMARY KEY (transaction_id, reconciliation_id, bank_transaction_id, bank_reconciliation_item_id)
);

REVOKE ALL ON TABLE mm_private.bank_reversal_context FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.prevent_locked_reconciliation_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, mm_private
AS $fn$
DECLARE
  v_transaction_id uuid;
  v_reconciliation_id uuid;
  v_item_id uuid;
  v_business_id uuid;
  v_transaction_date date;
BEGIN
  IF TG_TABLE_NAME = 'bank_transactions' THEN
    v_transaction_id := CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END;

    IF TG_OP IN ('UPDATE','DELETE')
       AND EXISTS (
         SELECT 1
         FROM mm_private.bank_reversal_context c
         WHERE c.transaction_id = txid_current()
           AND c.bank_transaction_id = v_transaction_id
           AND c.operation = 'reverse_locked_reconciliation'
       ) THEN
      RETURN coalesce(NEW, OLD);
    END IF;

    IF TG_OP IN ('UPDATE','DELETE') AND (
      EXISTS (
        SELECT 1
        FROM public.bank_reconciliation_items bri
        JOIN public.bank_reconciliations br ON br.id=bri.reconciliation_id
        WHERE bri.bank_transaction_id=v_transaction_id
          AND br.status='locked'
      )
      OR EXISTS (
        SELECT 1
        FROM public.bank_accounts ba
        JOIN public.accounting_periods ap ON ap.business_id=ba.business_id
        WHERE ba.id=CASE WHEN TG_OP='DELETE' THEN OLD.bank_account_id ELSE NEW.bank_account_id END
          AND CASE WHEN TG_OP='DELETE' THEN OLD.transaction_date ELSE NEW.transaction_date END
            BETWEEN ap.period_start AND ap.period_end
          AND ap.status IN ('closed','locked')
      )
      OR (TG_OP='UPDATE' AND EXISTS (
        SELECT 1
        FROM public.bank_accounts ba
        JOIN public.accounting_periods ap ON ap.business_id=ba.business_id
        WHERE ba.id=OLD.bank_account_id
          AND OLD.transaction_date BETWEEN ap.period_start AND ap.period_end
          AND ap.status IN ('closed','locked')
      ))
    ) THEN
      RAISE EXCEPTION 'Bank transaction belongs to a locked reconciliation or accounting period';
    END IF;

    RETURN coalesce(NEW, OLD);
  END IF;

  IF TG_TABLE_NAME = 'bank_reconciliation_items' THEN
    v_item_id := CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END;
    v_reconciliation_id := CASE WHEN TG_OP='DELETE' THEN OLD.reconciliation_id ELSE NEW.reconciliation_id END;

    IF TG_OP IN ('UPDATE','DELETE')
       AND EXISTS (
         SELECT 1
         FROM mm_private.bank_reversal_context c
         WHERE c.transaction_id = txid_current()
           AND c.bank_reconciliation_item_id = v_item_id
           AND c.operation = 'reverse_locked_reconciliation'
       ) THEN
      RETURN coalesce(NEW, OLD);
    END IF;

    IF TG_OP='UPDATE' AND EXISTS (
      SELECT 1
      FROM public.bank_reconciliations
      WHERE id IN (OLD.reconciliation_id, NEW.reconciliation_id)
        AND status='locked'
    ) THEN
      RAISE EXCEPTION 'Bank reconciliation item belongs to a locked reconciliation';
    END IF;

    IF TG_OP IN ('INSERT','DELETE') AND EXISTS (
      SELECT 1
      FROM public.bank_reconciliations
      WHERE id=v_reconciliation_id
        AND status='locked'
    ) THEN
      RAISE EXCEPTION 'Bank reconciliation item belongs to a locked reconciliation';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.bank_reconciliations br
      JOIN public.bank_transactions bt
        ON bt.id IN (
          CASE WHEN TG_OP='DELETE' THEN OLD.bank_transaction_id ELSE NEW.bank_transaction_id END
        )
      JOIN public.accounting_periods ap
        ON ap.business_id=br.business_id
      WHERE br.id=v_reconciliation_id
        AND bt.transaction_date BETWEEN ap.period_start AND ap.period_end
        AND ap.status IN ('closed','locked')
    ) THEN
      RAISE EXCEPTION 'Bank reconciliation item belongs to a locked accounting period';
    END IF;

    IF TG_OP='UPDATE' AND EXISTS (
      SELECT 1
      FROM public.bank_reconciliations br
      JOIN public.bank_transactions bt ON bt.id=OLD.bank_transaction_id
      JOIN public.accounting_periods ap ON ap.business_id=br.business_id
      WHERE br.id=OLD.reconciliation_id
        AND bt.transaction_date BETWEEN ap.period_start AND ap.period_end
        AND ap.status IN ('closed','locked')
    ) THEN
      RAISE EXCEPTION 'Bank reconciliation item belongs to a locked accounting period';
    END IF;

    RETURN coalesce(NEW, OLD);
  END IF;

  RETURN coalesce(NEW, OLD);
END;
$fn$;

DROP TRIGGER IF EXISTS trg_prevent_locked_reconciliation_mutation ON public.bank_transactions;
CREATE TRIGGER trg_prevent_locked_reconciliation_mutation
BEFORE UPDATE OR DELETE
ON public.bank_transactions
FOR EACH ROW
EXECUTE FUNCTION public.prevent_locked_reconciliation_mutation();

DROP TRIGGER IF EXISTS trg_prevent_locked_reconciliation_item_mutation ON public.bank_reconciliation_items;
CREATE TRIGGER trg_prevent_locked_reconciliation_item_mutation
BEFORE INSERT OR UPDATE OR DELETE
ON public.bank_reconciliation_items
FOR EACH ROW
EXECUTE FUNCTION public.prevent_locked_reconciliation_mutation();

CREATE OR REPLACE FUNCTION public.reverse_locked_bank_reconciliation(
  p_reconciliation_id uuid,
  p_bank_transaction_id uuid,
  p_reason text,
  p_reversal_date date DEFAULT current_date
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, mm_private
AS $fn$
DECLARE
  v_rec public.bank_reconciliations%rowtype;
  v_item public.bank_reconciliation_items%rowtype;
  v_tx public.bank_transactions%rowtype;
  v_reversal uuid;
  v_old_item jsonb;
  v_old_tx jsonb;
  v_org uuid;
BEGIN
  SELECT * INTO v_rec
  FROM public.bank_reconciliations
  WHERE id=p_reconciliation_id
  FOR UPDATE;

  IF v_rec.id IS NULL THEN
    RAISE EXCEPTION 'Reconciliation not found';
  END IF;

  IF v_rec.status <> 'locked' THEN
    RAISE EXCEPTION 'Reconciliation is not locked';
  END IF;

  IF NOT mm_private.has_business_permission(v_rec.business_id,'accounting.adjust') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  PERFORM public.assert_accounting_period_open(v_rec.business_id, v_rec.period_start);
  PERFORM public.assert_accounting_period_open(v_rec.business_id, p_reversal_date);

  SELECT * INTO v_item
  FROM public.bank_reconciliation_items
  WHERE reconciliation_id=p_reconciliation_id
    AND bank_transaction_id=p_bank_transaction_id
  FOR UPDATE;

  IF v_item.id IS NULL THEN
    RAISE EXCEPTION 'Bank transaction is not attached to the locked reconciliation';
  END IF;

  SELECT * INTO v_tx
  FROM public.bank_transactions
  WHERE id=p_bank_transaction_id
  FOR UPDATE;

  IF v_tx.id IS NULL THEN
    RAISE EXCEPTION 'Bank transaction not found';
  END IF;

  PERFORM public.assert_accounting_period_open(v_rec.business_id, v_tx.transaction_date);

  v_old_item := to_jsonb(v_item);
  v_old_tx := to_jsonb(v_tx);

  INSERT INTO mm_private.bank_reversal_context(
    transaction_id,reconciliation_id,bank_transaction_id,bank_reconciliation_item_id,operation
  ) VALUES (
    txid_current(),v_rec.id,v_tx.id,v_item.id,'reverse_locked_reconciliation'
  );

  IF v_item.adjustment_journal_id IS NOT NULL THEN
    v_reversal := public.reverse_journal_entry(
      v_item.adjustment_journal_id,
      p_reversal_date,
      coalesce(nullif(trim(p_reason),''),'Bank reconciliation reversal'),
      auth.uid()
    );
  END IF;

  UPDATE public.bank_reconciliation_items
  SET matched=false,
      match_type='none',
      matched_record_id=null,
      adjustment_journal_id=null,
      notes=trim(
        coalesce(notes,'')
        || CASE WHEN coalesce(trim(notes),'')='' THEN '' ELSE E'\n' END
        || 'Reversed: '
        || coalesce(nullif(trim(p_reason),''),'Bank reconciliation reversal')
      )
  WHERE id=v_item.id;

  UPDATE public.bank_transactions
  SET status='unreviewed'::bank_txn_status,
      reviewed_at=null,
      reviewed_by=null
  WHERE id=v_tx.id;

  UPDATE public.bank_reconciliations
  SET status='in_progress',
      locked_at=null,
      locked_by=null,
      reconciled_at=null,
      reconciled_by=null,
      updated_at=now(),
      notes=trim(
        coalesce(notes,'')
        || CASE WHEN coalesce(trim(notes),'')='' THEN '' ELSE E'\n' END
        || 'Reopened by audited reversal: '
        || coalesce(nullif(trim(p_reason),''),'Bank reconciliation reversal')
      )
  WHERE id=v_rec.id;

  SELECT organization_id INTO v_org
  FROM public.businesses
  WHERE id=v_rec.business_id;

  INSERT INTO public.audit_logs(
    business_id,
    organization_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    old_data,
    new_data
  )
  VALUES(
    v_rec.business_id,
    v_org,
    auth.uid(),
    'bank_reconciliation_reversal',
    'bank_reconciliation',
    v_rec.id,
    jsonb_build_object(
      'reconciliation_item',v_old_item,
      'bank_transaction',v_old_tx
    ),
    jsonb_build_object(
      'reason',coalesce(nullif(trim(p_reason),''),'Bank reconciliation reversal'),
      'reversal_journal_id',v_reversal,
      'bank_transaction_id',v_tx.id,
      'reopened',true,
      'reversal_date',p_reversal_date
    )
  );

  DELETE FROM mm_private.bank_reversal_context
  WHERE transaction_id=txid_current()
    AND reconciliation_id=v_rec.id
    AND bank_transaction_id=v_tx.id
    AND bank_reconciliation_item_id=v_item.id
    AND operation='reverse_locked_reconciliation';

  RETURN coalesce(v_reversal,v_item.id);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.save_bank_reconciliation_rule(
  p_business_id uuid,
  p_name text,
  p_priority integer DEFAULT 100,
  p_enabled boolean DEFAULT true,
  p_direction text DEFAULT 'both',
  p_reference_pattern text DEFAULT NULL,
  p_description_pattern text DEFAULT NULL,
  p_counterparty_pattern text DEFAULT NULL,
  p_amount_min numeric DEFAULT NULL,
  p_amount_max numeric DEFAULT NULL,
  p_target_account_id uuid DEFAULT NULL,
  p_auto_apply boolean DEFAULT false,
  p_confidence_threshold numeric DEFAULT 0.90
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, mm_private
AS $fn$
DECLARE
  v_id uuid;
BEGIN
  IF NOT mm_private.has_business_permission(p_business_id,'accounting.adjust') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF nullif(trim(p_name),'') IS NULL THEN
    RAISE EXCEPTION 'Rule name is required';
  END IF;

  IF p_direction NOT IN ('both','inbound','outbound') THEN
    RAISE EXCEPTION 'Unsupported rule direction';
  END IF;

  IF p_amount_min IS NOT NULL AND p_amount_max IS NOT NULL AND p_amount_min > p_amount_max THEN
    RAISE EXCEPTION 'Rule amount minimum cannot exceed maximum';
  END IF;

  IF p_target_account_id IS NOT NULL
     AND NOT EXISTS(
       SELECT 1 FROM public.accounts
       WHERE id=p_target_account_id
         AND business_id=p_business_id
         AND is_active
     ) THEN
    RAISE EXCEPTION 'Rule target account is invalid';
  END IF;

  IF p_confidence_threshold < 0 OR p_confidence_threshold > 1 THEN
    RAISE EXCEPTION 'Rule confidence threshold must be between 0 and 1';
  END IF;

  BEGIN
    IF p_reference_pattern IS NOT NULL THEN PERFORM regexp_replace('',p_reference_pattern,''); END IF;
    IF p_description_pattern IS NOT NULL THEN PERFORM regexp_replace('',p_description_pattern,''); END IF;
    IF p_counterparty_pattern IS NOT NULL THEN PERFORM regexp_replace('',p_counterparty_pattern,''); END IF;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'Invalid regular expression in bank reconciliation rule';
  END;

  INSERT INTO public.bank_reconciliation_rules(
    business_id,name,priority,enabled,direction,reference_pattern,
    description_pattern,counterparty_pattern,amount_min,amount_max,
    target_account_id,auto_apply,confidence_threshold
  )
  VALUES(
    p_business_id,p_name,p_priority,p_enabled,p_direction,p_reference_pattern,
    p_description_pattern,p_counterparty_pattern,p_amount_min,p_amount_max,
    p_target_account_id,p_auto_apply,p_confidence_threshold
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.save_bank_reconciliation_rule(
  uuid,text,integer,boolean,text,text,text,text,numeric,numeric,uuid,boolean,numeric
) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.save_bank_reconciliation_rule(
  uuid,text,integer,boolean,text,text,text,text,numeric,numeric,uuid,boolean,numeric
) TO authenticated;

CREATE OR REPLACE FUNCTION public.import_bank_statement_rows(
  p_business_id uuid,
  p_bank_account_id uuid,
  p_source_format text,
  p_filename text,
  p_content_hash text,
  p_statement_start date,
  p_statement_end date,
  p_opening_balance numeric,
  p_closing_balance numeric,
  p_balance_verified boolean,
  p_rows jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, mm_private
AS $fn$
DECLARE
  v_import_id uuid;
  v_row jsonb;
  v_inserted integer := 0;
  v_duplicates integer := 0;
  v_external text;
  v_direction text;
BEGIN
  IF NOT mm_private.has_business_permission(p_business_id,'banking.reconcile') THEN
    RAISE EXCEPTION 'Bank reconciliation permission required';
  END IF;

  IF NOT EXISTS(
    SELECT 1 FROM public.bank_accounts
    WHERE id=p_bank_account_id
      AND business_id=p_business_id
      AND is_active
  ) THEN
    RAISE EXCEPTION 'Bank account not found';
  END IF;

  IF p_source_format NOT IN ('csv','camt053','mt940','ofx','qbo') THEN
    RAISE EXCEPTION 'Unsupported bank statement format';
  END IF;

  IF p_statement_start IS NOT NULL AND p_statement_end IS NOT NULL
     AND p_statement_end < p_statement_start THEN
    RAISE EXCEPTION 'Statement end date cannot precede start date';
  END IF;

  IF p_content_hash IS NULL OR p_content_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Statement content hash is invalid';
  END IF;

  IF jsonb_typeof(coalesce(p_rows,'[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Statement rows must be a JSON array';
  END IF;

  PERFORM public.assert_accounting_period_open(
    p_business_id,
    coalesce(p_statement_start,p_statement_end,current_date)
  );

  INSERT INTO public.bank_statement_imports(
    business_id,bank_account_id,source_format,filename,content_hash,
    statement_start,statement_end,opening_balance,closing_balance,
    row_count,balance_verified,status
  )
  VALUES(
    p_business_id,p_bank_account_id,p_source_format,coalesce(p_filename,'statement'),
    lower(p_content_hash),p_statement_start,p_statement_end,p_opening_balance,
    p_closing_balance,jsonb_array_length(coalesce(p_rows,'[]'::jsonb)),
    coalesce(p_balance_verified,false),
    CASE WHEN coalesce(p_balance_verified,false) THEN 'completed' ELSE 'completed_unverified' END
  )
  RETURNING id INTO v_import_id;

  FOR v_row IN SELECT * FROM jsonb_array_elements(coalesce(p_rows,'[]'::jsonb))
  LOOP
    IF nullif(trim(v_row->>'transaction_date'),'') IS NULL THEN
      RAISE EXCEPTION 'Imported bank transaction date is required';
    END IF;

    IF (v_row->>'signed_amount') IS NULL
       OR (v_row->>'signed_amount')::numeric IS NULL THEN
      RAISE EXCEPTION 'Imported bank transaction amount is required';
    END IF;

    IF abs((v_row->>'signed_amount')::numeric) = 0 THEN
      RAISE EXCEPTION 'Zero-value bank transactions are not allowed';
    END IF;

    IF (v_row->>'transaction_date')::date IS NULL THEN
      RAISE EXCEPTION 'Imported bank transaction date is invalid';
    END IF;

    PERFORM public.assert_accounting_period_open(
      p_business_id,
      (v_row->>'transaction_date')::date
    );

    v_direction :=
      CASE WHEN (v_row->>'signed_amount')::numeric > 0
           THEN 'inbound'
           ELSE 'outbound'
      END;

    v_external := nullif(trim(v_row->>'external_transaction_id'),'');
    IF v_external IS NOT NULL
       AND EXISTS(
         SELECT 1
         FROM public.bank_transactions
         WHERE bank_account_id=p_bank_account_id
           AND external_transaction_id=v_external
       ) THEN
      v_external := NULL;
    END IF;

    INSERT INTO public.bank_transactions(
      bank_account_id,
      business_id,
      transaction_date,
      value_date,
      description,
      reference,
      amount,
      direction,
      balance_after,
      external_transaction_id,
      raw_data,
      suggested_account_id,
      status
    )
    VALUES(
      p_bank_account_id,
      p_business_id,
      (v_row->>'transaction_date')::date,
      nullif(v_row->>'value_date','')::date,
      nullif(v_row->>'description',''),
      nullif(v_row->>'reference',''),
      abs((v_row->>'signed_amount')::numeric),
      v_direction::payment_direction,
      CASE WHEN nullif(v_row->>'running_balance','') IS NULL
           THEN NULL
           ELSE (v_row->>'running_balance')::numeric
      END,
      v_external,
      coalesce(v_row->'raw_data','{}'::jsonb),
      nullif(v_row->>'suggested_account_id','')::uuid,
      'unreviewed'::bank_txn_status
    )
    ON CONFLICT (business_id, bank_account_id, fingerprint) DO NOTHING;

    GET DIAGNOSTICS v_inserted = ROW_COUNT;

    IF v_inserted = 0 THEN
      v_duplicates := v_duplicates + 1;
    ELSE
      v_inserted := v_inserted;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'import_id',v_import_id,
    'total_rows',jsonb_array_length(coalesce(p_rows,'[]'::jsonb)),
    'inserted_rows',
      jsonb_array_length(coalesce(p_rows,'[]'::jsonb)) - v_duplicates,
    'duplicate_skipped_rows',v_duplicates,
    'balance_verified',coalesce(p_balance_verified,false)
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.import_bank_statement_rows(
  uuid,uuid,text,text,text,date,date,numeric,numeric,boolean,jsonb
) FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.import_bank_statement_rows(
  uuid,uuid,text,text,text,date,date,numeric,numeric,boolean,jsonb
) TO service_role;

COMMIT;
