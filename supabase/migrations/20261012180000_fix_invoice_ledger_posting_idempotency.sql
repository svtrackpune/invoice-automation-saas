-- Preserve the LED-001 journal lifecycle in invoice posting:
-- create the entry as draft, insert every ledger line, then post once complete.
-- Also make a retry heal an invoice whose matching posted journal is present but
-- whose invoices.journal_entry_id was not persisted, without duplicating ledger impact.
BEGIN;

DO $fix_invoice_posting$
DECLARE
  v_target regprocedure := 'public.post_invoice(uuid,uuid)'::regprocedure;
  v_definition text;
  v_old text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef(v_target) INTO v_definition;

  -- Extend the local state to validate an existing source-key collision safely.
  v_old := $old$  v_entry uuid;$old$;
  v_new := $new$  v_entry uuid;
  v_existing_entry_status text;$new$;
  IF position(v_old IN v_definition) > 0 THEN
    v_definition := replace(v_definition, v_old, v_new);
  ELSIF position('v_existing_entry_status text' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Invoice posting patch aborted: expected v_entry declaration not found';
  END IF;

  -- A journal header must remain draft until every journal_lines insert finishes.
  v_old := $old$    'posted',
    now(),
    auth.uid(),
    auth.uid(),
    inv.currency_code,$old$;
  v_new := $new$    'draft',
    NULL,
    NULL,
    auth.uid(),
    inv.currency_code,$new$;
  IF position(v_old IN v_definition) > 0 THEN
    v_definition := replace(v_definition, v_old, v_new);
  ELSIF position($check$    'draft',
    NULL,
    NULL,
    auth.uid(),
    inv.currency_code,$check$ IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Invoice posting patch aborted: header status block was not found';
  END IF;

  -- The update below fires set_journal_totals after base revenue, tax, and any
  -- COGS/inventory lines have all been inserted. The existing trigger re-checks
  -- debit/credit parity before the posted state can commit.
  v_old := $old$  PERFORM public.validate_journal_entry_balance(v_entry);$old$;
  v_new := $new$  UPDATE public.journal_entries
  SET status = 'posted',
      posted_at = now(),
      posted_by = auth.uid()
  WHERE id = v_entry
    AND status = 'draft';

  IF NOT FOUND THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.journal_entries
      WHERE id = v_entry
        AND business_id = inv.business_id
        AND source_type = 'invoice'
        AND source_id = inv.id
        AND status = 'posted'
    ) THEN
      RAISE EXCEPTION 'Invoice posting refused: journal entry % did not transition from draft to posted', v_entry;
    END IF;
  END IF;

  PERFORM public.validate_journal_entry_balance(v_entry);$new$;
  IF position(v_old IN v_definition) > 0 THEN
    v_definition := replace(v_definition, v_old, v_new);
  ELSIF position('UPDATE public.journal_entries' || E'\n  SET status = \'posted\'' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Invoice posting patch aborted: final balance-validation point not found';
  END IF;

  -- If the unique source identity already exists, only reuse a fully posted,
  -- balanced journal belonging to this same invoice/business. Never append to it.
  v_old := $old$  IF v_entry IS NULL THEN
    SELECT id INTO v_entry
    FROM public.journal_entries
    WHERE source_type='invoice' AND source_id=inv.id
    LIMIT 1;
    RETURN v_entry;
  END IF;$old$;
  v_new := $new$  IF v_entry IS NULL THEN
    SELECT id, status::text
      INTO v_entry, v_existing_entry_status
    FROM public.journal_entries
    WHERE business_id = inv.business_id
      AND source_type = 'invoice'
      AND source_id = inv.id
    FOR UPDATE;

    IF v_entry IS NULL THEN
      RAISE EXCEPTION 'Invoice journal uniqueness conflict could not be resolved for invoice %', inv.id;
    END IF;

    IF v_existing_entry_status IS DISTINCT FROM 'posted' THEN
      RAISE EXCEPTION
        'Invoice journal entry % already exists in status %; refusing to duplicate or append ledger lines',
        v_entry, coalesce(v_existing_entry_status, 'unknown');
    END IF;

    PERFORM public.validate_journal_entry_balance(v_entry);

    UPDATE public.invoices
    SET journal_entry_id = v_entry,
        status = CASE
          WHEN balance_due <= 0 THEN 'paid'::invoice_status
          WHEN due_date < current_date THEN 'overdue'::invoice_status
          WHEN amount_paid > 0 THEN 'partially_paid'::invoice_status
          ELSE 'sent'::invoice_status
        END,
        updated_at = now()
    WHERE id = inv.id
      AND business_id = inv.business_id;

    RETURN v_entry;
  END IF;$new$;
  IF position(v_old IN v_definition) > 0 THEN
    v_definition := replace(v_definition, v_old, v_new);
  ELSIF position('Invoice journal uniqueness conflict could not be resolved' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Invoice posting patch aborted: idempotent conflict branch not found';
  END IF;

  IF position($assert$'draft',
    NULL,
    NULL,
    auth.uid(),
    inv.currency_code,$assert$ IN v_definition) = 0
     OR position('SET status = ''posted''' IN v_definition) = 0
     OR position('Invoice journal uniqueness conflict could not be resolved' IN v_definition) = 0
     OR position('v_existing_entry_status IS DISTINCT FROM ''posted''' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Invoice posting patch aborted: lifecycle/idempotency assertions failed';
  END IF;

  EXECUTE v_definition;
END;
$fix_invoice_posting$;

COMMIT;
