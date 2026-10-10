BEGIN;

-- A stricter validated debit/credit check already exists in production. Only
-- add this NOT VALID constraint if no equivalent or stronger check is present.
DO $line_amount_check$
DECLARE v_stronger boolean;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.journal_lines'::regclass AND conname='journal_lines_nonnegative_positive_side_chk') THEN
    SELECT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conrelid='public.journal_lines'::regclass AND contype='c' AND convalidated
        AND lower(pg_get_constraintdef(oid)) LIKE '%debit >=%'
        AND lower(pg_get_constraintdef(oid)) LIKE '%credit >=%'
        AND lower(pg_get_constraintdef(oid)) LIKE '%debit + credit%'
        AND lower(pg_get_constraintdef(oid)) LIKE '%> (0)%'
    ) INTO v_stronger;
    IF NOT v_stronger THEN
      ALTER TABLE public.journal_lines
        ADD CONSTRAINT journal_lines_nonnegative_positive_side_chk
        CHECK (debit >= 0 AND credit >= 0 AND (debit > 0 OR credit > 0))
        NOT VALID;
    END IF;
  END IF;
END;
$line_amount_check$;

CREATE OR REPLACE FUNCTION public.fn_validate_journal_entry_balance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_ids uuid[];
  v_id uuid;
  v_status text;
  v_count bigint;
  v_debit numeric;
  v_credit numeric;
BEGIN
  IF TG_TABLE_NAME='journal_entries' THEN
    IF TG_OP='DELETE' THEN v_ids := ARRAY[OLD.id]; ELSE v_ids := ARRAY[NEW.id]; END IF;
  ELSIF TG_OP='INSERT' THEN
    v_ids := ARRAY[NEW.journal_entry_id];
  ELSIF TG_OP='DELETE' THEN
    v_ids := ARRAY[OLD.journal_entry_id];
  ELSE
    v_ids := ARRAY[OLD.journal_entry_id, NEW.journal_entry_id];
  END IF;

  FOREACH v_id IN ARRAY v_ids LOOP
    IF v_id IS NULL THEN CONTINUE; END IF;
    SELECT status::text INTO v_status FROM public.journal_entries WHERE id=v_id;
    -- Skip child trigger events from a parent delete/cascade.
    IF NOT FOUND THEN CONTINUE; END IF;

    IF v_status IN ('posted','locked') THEN
      SELECT count(*), round(coalesce(sum(debit),0),2), round(coalesce(sum(credit),0),2)
        INTO v_count,v_debit,v_credit
      FROM public.journal_lines WHERE journal_entry_id=v_id;
      IF v_count < 2 OR v_debit <> v_credit THEN
        RAISE EXCEPTION
          'LED-001 VIOLATION: journal entry % requires at least two lines and equal debit/credit totals at cent precision (lines %, debit %, credit %)',
          v_id,v_count,v_debit,v_credit
          USING ERRCODE='23514', CONSTRAINT='journal_entries_balance_guard';
      END IF;
    END IF;
  END LOOP;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_guard_posted_journal_line_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE v_status text;
BEGIN
  SELECT status::text INTO v_status FROM public.journal_entries WHERE id=NEW.journal_entry_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'LED-001 VIOLATION: journal entry % does not exist', NEW.journal_entry_id
      USING ERRCODE='23514', CONSTRAINT='journal_entries_balance_guard';
  END IF;
  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'LED-001 VIOLATION: lines may be added only to draft entries; entry % is %',
      NEW.journal_entry_id,v_status
      USING ERRCODE='23514', CONSTRAINT='journal_entries_balance_guard';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_prevent_posted_journal_entry_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF OLD.status::text IN ('posted','locked') THEN
    RAISE EXCEPTION 'LED-001 VIOLATION: posted journal entries are immutable; create a reversal instead'
      USING ERRCODE='23514', CONSTRAINT='journal_entries_balance_guard';
  END IF;
  RETURN OLD;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_validate_journal_entry_balance() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_guard_posted_journal_line_insert() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_prevent_posted_journal_entry_delete() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_journal_entries_balance_guard ON public.journal_entries;
CREATE CONSTRAINT TRIGGER trg_journal_entries_balance_guard
AFTER INSERT OR UPDATE ON public.journal_entries
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.fn_validate_journal_entry_balance();

DROP TRIGGER IF EXISTS trg_journal_lines_balance_guard ON public.journal_lines;
CREATE CONSTRAINT TRIGGER trg_journal_lines_balance_guard
AFTER INSERT OR UPDATE OR DELETE ON public.journal_lines
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.fn_validate_journal_entry_balance();

DROP TRIGGER IF EXISTS trg_guard_posted_journal_line_insert ON public.journal_lines;
CREATE TRIGGER trg_guard_posted_journal_line_insert
BEFORE INSERT ON public.journal_lines
FOR EACH ROW EXECUTE FUNCTION public.fn_guard_posted_journal_line_insert();

DROP TRIGGER IF EXISTS trg_prevent_posted_journal_entry_delete ON public.journal_entries;
CREATE TRIGGER trg_prevent_posted_journal_entry_delete
BEFORE DELETE ON public.journal_entries
FOR EACH ROW EXECUTE FUNCTION public.fn_prevent_posted_journal_entry_delete();

COMMIT;
