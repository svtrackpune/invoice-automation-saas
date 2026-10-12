BEGIN;

-- The journal_entry_source_unique constraint enforces UNIQUE (business_id, source_type, source_id).
-- The original posted journal must retain source_type='invoice'; a replacement correction
-- entry needs its own source_type so it does not collide with the original invoice journal.
DO $fix_invoice_correction_source$
DECLARE
  v_target regprocedure := 'public.update_invoice_any_state(uuid,uuid,date,date,jsonb,text,numeric,text,text,uuid,date,uuid,text,uuid)'::regprocedure;
  v_definition text;
  v_old text := $old$'Invoice '||inv.invoice_number||' (corrected)','invoice',inv.id,'draft',$old$;
  v_new text := $new$'Invoice '||inv.invoice_number||' (corrected)','invoice_correction',inv.id,'draft',$new$;
BEGIN
  SELECT pg_get_functiondef(v_target) INTO v_definition;

  IF length(v_definition)-length(replace(v_definition,v_old,'')) <> length(v_old) THEN
    RAISE EXCEPTION 'Invoice correction source patch aborted: expected exactly one corrected-entry source identity';
  END IF;

  v_definition := replace(v_definition,v_old,v_new);
  EXECUTE v_definition;
END;
$fix_invoice_correction_source$;

COMMIT;
