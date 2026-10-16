BEGIN;

-- The vendor form and vendors.email column treat email as optional. Keep strict
-- validation and normalization whenever an address is supplied, but do not make
-- supplier onboarding fail for vendors who do not use email.
CREATE OR REPLACE FUNCTION public.enforce_master_contact_email()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NULLIF(BTRIM(NEW.email), '') IS NULL THEN
    NEW.email := NULL;
    RETURN NEW;
  END IF;

  IF BTRIM(NEW.email) !~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+([.][A-Za-z0-9-]+)+$' THEN
    RAISE EXCEPTION '% email address is invalid',
      CASE WHEN TG_TABLE_NAME = 'customers' THEN 'Customer' ELSE 'Vendor' END
      USING ERRCODE = '23514';
  END IF;

  NEW.email := LOWER(BTRIM(NEW.email));
  RETURN NEW;
END;
$function$;

-- Avoid evaluating a parent-bill lookup through the caller's nested bills RLS
-- policy. This helper preserves the same tenant, draft-state, and permission
-- checks while letting the policy owner resolve the parent row deterministically.
CREATE OR REPLACE FUNCTION mm_private.can_write_draft_bill(p_bill_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'mm_private', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.bills AS b
    WHERE b.id = p_bill_id
      AND b.status = 'draft'::public.bill_status
      AND b.journal_entry_id IS NULL
      AND mm_private.is_org_member(mm_private.business_org(b.business_id))
      AND mm_private.has_business_permission(b.business_id, 'purchases.manage')
  );
$function$;

REVOKE ALL ON FUNCTION mm_private.can_write_draft_bill(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION mm_private.can_write_draft_bill(uuid) TO authenticated;

DROP POLICY IF EXISTS bill_items_member_insert ON public.bill_items;
DROP POLICY IF EXISTS bill_items_member_update ON public.bill_items;
DROP POLICY IF EXISTS bill_items_member_delete ON public.bill_items;

CREATE POLICY bill_items_member_insert
ON public.bill_items FOR INSERT TO authenticated
WITH CHECK (mm_private.can_write_draft_bill(bill_id));

CREATE POLICY bill_items_member_update
ON public.bill_items FOR UPDATE TO authenticated
USING (mm_private.can_write_draft_bill(bill_id))
WITH CHECK (mm_private.can_write_draft_bill(bill_id));

CREATE POLICY bill_items_member_delete
ON public.bill_items FOR DELETE TO authenticated
USING (mm_private.can_write_draft_bill(bill_id));

-- Procurement data is authenticated-only; removing stale anon table grants does
-- not change the authenticated policies above.
REVOKE ALL ON TABLE public.vendors FROM anon;
REVOKE ALL ON TABLE public.vendor_supply_mappings FROM anon;

-- The supply-mapping table was introduced by a recent migration. Force PostgREST
-- to refresh its schema cache so vendor saves do not fail against a stale cache.
NOTIFY pgrst, 'reload schema';

COMMIT;
