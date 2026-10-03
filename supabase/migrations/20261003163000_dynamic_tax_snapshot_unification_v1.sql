BEGIN;

CREATE OR REPLACE FUNCTION public.snapshot_dynamic_invoice_tax(p_invoice_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,mm_private
AS $fn$
DECLARE
  i public.invoices%rowtype;
  b public.businesses%rowtype;
  item record;
  tr public.tax_rates%rowtype;
  x jsonb;
  v_exchange_rate numeric:=1;
  v_base_currency text;
  v_count integer:=0;
BEGIN
  SELECT * INTO i FROM public.invoices WHERE id=p_invoice_id FOR UPDATE;
  IF i.id IS NULL OR i.journal_entry_id IS NULL THEN RETURN 0; END IF;
  IF EXISTS(SELECT 1 FROM public.invoice_tax_lines WHERE invoice_id=i.id) THEN
    RETURN (SELECT count(*) FROM public.invoice_tax_lines WHERE invoice_id=i.id);
  END IF;

  SELECT * INTO b FROM public.businesses WHERE id=i.business_id;
  IF b.id IS NULL THEN RAISE EXCEPTION 'Business not found'; END IF;

  SELECT coalesce(min(jl.exchange_rate),1)::numeric
    INTO v_exchange_rate
  FROM public.journal_lines jl
  WHERE jl.journal_entry_id=i.journal_entry_id
    AND jl.transaction_currency_code=upper(i.currency_code);

  v_exchange_rate:=coalesce(v_exchange_rate,1);
  v_base_currency:=coalesce(upper(b.base_currency_code),upper(i.currency_code));

  FOR item IN
    SELECT ii.*
    FROM public.invoice_items ii
    WHERE ii.invoice_id=i.id
    ORDER BY ii.sort_order,ii.id
  LOOP
    SELECT * INTO tr
    FROM public.tax_rates
    WHERE id=item.tax_rate_id AND business_id=i.business_id
    LIMIT 1;

    IF tr.id IS NULL OR NOT coalesce((tr.metadata->>'dynamic_provider')::boolean,false) THEN
      CONTINUE;
    END IF;

    FOR x IN SELECT * FROM jsonb_array_elements(coalesce(tr.metadata->'snapshot','[]'::jsonb))
    LOOP
      INSERT INTO public.invoice_tax_lines(
        business_id,invoice_id,invoice_item_id,jurisdiction_id,tax_rule_id,tax_component_id,
        tax_code,tax_category,rate,taxable_amount,tax_amount,base_tax_amount,
        transaction_currency_code,base_currency_code,exchange_rate,is_reverse_charge,
        source_adapter,snapshot_at
      )
      VALUES(
        i.business_id,i.id,item.id,(x->>'jurisdictionId')::uuid,(x->>'taxRuleId')::uuid,
        nullif(x->>'taxComponentId','')::uuid,coalesce(x->>'taxCode',tr.component_code,tr.name),
        upper(coalesce(x->>'taxCategory','STANDARD')),(x->>'rate')::numeric,
        (x->>'taxableAmount')::numeric,(x->>'taxAmount')::numeric,
        round((x->>'taxAmount')::numeric*v_exchange_rate,6),upper(i.currency_code),
        v_base_currency,v_exchange_rate,coalesce((x->>'isReverseCharge')::boolean,false),
        coalesce(x->>'sourceProvider','moneymatters.dynamic-tax-v1'),now()
      )
      ON CONFLICT(dedupe_key) DO NOTHING;
      v_count:=v_count+1;
    END LOOP;
  END LOOP;

  RETURN v_count;
END;
$fn$;

REVOKE ALL ON FUNCTION public.snapshot_dynamic_invoice_tax(uuid) FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.snapshot_dynamic_invoice_tax(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.snapshot_invoice_tax_lines_v2(p_invoice_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,mm_private
AS $fn$
DECLARE v_dynamic boolean;
BEGIN
  SELECT EXISTS(
    SELECT 1
    FROM public.invoice_items ii
    JOIN public.tax_rates tr ON tr.id=ii.tax_rate_id AND tr.business_id=(SELECT business_id FROM public.invoices WHERE id=p_invoice_id)
    WHERE ii.invoice_id=p_invoice_id
      AND coalesce((tr.metadata->>'dynamic_provider')::boolean,false)
  ) INTO v_dynamic;

  IF v_dynamic THEN
    RETURN public.snapshot_dynamic_invoice_tax(p_invoice_id);
  END IF;

  RETURN public.snapshot_invoice_tax_lines(p_invoice_id);
END;
$fn$;

REVOKE ALL ON FUNCTION public.snapshot_invoice_tax_lines_v2(uuid) FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.snapshot_invoice_tax_lines_v2(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.trigger_snapshot_posted_invoice_tax()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,mm_private
AS $fn$
BEGIN
  IF NEW.journal_entry_id IS NOT NULL
     AND (TG_OP='INSERT' OR OLD.journal_entry_id IS DISTINCT FROM NEW.journal_entry_id) THEN
    PERFORM public.snapshot_invoice_tax_lines_v2(NEW.id);
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_snapshot_posted_invoice_tax_dynamic ON public.invoices;

COMMIT;