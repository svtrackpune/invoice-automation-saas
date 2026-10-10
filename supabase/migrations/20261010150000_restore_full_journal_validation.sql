BEGIN;

-- Restore the pre-existing dual-currency/base-currency validation inside the
-- hardened BEFORE UPDATE posting trigger. LED-001 parity checks occur first.
CREATE OR REPLACE FUNCTION mm_private.set_journal_totals()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'mm_private'
AS $function$
DECLARE
  v_line_count bigint;
BEGIN
  IF NEW.status = 'posted' THEN
    SELECT count(*), coalesce(sum(debit),0), coalesce(sum(credit),0)
      INTO v_line_count, NEW.total_debit, NEW.total_credit
      FROM public.journal_lines
     WHERE journal_entry_id = NEW.id;

    IF v_line_count < 2
       OR round(coalesce(NEW.total_debit,0),2) = 0
       OR round(coalesce(NEW.total_debit,0),2) <> round(coalesce(NEW.total_credit,0),2) THEN
      RAISE EXCEPTION
        'LED-001 VIOLATION: journal entry % requires at least two lines and equal debit/credit totals at cent precision (lines %, debit %, credit %)',
        NEW.id, v_line_count, NEW.total_debit, NEW.total_credit
        USING ERRCODE = '23514',
              CONSTRAINT = 'journal_entries_balance_guard';
    END IF;

    PERFORM public.validate_journal_entry_balance(NEW.id);
  END IF;
  RETURN NEW;
END;
$function$;

COMMIT;
