BEGIN;

-- Public quotation acceptance creates invoice dispatch jobs on the posting
-- transition. Keep the trigger idempotent without relying on a partial-index
-- conflict target that has failed in this hosted PostgreSQL environment.
DO $patch$
DECLARE
  v_definition text;
  v_old text;
  v_new text;
BEGIN
  v_definition := pg_get_functiondef(
    'public.fn_enqueue_accepted_quotation_invoice_dispatch()'::regprocedure
  );

  v_old := $old$
    INSERT INTO public.notification_jobs(
      business_id, customer_id, invoice_id, channel, notification_type,
      recipient, subject, message, action_url, scheduled_for, metadata,
      delivery_idempotency_key
    )
    VALUES(
      NEW.business_id, NEW.customer_id, NEW.id, v_channel, 'invoice_created',
      v_recipient, v_subject, v_message, v_invoice_url, now(),
      jsonb_build_object(
        'document_type','invoice',
        'document_id',NEW.id::text,
        'document_number',NEW.invoice_number,
        'source_quotation_id',NEW.source_quotation_id,
        'idempotency_key',v_key,
        'delivery_idempotency_key',v_key,
        'attachment_type',CASE WHEN v_channel='sms' THEN 'public_pdf_link' ELSE 'invoice_pdf' END
      ),
      v_key
    )
    ON CONFLICT (business_id, delivery_idempotency_key)
      WHERE delivery_idempotency_key IS NOT NULL
    DO NOTHING;

    GET DIAGNOSTICS v_inserted = ROW_COUNT;
$old$;

  v_new := $new$
    BEGIN
      INSERT INTO public.notification_jobs(
        business_id, customer_id, invoice_id, channel, notification_type,
        recipient, subject, message, action_url, scheduled_for, metadata,
        delivery_idempotency_key
      )
      VALUES(
        NEW.business_id, NEW.customer_id, NEW.id, v_channel, 'invoice_created',
        v_recipient, v_subject, v_message, v_invoice_url, now(),
        jsonb_build_object(
          'document_type','invoice',
          'document_id',NEW.id::text,
          'document_number',NEW.invoice_number,
          'source_quotation_id',NEW.source_quotation_id,
          'idempotency_key',v_key,
          'delivery_idempotency_key',v_key,
          'attachment_type',CASE WHEN v_channel='sms' THEN 'public_pdf_link' ELSE 'invoice_pdf' END
        ),
        v_key
      );
      GET DIAGNOSTICS v_inserted = ROW_COUNT;
    EXCEPTION WHEN unique_violation THEN
      IF EXISTS (
        SELECT 1
        FROM public.notification_jobs existing_job
        WHERE existing_job.business_id = NEW.business_id
          AND existing_job.delivery_idempotency_key = v_key
      ) THEN
        v_inserted := 0;
      ELSE
        RAISE;
      END IF;
    END;
$new$;

  IF strpos(v_definition, v_old) = 0 THEN
    RAISE EXCEPTION 'Accepted quotation invoice outbox block not found; no changes applied';
  END IF;

  v_definition := replace(v_definition, v_old, v_new);
  EXECUTE v_definition;
END
$patch$;

REVOKE ALL ON FUNCTION public.fn_enqueue_accepted_quotation_invoice_dispatch()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_enqueue_accepted_quotation_invoice_dispatch()
  TO service_role;

COMMIT;
