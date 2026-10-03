BEGIN;

CREATE TABLE IF NOT EXISTS public.offline_cash_bill_sync (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  temp_pos_uuid uuid NOT NULL,
  offline_ticket_number text NOT NULL,
  request_hash char(64) NOT NULL,
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE RESTRICT,
  first_received_at timestamptz NOT NULL DEFAULT now(),
  last_received_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 1,
  UNIQUE(business_id,temp_pos_uuid),
  UNIQUE(business_id,offline_ticket_number),
  CONSTRAINT offline_cash_bill_hash_chk CHECK (request_hash ~ '^[0-9a-f]{64}$')
);
CREATE INDEX IF NOT EXISTS offline_cash_bill_sync_business_idx ON public.offline_cash_bill_sync(business_id,first_received_at DESC);
ALTER TABLE public.offline_cash_bill_sync ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS offline_cash_bill_sync_select ON public.offline_cash_bill_sync;
CREATE POLICY offline_cash_bill_sync_select ON public.offline_cash_bill_sync FOR SELECT TO authenticated USING (mm_private.has_business_permission(business_id,'sales.view'));
REVOKE INSERT,UPDATE,DELETE ON public.offline_cash_bill_sync FROM anon,authenticated;
GRANT SELECT ON public.offline_cash_bill_sync TO authenticated;

CREATE OR REPLACE FUNCTION public.create_cash_bill(
  p_business_id uuid,p_phone text,p_invoice_date date,p_items jsonb,p_payment_method public.payment_method,p_account_id uuid,
  p_invoice_discount_type text,p_invoice_discount_value numeric,p_notes text,p_terms text,
  p_temp_pos_uuid uuid,p_offline_ticket_number text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,mm_private AS $fn$
DECLARE v_request jsonb; v_hash text; v_existing public.offline_cash_bill_sync%rowtype; v_invoice uuid;
BEGIN
  IF p_temp_pos_uuid IS NULL THEN RAISE EXCEPTION 'Offline POS idempotency key is required.'; END IF;
  IF nullif(btrim(p_offline_ticket_number),'') IS NULL THEN RAISE EXCEPTION 'Offline POS ticket number is required.'; END IF;
  v_request:=jsonb_build_object('business_id',p_business_id,'phone',coalesce(p_phone,''),'invoice_date',p_invoice_date,'items',coalesce(p_items,'[]'::jsonb),'payment_method',p_payment_method::text,'account_id',p_account_id,'invoice_discount_type',p_invoice_discount_type,'invoice_discount_value',coalesce(p_invoice_discount_value,0),'notes',p_notes,'terms',p_terms,'temp_pos_uuid',p_temp_pos_uuid,'offline_ticket_number',btrim(p_offline_ticket_number));
  v_hash:=encode(digest(v_request::text,'sha256'),'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended('cash-bill:'||p_business_id::text||':'||p_temp_pos_uuid::text,0));
  SELECT * INTO v_existing FROM public.offline_cash_bill_sync WHERE business_id=p_business_id AND temp_pos_uuid=p_temp_pos_uuid FOR UPDATE;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.request_hash<>v_hash THEN RAISE EXCEPTION 'Offline POS idempotency conflict: key was reused with different payload.'; END IF;
    UPDATE public.offline_cash_bill_sync SET last_received_at=now(),attempts=attempts+1 WHERE id=v_existing.id;
    RETURN v_existing.invoice_id;
  END IF;
  v_invoice:=public.create_cash_bill(p_business_id,p_phone,p_invoice_date,p_items,p_payment_method,p_account_id,p_invoice_discount_type,p_invoice_discount_value,p_notes,p_terms);
  INSERT INTO public.offline_cash_bill_sync(business_id,temp_pos_uuid,offline_ticket_number,request_hash,invoice_id) VALUES(p_business_id,p_temp_pos_uuid,btrim(p_offline_ticket_number),v_hash,v_invoice);
  RETURN v_invoice;
END; $fn$;

REVOKE EXECUTE ON FUNCTION public.create_cash_bill(uuid,text,date,jsonb,public.payment_method,uuid,text,numeric,text,text,uuid,text) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.create_cash_bill(uuid,text,date,jsonb,public.payment_method,uuid,text,numeric,text,text,uuid,text) TO authenticated;

-- Offline sync uses a distinct overload so the entitlement applies only to replay,
-- while ordinary online Cash Bills keep working without the Offline POS feature.
CREATE OR REPLACE FUNCTION public.create_cash_bill(
  p_business_id uuid,p_phone text,p_invoice_date date,p_items jsonb,p_payment_method public.payment_method,p_account_id uuid,
  p_invoice_discount_type text,p_invoice_discount_value numeric,p_notes text,p_terms text,p_temp_pos_uuid uuid,p_offline_ticket_number text,p_offline_sync boolean
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,mm_private AS $fn$
DECLARE v_enabled boolean;
BEGIN
  SELECT coalesce(offline_pos_enabled,false) INTO v_enabled FROM public.saas_entitlements WHERE business_id=p_business_id;
  IF coalesce(p_offline_sync,false) AND NOT coalesce(v_enabled,false) THEN RAISE EXCEPTION 'Offline POS is not enabled for this business plan.'; END IF;
  RETURN public.create_cash_bill(p_business_id,p_phone,p_invoice_date,p_items,p_payment_method,p_account_id,p_invoice_discount_type,p_invoice_discount_value,p_notes,p_terms,p_temp_pos_uuid,p_offline_ticket_number);
END; $fn$;
REVOKE EXECUTE ON FUNCTION public.create_cash_bill(uuid,text,date,jsonb,public.payment_method,uuid,text,numeric,text,text,uuid,text,boolean) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.create_cash_bill(uuid,text,date,jsonb,public.payment_method,uuid,text,numeric,text,text,uuid,text,boolean) TO authenticated;
COMMIT;