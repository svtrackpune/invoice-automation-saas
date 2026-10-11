BEGIN;

-- Keep the latest receipt enqueue function intact (including earlier token
-- hardening) while replacing partial-index ON CONFLICT inference with an
-- explicit duplicate-key guard.
DO $patch$
DECLARE
  v_definition text;
  v_old text;
  v_new text;
BEGIN
  v_definition := pg_get_functiondef(
    'public.enqueue_receipt_delivery_notifications(uuid)'::regprocedure
  );

  v_old := $old$
    INSERT INTO public.notification_jobs(
      business_id, customer_id, invoice_id, channel, notification_type,
      recipient, subject, message, action_url, scheduled_for, metadata,
      delivery_idempotency_key
    )
    VALUES(
      r.business_id, r.customer_id, v_invoice_id, v_channel, 'receipt',
      v_recipient, v_subject, v_body, v_action_url, now(), v_metadata,
      v_delivery_key
    )
    ON CONFLICT (business_id, delivery_idempotency_key)
      WHERE delivery_idempotency_key IS NOT NULL
    DO NOTHING;

    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    v_total_inserted := v_total_inserted + v_inserted;
$old$;

  v_new := $new$
    BEGIN
      INSERT INTO public.notification_jobs(
        business_id, customer_id, invoice_id, channel, notification_type,
        recipient, subject, message, action_url, scheduled_for, metadata,
        delivery_idempotency_key
      )
      VALUES(
        r.business_id, r.customer_id, v_invoice_id, v_channel, 'receipt',
        v_recipient, v_subject, v_body, v_action_url, now(), v_metadata,
        v_delivery_key
      );
      GET DIAGNOSTICS v_inserted = ROW_COUNT;
    EXCEPTION WHEN unique_violation THEN
      IF EXISTS (
        SELECT 1
        FROM public.notification_jobs existing_job
        WHERE existing_job.business_id = r.business_id
          AND existing_job.delivery_idempotency_key = v_delivery_key
      ) THEN
        v_inserted := 0;
      ELSE
        RAISE;
      END IF;
    END;
    v_total_inserted := v_total_inserted + v_inserted;
$new$;

  IF strpos(v_definition, v_old) = 0 THEN
    RAISE EXCEPTION 'Current receipt outbox insertion block not found; migration is not applied';
  END IF;

  v_definition := replace(v_definition, v_old, v_new);
  EXECUTE v_definition;
END
$patch$;

REVOKE ALL ON FUNCTION public.enqueue_receipt_delivery_notifications(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_receipt_delivery_notifications(uuid)
  TO service_role;

COMMIT;
