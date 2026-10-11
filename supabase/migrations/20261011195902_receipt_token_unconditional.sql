BEGIN;

-- Ensure a hashed public receipt token exists even without customer contact
-- details or enabled delivery channels. This migration is replay-safe: an
-- earlier migration may already have moved the token block ahead of this guard.
DO $patch$
DECLARE
  v_definition text;
  v_token_block text;
  v_old_guards text;
  v_new_guards text;
  v_token_position integer;
  v_customer_guard_position integer;
BEGIN
  v_definition := pg_get_functiondef(
    'public.enqueue_receipt_delivery_notifications(uuid)'::regprocedure
  );

  v_token_block := $token$
  v_access := public._issue_receipt_access_token(r.id, 'customer_download');
  v_token := v_access->>'token';
  IF v_token IS NULL OR v_token !~ '^[A-Fa-f0-9]{48,128}$' THEN
    RAISE EXCEPTION 'Receipt public token could not be issued';
  END IF;

  v_action_url := '/api/receipts/pdf?token=' || v_token;
$token$;

  v_old_guards := $guards$
  IF r.id IS NULL THEN
    RAISE EXCEPTION 'Receipt not found';
  END IF;

  IF r.customer_id IS NULL THEN
    RETURN 0;
  END IF;
$guards$;

  v_new_guards := $guards_new$
  IF r.id IS NULL THEN
    RAISE EXCEPTION 'Receipt not found';
  END IF;

  v_access := public._issue_receipt_access_token(r.id, 'customer_download');
  v_token := v_access->>'token';
  IF v_token IS NULL OR v_token !~ '^[A-Fa-f0-9]{48,128}$' THEN
    RAISE EXCEPTION 'Receipt public token could not be issued';
  END IF;

  v_action_url := '/api/receipts/pdf?token=' || v_token;

  IF r.customer_id IS NULL THEN
    RETURN 0;
  END IF;
$guards_new$;

  v_token_position := strpos(v_definition, v_token_block);
  v_customer_guard_position := strpos(v_definition, 'IF r.customer_id IS NULL');
  IF v_token_position = 0 OR v_customer_guard_position = 0 THEN
    RAISE EXCEPTION 'Current receipt token/customer guard not found';
  END IF;

  IF v_token_position > v_customer_guard_position THEN
    IF strpos(v_definition, v_old_guards) = 0 THEN
      RAISE EXCEPTION 'Current receipt guard pair not found';
    END IF;
    v_definition := replace(v_definition, v_token_block, '');
    v_definition := replace(v_definition, v_old_guards, v_new_guards);
    EXECUTE v_definition;
  END IF;
END
$patch$;

REVOKE ALL ON FUNCTION public.enqueue_receipt_delivery_notifications(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_receipt_delivery_notifications(uuid)
  TO service_role;

COMMIT;
