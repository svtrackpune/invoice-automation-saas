BEGIN;

CREATE TABLE IF NOT EXISTS public.saas_entitlements (
  business_id uuid PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  api_enabled boolean NOT NULL DEFAULT true,
  e_invoicing_enabled boolean NOT NULL DEFAULT false,
  offline_pos_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.saas_entitlements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS saas_entitlements_select ON public.saas_entitlements;
CREATE POLICY saas_entitlements_select ON public.saas_entitlements
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.businesses b
      WHERE b.id=saas_entitlements.business_id
        AND mm_private.is_org_member(b.organization_id)
    )
  );
REVOKE INSERT,UPDATE,DELETE ON public.saas_entitlements FROM anon,authenticated;
GRANT SELECT ON public.saas_entitlements TO authenticated;

INSERT INTO public.saas_entitlements(business_id)
SELECT id FROM public.businesses
ON CONFLICT(business_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.ensure_saas_entitlement_row()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,mm_private
AS $fn$
BEGIN
  INSERT INTO public.saas_entitlements(business_id) VALUES(NEW.id)
  ON CONFLICT(business_id) DO NOTHING;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_business_saas_entitlement ON public.businesses;
CREATE TRIGGER trg_business_saas_entitlement
AFTER INSERT ON public.businesses
FOR EACH ROW EXECUTE FUNCTION public.ensure_saas_entitlement_row();

REVOKE ALL ON FUNCTION public.ensure_saas_entitlement_row() FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_saas_entitlement_row() TO service_role;

COMMIT;