-- Allow optional master-data worksheets to remain empty when the example rows are removed.
-- Each populated row is still validated; the atomic commit function continues to revalidate before writes.
BEGIN;

CREATE OR REPLACE FUNCTION public._validate_business_setup_payload(p_business_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'mm_private', 'pg_temp'
AS $function$
DECLARE
 v_issues jsonb:='[]'::jsonb; v_profile jsonb:=coalesce(p_payload->'profile','{}'::jsonb);
 r jsonb; sheet_name text; key_name text; row_no integer; name_text text; kind text;
 num numeric; opening_date date; has_balance boolean:=false; seen text[]:=ARRAY[]::text[]; code_text text; sku_text text;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 IF p_business_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.businesses WHERE id=p_business_id) THEN RAISE EXCEPTION 'Selected business not found'; END IF;
 IF NOT mm_private.has_business_permission(p_business_id,'settings.manage',auth.uid()) THEN RAISE EXCEPTION 'Access denied: settings.manage permission is required'; END IF;
 IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR octet_length(p_payload::text)>15000000 THEN RAISE EXCEPTION 'Invalid or oversized workbook payload'; END IF;
 IF jsonb_typeof(v_profile) IS DISTINCT FROM 'object' THEN
  v_issues:=v_issues||jsonb_build_array(jsonb_build_object('sheet','Business Profile','row',2,'field','Profile','severity','error','message','Business Profile must contain one data row.'));
 ELSE
  name_text:=nullif(btrim(v_profile->>'business_name'),'');
  IF name_text IS NULL OR lower(name_text) LIKE 'replace with%' OR lower(name_text) LIKE 'sample %' THEN
   v_issues:=v_issues||jsonb_build_array(jsonb_build_object('sheet','Business Profile','row',2,'field','Business Name','severity','error','message','Replace the sample business name with the real business name.'));
  END IF;
  IF nullif(btrim(v_profile->>'business_type'),'') IS NOT NULL
     AND lower(btrim(v_profile->>'business_type')) NOT IN ('sole_proprietorship','partnership','llp','private_limited','public_limited','trust','society','individual','other') THEN
    v_issues:=v_issues||jsonb_build_array(jsonb_build_object('sheet','Business Profile','row',2,'field','Business Type','severity','error','message','Business Type must be sole_proprietorship, partnership, llp, private_limited, public_limited, trust, society, individual, or other.'));
  END IF;
  IF nullif(btrim(v_profile->>'gstin'),'') IS NOT NULL AND upper(btrim(v_profile->>'gstin')) !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$' THEN v_issues:=v_issues||jsonb_build_array(jsonb_build_object('sheet','Business Profile','row',2,'field','GSTIN','severity','error','message','GSTIN format is invalid.')); END IF;
  IF nullif(btrim(v_profile->>'pan'),'') IS NOT NULL AND upper(btrim(v_profile->>'pan')) !~ '^[A-Z]{5}[0-9]{4}[A-Z]$' THEN v_issues:=v_issues||jsonb_build_array(jsonb_build_object('sheet','Business Profile','row',2,'field','PAN','severity','error','message','PAN format is invalid.')); END IF;
  IF nullif(btrim(v_profile->>'opening_balance_date'),'') IS NOT NULL THEN
   BEGIN opening_date:=(v_profile->>'opening_balance_date')::date;
   EXCEPTION WHEN OTHERS THEN v_issues:=v_issues||jsonb_build_array(jsonb_build_object('sheet','Business Profile','row',2,'field','Opening Balance Date','severity','error','message','Opening Balance Date must be a valid date (YYYY-MM-DD).')); END;
  END IF;
  IF nullif(btrim(v_profile->>'currency_code'),'') IS NOT NULL AND upper(btrim(v_profile->>'currency_code')) !~ '^[A-Z]{3}$' THEN v_issues:=v_issues||jsonb_build_array(jsonb_build_object('sheet','Business Profile','row',2,'field','Currency Code','severity','error','message','Currency Code must be a three-letter code.')); END IF;
 END IF;

 FOR sheet_name,key_name IN SELECT * FROM (VALUES ('Bank & Accounts','bank_accounts'),('Customers','customers'),('Vendors','vendors'),('Categories','categories'),('Products & Services','products_services')) x(sheet_name,key_name)
 LOOP
  IF jsonb_typeof(p_payload->key_name) IS DISTINCT FROM 'array' THEN
   v_issues:=v_issues||jsonb_build_array(jsonb_build_object('sheet',sheet_name,'row',1,'field','Worksheet','severity','error','message','Worksheet is missing or malformed.'));
  ELSIF jsonb_array_length(p_payload->key_name)>5000 THEN
   v_issues:=v_issues||jsonb_build_array(jsonb_build_object('sheet',sheet_name,'row',1,'field','Worksheet','severity','error','message','Maximum 5,000 rows per worksheet.'));
  END IF;
 END LOOP;

 IF jsonb_typeof(p_payload->'customers')='array' THEN
  IF jsonb_array_length(p_payload->'customers')>0 AND NOT mm_private.has_business_permission(p_business_id,'customers.manage',auth.uid()) THEN RAISE EXCEPTION 'Access denied: customers.manage is required'; END IF;
  seen:=ARRAY[]::text[];
  FOR r IN SELECT value FROM jsonb_array_elements(p_payload->'customers') AS t(value) LOOP
   row_no:=coalesce(nullif(r->>'_sheet_row','')::integer,2); name_text:=nullif(btrim(r->>'name'),'');
   BEGIN
    IF name_text IS NULL THEN RAISE EXCEPTION 'Customer Name is required'; END IF;
    IF lower(name_text) LIKE 'sample %' OR lower(name_text) LIKE '%replace or delete%' THEN RAISE EXCEPTION 'Replace or delete the sample customer row'; END IF;
    num:=coalesce(nullif(btrim(r->>'opening_balance'),'')::numeric,0); IF num<0 THEN RAISE EXCEPTION 'Opening Balance cannot be negative'; END IF; IF num>0 THEN has_balance:=true; END IF;
    num:=coalesce(nullif(btrim(r->>'credit_limit'),'')::numeric,0); IF num<0 THEN RAISE EXCEPTION 'Credit Limit cannot be negative'; END IF;
    IF coalesce(nullif(btrim(r->>'payment_terms_days'),''),'0')::integer<0 THEN RAISE EXCEPTION 'Payment Terms cannot be negative'; END IF;
    IF nullif(btrim(r->>'gstin'),'') IS NOT NULL AND upper(btrim(r->>'gstin')) !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$' THEN RAISE EXCEPTION 'GSTIN format is invalid'; END IF;
    IF lower(name_text)=ANY(seen) THEN RAISE EXCEPTION 'Customer name is duplicated within workbook'; END IF; seen:=array_append(seen,lower(name_text));
   EXCEPTION WHEN OTHERS THEN v_issues:=v_issues||jsonb_build_array(jsonb_build_object('sheet','Customers','row',row_no,'field','Customer','severity','error','message',left(SQLERRM,250))); END;
  END LOOP;
 END IF;
 IF jsonb_typeof(p_payload->'vendors')='array' THEN
  IF jsonb_array_length(p_payload->'vendors')>0 AND NOT mm_private.has_business_permission(p_business_id,'vendors.manage',auth.uid()) THEN RAISE EXCEPTION 'Access denied: vendors.manage is required'; END IF;
  seen:=ARRAY[]::text[];
  FOR r IN SELECT value FROM jsonb_array_elements(p_payload->'vendors') AS t(value) LOOP
   row_no:=coalesce(nullif(r->>'_sheet_row','')::integer,2); name_text:=nullif(btrim(r->>'name'),'');
   BEGIN
    IF name_text IS NULL THEN RAISE EXCEPTION 'Vendor Name is required'; END IF;
    IF lower(name_text) LIKE 'sample %' OR lower(name_text) LIKE '%replace or delete%' THEN RAISE EXCEPTION 'Replace or delete the sample vendor row'; END IF;
    num:=coalesce(nullif(btrim(r->>'opening_balance'),'')::numeric,0); IF num<0 THEN RAISE EXCEPTION 'Opening Balance cannot be negative'; END IF; IF num>0 THEN has_balance:=true; END IF;
    IF coalesce(nullif(btrim(r->>'payment_terms_days'),''),'0')::integer<0 THEN RAISE EXCEPTION 'Payment Terms cannot be negative'; END IF;
    IF nullif(btrim(r->>'gstin'),'') IS NOT NULL AND upper(btrim(r->>'gstin')) !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$' THEN RAISE EXCEPTION 'GSTIN format is invalid'; END IF;
    IF lower(name_text)=ANY(seen) THEN RAISE EXCEPTION 'Vendor name is duplicated within workbook'; END IF; seen:=array_append(seen,lower(name_text));
   EXCEPTION WHEN OTHERS THEN v_issues:=v_issues||jsonb_build_array(jsonb_build_object('sheet','Vendors','row',row_no,'field','Vendor','severity','error','message',left(SQLERRM,250))); END;
  END LOOP;
 END IF;
 IF jsonb_typeof(p_payload->'bank_accounts')='array' THEN
  IF (SELECT count(*) FROM jsonb_array_elements(p_payload->'bank_accounts') AS t(value)
      WHERE lower(coalesce(nullif(btrim(value->>'is_primary'),''),'false')) IN ('true','yes','1')) > 1 THEN
    v_issues:=v_issues||jsonb_build_array(jsonb_build_object('sheet','Bank & Accounts','row',1,'field','Is Primary','severity','error','message','Mark only one bank account as primary.'));
  END IF;
  IF jsonb_array_length(p_payload->'bank_accounts')>0 AND NOT mm_private.has_business_permission(p_business_id,'accounting.post',auth.uid()) THEN RAISE EXCEPTION 'Access denied: accounting.post is required for accounts'; END IF;
  seen:=ARRAY[]::text[];
  FOR r IN SELECT value FROM jsonb_array_elements(p_payload->'bank_accounts') AS t(value) LOOP
   row_no:=coalesce(nullif(r->>'_sheet_row','')::integer,2); name_text:=nullif(btrim(r->>'account_name'),''); kind:=lower(coalesce(nullif(btrim(r->>'record_type'),''),'bank')); code_text:=nullif(btrim(r->>'account_code'),'');
   BEGIN
    IF name_text IS NULL THEN RAISE EXCEPTION 'Account Name is required'; END IF;
    IF lower(name_text) LIKE 'sample %' OR lower(name_text) LIKE '%replace or delete%' THEN RAISE EXCEPTION 'Replace or delete the sample account row'; END IF;
    IF kind NOT IN ('cash','bank','upi','account') THEN RAISE EXCEPTION 'Record Type must be cash, bank, upi, or account'; END IF;
    IF kind='account' AND lower(coalesce(r->>'account_type','')) NOT IN ('asset','liability','equity','income','expense') THEN RAISE EXCEPTION 'Account Type is invalid'; END IF;
    IF kind='account' AND lower(coalesce(r->>'normal_balance','')) NOT IN ('debit','credit') THEN RAISE EXCEPTION 'Normal Balance is invalid'; END IF;
    IF kind<>'account' AND (lower(coalesce(nullif(r->>'account_type',''),'asset'))<>'asset' OR lower(coalesce(nullif(r->>'normal_balance',''),'debit'))<>'debit') THEN RAISE EXCEPTION 'Cash/bank/UPI must be debit-balance asset accounts'; END IF;
    num:=coalesce(nullif(btrim(r->>'opening_balance'),'')::numeric,0); IF num<0 THEN RAISE EXCEPTION 'Opening Balance cannot be negative'; END IF; IF num>0 THEN has_balance:=true; END IF;
    IF code_text IS NOT NULL AND lower(code_text)=ANY(seen) THEN RAISE EXCEPTION 'Account Code is duplicated within workbook'; END IF;
    IF code_text IS NOT NULL THEN seen:=array_append(seen,lower(code_text)); END IF;
   EXCEPTION WHEN OTHERS THEN v_issues:=v_issues||jsonb_build_array(jsonb_build_object('sheet','Bank & Accounts','row',row_no,'field','Account','severity','error','message',left(SQLERRM,250))); END;
  END LOOP;
 END IF;
 IF jsonb_typeof(p_payload->'categories')='array' THEN
  IF jsonb_array_length(p_payload->'categories')>0 AND NOT mm_private.has_business_permission(p_business_id,'inventory.manage',auth.uid()) THEN RAISE EXCEPTION 'Access denied: inventory.manage is required for categories'; END IF;
  FOR r IN SELECT value FROM jsonb_array_elements(p_payload->'categories') AS t(value) LOOP
   row_no:=coalesce(nullif(r->>'_sheet_row','')::integer,2); name_text:=nullif(btrim(r->>'category'),'');
   BEGIN
    IF name_text IS NULL THEN RAISE EXCEPTION 'Category is required'; END IF;
    IF lower(name_text) LIKE 'sample %' OR lower(name_text) LIKE '%replace or delete%' THEN RAISE EXCEPTION 'Replace or delete the sample category row'; END IF;
    IF lower(coalesce(r->>'subcategory','')) LIKE 'sample %' THEN RAISE EXCEPTION 'Replace or delete the sample subcategory row'; END IF;
    num:=coalesce(nullif(btrim(r->>'tax_rate'),'')::numeric,0); IF num<0 OR num>100 THEN RAISE EXCEPTION 'Tax Rate must be between 0 and 100'; END IF;
   EXCEPTION WHEN OTHERS THEN v_issues:=v_issues||jsonb_build_array(jsonb_build_object('sheet','Categories','row',row_no,'field','Category','severity','error','message',left(SQLERRM,250))); END;
  END LOOP;
 END IF;
 IF jsonb_typeof(p_payload->'products_services')='array' THEN
  IF jsonb_array_length(p_payload->'products_services')>0 AND NOT mm_private.has_business_permission(p_business_id,'inventory.manage',auth.uid()) THEN RAISE EXCEPTION 'Access denied: inventory.manage is required for products'; END IF;
  seen:=ARRAY[]::text[];
  FOR r IN SELECT value FROM jsonb_array_elements(p_payload->'products_services') AS t(value) LOOP
   row_no:=coalesce(nullif(r->>'_sheet_row','')::integer,2); name_text:=nullif(btrim(r->>'name'),''); kind:=lower(coalesce(nullif(btrim(r->>'item_type'),''),'product')); sku_text:=nullif(btrim(r->>'sku'),'');
   BEGIN
    IF name_text IS NULL THEN RAISE EXCEPTION 'Name is required'; END IF;
    IF lower(name_text) LIKE 'sample %' OR lower(name_text) LIKE '%replace or delete%' THEN RAISE EXCEPTION 'Replace or delete the sample item row'; END IF;
    IF kind NOT IN ('product','service') THEN RAISE EXCEPTION 'Item Type must be product or service'; END IF;
    IF nullif(btrim(r->>'category'),'') IS NULL THEN RAISE EXCEPTION 'Category is required'; END IF;
    IF nullif(btrim(r->>'hsn_sac'),'') IS NULL THEN RAISE EXCEPTION 'HSN/SAC is required'; END IF;
    IF kind='product' AND nullif(btrim(r->>'unit'),'') IS NULL THEN RAISE EXCEPTION 'Unit is required for goods'; END IF;
    num:=coalesce(nullif(btrim(r->>'sales_price'),'')::numeric,0); IF num<0 THEN RAISE EXCEPTION 'Sale Price cannot be negative'; END IF;
    num:=coalesce(nullif(btrim(r->>'purchase_price'),'')::numeric,0); IF num<0 THEN RAISE EXCEPTION 'Purchase Price cannot be negative'; END IF;
    num:=coalesce(nullif(btrim(r->>'tax_rate'),'')::numeric,0); IF num<0 OR num>100 THEN RAISE EXCEPTION 'Tax Rate must be between 0 and 100'; END IF;
    num:=coalesce(nullif(btrim(r->>'opening_stock'),'')::numeric,0); IF num<0 THEN RAISE EXCEPTION 'Opening Stock cannot be negative'; END IF; IF kind='service' AND num<>0 THEN RAISE EXCEPTION 'Services cannot have opening stock'; END IF;
    IF num>0 THEN num:=coalesce(nullif(btrim(r->>'opening_stock_cost'),'')::numeric,0); IF num<0 THEN RAISE EXCEPTION 'Opening Stock Cost cannot be negative'; END IF; END IF;
    IF sku_text IS NOT NULL AND lower(sku_text)=ANY(seen) THEN RAISE EXCEPTION 'SKU is duplicated within workbook'; END IF;
    IF sku_text IS NOT NULL THEN seen:=array_append(seen,lower(sku_text)); END IF;
   EXCEPTION WHEN OTHERS THEN v_issues:=v_issues||jsonb_build_array(jsonb_build_object('sheet','Products & Services','row',row_no,'field','Item','severity','error','message',left(SQLERRM,250))); END;
  END LOOP;
 END IF;
 IF has_balance AND NOT mm_private.has_business_permission(p_business_id,'accounting.post',auth.uid()) THEN
   RAISE EXCEPTION 'Access denied: accounting.post is required to import non-zero opening balances';
 END IF;
 IF has_balance THEN
  IF nullif(btrim(v_profile->>'opening_balance_date'),'') IS NULL THEN v_issues:=v_issues||jsonb_build_array(jsonb_build_object('sheet','Business Profile','row',2,'field','Opening Balance Date','severity','error','message','Set an Opening Balance Date before non-zero balances.')); END IF;
  IF EXISTS(SELECT 1 FROM public.journal_entries WHERE business_id=p_business_id AND source_type='business_setup_opening_balance' AND status::text IN ('posted','locked')) THEN v_issues:=v_issues||jsonb_build_array(jsonb_build_object('sheet','Opening Balances','row',1,'field','Opening Balance','severity','error','message','Opening balances were already imported. Use a journal adjustment workflow.')); END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(p_payload->'customers','[]'::jsonb)) AS x(value) WHERE coalesce(nullif(value->>'opening_balance','')::numeric,0)>0) AND NOT EXISTS(SELECT 1 FROM public.accounts WHERE business_id=p_business_id AND code='1100' AND is_active) THEN v_issues:=v_issues||jsonb_build_array(jsonb_build_object('sheet','Opening Balances','row',1,'field','Customers','severity','error','message','Accounts Receivable account 1100 is missing.')); END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(p_payload->'vendors','[]'::jsonb)) AS x(value) WHERE coalesce(nullif(value->>'opening_balance','')::numeric,0)>0) AND NOT EXISTS(SELECT 1 FROM public.accounts WHERE business_id=p_business_id AND code='2000' AND is_active) THEN v_issues:=v_issues||jsonb_build_array(jsonb_build_object('sheet','Opening Balances','row',1,'field','Vendors','severity','error','message','Accounts Payable account 2000 is missing.')); END IF;
  IF NOT EXISTS(SELECT 1 FROM public.accounts WHERE business_id=p_business_id AND code='3000' AND is_active) THEN v_issues:=v_issues||jsonb_build_array(jsonb_build_object('sheet','Opening Balances','row',1,'field','Equity Offset','severity','error','message','Opening Balance Equity account 3000 is missing.')); END IF;
 END IF;
 RETURN jsonb_build_object('issues',v_issues,'summary',jsonb_build_object(
  'business_profile',1,'bank_accounts',coalesce(jsonb_array_length(p_payload->'bank_accounts'),0),
  'customers',coalesce(jsonb_array_length(p_payload->'customers'),0),'vendors',coalesce(jsonb_array_length(p_payload->'vendors'),0),
  'categories',coalesce(jsonb_array_length(p_payload->'categories'),0),'products_services',coalesce(jsonb_array_length(p_payload->'products_services'),0),
  'opening_balances_present',has_balance
 ));
END;
$function$;

REVOKE ALL ON FUNCTION public._validate_business_setup_payload(uuid,jsonb) FROM PUBLIC,anon,authenticated;
NOTIFY pgrst, 'reload schema';

COMMIT;
