BEGIN;

-- The correction patch now assigns v_journal to the new draft replacement entry.
-- Remove the redundant delete statement left over from the original in-place mutation
-- block so the correction source no longer contains any journal-line delete operation.
DO $cleanup_invoice_journal$
DECLARE
  v_target regprocedure := 'public.update_invoice_any_state(uuid,uuid,date,date,jsonb,text,numeric,text,text,uuid,date,uuid,text,uuid)'::regprocedure;
  v_definition text;
  v_old text := E'    DELETE FROM public.journal_lines WHERE journal_entry_id=v_journal;\n';
BEGIN
  SELECT pg_get_functiondef(v_target) INTO v_definition;

  IF length(v_definition)-length(replace(v_definition,v_old,'')) <> length(v_old) THEN
    RAISE EXCEPTION 'Invoice journal cleanup aborted: expected exactly one redundant deletion against the new draft entry';
  END IF;

  IF position('RETURNING id INTO v_journal;' IN v_definition) = 0
     OR position(v_old IN v_definition) < position('RETURNING id INTO v_journal;' IN v_definition) THEN
    RAISE EXCEPTION 'Invoice journal cleanup aborted: delete site is not located after creating the new draft journal';
  END IF;

  v_definition := replace(v_definition,v_old,'');
  EXECUTE v_definition;
END;
$cleanup_invoice_journal$;

COMMIT;
