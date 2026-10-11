BEGIN;

-- Move token issuance ahead of every customer/channel early return while
-- retaining the current, live, idempotent enqueue function body. This avoids
-- copying stale trigger/outbox implementations into the migration.
DO $patch$
DECLARE
  v_definition text;
  v_token_block text;
  v_old_guards text;
  v_new_guards text;
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

  IF strpos(v_definition, v_token_block) = 0 THEN
    RAISE EXCEPTION 'Current receipt token block was not found; no function changes applied';
  END IF;
  IF strpos(v_definition, v_old_guards) = 0 THEN
    RAISE EXCEPTION 'Current receipt guards were not found; no function changes applied';
  END IF;

  -- Remove the existing token block first, then put a single copy before the
  -- customer-null guard. The change preserves the current provider/channel
  -- idempotency handler and all security attributes emitted by pg_get_functiondef.
  v_definition := replace(v_definition, v_token_block, '');
  v_definition := replace(v_definition, v_old_guards, v_new_guards);

  IF strpos(v_definition, v_token_block) = 0
     OR strpos(v_definition, v_token_block) > strpos(v_definition, 'IF r.customer_id IS NULL') THEN
    RAISE EXCEPTION 'Receipt token block did not move before customer guard';
  END IF;

  EXECUTE v_definition;
END
$patch$;

REVOKE ALL ON FUNCTION public.enqueue_receipt_delivery_notifications(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_receipt_delivery_notifications(uuid)
  TO service_role;

COMMIT;
