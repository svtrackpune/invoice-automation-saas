BEGIN;

-- Wave 2: generic tax engine + immutable tax snapshots + canonical documents/addresses.
-- Additive only: existing India GST fields, tax_rates, invoice posting, ledger
-- controls, and financial RLS boundaries remain authoritative.

CREATE TABLE IF NOT EXISTS public.jurisdictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code char(2) NOT NULL,
  subdivision_code text,
  jurisdiction_type text NOT NULL,
  name text NOT NULL,
  tax_authority text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT jurisdictions_country_code_chk CHECK (country_code ~ '^[A-Z]{2}$'),
  CONSTRAINT jurisdictions_subdivision_code_chk CHECK (
    subdivision_code IS NULL OR subdivision_code ~ '^[A-Z]{2}-[A-Z0-9-]+$'
  ),
  CONSTRAINT jurisdictions_type_chk CHECK (
    jurisdiction_type IN ('country','state','county','city','special_district')
  ),
  CONSTRAINT jurisdictions_country_scope_chk CHECK (
    (jurisdiction_type='country' AND subdivision_code IS NULL)
    OR (jurisdiction_type<>'country' AND subdivision_code IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS jurisdictions_identity_uidx
  ON public.jurisdictions(
    country_code,coalesce(subdivision_code,''),jurisdiction_type,lower(name)
  );

ALTER TABLE public.jurisdictions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS jurisdictions_authenticated_select ON public.jurisdictions;
CREATE POLICY jurisdictions_authenticated_select
  ON public.jurisdictions FOR SELECT TO authenticated USING (true);
REVOKE ALL ON TABLE public.jurisdictions FROM anon;
REVOKE INSERT,UPDATE,DELETE ON TABLE public.jurisdictions FROM authenticated;
GRANT SELECT ON TABLE public.jurisdictions TO authenticated;

INSERT INTO public.jurisdictions(country_code,jurisdiction_type,name,tax_authority)
VALUES
  ('IN','country','India','Government of India'),
  ('US','country','United States','United States tax authorities'),
  ('CA','country','Canada','Canada Revenue Agency / provincial authorities'),
  ('GB','country','United Kingdom','HM Revenue & Customs')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.business_tax_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  jurisdiction_id uuid NOT NULL REFERENCES public.jurisdictions(id) ON DELETE RESTRICT,
  tax_system text NOT NULL,
  registration_number text NOT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT business_tax_registrations_tax_system_chk
    CHECK (tax_system IN ('VAT','SALES_TAX','GST','CUSTOM')),
  CONSTRAINT business_tax_registrations_number_chk
    CHECK (btrim(registration_number)<>'')
);

CREATE UNIQUE INDEX IF NOT EXISTS business_tax_registrations_primary_uidx
  ON public.business_tax_registrations(business_id,tax_system)
  WHERE is_primary;
CREATE UNIQUE INDEX IF NOT EXISTS business_tax_registrations_identity_uidx
  ON public.business_tax_registrations(
    business_id,jurisdiction_id,tax_system,lower(registration_number)
  );
CREATE INDEX IF NOT EXISTS business_tax_registrations_business_idx
  ON public.business_tax_registrations(business_id);

ALTER TABLE public.business_tax_registrations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS business_tax_registrations_member_all ON public.business_tax_registrations;
CREATE POLICY business_tax_registrations_member_all
  ON public.business_tax_registrations FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.businesses b
      WHERE b.id=business_tax_registrations.business_id
        AND mm_private.is_org_member(b.organization_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.businesses b
      WHERE b.id=business_tax_registrations.business_id
        AND mm_private.is_org_member(b.organization_id)
    )
  );
REVOKE ALL ON TABLE public.business_tax_registrations FROM anon;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.business_tax_registrations TO authenticated;

CREATE TABLE IF NOT EXISTS public.tax_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES public.businesses(id) ON DELETE CASCADE,
  jurisdiction_id uuid NOT NULL REFERENCES public.jurisdictions(id) ON DELETE RESTRICT,
  tax_system text NOT NULL,
  tax_code text NOT NULL,
  name text NOT NULL,
  tax_category text NOT NULL DEFAULT 'STANDARD',
  effective_from date NOT NULL,
  effective_to date,
  is_active boolean NOT NULL DEFAULT true,
  legacy_tax_rate_id uuid REFERENCES public.tax_rates(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tax_rules_tax_system_chk CHECK (tax_system IN ('VAT','SALES_TAX','GST','CUSTOM')),
  CONSTRAINT tax_rules_category_chk CHECK (
    tax_category IN ('STANDARD','REDUCED','ZERO_RATED','EXEMPT','REVERSE_CHARGE')
  ),
  CONSTRAINT tax_rules_effective_window_chk
    CHECK (effective_to IS NULL OR effective_to>=effective_from),
  CONSTRAINT tax_rules_code_chk CHECK (btrim(tax_code)<>'')
);

CREATE UNIQUE INDEX IF NOT EXISTS tax_rules_business_identity_uidx
  ON public.tax_rules(
    coalesce(business_id,'00000000-0000-0000-0000-000000000000'::uuid),
    jurisdiction_id,tax_code,effective_from
  );
CREATE INDEX IF NOT EXISTS tax_rules_lookup_idx
  ON public.tax_rules(business_id,jurisdiction_id,tax_system,is_active,effective_from);

ALTER TABLE public.tax_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tax_rules_authenticated_select ON public.tax_rules;
CREATE POLICY tax_rules_authenticated_select
  ON public.tax_rules FOR SELECT TO authenticated
  USING (
    business_id IS NULL
    OR EXISTS (
      SELECT 1 FROM public.businesses b
      WHERE b.id=tax_rules.business_id
        AND mm_private.is_org_member(b.organization_id)
    )
  );
REVOKE ALL ON TABLE public.tax_rules FROM anon,authenticated;
GRANT SELECT ON TABLE public.tax_rules TO authenticated;

CREATE TABLE IF NOT EXISTS public.tax_rule_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tax_rule_id uuid NOT NULL REFERENCES public.tax_rules(id) ON DELETE CASCADE,
  tax_code text NOT NULL,
  rate numeric(20,10) NOT NULL DEFAULT 0,
  sequence integer NOT NULL,
  calculation_basis text NOT NULL DEFAULT 'net',
  compound_on_component_id uuid REFERENCES public.tax_rule_components(id) ON DELETE RESTRICT,
  is_recoverable boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tax_rule_components_rate_chk CHECK (rate>=0),
  CONSTRAINT tax_rule_components_sequence_chk CHECK (sequence>0),
  CONSTRAINT tax_rule_components_basis_chk
    CHECK (calculation_basis IN ('net','gross_plus_previous')),
  CONSTRAINT tax_rule_components_code_chk CHECK (btrim(tax_code)<>''),
  CONSTRAINT tax_rule_components_compound_chk
    CHECK (calculation_basis='net' OR compound_on_component_id IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS tax_rule_components_sequence_uidx
  ON public.tax_rule_components(tax_rule_id,sequence);
CREATE INDEX IF NOT EXISTS tax_rule_components_rule_idx
  ON public.tax_rule_components(tax_rule_id,sequence);

CREATE OR REPLACE FUNCTION public.guard_tax_rule_component_scope()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,mm_private
AS $fn$
DECLARE v_parent_rule uuid;
BEGIN
  IF NEW.compound_on_component_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.compound_on_component_id=NEW.id THEN
    RAISE EXCEPTION 'A tax component cannot compound on itself';
  END IF;
  SELECT tax_rule_id INTO v_parent_rule
  FROM public.tax_rule_components WHERE id=NEW.compound_on_component_id;
  IF v_parent_rule IS NULL OR v_parent_rule IS DISTINCT FROM NEW.tax_rule_id THEN
    RAISE EXCEPTION 'Compound tax component must belong to the same tax rule';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.tax_rule_components c
    WHERE c.id=NEW.compound_on_component_id AND c.sequence<NEW.sequence
  ) THEN
    RAISE EXCEPTION 'Compound tax component must reference an earlier component';
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_tax_rule_component_scope ON public.tax_rule_components;
CREATE TRIGGER trg_tax_rule_component_scope
BEFORE INSERT OR UPDATE OF tax_rule_id,sequence,compound_on_component_id
ON public.tax_rule_components
FOR EACH ROW EXECUTE FUNCTION public.guard_tax_rule_component_scope();
REVOKE ALL ON FUNCTION public.guard_tax_rule_component_scope() FROM PUBLIC,anon,authenticated;

ALTER TABLE public.tax_rule_components ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tax_rule_components_authenticated_select ON public.tax_rule_components;
CREATE POLICY tax_rule_components_authenticated_select
  ON public.tax_rule_components FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tax_rules r
      WHERE r.id=tax_rule_components.tax_rule_id
        AND (
          r.business_id IS NULL
          OR EXISTS (
            SELECT 1 FROM public.businesses b
            WHERE b.id=r.business_id
              AND mm_private.is_org_member(b.organization_id)
          )
        )
    )
  );
REVOKE ALL ON TABLE public.tax_rule_components FROM anon,authenticated;
GRANT SELECT ON TABLE public.tax_rule_components TO authenticated;

CREATE OR REPLACE FUNCTION public.calculate_tax_rule_preview(
  p_tax_rule_id uuid,p_net_amount numeric
)
RETURNS TABLE(
  component_id uuid,tax_code text,sequence integer,rate numeric,
  calculation_basis text,compound_on_component_id uuid,
  taxable_amount numeric,tax_amount numeric
)
LANGUAGE plpgsql STABLE SET search_path=public
AS $fn$
DECLARE
  c public.tax_rule_components%rowtype;
  v_taxable numeric;
  v_tax numeric;
  v_component_tax jsonb:='{}'::jsonb;
  v_previous numeric:=0;
BEGIN
  IF p_net_amount<0 THEN
    RAISE EXCEPTION 'Tax preview net amount cannot be negative';
  END IF;

  FOR c IN
    SELECT * FROM public.tax_rule_components
    WHERE tax_rule_id=p_tax_rule_id ORDER BY sequence
  LOOP
    IF c.calculation_basis='net' THEN
      v_taxable:=round(p_net_amount,6);
    ELSE
      v_previous:=coalesce(
        (v_component_tax->>c.compound_on_component_id::text)::numeric,0
      );
      v_taxable:=round(p_net_amount+v_previous,6);
    END IF;
    v_tax:=round(v_taxable*c.rate/100,6);
    v_component_tax:=jsonb_set(
      v_component_tax,ARRAY[c.id::text],to_jsonb(v_tax),true
    );

    component_id:=c.id;
    tax_code:=c.tax_code;
    sequence:=c.sequence;
    rate:=c.rate;
    calculation_basis:=c.calculation_basis;
    compound_on_component_id:=c.compound_on_component_id;
    taxable_amount:=v_taxable;
    tax_amount:=v_tax;
    RETURN NEXT;
  END LOOP;
END;
$fn$;

REVOKE ALL ON FUNCTION public.calculate_tax_rule_preview(uuid,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.calculate_tax_rule_preview(uuid,numeric) TO authenticated;

CREATE TABLE IF NOT EXISTS public.customer_tax_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  jurisdiction_id uuid NOT NULL REFERENCES public.jurisdictions(id) ON DELETE RESTRICT,
  tax_system text NOT NULL,
  tax_registration_number text,
  exemption_status boolean NOT NULL DEFAULT false,
  exemption_reason text,
  exemption_certificate_number text,
  effective_from date NOT NULL DEFAULT current_date,
  effective_to date,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_tax_profiles_tax_system_chk
    CHECK (tax_system IN ('VAT','SALES_TAX','GST','CUSTOM')),
  CONSTRAINT customer_tax_profiles_effective_window_chk
    CHECK (effective_to IS NULL OR effective_to>=effective_from),
  CONSTRAINT customer_tax_profiles_exemption_reason_chk
    CHECK (exemption_status=false OR btrim(coalesce(exemption_reason,''))<>'')
);

CREATE UNIQUE INDEX IF NOT EXISTS customer_tax_profiles_identity_uidx
  ON public.customer_tax_profiles(customer_id,jurisdiction_id,tax_system);
CREATE INDEX IF NOT EXISTS customer_tax_profiles_customer_idx
  ON public.customer_tax_profiles(customer_id);

ALTER TABLE public.customer_tax_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS customer_tax_profiles_member_all ON public.customer_tax_profiles;
CREATE POLICY customer_tax_profiles_member_all
  ON public.customer_tax_profiles FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.customers c
      JOIN public.businesses b ON b.id=c.business_id
      WHERE c.id=customer_tax_profiles.customer_id
        AND mm_private.is_org_member(b.organization_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.customers c
      JOIN public.businesses b ON b.id=c.business_id
      WHERE c.id=customer_tax_profiles.customer_id
        AND mm_private.is_org_member(b.organization_id)
    )
  );
REVOKE ALL ON TABLE public.customer_tax_profiles FROM anon;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.customer_tax_profiles TO authenticated;

CREATE TABLE IF NOT EXISTS public.invoice_tax_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE RESTRICT,
  invoice_item_id uuid REFERENCES public.invoice_items(id) ON DELETE RESTRICT,
  jurisdiction_id uuid NOT NULL REFERENCES public.jurisdictions(id) ON DELETE RESTRICT,
  tax_rule_id uuid REFERENCES public.tax_rules(id) ON DELETE RESTRICT,
  tax_component_id uuid REFERENCES public.tax_rule_components(id) ON DELETE RESTRICT,
  tax_code text NOT NULL,
  tax_category text NOT NULL,
  rate numeric(20,10) NOT NULL DEFAULT 0,
  taxable_amount numeric(20,6) NOT NULL DEFAULT 0,
  tax_amount numeric(20,6) NOT NULL DEFAULT 0,
  base_tax_amount numeric(20,6) NOT NULL DEFAULT 0,
  transaction_currency_code char(3) NOT NULL,
  base_currency_code char(3) NOT NULL,
  exchange_rate numeric(20,10) NOT NULL DEFAULT 1,
  is_reverse_charge boolean NOT NULL DEFAULT false,
  source_adapter text NOT NULL,
  snapshot_at timestamptz NOT NULL DEFAULT now(),
  dedupe_key text GENERATED ALWAYS AS (
    invoice_id::text || ':' || coalesce(invoice_item_id::text,'invoice')
    || ':' || jurisdiction_id::text || ':' || tax_code
  ) STORED,
  CONSTRAINT invoice_tax_lines_category_chk
    CHECK (tax_category IN ('STANDARD','REDUCED','ZERO_RATED','EXEMPT','REVERSE_CHARGE')),
  CONSTRAINT invoice_tax_lines_rate_chk CHECK (rate>=0),
  CONSTRAINT invoice_tax_lines_taxable_chk CHECK (taxable_amount>=0),
  CONSTRAINT invoice_tax_lines_tax_chk CHECK (tax_amount>=0),
  CONSTRAINT invoice_tax_lines_base_tax_chk CHECK (base_tax_amount>=0),
  CONSTRAINT invoice_tax_lines_tx_currency_chk CHECK (transaction_currency_code ~ '^[A-Z]{3}$'),
  CONSTRAINT invoice_tax_lines_base_currency_chk CHECK (base_currency_code ~ '^[A-Z]{3}$'),
  CONSTRAINT invoice_tax_lines_exchange_rate_chk CHECK (exchange_rate>0),
  CONSTRAINT invoice_tax_lines_adapter_chk CHECK (btrim(source_adapter)<>'')
);

CREATE UNIQUE INDEX IF NOT EXISTS invoice_tax_lines_dedupe_uidx
  ON public.invoice_tax_lines(dedupe_key);
CREATE INDEX IF NOT EXISTS invoice_tax_lines_invoice_idx
  ON public.invoice_tax_lines(invoice_id,invoice_item_id);

ALTER TABLE public.invoice_tax_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS invoice_tax_lines_member_select ON public.invoice_tax_lines;
CREATE POLICY invoice_tax_lines_member_select
  ON public.invoice_tax_lines FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.businesses b
      WHERE b.id=invoice_tax_lines.business_id
        AND mm_private.is_org_member(b.organization_id)
    )
  );
REVOKE ALL ON TABLE public.invoice_tax_lines FROM anon,authenticated;
GRANT SELECT ON TABLE public.invoice_tax_lines TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_invoice_tax_line_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path=public
AS $fn$
BEGIN
  RAISE EXCEPTION 'Posted invoice tax snapshots are immutable';
END;
$fn$;

DROP TRIGGER IF EXISTS trg_invoice_tax_line_immutable_update ON public.invoice_tax_lines;
DROP TRIGGER IF EXISTS trg_invoice_tax_line_immutable_delete ON public.invoice_tax_lines;
CREATE TRIGGER trg_invoice_tax_line_immutable_update
BEFORE UPDATE ON public.invoice_tax_lines
FOR EACH ROW EXECUTE FUNCTION public.guard_invoice_tax_line_immutable();
CREATE TRIGGER trg_invoice_tax_line_immutable_delete
BEFORE DELETE ON public.invoice_tax_lines
FOR EACH ROW EXECUTE FUNCTION public.guard_invoice_tax_line_immutable();
REVOKE ALL ON FUNCTION public.guard_invoice_tax_line_immutable() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.canonicalize_iso_address(
  p_address jsonb,p_default_country_code char(2)
)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=public
AS $fn$
DECLARE
  a jsonb:=coalesce(p_address,'{}'::jsonb);
  c text;
  s text;
  locality text;
  postal text;
  line1 text;
  line2 text;
BEGIN
  c:=upper(btrim(coalesce(
    a->>'country_code',a->>'country',p_default_country_code::text,''
  )));
  IF length(c)<>2 THEN
    c:=upper(btrim(p_default_country_code::text));
  END IF;

  s:=upper(btrim(coalesce(
    a->>'country_subdivision_code',a->>'subdivision_code',
    a->>'state_code',a->>'state',''
  )));

  IF s='' THEN
    s:=NULL;
  ELSIF s ~ '^[A-Z]{2}-[A-Z0-9-]+$' THEN
    NULL;
  ELSE
    s:=CASE c
      WHEN 'IN' THEN CASE s
        WHEN '01' THEN 'IN-JK' WHEN '02' THEN 'IN-HP' WHEN '03' THEN 'IN-PB'
        WHEN '04' THEN 'IN-CH' WHEN '05' THEN 'IN-UK' WHEN '06' THEN 'IN-HR'
        WHEN '07' THEN 'IN-DL' WHEN '08' THEN 'IN-RJ' WHEN '09' THEN 'IN-UP'
        WHEN '10' THEN 'IN-BR' WHEN '11' THEN 'IN-SK' WHEN '12' THEN 'IN-AR'
        WHEN '13' THEN 'IN-NL' WHEN '14' THEN 'IN-MN' WHEN '15' THEN 'IN-MZ'
        WHEN '16' THEN 'IN-TR' WHEN '17' THEN 'IN-ML' WHEN '18' THEN 'IN-AS'
        WHEN '19' THEN 'IN-WB' WHEN '20' THEN 'IN-JH' WHEN '21' THEN 'IN-OR'
        WHEN '22' THEN 'IN-CG' WHEN '23' THEN 'IN-MP' WHEN '24' THEN 'IN-GJ'
        WHEN '26' THEN 'IN-DH' WHEN '27' THEN 'IN-MH' WHEN '28' THEN 'IN-AP'
        WHEN '29' THEN 'IN-KA' WHEN '30' THEN 'IN-GA' WHEN '31' THEN 'IN-LD'
        WHEN '32' THEN 'IN-KL' WHEN '33' THEN 'IN-TN' WHEN '34' THEN 'IN-PY'
        WHEN '35' THEN 'IN-AN' WHEN '36' THEN 'IN-TS' WHEN '37' THEN 'IN-AP'
        WHEN '38' THEN 'IN-LA'
        WHEN 'ANDHRA PRADESH' THEN 'IN-AP' WHEN 'ARUNACHAL PRADESH' THEN 'IN-AR'
        WHEN 'ASSAM' THEN 'IN-AS' WHEN 'BIHAR' THEN 'IN-BR'
        WHEN 'CHHATTISGARH' THEN 'IN-CG' WHEN 'GOA' THEN 'IN-GA'
        WHEN 'GUJARAT' THEN 'IN-GJ' WHEN 'HARYANA' THEN 'IN-HR'
        WHEN 'HIMACHAL PRADESH' THEN 'IN-HP' WHEN 'JHARKHAND' THEN 'IN-JH'
        WHEN 'KARNATAKA' THEN 'IN-KA' WHEN 'KERALA' THEN 'IN-KL'
        WHEN 'MADHYA PRADESH' THEN 'IN-MP' WHEN 'MAHARASHTRA' THEN 'IN-MH'
        WHEN 'MANIPUR' THEN 'IN-MN' WHEN 'MEGHALAYA' THEN 'IN-ML'
        WHEN 'MIZORAM' THEN 'IN-MZ' WHEN 'NAGALAND' THEN 'IN-NL'
        WHEN 'ODISHA' THEN 'IN-OR' WHEN 'PUNJAB' THEN 'IN-PB'
        WHEN 'RAJASTHAN' THEN 'IN-RJ' WHEN 'SIKKIM' THEN 'IN-SK'
        WHEN 'TAMIL NADU' THEN 'IN-TN' WHEN 'TELANGANA' THEN 'IN-TS'
        WHEN 'TRIPURA' THEN 'IN-TR' WHEN 'UTTAR PRADESH' THEN 'IN-UP'
        WHEN 'UTTARAKHAND' THEN 'IN-UK' WHEN 'WEST BENGAL' THEN 'IN-WB'
        WHEN 'DELHI' THEN 'IN-DL' WHEN 'JAMMU AND KASHMIR' THEN 'IN-JK'
        WHEN 'LADAKH' THEN 'IN-LA' WHEN 'PUDUCHERRY' THEN 'IN-PY'
        WHEN 'CHANDIGARH' THEN 'IN-CH' WHEN 'LAKSHADWEEP' THEN 'IN-LD'
        WHEN 'ANDAMAN AND NICOBAR ISLANDS' THEN 'IN-AN'
        WHEN 'DADRA AND NAGAR HAVELI AND DAMAN AND DIU' THEN 'IN-DH'
        WHEN 'AP' THEN 'IN-AP' WHEN 'AR' THEN 'IN-AR' WHEN 'AS' THEN 'IN-AS'
        WHEN 'BR' THEN 'IN-BR' WHEN 'CG' THEN 'IN-CG' WHEN 'GA' THEN 'IN-GA'
        WHEN 'GJ' THEN 'IN-GJ' WHEN 'HR' THEN 'IN-HR' WHEN 'HP' THEN 'IN-HP'
        WHEN 'JH' THEN 'IN-JH' WHEN 'KA' THEN 'IN-KA' WHEN 'KL' THEN 'IN-KL'
        WHEN 'MP' THEN 'IN-MP' WHEN 'MH' THEN 'IN-MH' WHEN 'MN' THEN 'IN-MN'
        WHEN 'ML' THEN 'IN-ML' WHEN 'MZ' THEN 'IN-MZ' WHEN 'NL' THEN 'IN-NL'
        WHEN 'OR' THEN 'IN-OR' WHEN 'OD' THEN 'IN-OR' WHEN 'PB' THEN 'IN-PB'
        WHEN 'RJ' THEN 'IN-RJ' WHEN 'SK' THEN 'IN-SK' WHEN 'TN' THEN 'IN-TN'
        WHEN 'TS' THEN 'IN-TS' WHEN 'TR' THEN 'IN-TR' WHEN 'UP' THEN 'IN-UP'
        WHEN 'UK' THEN 'IN-UK' WHEN 'WB' THEN 'IN-WB' WHEN 'DL' THEN 'IN-DL'
        WHEN 'JK' THEN 'IN-JK' WHEN 'LA' THEN 'IN-LA' WHEN 'PY' THEN 'IN-PY'
        WHEN 'CH' THEN 'IN-CH' WHEN 'LD' THEN 'IN-LD' WHEN 'AN' THEN 'IN-AN'
        WHEN 'DH' THEN 'IN-DH'
        ELSE NULL END
      WHEN 'CA' THEN CASE
        WHEN s IN ('AB','BC','MB','NB','NL','NS','NT','NU','ON','PE','QC','SK','YT')
          THEN 'CA-'||s ELSE NULL END
      WHEN 'US' THEN CASE
        WHEN s ~ '^[A-Z]{2}$' THEN 'US-'||s ELSE NULL END
      WHEN 'GB' THEN CASE s
        WHEN 'ENG' THEN 'GB-ENG' WHEN 'WLS' THEN 'GB-WLS'
        WHEN 'SCT' THEN 'GB-SCT' WHEN 'NIR' THEN 'GB-NIR'
        ELSE NULL END
      ELSE CASE WHEN s ~ '^[A-Z]{2}$' THEN c||'-'||s ELSE NULL END
    END;
  END IF;

  locality:=nullif(btrim(coalesce(
    a->>'locality',a->>'city',a->>'town',a->>'district',''
  )),'');
  postal:=nullif(btrim(coalesce(
    a->>'postal_code',a->>'pincode',a->>'pin',a->>'zip',''
  )),'');
  line1:=nullif(btrim(coalesce(
    a->>'address_line_1',a->>'line1',a->>'street',a->>'address',''
  )),'');
  line2:=nullif(btrim(coalesce(
    a->>'address_line_2',a->>'line2',a->>'suite',''
  )),'');
  RETURN jsonb_build_object(
    'country_code',c,
    'country_subdivision_code',s,
    'locality',locality,
    'postal_code',postal,
    'address_line_1',line1,
    'address_line_2',line2
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.canonicalize_iso_address(jsonb,char) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.canonicalize_iso_address(jsonb,char) TO authenticated;

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS address_iso jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS billing_address_iso jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS shipping_address_iso jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS address_iso jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE public.businesses
SET address_iso=public.canonicalize_iso_address(address,country_code)
WHERE address_iso='{}'::jsonb;

UPDATE public.customers c
SET billing_address_iso=public.canonicalize_iso_address(c.billing_address,b.country_code),
    shipping_address_iso=public.canonicalize_iso_address(c.shipping_address,b.country_code)
FROM public.businesses b
WHERE b.id=c.business_id
  AND (c.billing_address_iso='{}'::jsonb OR c.shipping_address_iso='{}'::jsonb);

UPDATE public.vendors v
SET address_iso=public.canonicalize_iso_address(v.address,b.country_code)
FROM public.businesses b
WHERE b.id=v.business_id AND v.address_iso='{}'::jsonb;

ALTER TABLE public.businesses DROP CONSTRAINT IF EXISTS businesses_address_iso_shape_chk;
ALTER TABLE public.customers
  DROP CONSTRAINT IF EXISTS customers_billing_address_iso_shape_chk,
  DROP CONSTRAINT IF EXISTS customers_shipping_address_iso_shape_chk;
ALTER TABLE public.vendors DROP CONSTRAINT IF EXISTS vendors_address_iso_shape_chk;

ALTER TABLE public.businesses
  ADD CONSTRAINT businesses_address_iso_shape_chk CHECK (
    jsonb_typeof(address_iso)='object'

    AND address_iso ?& ARRAY[
      'country_code','country_subdivision_code','locality',
      'postal_code','address_line_1','address_line_2'
    ]
    AND address_iso->>'country_code' ~ '^[A-Z]{2}$'
    AND (
      address_iso->>'country_subdivision_code' IS NULL
      OR address_iso->>'country_subdivision_code' ~ '^[A-Z]{2}-[A-Z0-9-]+$'
    )
  );

ALTER TABLE public.customers
  ADD CONSTRAINT customers_billing_address_iso_shape_chk CHECK (
    jsonb_typeof(billing_address_iso)='object'

    AND billing_address_iso ?& ARRAY[
      'country_code','country_subdivision_code','locality',
      'postal_code','address_line_1','address_line_2'
    ]
    AND billing_address_iso->>'country_code' ~ '^[A-Z]{2}$'
    AND (
      billing_address_iso->>'country_subdivision_code' IS NULL
      OR billing_address_iso->>'country_subdivision_code' ~ '^[A-Z]{2}-[A-Z0-9-]+$'
    )
  ),
  ADD CONSTRAINT customers_shipping_address_iso_shape_chk CHECK (
    jsonb_typeof(shipping_address_iso)='object'

    AND shipping_address_iso ?& ARRAY[
      'country_code','country_subdivision_code','locality',
      'postal_code','address_line_1','address_line_2'
    ]
    AND shipping_address_iso->>'country_code' ~ '^[A-Z]{2}$'
    AND (
      shipping_address_iso->>'country_subdivision_code' IS NULL
      OR shipping_address_iso->>'country_subdivision_code' ~ '^[A-Z]{2}-[A-Z0-9-]+$'
    )
  );

ALTER TABLE public.vendors
  ADD CONSTRAINT vendors_address_iso_shape_chk CHECK (
    jsonb_typeof(address_iso)='object'

    AND address_iso ?& ARRAY[
      'country_code','country_subdivision_code','locality',
      'postal_code','address_line_1','address_line_2'
    ]
    AND address_iso->>'country_code' ~ '^[A-Z]{2}$'
    AND (
      address_iso->>'country_subdivision_code' IS NULL
      OR address_iso->>'country_subdivision_code' ~ '^[A-Z]{2}-[A-Z0-9-]+$'
    )
  );

CREATE OR REPLACE FUNCTION public.sync_business_address_iso()
RETURNS trigger LANGUAGE plpgsql SET search_path=public
AS $fn$
BEGIN
  NEW.address_iso:=public.canonicalize_iso_address(NEW.address,NEW.country_code);
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.sync_customer_address_iso()
RETURNS trigger LANGUAGE plpgsql SET search_path=public
AS $fn$
DECLARE v_country char(2);
BEGIN
  SELECT country_code INTO v_country FROM public.businesses WHERE id=NEW.business_id;
  NEW.billing_address_iso:=public.canonicalize_iso_address(NEW.billing_address,v_country);
  NEW.shipping_address_iso:=public.canonicalize_iso_address(NEW.shipping_address,v_country);
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.sync_vendor_address_iso()
RETURNS trigger LANGUAGE plpgsql SET search_path=public
AS $fn$
DECLARE v_country char(2);
BEGIN
  SELECT country_code INTO v_country FROM public.businesses WHERE id=NEW.business_id;
  NEW.address_iso:=public.canonicalize_iso_address(NEW.address,v_country);
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_business_address_iso ON public.businesses;
CREATE TRIGGER trg_business_address_iso
BEFORE INSERT OR UPDATE OF address,country_code ON public.businesses
FOR EACH ROW EXECUTE FUNCTION public.sync_business_address_iso();

DROP TRIGGER IF EXISTS trg_customer_address_iso ON public.customers;
CREATE TRIGGER trg_customer_address_iso
BEFORE INSERT OR UPDATE OF business_id,billing_address,shipping_address ON public.customers
FOR EACH ROW EXECUTE FUNCTION public.sync_customer_address_iso();

DROP TRIGGER IF EXISTS trg_vendor_address_iso ON public.vendors;
CREATE TRIGGER trg_vendor_address_iso
BEFORE INSERT OR UPDATE OF business_id,address ON public.vendors
FOR EACH ROW EXECUTE FUNCTION public.sync_vendor_address_iso();

REVOKE ALL ON FUNCTION public.sync_business_address_iso() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.sync_customer_address_iso() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.sync_vendor_address_iso() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.india_gst_adapter_snapshot_invoice(p_invoice_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,mm_private
AS $fn$
DECLARE
  i public.invoices%rowtype;
  b public.businesses%rowtype;
  item record;
  tr public.tax_rates%rowtype;
  tp public.business_tax_profiles%rowtype;
  v_supplier_state text;
  v_place_state text;
  v_jurisdiction uuid;
  v_country_jurisdiction uuid;
  v_rule uuid;
  v_cgst_component uuid;
  v_sgst_component uuid;
  v_igst_component uuid;
  v_rc_component uuid;
  v_taxable numeric;
  v_item_tax numeric;
  v_item_tax_total numeric;
  v_scale numeric:=1;
  v_rate numeric:=0;
  v_exchange_rate numeric:=1;
  v_rate_count integer:=0;
  v_count integer:=0;
  v_subdivision text;
  v_category text:='STANDARD';
BEGIN
  SELECT * INTO i FROM public.invoices WHERE id=p_invoice_id FOR UPDATE;
  IF i.id IS NULL THEN RAISE EXCEPTION 'Invoice not found'; END IF;
  SELECT * INTO b FROM public.businesses WHERE id=i.business_id;
  IF b.id IS NULL THEN RAISE EXCEPTION 'Business not found'; END IF;
  IF upper(b.country_code)<>'IN' THEN
    RAISE EXCEPTION 'IndiaGSTAdapter can only process India businesses';
  END IF;
  IF i.journal_entry_id IS NULL THEN
    RAISE EXCEPTION 'Invoice must be posted before tax snapshot creation';
  END IF;

  SELECT count(DISTINCT round(jl.exchange_rate,10)), coalesce(min(jl.exchange_rate),1)
    INTO v_rate_count,v_exchange_rate
  FROM public.journal_lines jl
  WHERE jl.journal_entry_id=i.journal_entry_id
    AND jl.transaction_currency_code=upper(i.currency_code);
  IF v_rate_count>1 THEN
    RAISE EXCEPTION 'Invoice posting contains inconsistent exchange rates';
  END IF;

  SELECT * INTO tp FROM public.business_tax_profiles
  WHERE business_id=i.business_id LIMIT 1;
  SELECT public.gst_state_code(tp.tax_state) INTO v_supplier_state;

  v_place_state:=public.gst_state_code(i.place_of_supply_state_code);
  IF v_place_state IS NULL THEN
    SELECT public.gst_state_code(coalesce(
      c.billing_address->>'state',c.shipping_address->>'state'
    )) INTO v_place_state
    FROM public.customers c
    WHERE c.id=i.customer_id AND c.business_id=i.business_id;
  END IF;

  SELECT id INTO v_country_jurisdiction FROM public.jurisdictions
  WHERE country_code='IN' AND jurisdiction_type='country' LIMIT 1;

  IF v_country_jurisdiction IS NULL THEN
    INSERT INTO public.jurisdictions(country_code,jurisdiction_type,name,tax_authority)
    VALUES('IN','country','India','Government of India')
    RETURNING id INTO v_country_jurisdiction;
  END IF;
  v_jurisdiction:=v_country_jurisdiction;

  IF v_place_state IS NOT NULL THEN
    v_subdivision:=CASE v_place_state
      WHEN '01' THEN 'IN-JK' WHEN '02' THEN 'IN-HP' WHEN '03' THEN 'IN-PB'
      WHEN '04' THEN 'IN-CH' WHEN '05' THEN 'IN-UK' WHEN '06' THEN 'IN-HR'
      WHEN '07' THEN 'IN-DL' WHEN '08' THEN 'IN-RJ' WHEN '09' THEN 'IN-UP'
      WHEN '10' THEN 'IN-BR' WHEN '11' THEN 'IN-SK' WHEN '12' THEN 'IN-AR'
      WHEN '13' THEN 'IN-NL' WHEN '14' THEN 'IN-MN' WHEN '15' THEN 'IN-MZ'
      WHEN '16' THEN 'IN-TR' WHEN '17' THEN 'IN-ML' WHEN '18' THEN 'IN-AS'
      WHEN '19' THEN 'IN-WB' WHEN '20' THEN 'IN-JH' WHEN '21' THEN 'IN-OR'
      WHEN '22' THEN 'IN-CG' WHEN '23' THEN 'IN-MP' WHEN '24' THEN 'IN-GJ'
      WHEN '26' THEN 'IN-DH' WHEN '27' THEN 'IN-MH' WHEN '28' THEN 'IN-AP'
      WHEN '29' THEN 'IN-KA' WHEN '30' THEN 'IN-GA' WHEN '31' THEN 'IN-LD'
      WHEN '32' THEN 'IN-KL' WHEN '33' THEN 'IN-TN' WHEN '34' THEN 'IN-PY'
      WHEN '35' THEN 'IN-AN' WHEN '36' THEN 'IN-TS' WHEN '37' THEN 'IN-AP'
      WHEN '38' THEN 'IN-LA' ELSE NULL END;
    IF v_subdivision IS NOT NULL THEN
      SELECT id INTO v_jurisdiction FROM public.jurisdictions
      WHERE country_code='IN' AND subdivision_code=v_subdivision
        AND jurisdiction_type='state' LIMIT 1;
      IF v_jurisdiction IS NULL THEN
        INSERT INTO public.jurisdictions(
          country_code,subdivision_code,jurisdiction_type,name,tax_authority
        )
        VALUES(
          'IN',v_subdivision,'state',
          coalesce(i.place_of_supply_state_code,'India state'),'GST jurisdiction'
        )
        RETURNING id INTO v_jurisdiction;
      END IF;
    END IF;
  END IF;

  IF nullif(btrim(tp.gstin),'') IS NOT NULL THEN
    INSERT INTO public.business_tax_registrations(
      business_id,jurisdiction_id,tax_system,registration_number,is_primary
    )
    VALUES(
      i.business_id,v_jurisdiction,'GST',btrim(tp.gstin),true
    )
    ON CONFLICT (
      business_id,jurisdiction_id,tax_system,lower(registration_number)
    ) DO UPDATE SET is_primary=true,updated_at=now();
  END IF;

  SELECT coalesce(sum(ii.tax_amount),0) INTO v_item_tax_total
  FROM public.invoice_items ii WHERE ii.invoice_id=i.id;
  IF v_item_tax_total<>0 AND i.tax_total<>v_item_tax_total THEN
    v_scale:=round(i.tax_total/nullif(v_item_tax_total,0),10);
  END IF;

  FOR item IN
    SELECT ii.* FROM public.invoice_items ii
    WHERE ii.invoice_id=i.id ORDER BY ii.sort_order,ii.id
  LOOP
    v_taxable:=round(greatest(
      item.quantity*item.unit_price-coalesce(item.discount,0),0
    )*coalesce(v_scale,1),6);
    v_item_tax:=round(greatest(item.tax_amount,0)*coalesce(v_scale,1),6);

    SELECT * INTO tr FROM public.tax_rates
    WHERE id=item.tax_rate_id AND business_id=i.business_id LIMIT 1;
    v_rate:=coalesce(tr.rate,0);
    v_category:=CASE
      WHEN coalesce(i.reverse_charge,false) THEN 'REVERSE_CHARGE'
      WHEN v_rate=0 THEN 'ZERO_RATED'
      ELSE 'STANDARD'
    END;
    IF tr.id IS NULL AND v_item_tax<=0 THEN CONTINUE; END IF;

    INSERT INTO public.tax_rules(
      business_id,jurisdiction_id,tax_system,tax_code,name,tax_category,
      effective_from,is_active,legacy_tax_rate_id,metadata
    )
    VALUES(
      i.business_id,v_jurisdiction,'GST',
      'GST-'||coalesce(tr.id::text,'INVOICE-'||i.id::text),
      coalesce(tr.name,'GST'),v_category,i.invoice_date,true,tr.id,
      jsonb_build_object(
        'legacy_component_code',tr.component_code,
        'legacy_tax_kind',tr.tax_kind,
        'legacy_metadata',tr.metadata
      )
    )
    ON CONFLICT (
      coalesce(business_id,'00000000-0000-0000-0000-000000000000'::uuid),
      jurisdiction_id,tax_code,effective_from
    )
    DO UPDATE SET name=excluded.name,tax_category=excluded.tax_category,updated_at=now()
    RETURNING id INTO v_rule;

    IF coalesce(i.reverse_charge,false) THEN
      SELECT id INTO v_rc_component FROM public.tax_rule_components
      WHERE tax_rule_id=v_rule AND tax_code='GST-RC' AND sequence=1 LIMIT 1;
      IF v_rc_component IS NULL THEN
        INSERT INTO public.tax_rule_components(
          tax_rule_id,tax_code,rate,sequence,calculation_basis,is_recoverable
        ) VALUES(v_rule,'GST-RC',v_rate,1,'net',true)
        RETURNING id INTO v_rc_component;
      END IF;

      INSERT INTO public.invoice_tax_lines(
        business_id,invoice_id,invoice_item_id,jurisdiction_id,tax_rule_id,
        tax_component_id,tax_code,tax_category,rate,taxable_amount,tax_amount,
        base_tax_amount,transaction_currency_code,base_currency_code,
        exchange_rate,is_reverse_charge,source_adapter
      )
      VALUES(
        i.business_id,i.id,item.id,v_jurisdiction,v_rule,v_rc_component,
        'GST-RC','REVERSE_CHARGE',v_rate,v_taxable,v_item_tax,
        round(v_item_tax*v_exchange_rate,6),upper(i.currency_code),
        upper(b.base_currency_code),v_exchange_rate,true,'IndiaGSTAdapter'
      ) ON CONFLICT (dedupe_key) DO NOTHING;
      v_count:=v_count+1;

    ELSIF v_supplier_state IS NOT NULL AND v_place_state IS NOT NULL
      AND v_supplier_state=v_place_state
      AND upper(coalesce(i.supply_type,'')) NOT IN ('EXPORT','SEZ') THEN

      SELECT id INTO v_cgst_component FROM public.tax_rule_components
      WHERE tax_rule_id=v_rule AND tax_code='CGST' AND sequence=1 LIMIT 1;
      IF v_cgst_component IS NULL THEN
        INSERT INTO public.tax_rule_components(
          tax_rule_id,tax_code,rate,sequence,calculation_basis,is_recoverable
        ) VALUES(v_rule,'CGST',round(v_rate/2,10),1,'net',true)
        RETURNING id INTO v_cgst_component;
      END IF;

      SELECT id INTO v_sgst_component FROM public.tax_rule_components
      WHERE tax_rule_id=v_rule AND tax_code='SGST' AND sequence=2 LIMIT 1;
      IF v_sgst_component IS NULL THEN
        INSERT INTO public.tax_rule_components(
          tax_rule_id,tax_code,rate,sequence,calculation_basis,is_recoverable
        ) VALUES(v_rule,'SGST',round(v_rate/2,10),2,'net',true)
        RETURNING id INTO v_sgst_component;
      END IF;

      INSERT INTO public.invoice_tax_lines(
        business_id,invoice_id,invoice_item_id,jurisdiction_id,tax_rule_id,
        tax_component_id,tax_code,tax_category,rate,taxable_amount,tax_amount,
        base_tax_amount,transaction_currency_code,base_currency_code,
        exchange_rate,is_reverse_charge,source_adapter
      )
      VALUES(
        i.business_id,i.id,item.id,v_jurisdiction,v_rule,v_cgst_component,
        'CGST',v_category,round(v_rate/2,10),v_taxable,
        round(v_item_tax/2,6),round((v_item_tax/2)*v_exchange_rate,6),
        upper(i.currency_code),upper(b.base_currency_code),v_exchange_rate,false,'IndiaGSTAdapter'
      ) ON CONFLICT (dedupe_key) DO NOTHING;

      INSERT INTO public.invoice_tax_lines(
        business_id,invoice_id,invoice_item_id,jurisdiction_id,tax_rule_id,
        tax_component_id,tax_code,tax_category,rate,taxable_amount,tax_amount,
        base_tax_amount,transaction_currency_code,base_currency_code,
        exchange_rate,is_reverse_charge,source_adapter
      )
      VALUES(
        i.business_id,i.id,item.id,v_jurisdiction,v_rule,v_sgst_component,
        'SGST',v_category,round(v_rate/2,10),v_taxable,
        round(v_item_tax-v_item_tax/2,6),
        round((v_item_tax-v_item_tax/2)*v_exchange_rate,6),
        upper(i.currency_code),upper(b.base_currency_code),v_exchange_rate,false,'IndiaGSTAdapter'
      ) ON CONFLICT (dedupe_key) DO NOTHING;
      v_count:=v_count+2;

    ELSE

      SELECT id INTO v_igst_component FROM public.tax_rule_components
      WHERE tax_rule_id=v_rule AND tax_code='IGST' AND sequence=1 LIMIT 1;
      IF v_igst_component IS NULL THEN
        INSERT INTO public.tax_rule_components(
          tax_rule_id,tax_code,rate,sequence,calculation_basis,is_recoverable
        ) VALUES(v_rule,'IGST',v_rate,1,'net',true)
        RETURNING id INTO v_igst_component;
      END IF;

      INSERT INTO public.invoice_tax_lines(
        business_id,invoice_id,invoice_item_id,jurisdiction_id,tax_rule_id,
        tax_component_id,tax_code,tax_category,rate,taxable_amount,tax_amount,
        base_tax_amount,transaction_currency_code,base_currency_code,
        exchange_rate,is_reverse_charge,source_adapter
      )
      VALUES(
        i.business_id,i.id,item.id,v_jurisdiction,v_rule,v_igst_component,
        'IGST',
        CASE WHEN upper(coalesce(i.supply_type,'')) IN ('EXPORT','SEZ') AND v_rate=0
          THEN 'ZERO_RATED' ELSE v_category END,
        v_rate,v_taxable,v_item_tax,round(v_item_tax*v_exchange_rate,6),
        upper(i.currency_code),upper(b.base_currency_code),v_exchange_rate,
        false,'IndiaGSTAdapter'
      ) ON CONFLICT (dedupe_key) DO NOTHING;
      v_count:=v_count+1;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$fn$;

REVOKE ALL ON FUNCTION public.india_gst_adapter_snapshot_invoice(uuid)
  FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.snapshot_invoice_tax_lines(p_invoice_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,mm_private
AS $fn$
DECLARE
  i public.invoices%rowtype;
  b public.businesses%rowtype;
  item record;
  tr public.tax_rates%rowtype;
  v_jurisdiction uuid;
  v_rule uuid;
  v_component uuid;
  v_country_jurisdiction uuid;
  v_taxable numeric;
  v_tax numeric;
  v_rate numeric;
  v_exchange_rate numeric:=1;
  v_count integer:=0;
  v_tax_system text;
  v_category text;
BEGIN
  SELECT * INTO i FROM public.invoices WHERE id=p_invoice_id FOR UPDATE;
  IF i.id IS NULL THEN RAISE EXCEPTION 'Invoice not found'; END IF;
  IF i.journal_entry_id IS NULL THEN RETURN 0; END IF;

  IF EXISTS (SELECT 1 FROM public.invoice_tax_lines WHERE invoice_id=i.id) THEN
    SELECT count(*) INTO v_count FROM public.invoice_tax_lines WHERE invoice_id=i.id;
    RETURN v_count;
  END IF;

  SELECT * INTO b FROM public.businesses WHERE id=i.business_id;
  IF b.id IS NULL THEN RAISE EXCEPTION 'Business not found'; END IF;

  IF upper(b.country_code)='IN' THEN
    RETURN public.india_gst_adapter_snapshot_invoice(i.id);
  END IF;

  SELECT coalesce(min(jl.exchange_rate),1) INTO v_exchange_rate
  FROM public.journal_lines jl
  WHERE jl.journal_entry_id=i.journal_entry_id
    AND jl.transaction_currency_code=upper(i.currency_code);

  v_tax_system:=CASE upper(coalesce(b.tax_settings->>'tax_mode',''))
    WHEN 'VAT' THEN 'VAT'
    WHEN 'SALES_TAX' THEN 'SALES_TAX'
    WHEN 'GST' THEN 'GST'
    ELSE CASE upper(b.country_code)
      WHEN 'US' THEN 'SALES_TAX'
      WHEN 'CA' THEN 'GST'
      WHEN 'GB' THEN 'VAT'
      ELSE 'CUSTOM' END
  END;

  SELECT id INTO v_country_jurisdiction FROM public.jurisdictions
  WHERE country_code=upper(b.country_code)
    AND jurisdiction_type='country' LIMIT 1;

  IF v_country_jurisdiction IS NULL THEN
    INSERT INTO public.jurisdictions(
      country_code,jurisdiction_type,name,tax_authority
    ) VALUES(upper(b.country_code),'country',
      upper(b.country_code)||' tax jurisdiction',NULL)
    RETURNING id INTO v_country_jurisdiction;
  END IF;
  v_jurisdiction:=v_country_jurisdiction;

  FOR item IN
    SELECT ii.* FROM public.invoice_items ii
    WHERE ii.invoice_id=i.id ORDER BY ii.sort_order,ii.id
  LOOP
    IF coalesce(item.tax_amount,0)<=0 AND item.tax_rate_id IS NULL
       AND NOT coalesce(i.reverse_charge,false) THEN CONTINUE; END IF;

    SELECT * INTO tr FROM public.tax_rates
    WHERE id=item.tax_rate_id AND business_id=i.business_id LIMIT 1;

    v_rate:=coalesce(tr.rate,0);
    v_category:=CASE
      WHEN coalesce(i.reverse_charge,false) THEN 'REVERSE_CHARGE'
      WHEN tr.metadata->>'tax_category' IN (
        'STANDARD','REDUCED','ZERO_RATED','EXEMPT','REVERSE_CHARGE'
      ) THEN upper(tr.metadata->>'tax_category')
      WHEN v_rate=0 THEN 'ZERO_RATED'
      ELSE 'STANDARD'
    END;

    v_taxable:=round(greatest(
      item.quantity*item.unit_price-coalesce(item.discount,0),0
    ),6);
    v_tax:=round(greatest(coalesce(item.tax_amount,0),0),6);

    INSERT INTO public.tax_rules(
      business_id,jurisdiction_id,tax_system,tax_code,name,tax_category,
      effective_from,is_active,legacy_tax_rate_id,metadata
    )
    VALUES(
      i.business_id,v_jurisdiction,v_tax_system,
      'TAX-'||coalesce(tr.id::text,'INVOICE-'||i.id::text),
      coalesce(tr.name,v_tax_system||' tax'),v_category,i.invoice_date,true,tr.id,
      jsonb_build_object('legacy_tax_rate_id',tr.id,'legacy_metadata',tr.metadata)
    )
    ON CONFLICT (
      coalesce(business_id,'00000000-0000-0000-0000-000000000000'::uuid),
      jurisdiction_id,tax_code,effective_from
    )
    DO UPDATE SET name=excluded.name,tax_category=excluded.tax_category,updated_at=now()
    RETURNING id INTO v_rule;

    SELECT id INTO v_component FROM public.tax_rule_components
    WHERE tax_rule_id=v_rule AND sequence=1 LIMIT 1;

    IF v_component IS NULL THEN
      INSERT INTO public.tax_rule_components(
        tax_rule_id,tax_code,rate,sequence,calculation_basis,is_recoverable
      )
      VALUES(
        v_rule,coalesce(nullif(tr.component_code,''),v_tax_system),
        v_rate,1,'net',false
      )
      RETURNING id INTO v_component;
    END IF;

    INSERT INTO public.invoice_tax_lines(
      business_id,invoice_id,invoice_item_id,jurisdiction_id,tax_rule_id,
      tax_component_id,tax_code,tax_category,rate,taxable_amount,tax_amount,
      base_tax_amount,transaction_currency_code,base_currency_code,
      exchange_rate,is_reverse_charge,source_adapter
    )
    VALUES(
      i.business_id,i.id,item.id,v_jurisdiction,v_rule,v_component,
      coalesce(nullif(tr.component_code,''),v_tax_system),
      v_category,v_rate,v_taxable,v_tax,round(v_tax*v_exchange_rate,6),
      upper(i.currency_code),upper(b.base_currency_code),v_exchange_rate,
      v_category='REVERSE_CHARGE','LegacyTaxRateAdapter'
    )
    ON CONFLICT (dedupe_key) DO NOTHING;

    v_count:=v_count+1;
  END LOOP;

  RETURN v_count;
END;
$fn$;

REVOKE ALL ON FUNCTION public.snapshot_invoice_tax_lines(uuid)
  FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.trigger_snapshot_posted_invoice_tax()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,mm_private
AS $fn$
BEGIN
  IF NEW.journal_entry_id IS NOT NULL
     AND (TG_OP='INSERT' OR OLD.journal_entry_id IS DISTINCT FROM NEW.journal_entry_id) THEN
    PERFORM public.snapshot_invoice_tax_lines(NEW.id);
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_snapshot_posted_invoice_tax ON public.invoices;
CREATE TRIGGER trg_snapshot_posted_invoice_tax
AFTER INSERT OR UPDATE OF journal_entry_id ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.trigger_snapshot_posted_invoice_tax();

REVOKE ALL ON FUNCTION public.trigger_snapshot_posted_invoice_tax()
  FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE VIEW public.canonical_documents
WITH (security_invoker=true)
AS
SELECT
  i.business_id,'invoice'::text document_type,i.id document_id,
  i.invoice_number document_number,i.invoice_date issue_date,i.due_date,
  i.status::text status,i.currency_code,'customer'::text party_type,
  i.customer_id party_id,i.subtotal,i.tax_total,i.total,
  'invoices'::text source_table,i.id source_id
FROM public.invoices i
UNION ALL
SELECT
  q.business_id,'quotation',q.id,q.quotation_number,q.quotation_date,q.valid_until,
  q.status::text,q.currency_code,'customer',q.customer_id,q.subtotal,q.tax_amount,q.total,
  'quotations',q.id
FROM public.quotations q
UNION ALL
SELECT
  b.business_id,'bill',b.id,b.bill_number,b.bill_date,b.due_date,
  b.status::text,b.currency_code,'vendor',b.vendor_id,b.subtotal,b.tax_total,b.total,
  'bills',b.id
FROM public.bills b
UNION ALL
SELECT
  n.business_id,'credit_note',n.id,n.credit_note_number,n.credit_note_date,NULL::date,
  n.status::text,n.currency_code,'customer',n.customer_id,n.subtotal,n.tax_total,n.total,
  'credit_notes',n.id
FROM public.credit_notes n
UNION ALL
SELECT
  d.business_id,'debit_note',d.id,d.debit_note_number,d.debit_note_date,NULL::date,
  d.status::text,d.currency_code,
  CASE WHEN d.customer_id IS NOT NULL THEN 'customer' ELSE 'vendor' END,
  coalesce(d.customer_id,d.vendor_id),d.subtotal,d.tax_total,d.total,
  'debit_notes',d.id
FROM public.debit_notes d
UNION ALL
SELECT
  r.business_id,'receipt',r.id,r.receipt_number,r.receipt_date,NULL::date,
  'issued',r.currency_code,
  CASE WHEN r.customer_id IS NOT NULL THEN 'customer' ELSE 'unknown' END,
  r.customer_id,r.amount,0::numeric,r.amount,'receipts',r.id
FROM public.receipts r;

GRANT SELECT ON public.canonical_documents TO authenticated;
REVOKE ALL ON public.canonical_documents FROM anon;

CREATE OR REPLACE VIEW public.canonical_document_items
WITH (security_invoker=true)
AS
SELECT
  i.business_id,'invoice'::text document_type,i.id document_id,
  ii.id item_id,ii.sort_order,ii.product_service_id,ii.description,ii.quantity,
  ii.unit_price,ii.discount,ii.tax_amount,ii.line_total,ii.hsn_sac,
  'invoice_items'::text source_table,ii.id source_id
FROM public.invoices i
JOIN public.invoice_items ii ON ii.invoice_id=i.id
UNION ALL
SELECT
  q.business_id,'quotation',q.id,qi.id,qi.sort_order,qi.product_service_id,
  qi.description,qi.quantity,qi.unit_price,qi.line_discount,qi.line_tax,qi.line_total,
  NULL::text,'quotation_items',qi.id
FROM public.quotations q
JOIN public.quotation_items qi ON qi.quotation_id=q.id
UNION ALL
SELECT
  b.business_id,'bill',b.id,bi.id,bi.sort_order,bi.product_service_id,
  bi.description,bi.quantity,bi.unit_price,bi.discount,bi.tax_amount,bi.line_total,
  NULL::text,'bill_items',bi.id
FROM public.bills b
JOIN public.bill_items bi ON bi.bill_id=b.id
UNION ALL
SELECT
  n.business_id,'credit_note',n.id,ni.id,ni.sort_order,ni.product_service_id,
  ni.description,ni.quantity,ni.unit_price,0::numeric,ni.line_tax,ni.line_total,
  NULL::text,'credit_note_items',ni.id
FROM public.credit_notes n
JOIN public.credit_note_items ni ON ni.credit_note_id=n.id
UNION ALL
SELECT
  d.business_id,'debit_note',d.id,di.id,di.sort_order,di.product_service_id,
  di.description,di.quantity,di.unit_price,0::numeric,di.tax_amount,di.line_total,
  NULL::text,'debit_note_items',di.id
FROM public.debit_notes d
JOIN public.debit_note_items di ON di.debit_note_id=d.id;

GRANT SELECT ON public.canonical_document_items TO authenticated;
REVOKE ALL ON public.canonical_document_items FROM anon;

COMMIT;