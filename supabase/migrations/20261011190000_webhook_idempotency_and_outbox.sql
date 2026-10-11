BEGIN;

-- payment_webhook_events already stores authenticated gateway events under the
-- stable (provider, event_id) key. claim_payment_webhook_event atomically sets
-- status='processing'; allow that state in the existing constraint.
ALTER TABLE public.payment_webhook_events
  DROP CONSTRAINT IF EXISTS payment_webhook_events_status_check;

ALTER TABLE public.payment_webhook_events
  ADD CONSTRAINT payment_webhook_events_status_check
  CHECK (status = ANY (ARRAY[
    'received'::text,
    'processing'::text,
    'processed'::text,
    'ignored'::text,
    'failed'::text
  ]))
  NOT VALID;

ALTER TABLE public.payment_webhook_events
  VALIDATE CONSTRAINT payment_webhook_events_status_check;

-- Keep gateway events server-only. Existing service_role-only grants on
-- claim_payment_webhook_event and the existing RLS policy boundary remain.
ALTER TABLE public.payment_webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.payment_webhook_events FROM PUBLIC, anon, authenticated;

-- notification_jobs is the existing transactional notification outbox.
-- Its per-business unique delivery key and claim_notification_jobs SKIP LOCKED
-- claim contract remain authoritative; do not introduce a second competing
-- outbox table.
COMMENT ON COLUMN public.notification_jobs.delivery_idempotency_key IS
  'Stable idempotency key for one logical customer delivery; unique per business and used by the notification outbox and delivery evidence.';

COMMIT;
