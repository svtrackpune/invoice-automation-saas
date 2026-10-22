BEGIN;

-- A bill can be recorded only after the challan number exists. Keep a durable,
-- tenant-scoped audit of manual e-way bill assignment/replacement.
CREATE TABLE IF NOT EXISTS public.delivery_challan_eway_bill_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  challan_id uuid NOT NULL REFERENCES public.delivery_challans(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('manual_recorded', 'manual_updated')),
  previous_eway_bill_number text,
  eway_bill_number text NOT NULL CHECK (eway_bill_number ~ '^[0-9]{12}$'),
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Make account deletion non-blocking while retaining the immutable dispatch event.
ALTER TABLE public.delivery_challan_eway_bill_events
  ALTER COLUMN actor_id DROP NOT NULL;
ALTER TABLE public.delivery_challan_eway_bill_events
  DROP CONSTRAINT IF EXISTS delivery_challan_eway_bill_events_actor_id_fkey;
ALTER TABLE public.delivery_challan_eway_bill_events
  ADD CONSTRAINT delivery_challan_eway_bill_events_actor_id_fkey
  FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS delivery_challan_eway_events_challan_created_idx
  ON public.delivery_challan_eway_bill_events (business_id, challan_id, created_at DESC);
CREATE INDEX IF NOT EXISTS delivery_challan_eway_events_challan_fk_idx
  ON public.delivery_challan_eway_bill_events (challan_id);
CREATE INDEX IF NOT EXISTS delivery_challan_eway_events_actor_fk_idx
  ON public.delivery_challan_eway_bill_events (actor_id);

ALTER TABLE public.delivery_challan_eway_bill_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS delivery_challan_eway_events_view ON public.delivery_challan_eway_bill_events;
CREATE POLICY delivery_challan_eway_events_view
  ON public.delivery_challan_eway_bill_events
  FOR SELECT TO authenticated
  USING (
    mm_private.has_business_permission(business_id, 'inventory.view', (select auth.uid()))
    OR mm_private.has_business_permission(business_id, 'inventory.manage', (select auth.uid()))
    OR mm_private.has_business_permission(business_id, 'settings.manage', (select auth.uid()))
  );

REVOKE ALL ON public.delivery_challan_eway_bill_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.delivery_challan_eway_bill_events TO authenticated;

-- Validate the existing/manual bill number at the data boundary too, including
-- calls made through the existing public API, not only the workspace form.
ALTER TABLE public.delivery_challans
  DROP CONSTRAINT IF EXISTS delivery_challans_eway_bill_number_format_check;
ALTER TABLE public.delivery_challans
  ADD CONSTRAINT delivery_challans_eway_bill_number_format_check
  CHECK (
    eway_bill_number IS NULL
    OR btrim(eway_bill_number) ~ '^[0-9]{12}$'
  );

CREATE OR REPLACE FUNCTION mm_private.record_delivery_challan_eway_bill_internal(
  p_business_id uuid,
  p_challan_id uuid,
  p_eway_bill_number text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'mm_private', 'pg_temp'
AS $function$
DECLARE
  v_challan public.delivery_challans%rowtype;
  v_gstin text;
  v_regime text;
  v_registration text;
  v_new_number text := nullif(btrim(coalesce(p_eway_bill_number, '')), '');
  v_event_type text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING errcode = '42501';
  END IF;

  IF NOT mm_private.has_business_permission(p_business_id, 'inventory.manage', auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: inventory management permission is required' USING errcode = '42501';
  END IF;

  IF v_new_number IS NULL OR v_new_number !~ '^[0-9]{12}$' THEN
    RAISE EXCEPTION 'E-way Bill Number must contain exactly 12 digits' USING errcode = '22023';
  END IF;

  SELECT
    upper(btrim(coalesce(tp.gstin, ''))),
    upper(btrim(coalesce(tp.tax_regime, 'NONE'))),
    upper(btrim(coalesce(tp.gst_registration_type, 'NONE')))
  INTO v_gstin, v_regime, v_registration
  FROM public.business_tax_profiles tp
  WHERE tp.business_id = p_business_id;

  IF coalesce(v_regime, 'NONE') <> 'GST'
     OR coalesce(v_registration, 'NONE') NOT IN ('REGULAR', 'CASUAL', 'NON_RESIDENT', 'SEZ', 'COMPOSITION')
     OR coalesce(v_gstin, '') !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$' THEN
    RAISE EXCEPTION 'A valid GST registration is required to record an e-way bill' USING errcode = '22023';
  END IF;

  SELECT dc.*
  INTO v_challan
  FROM public.delivery_challans dc
  WHERE dc.id = p_challan_id
    AND dc.business_id = p_business_id
  FOR UPDATE;

  IF v_challan.id IS NULL THEN
    RAISE EXCEPTION 'Delivery challan not found for the active business' USING errcode = 'P0002';
  END IF;
  IF v_challan.status = 'cancelled' THEN
    RAISE EXCEPTION 'Cannot assign an e-way bill to a cancelled delivery challan' USING errcode = '22023';
  END IF;

  IF v_challan.eway_bill_number = v_new_number THEN
    RETURN jsonb_build_object(
      'success', true,
      'changed', false,
      'challan_id', v_challan.id,
      'challan_number', v_challan.challan_number,
      'eway_bill_number', v_challan.eway_bill_number
    );
  END IF;

  v_event_type := CASE
    WHEN nullif(btrim(coalesce(v_challan.eway_bill_number, '')), '') IS NULL THEN 'manual_recorded'
    ELSE 'manual_updated'
  END;

  UPDATE public.delivery_challans
  SET eway_bill_number = v_new_number,
      updated_at = now()
  WHERE id = v_challan.id
    AND business_id = p_business_id;

  INSERT INTO public.delivery_challan_eway_bill_events (
    business_id, challan_id, event_type,
    previous_eway_bill_number, eway_bill_number, actor_id
  ) VALUES (
    p_business_id, v_challan.id, v_event_type,
    nullif(btrim(coalesce(v_challan.eway_bill_number, '')), ''),
    v_new_number, auth.uid()
  );

  RETURN jsonb_build_object(
    'success', true,
    'changed', true,
    'challan_id', v_challan.id,
    'challan_number', v_challan.challan_number,
    'eway_bill_number', v_new_number
  );
END;
$function$;

REVOKE ALL ON FUNCTION mm_private.record_delivery_challan_eway_bill_internal(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION mm_private.record_delivery_challan_eway_bill_internal(uuid, uuid, text) TO authenticated;

-- Public PostgREST endpoint runs as invoker; the permission-checked privileged
-- operation lives in mm_private, which is not the exposed Data API schema.
CREATE OR REPLACE FUNCTION public.record_delivery_challan_eway_bill(
  p_business_id uuid,
  p_challan_id uuid,
  p_eway_bill_number text
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path TO 'public', 'mm_private', 'pg_temp'
AS $function$
  SELECT mm_private.record_delivery_challan_eway_bill_internal(
    p_business_id, p_challan_id, p_eway_bill_number
  );
$function$;

REVOKE ALL ON FUNCTION public.record_delivery_challan_eway_bill(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_delivery_challan_eway_bill(uuid, uuid, text) TO authenticated;

COMMIT;
