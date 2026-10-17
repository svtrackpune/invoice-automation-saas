BEGIN;

CREATE OR REPLACE FUNCTION public.commit_business_setup_import(p_import_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'mm_private', 'pg_temp'
AS $function$
DECLARE
 v_stage public.business_setup_import_staging%rowtype;
 v_payload jsonb; v_profile jsonb; v_row jsonb; v_validation jsonb;
 v_account_id uuid; v_bank_id uuid; v_customer_id uuid; v_vendor_id uuid;
 v_category_id uuid; v_subcategory_id uuid; v_item_id uuid; v_tax_id uuid;
 v_ar_id uuid; v_ap_id uuid; v_equity_id uuid; v_inventory_id uuid; v_income_id uuid; v_expense_id uuid; v_entry_id uuid;
 v_entry_no bigint; v_currency char(3); v_record_type text;
 v_primary_bank_id uuid; v_primary_upi_id text; v_has_cash boolean:=false; v_has_upi boolean:=false;
 v_account_type public.account_type; v_normal_balance public.normal_balance;
 v_item_type text; v_existing_item_type text; v_item_name text; v_account_name text; v_account_code text;
 v_category_name text; v_subcategory_name text; v_tax_rate numeric; v_amount numeric; v_net numeric;
 v_debits numeric:=0; v_credits numeric:=0; v_opening_lines jsonb:='[]'::jsonb;
 v_opening_date date; v_is_system boolean;
 v_accounts_created integer:=0; v_banks_created integer:=0; v_customers_created integer:=0;
 v_vendors_created integer:=0; v_categories_created integer:=0; v_subcategories_created integer:=0;
 v_items_created integer:=0; v_items_updated integer:=0;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

 SELECT * INTO v_stage
 FROM public.business_setup_import_staging
 WHERE id=p_import_id
 FOR UPDATE;
 IF v_stage.id IS NULL THEN RAISE EXCEPTION 'Preview not found. Upload and validate the workbook again.'; END IF;
 IF v_stage.created_by IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Only the user who previewed this workbook can commit it'; END IF;
 IF v_stage.status<>'validated' THEN RAISE EXCEPTION 'This preview has errors, expired, or was already committed. Validate again before committing.'; END IF;
 IF v_stage.expires_at<=now() THEN RAISE EXCEPTION 'Preview expired. Upload and validate the workbook again.'; END IF;

 -- Serialize setup commits per business, then revalidate permission and data while holding the lock.
 PERFORM 1 FROM public.businesses WHERE id=v_stage.business_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Business not found'; END IF;
 v_validation:=public._validate_business_setup_payload(v_stage.business_id,v_stage.payload);
 IF jsonb_array_length(coalesce(v_validation->'issues','[]'::jsonb))>0 THEN
   RAISE EXCEPTION 'Workbook validation changed after preview. Validate again and resolve every error.';
 END IF;

 v_payload:=v_stage.payload;
 v_profile:=v_payload->'profile';
 v_currency:=upper(coalesce(nullif(btrim(v_profile->>'currency_code'),''),(SELECT b.currency_code::text FROM public.businesses b WHERE b.id=v_stage.business_id),'INR'))::char(3);
 v_opening_date:=nullif(btrim(v_profile->>'opening_balance_date'),'')::date;

 IF jsonb_array_length(v_payload->'customers')>0 AND NOT mm_private.has_business_permission(v_stage.business_id,'customers.manage',auth.uid()) THEN RAISE EXCEPTION 'Access denied: customers.manage is required'; END IF;
 IF jsonb_array_length(v_payload->'vendors')>0 AND NOT mm_private.has_business_permission(v_stage.business_id,'vendors.manage',auth.uid()) THEN RAISE EXCEPTION 'Access denied: vendors.manage is required'; END IF;
 IF jsonb_array_length(v_payload->'bank_accounts')>0 AND NOT mm_private.has_business_permission(v_stage.business_id,'accounting.post',auth.uid()) THEN RAISE EXCEPTION 'Access denied: accounting.post is required for accounts'; END IF;
 IF jsonb_array_length(v_payload->'categories')+jsonb_array_length(v_payload->'products_services')>0 AND NOT mm_private.has_business_permission(v_stage.business_id,'inventory.manage',auth.uid()) THEN RAISE EXCEPTION 'Access denied: inventory.manage is required'; END IF;

 -- Business profile is applied only after successful preview and fresh server-side validation.
 UPDATE public.businesses b
 SET name=coalesce(nullif(btrim(v_profile->>'business_name'),''),b.name),
     business_type=CASE WHEN nullif(btrim(v_profile->>'business_type'),'') IS NULL THEN b.business_type ELSE lower(btrim(v_profile->>'business_type'))::public.business_type END,
     legal_name=coalesce(nullif(btrim(v_profile->>'legal_name'),''),b.legal_name),
     phone=coalesce(nullif(btrim(v_profile->>'phone'),''),b.phone),
     email=coalesce(nullif(btrim(v_profile->>'email'),''),b.email),
     website=coalesce(nullif(btrim(v_profile->>'website'),''),b.website),
     tax_registration_number=coalesce(nullif(upper(btrim(v_profile->>'gstin')),''),b.tax_registration_number),
     registration_number=coalesce(nullif(upper(btrim(v_profile->>'pan')),''),b.registration_number),
     country_code=coalesce(nullif(upper(btrim(v_profile->>'country_code')),''),b.country_code),
     currency_code=v_currency,
     base_currency_code=v_currency,
     timezone=coalesce(nullif(btrim(v_profile->>'timezone'),''),b.timezone),
     default_timezone=coalesce(nullif(btrim(v_profile->>'timezone'),''),b.default_timezone),
     address=coalesce(b.address,'{}'::jsonb)||jsonb_strip_nulls(jsonb_build_object(
       'line1',nullif(btrim(v_profile->>'address_line_1'),''),
       'line2',nullif(btrim(v_profile->>'address_line_2'),''),
       'city',nullif(btrim(v_profile->>'city'),''),
       'state',nullif(btrim(v_profile->>'state'),''),
       'postal_code',nullif(btrim(v_profile->>'postal_code'),''),
       'country_code',nullif(upper(btrim(v_profile->>'country_code')),''))),
     address_iso=coalesce(b.address_iso,'{}'::jsonb)||jsonb_strip_nulls(jsonb_build_object(
       'line1',nullif(btrim(v_profile->>'address_line_1'),''),
       'line2',nullif(btrim(v_profile->>'address_line_2'),''),
       'city',nullif(btrim(v_profile->>'city'),''),
       'state',nullif(btrim(v_profile->>'state'),''),
       'postal_code',nullif(btrim(v_profile->>'postal_code'),''),
       'country_code',nullif(upper(btrim(v_profile->>'country_code')),''))),
     updated_at=now()
 WHERE b.id=v_stage.business_id;

 -- Bank/Accounts: resolve or create chart-of-account rows; then link cash/bank/UPI details.
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_payload->'bank_accounts') x(value)
           WHERE lower(coalesce(value->>'is_primary','false')) IN ('true','yes','1')) THEN
   UPDATE public.bank_accounts SET is_primary=false WHERE business_id=v_stage.business_id;
 END IF;

 FOR v_row IN SELECT value FROM jsonb_array_elements(v_payload->'bank_accounts') x(value) LOOP
   v_record_type:=lower(coalesce(nullif(btrim(v_row->>'record_type'),''),'bank'));
   v_account_name:=btrim(v_row->>'account_name');
   v_account_code:=nullif(btrim(v_row->>'account_code'),'');
   v_account_type:=CASE WHEN v_record_type='account' THEN lower(v_row->>'account_type')::public.account_type ELSE 'asset'::public.account_type END;
   v_normal_balance:=CASE WHEN v_record_type='account' THEN lower(v_row->>'normal_balance')::public.normal_balance ELSE 'debit'::public.normal_balance END;
   v_account_id:=NULL;

   IF v_account_code IS NOT NULL THEN
     SELECT a.id INTO v_account_id FROM public.accounts a
     WHERE a.business_id=v_stage.business_id AND a.code=v_account_code
     ORDER BY a.is_system DESC,a.id LIMIT 1 FOR UPDATE;
   END IF;
   IF v_account_id IS NULL THEN
     SELECT a.id INTO v_account_id FROM public.accounts a
     WHERE a.business_id=v_stage.business_id AND lower(btrim(a.name))=lower(v_account_name) AND a.account_type=v_account_type
     ORDER BY a.is_system DESC,a.id LIMIT 1 FOR UPDATE;
   END IF;

   IF v_account_id IS NULL THEN
     INSERT INTO public.accounts(business_id,code,name,account_type,normal_balance,account_subtype,is_system,is_active,description)
     VALUES(v_stage.business_id,v_account_code,v_account_name,v_account_type,v_normal_balance,
       CASE WHEN v_record_type='cash' THEN 'cash' WHEN v_record_type IN ('bank','upi') THEN 'bank' ELSE NULL END,
       false,true,nullif(btrim(v_row->>'description'),''))
     RETURNING id INTO v_account_id;
     v_accounts_created:=v_accounts_created+1;
   ELSE
     SELECT a.is_system INTO v_is_system FROM public.accounts a WHERE a.id=v_account_id;
     IF NOT v_is_system THEN
       UPDATE public.accounts SET is_active=true,
         description=coalesce(nullif(btrim(v_row->>'description'),''),description),updated_at=now()
       WHERE id=v_account_id AND business_id=v_stage.business_id;
     END IF;
   END IF;

   v_amount:=coalesce(nullif(btrim(v_row->>'opening_balance'),'')::numeric,0);
   IF v_amount>0 THEN
     v_opening_lines:=v_opening_lines||jsonb_build_array(jsonb_build_object(
       'account_id',v_account_id,
       'debit',CASE WHEN v_normal_balance='debit' THEN v_amount ELSE 0 END,
       'credit',CASE WHEN v_normal_balance='credit' THEN v_amount ELSE 0 END,
       'entity_type','account','entity_id',v_account_id,'description','Opening balance · '||v_account_name));
   END IF;

   IF v_record_type IN ('cash','bank','upi') THEN
     SELECT ba.id INTO v_bank_id FROM public.bank_accounts ba
     WHERE ba.business_id=v_stage.business_id AND ba.linked_account_id=v_account_id AND lower(ba.name)=lower(v_account_name)
     ORDER BY ba.is_primary DESC,ba.id LIMIT 1 FOR UPDATE;
     IF v_bank_id IS NULL THEN
       INSERT INTO public.bank_accounts(
         business_id,name,institution_name,account_last4,currency_code,linked_account_id,is_connected,is_active,metadata,
         account_holder_name,ifsc_code,branch_name,account_type,is_primary,account_number
       ) VALUES(
         v_stage.business_id,v_account_name,nullif(btrim(v_row->>'institution_name'),''),
         CASE WHEN nullif(btrim(v_row->>'account_number'),'') IS NULL THEN NULL ELSE right(btrim(v_row->>'account_number'),4) END,
         upper(coalesce(nullif(btrim(v_row->>'currency_code'),''),v_currency)),v_account_id,false,true,
         jsonb_strip_nulls(jsonb_build_object('record_type',v_record_type,'upi_id',nullif(btrim(v_row->>'upi_id'),''))),
         nullif(btrim(v_row->>'account_holder_name'),''),nullif(upper(btrim(v_row->>'ifsc_code')),''),
         nullif(btrim(v_row->>'branch_name'),''),
         CASE WHEN v_record_type='cash' THEN 'cash' WHEN v_record_type='upi' THEN 'upi' ELSE 'bank' END,
         lower(coalesce(v_row->>'is_primary','false')) IN ('true','yes','1'),nullif(btrim(v_row->>'account_number'),'')
       ) RETURNING id INTO v_bank_id;
       v_banks_created:=v_banks_created+1;
     ELSE
       UPDATE public.bank_accounts SET
         institution_name=coalesce(nullif(btrim(v_row->>'institution_name'),''),institution_name),
         account_number=coalesce(nullif(btrim(v_row->>'account_number'),''),account_number),
         account_last4=CASE WHEN nullif(btrim(v_row->>'account_number'),'') IS NULL THEN account_last4 ELSE right(btrim(v_row->>'account_number'),4) END,
         account_holder_name=coalesce(nullif(btrim(v_row->>'account_holder_name'),''),account_holder_name),
         ifsc_code=coalesce(nullif(upper(btrim(v_row->>'ifsc_code')),''),ifsc_code),
         branch_name=coalesce(nullif(btrim(v_row->>'branch_name'),''),branch_name),
         currency_code=upper(coalesce(nullif(btrim(v_row->>'currency_code'),''),v_currency)),
         metadata=coalesce(metadata,'{}'::jsonb)||jsonb_strip_nulls(jsonb_build_object('record_type',v_record_type,'upi_id',nullif(btrim(v_row->>'upi_id'),''))),
         is_primary=lower(coalesce(v_row->>'is_primary','false')) IN ('true','yes','1'),is_active=true,updated_at=now()
       WHERE id=v_bank_id AND business_id=v_stage.business_id;
     END IF;
   END IF;
 END LOOP;

 -- Make imported cash/bank/UPI master data available to POS and document rendering.
 IF jsonb_array_length(v_payload->'bank_accounts')>0 THEN
   SELECT EXISTS(SELECT 1 FROM public.bank_accounts ba WHERE ba.business_id=v_stage.business_id AND ba.is_active
     AND lower(coalesce(nullif(ba.metadata->>'record_type',''),nullif(ba.account_type,''),'bank'))='cash') INTO v_has_cash;
   SELECT nullif(btrim(ba.metadata->>'upi_id'),'') INTO v_primary_upi_id
   FROM public.bank_accounts ba WHERE ba.business_id=v_stage.business_id AND ba.is_active AND nullif(btrim(ba.metadata->>'upi_id'),'') IS NOT NULL
   ORDER BY ba.is_primary DESC,ba.id LIMIT 1;
   v_has_upi:=v_primary_upi_id IS NOT NULL;
   SELECT ba.id INTO v_primary_bank_id FROM public.bank_accounts ba
   WHERE ba.business_id=v_stage.business_id AND ba.is_active
     AND lower(coalesce(nullif(ba.metadata->>'record_type',''),nullif(ba.account_type,''),'bank'))='bank'
   ORDER BY ba.is_primary DESC,ba.name,ba.id LIMIT 1;
   IF v_has_cash OR v_has_upi OR v_primary_bank_id IS NOT NULL THEN
     INSERT INTO public.document_payment_settings(
       business_id,upi_id,merchant_name,default_bank_account_id,enable_cash,enable_upi,enable_card,enable_credit,
       payment_qr_enabled,payment_link_enabled,prefill_bill_amount,updated_at
     ) VALUES(
       v_stage.business_id,v_primary_upi_id,nullif(btrim(v_profile->>'business_name'),''),v_primary_bank_id,
       v_has_cash,v_has_upi,false,true,v_has_upi,false,true,now()
     )
     ON CONFLICT (business_id) DO UPDATE SET
       upi_id=coalesce(EXCLUDED.upi_id,document_payment_settings.upi_id),
       merchant_name=coalesce(EXCLUDED.merchant_name,document_payment_settings.merchant_name),
       default_bank_account_id=coalesce(EXCLUDED.default_bank_account_id,document_payment_settings.default_bank_account_id),
       enable_cash=CASE WHEN v_has_cash THEN true ELSE document_payment_settings.enable_cash END,
       enable_upi=CASE WHEN v_has_upi THEN true ELSE document_payment_settings.enable_upi END,
       payment_qr_enabled=CASE WHEN v_has_upi THEN true ELSE document_payment_settings.payment_qr_enabled END,
       updated_at=now();
   END IF;
   INSERT INTO public.business_document_bank_accounts(business_id,document_type,bank_account_id,display_order)
   SELECT v_stage.business_id,d.document_type,ba.id,
     (row_number() OVER(PARTITION BY d.document_type ORDER BY ba.is_primary DESC,ba.name,ba.id)-1)::integer
   FROM public.bank_accounts ba
   CROSS JOIN (VALUES ('invoice'::text),('quotation'::text),('receipt'::text)) AS d(document_type)
   WHERE ba.business_id=v_stage.business_id AND ba.is_active
     AND lower(coalesce(nullif(ba.metadata->>'record_type',''),nullif(ba.account_type,''),'bank'))='bank'
   ON CONFLICT (business_id,document_type,bank_account_id) DO UPDATE SET display_order=EXCLUDED.display_order;
 END IF;

 -- Resolve or create the configured tax rate in this tenant.
 FOR v_row IN
   SELECT x.value FROM jsonb_array_elements(v_payload->'categories') x(value)
   UNION ALL
   SELECT x.value FROM jsonb_array_elements(v_payload->'products_services') x(value)
 LOOP
   v_tax_rate:=coalesce(nullif(btrim(v_row->>'tax_rate'),'')::numeric,0);
   SELECT tr.id INTO v_tax_id FROM public.tax_rates tr
   WHERE tr.business_id=v_stage.business_id AND tr.is_active AND tr.tax_kind='sales' AND round(tr.rate::numeric,2)=round(v_tax_rate,2)
   ORDER BY tr.id LIMIT 1;
   IF v_tax_id IS NULL THEN
     INSERT INTO public.tax_rates(business_id,name,rate,tax_kind,is_active,metadata)
     VALUES(v_stage.business_id,'GST '||trim(to_char(v_tax_rate,'FM999990.##'))||'%',v_tax_rate,'sales',true,jsonb_build_object('source','business_setup_import'))
     RETURNING id INTO v_tax_id;
   END IF;
 END LOOP;

 -- Parent categories and child subcategories are idempotently linked.
 FOR v_row IN SELECT value FROM jsonb_array_elements(v_payload->'categories') x(value) LOOP
   v_category_name:=btrim(v_row->>'category');
   v_subcategory_name:=nullif(btrim(v_row->>'subcategory'),'');
   v_tax_rate:=coalesce(nullif(btrim(v_row->>'tax_rate'),'')::numeric,0);
   SELECT tr.id INTO v_tax_id FROM public.tax_rates tr
   WHERE tr.business_id=v_stage.business_id AND tr.is_active AND tr.tax_kind='sales' AND round(tr.rate::numeric,2)=round(v_tax_rate,2)
   ORDER BY tr.id LIMIT 1;
   v_category_id:=NULL;
   SELECT pc.id INTO v_category_id FROM public.product_categories pc
   WHERE pc.business_id=v_stage.business_id AND lower(btrim(pc.name))=lower(v_category_name)
   ORDER BY pc.is_active DESC,pc.id LIMIT 1 FOR UPDATE;
   IF v_category_id IS NULL THEN
     INSERT INTO public.product_categories(business_id,name,description,default_hsn_sac,default_tax_rate_id,is_active)
     VALUES(v_stage.business_id,v_category_name,nullif(btrim(v_row->>'description'),''),nullif(btrim(v_row->>'default_hsn_sac'),''),v_tax_id,true)
     RETURNING id INTO v_category_id;
     v_categories_created:=v_categories_created+1;
   ELSE
     UPDATE public.product_categories SET is_active=true,
       description=coalesce(nullif(btrim(v_row->>'description'),''),description),
       default_hsn_sac=coalesce(nullif(btrim(v_row->>'default_hsn_sac'),''),default_hsn_sac),
       default_tax_rate_id=coalesce(v_tax_id,default_tax_rate_id),updated_at=now()
     WHERE id=v_category_id AND business_id=v_stage.business_id;
   END IF;
   IF v_subcategory_name IS NOT NULL THEN
     v_subcategory_id:=NULL;
     SELECT ps.id INTO v_subcategory_id FROM public.product_subcategories ps
     WHERE ps.business_id=v_stage.business_id AND ps.category_id=v_category_id AND lower(btrim(ps.name))=lower(v_subcategory_name)
     ORDER BY ps.is_active DESC,ps.id LIMIT 1 FOR UPDATE;
     IF v_subcategory_id IS NULL THEN
       INSERT INTO public.product_subcategories(business_id,category_id,name,description,is_active)
       VALUES(v_stage.business_id,v_category_id,v_subcategory_name,nullif(btrim(v_row->>'description'),''),true)
       RETURNING id INTO v_subcategory_id;
       v_subcategories_created:=v_subcategories_created+1;
     ELSE
       UPDATE public.product_subcategories SET is_active=true,description=coalesce(nullif(btrim(v_row->>'description'),''),description),updated_at=now()
       WHERE id=v_subcategory_id AND business_id=v_stage.business_id;
     END IF;
   END IF;
 END LOOP;

 -- Customer and vendor upserts preserve existing records; opening balances are separate journal lines.
 FOR v_row IN SELECT value FROM jsonb_array_elements(v_payload->'customers') x(value) LOOP
   v_item_name:=btrim(v_row->>'name');
   v_customer_id:=NULL;
   SELECT c.id INTO v_customer_id FROM public.customers c
   WHERE c.business_id=v_stage.business_id AND (
     (nullif(btrim(v_row->>'gstin'),'') IS NOT NULL AND c.tax_id=upper(btrim(v_row->>'gstin')))
     OR (nullif(btrim(v_row->>'gstin'),'') IS NULL AND lower(btrim(c.display_name))=lower(v_item_name))
   ) ORDER BY c.id LIMIT 1 FOR UPDATE;
   IF v_customer_id IS NULL THEN
     INSERT INTO public.customers(business_id,display_name,legal_name,email,phone,tax_id,tax_type,billing_address,shipping_address,credit_limit,payment_terms_days,notes,metadata,is_active,payment_reminders_enabled,reminder_days_before_due)
     VALUES(v_stage.business_id,v_item_name,nullif(btrim(v_row->>'legal_name'),''),nullif(btrim(v_row->>'email'),''),nullif(btrim(v_row->>'phone'),''),
       nullif(upper(btrim(v_row->>'gstin')),''),coalesce(nullif(btrim(v_row->>'tax_type'),''),CASE WHEN nullif(btrim(v_row->>'gstin'),'') IS NULL THEN NULL ELSE 'GSTIN' END),
       CASE WHEN nullif(btrim(v_row->>'billing_address'),'') IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('line1',btrim(v_row->>'billing_address')) END,
       CASE WHEN nullif(btrim(v_row->>'shipping_address'),'') IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('line1',btrim(v_row->>'shipping_address')) END,
       nullif(btrim(v_row->>'credit_limit'),'')::numeric,coalesce(nullif(btrim(v_row->>'payment_terms_days'),'')::integer,0),nullif(btrim(v_row->>'notes'),''),'{}'::jsonb,true,true,3)
     RETURNING id INTO v_customer_id;
     v_customers_created:=v_customers_created+1;
   ELSE
     UPDATE public.customers SET
       legal_name=coalesce(nullif(btrim(v_row->>'legal_name'),''),legal_name),email=coalesce(nullif(btrim(v_row->>'email'),''),email),
       phone=coalesce(nullif(btrim(v_row->>'phone'),''),phone),tax_id=coalesce(nullif(upper(btrim(v_row->>'gstin')),''),tax_id),
       tax_type=coalesce(nullif(btrim(v_row->>'tax_type'),''),tax_type),
       billing_address=CASE WHEN nullif(btrim(v_row->>'billing_address'),'') IS NULL THEN billing_address ELSE jsonb_build_object('line1',btrim(v_row->>'billing_address')) END,
       shipping_address=CASE WHEN nullif(btrim(v_row->>'shipping_address'),'') IS NULL THEN shipping_address ELSE jsonb_build_object('line1',btrim(v_row->>'shipping_address')) END,
       credit_limit=coalesce(nullif(btrim(v_row->>'credit_limit'),'')::numeric,credit_limit),
       payment_terms_days=coalesce(nullif(btrim(v_row->>'payment_terms_days'),'')::integer,payment_terms_days),
       notes=coalesce(nullif(btrim(v_row->>'notes'),''),notes),updated_at=now()
     WHERE id=v_customer_id AND business_id=v_stage.business_id;
   END IF;
   v_amount:=coalesce(nullif(btrim(v_row->>'opening_balance'),'')::numeric,0);
   IF v_amount>0 THEN
     SELECT a.id INTO v_ar_id FROM public.accounts a WHERE a.business_id=v_stage.business_id AND a.code='1100' AND a.is_active LIMIT 1;
     v_opening_lines:=v_opening_lines||jsonb_build_array(jsonb_build_object('account_id',v_ar_id,'debit',v_amount,'credit',0,'entity_type','customer','entity_id',v_customer_id,'description','Opening receivable · '||v_item_name));
     UPDATE public.customers SET metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('business_setup_opening_balance',jsonb_build_object('amount',v_amount,'date',v_opening_date,'import_id',v_stage.id)) WHERE id=v_customer_id AND business_id=v_stage.business_id;
   END IF;
 END LOOP;

 FOR v_row IN SELECT value FROM jsonb_array_elements(v_payload->'vendors') x(value) LOOP
   v_item_name:=btrim(v_row->>'name');
   v_vendor_id:=NULL;
   SELECT ven.id INTO v_vendor_id FROM public.vendors ven
   WHERE ven.business_id=v_stage.business_id AND (
     (nullif(btrim(v_row->>'gstin'),'') IS NOT NULL AND ven.tax_id=upper(btrim(v_row->>'gstin')))
     OR (nullif(btrim(v_row->>'gstin'),'') IS NULL AND lower(btrim(ven.display_name))=lower(v_item_name))
   ) ORDER BY ven.id LIMIT 1 FOR UPDATE;
   IF v_vendor_id IS NULL THEN
     INSERT INTO public.vendors(business_id,display_name,legal_name,email,phone,tax_id,tax_type,address,payment_terms_days,notes,metadata,is_active,contact_person_name)
     VALUES(v_stage.business_id,v_item_name,nullif(btrim(v_row->>'legal_name'),''),nullif(btrim(v_row->>'email'),''),nullif(btrim(v_row->>'phone'),''),
       nullif(upper(btrim(v_row->>'gstin')),''),coalesce(nullif(btrim(v_row->>'tax_type'),''),CASE WHEN nullif(btrim(v_row->>'gstin'),'') IS NULL THEN NULL ELSE 'GSTIN' END),
       CASE WHEN nullif(btrim(v_row->>'address'),'') IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('line1',btrim(v_row->>'address')) END,
       coalesce(nullif(btrim(v_row->>'payment_terms_days'),'')::integer,0),nullif(btrim(v_row->>'notes'),''),'{}'::jsonb,true,nullif(btrim(v_row->>'contact_person_name'),''))
     RETURNING id INTO v_vendor_id;
     v_vendors_created:=v_vendors_created+1;
   ELSE
     UPDATE public.vendors SET legal_name=coalesce(nullif(btrim(v_row->>'legal_name'),''),legal_name),
       email=coalesce(nullif(btrim(v_row->>'email'),''),email),phone=coalesce(nullif(btrim(v_row->>'phone'),''),phone),
       tax_id=coalesce(nullif(upper(btrim(v_row->>'gstin')),''),tax_id),tax_type=coalesce(nullif(btrim(v_row->>'tax_type'),''),tax_type),
       address=CASE WHEN nullif(btrim(v_row->>'address'),'') IS NULL THEN address ELSE jsonb_build_object('line1',btrim(v_row->>'address')) END,
       payment_terms_days=coalesce(nullif(btrim(v_row->>'payment_terms_days'),'')::integer,payment_terms_days),
       notes=coalesce(nullif(btrim(v_row->>'notes'),''),notes),contact_person_name=coalesce(nullif(btrim(v_row->>'contact_person_name'),''),contact_person_name),updated_at=now()
     WHERE id=v_vendor_id AND business_id=v_stage.business_id;
   END IF;
   v_amount:=coalesce(nullif(btrim(v_row->>'opening_balance'),'')::numeric,0);
   IF v_amount>0 THEN
     SELECT a.id INTO v_ap_id FROM public.accounts a WHERE a.business_id=v_stage.business_id AND a.code='2000' AND a.is_active LIMIT 1;
     v_opening_lines:=v_opening_lines||jsonb_build_array(jsonb_build_object('account_id',v_ap_id,'debit',0,'credit',v_amount,'entity_type','vendor','entity_id',v_vendor_id,'description','Opening payable · '||v_item_name));
     UPDATE public.vendors SET metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('business_setup_opening_balance',jsonb_build_object('amount',v_amount,'date',v_opening_date,'import_id',v_stage.id)) WHERE id=v_vendor_id AND business_id=v_stage.business_id;
   END IF;
 END LOOP;

 SELECT a.id INTO v_income_id FROM public.accounts a WHERE a.business_id=v_stage.business_id AND a.code='4000' AND a.is_active LIMIT 1;
 SELECT a.id INTO v_expense_id FROM public.accounts a WHERE a.business_id=v_stage.business_id AND a.code='5000' AND a.is_active LIMIT 1;
 SELECT a.id INTO v_inventory_id FROM public.accounts a WHERE a.business_id=v_stage.business_id AND a.code='1200' AND a.is_active LIMIT 1;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_payload->'products_services') x(value) WHERE lower(coalesce(value->>'item_type','product'))='product' AND coalesce(nullif(value->>'opening_stock','')::numeric,0)>0)
   AND NOT EXISTS(SELECT 1 FROM public.inventory_locations il WHERE il.business_id=v_stage.business_id AND il.is_active) THEN
   INSERT INTO public.inventory_locations(business_id,name,code,address,is_default,is_active) VALUES(v_stage.business_id,'Main Store','MAIN','{}'::jsonb,true,true);
 END IF;

 FOR v_row IN SELECT value FROM jsonb_array_elements(v_payload->'products_services') x(value) LOOP
   v_item_name:=btrim(v_row->>'name');
   v_item_type:=lower(coalesce(nullif(btrim(v_row->>'item_type'),''),'product'));
   v_account_code:=nullif(btrim(v_row->>'sku'),'');
   v_category_name:=btrim(v_row->>'category');
   v_subcategory_name:=nullif(btrim(v_row->>'subcategory'),'');
   v_tax_rate:=coalesce(nullif(btrim(v_row->>'tax_rate'),'')::numeric,0);
   SELECT tr.id INTO v_tax_id FROM public.tax_rates tr
   WHERE tr.business_id=v_stage.business_id AND tr.is_active AND tr.tax_kind='sales' AND round(tr.rate::numeric,2)=round(v_tax_rate,2)
   ORDER BY tr.id LIMIT 1;
   IF v_tax_id IS NULL THEN
     INSERT INTO public.tax_rates(business_id,name,rate,tax_kind,is_active,metadata)
     VALUES(v_stage.business_id,'GST '||trim(to_char(v_tax_rate,'FM999990.##'))||'%',v_tax_rate,'sales',true,jsonb_build_object('source','business_setup_import'))
     RETURNING id INTO v_tax_id;
   END IF;
   v_category_id:=NULL;
   SELECT pc.id INTO v_category_id FROM public.product_categories pc
   WHERE pc.business_id=v_stage.business_id AND lower(btrim(pc.name))=lower(v_category_name) ORDER BY pc.is_active DESC,pc.id LIMIT 1 FOR UPDATE;
   IF v_category_id IS NULL THEN
     INSERT INTO public.product_categories(business_id,name,default_hsn_sac,default_tax_rate_id,is_active)
     VALUES(v_stage.business_id,v_category_name,nullif(btrim(v_row->>'hsn_sac'),''),v_tax_id,true)
     RETURNING id INTO v_category_id;
     v_categories_created:=v_categories_created+1;
   END IF;
   v_subcategory_id:=NULL;
   IF v_subcategory_name IS NOT NULL THEN
     SELECT ps.id INTO v_subcategory_id FROM public.product_subcategories ps
     WHERE ps.business_id=v_stage.business_id AND ps.category_id=v_category_id AND lower(btrim(ps.name))=lower(v_subcategory_name)
     ORDER BY ps.is_active DESC,ps.id LIMIT 1 FOR UPDATE;
     IF v_subcategory_id IS NULL THEN
       INSERT INTO public.product_subcategories(business_id,category_id,name,is_active)
       VALUES(v_stage.business_id,v_category_id,v_subcategory_name,true) RETURNING id INTO v_subcategory_id;
       v_subcategories_created:=v_subcategories_created+1;
     END IF;
   END IF;
   v_item_id:=NULL; v_existing_item_type:=NULL;
   IF v_account_code IS NOT NULL THEN
     SELECT ps.id,ps.item_type INTO v_item_id,v_existing_item_type FROM public.products_services ps
     WHERE ps.business_id=v_stage.business_id AND lower(btrim(ps.sku))=lower(v_account_code)
     ORDER BY ps.id LIMIT 1 FOR UPDATE;
     IF v_item_id IS NOT NULL AND v_existing_item_type<>v_item_type THEN RAISE EXCEPTION 'SKU % belongs to a different item type',v_account_code; END IF;
   END IF;
   IF v_item_id IS NULL THEN
     SELECT ps.id,ps.item_type INTO v_item_id,v_existing_item_type FROM public.products_services ps
     WHERE ps.business_id=v_stage.business_id AND ps.item_type=v_item_type AND lower(btrim(ps.name))=lower(v_item_name)
     ORDER BY ps.id LIMIT 1 FOR UPDATE;
   END IF;
   IF v_item_id IS NULL THEN
     INSERT INTO public.products_services(
       business_id,name,sku,description,item_type,unit,hsn_sac,sales_price,purchase_price,income_account_id,expense_account_id,inventory_account_id,default_tax_rate_id,
       is_active,inventory_tracked,reorder_level,reorder_quantity,barcode,track_batches,track_serials,sell_enabled,purchase_enabled,opening_stock,opening_stock_cost,category_id,subcategory_id
     ) VALUES(
       v_stage.business_id,v_item_name,v_account_code,nullif(btrim(v_row->>'description'),''),v_item_type,
       coalesce(nullif(btrim(v_row->>'unit'),''),CASE WHEN v_item_type='service' THEN 'hrs' ELSE NULL END),
       nullif(btrim(v_row->>'hsn_sac'),''),coalesce(nullif(btrim(v_row->>'sales_price'),'')::numeric,0),coalesce(nullif(btrim(v_row->>'purchase_price'),'')::numeric,0),
       v_income_id,v_expense_id,CASE WHEN v_item_type='product' THEN v_inventory_id ELSE NULL END,v_tax_id,
       coalesce(nullif(btrim(v_row->>'is_active'),'')::boolean,true),v_item_type='product',
       coalesce(nullif(btrim(v_row->>'reorder_level'),'')::numeric,0),0,nullif(btrim(v_row->>'barcode'),''),false,false,
       coalesce(nullif(btrim(v_row->>'sell_enabled'),'')::boolean,true),coalesce(nullif(btrim(v_row->>'purchase_enabled'),'')::boolean,true),
       CASE WHEN v_item_type='product' THEN coalesce(nullif(btrim(v_row->>'opening_stock'),'')::numeric,0) ELSE 0 END,
       CASE WHEN v_item_type='product' THEN coalesce(nullif(btrim(v_row->>'opening_stock_cost'),'')::numeric,coalesce(nullif(btrim(v_row->>'opening_stock'),'')::numeric,0)*coalesce(nullif(btrim(v_row->>'purchase_price'),'')::numeric,0)) ELSE 0 END,
       v_category_id,v_subcategory_id
     ) RETURNING id INTO v_item_id;
     v_items_created:=v_items_created+1;
   ELSE
     -- Critically, no opening_stock/opening_stock_cost fields are changed for existing items.
     UPDATE public.products_services ps SET
       name=v_item_name,sku=coalesce(v_account_code,ps.sku),description=coalesce(nullif(btrim(v_row->>'description'),''),ps.description),
       unit=coalesce(nullif(btrim(v_row->>'unit'),''),CASE WHEN v_item_type='service' THEN 'hrs' ELSE ps.unit END),
       hsn_sac=coalesce(nullif(btrim(v_row->>'hsn_sac'),''),ps.hsn_sac),
       sales_price=coalesce(nullif(btrim(v_row->>'sales_price'),'')::numeric,ps.sales_price),
       purchase_price=coalesce(nullif(btrim(v_row->>'purchase_price'),'')::numeric,ps.purchase_price),
       default_tax_rate_id=v_tax_id,is_active=coalesce(nullif(btrim(v_row->>'is_active'),'')::boolean,ps.is_active),
       inventory_tracked=CASE WHEN v_item_type='service' THEN false ELSE ps.inventory_tracked END,
       sell_enabled=coalesce(nullif(btrim(v_row->>'sell_enabled'),'')::boolean,ps.sell_enabled),
       purchase_enabled=coalesce(nullif(btrim(v_row->>'purchase_enabled'),'')::boolean,ps.purchase_enabled),
       category_id=v_category_id,subcategory_id=v_subcategory_id,updated_at=now()
     WHERE ps.id=v_item_id AND ps.business_id=v_stage.business_id;
     v_items_updated:=v_items_updated+1;
   END IF;
 END LOOP;

 -- All opening balances are posted through one balanced journal. No invoices/bills/payments are imported.
 IF jsonb_array_length(v_opening_lines)>0 THEN
   SELECT coalesce(sum((x.value->>'debit')::numeric),0),coalesce(sum((x.value->>'credit')::numeric),0)
   INTO v_debits,v_credits FROM jsonb_array_elements(v_opening_lines) x(value);
   v_net:=round(v_debits-v_credits,2);
   SELECT a.id INTO v_equity_id FROM public.accounts a WHERE a.business_id=v_stage.business_id AND a.code='3000' AND a.is_active LIMIT 1;
   IF v_equity_id IS NULL THEN RAISE EXCEPTION 'Opening Balance Equity account 3000 is missing'; END IF;
   IF v_net>0 THEN
     v_opening_lines:=v_opening_lines||jsonb_build_array(jsonb_build_object('account_id',v_equity_id,'debit',0,'credit',v_net,'entity_type','account','entity_id',v_equity_id,'description','Opening Balance Equity'));
   ELSIF v_net<0 THEN
     v_opening_lines:=v_opening_lines||jsonb_build_array(jsonb_build_object('account_id',v_equity_id,'debit',abs(v_net),'credit',0,'entity_type','account','entity_id',v_equity_id,'description','Opening Balance Equity'));
   END IF;
   SELECT coalesce(max(je.entry_number),0)+1 INTO v_entry_no FROM public.journal_entries je WHERE je.business_id=v_stage.business_id;
   INSERT INTO public.journal_entries(business_id,entry_number,entry_date,description,source_type,source_id,status,created_by,currency_code,is_system_generated)
   VALUES(v_stage.business_id,v_entry_no,v_opening_date,'Business setup opening balances','business_setup_opening_balance',v_stage.id,'draft',auth.uid(),v_currency,true)
   RETURNING id INTO v_entry_id;
   INSERT INTO public.journal_lines(journal_entry_id,account_id,description,debit,credit,currency_code,exchange_rate,entity_type,entity_id,transaction_currency_code,transaction_amount,base_currency_code,base_amount)
   SELECT v_entry_id,(x.value->>'account_id')::uuid,x.value->>'description',coalesce((x.value->>'debit')::numeric,0),coalesce((x.value->>'credit')::numeric,0),
     v_currency,1,x.value->>'entity_type',nullif(x.value->>'entity_id','')::uuid,v_currency,
     greatest(coalesce((x.value->>'debit')::numeric,0),coalesce((x.value->>'credit')::numeric,0)),v_currency,
     greatest(coalesce((x.value->>'debit')::numeric,0),coalesce((x.value->>'credit')::numeric,0))
   FROM jsonb_array_elements(v_opening_lines) x(value);
   PERFORM public.validate_journal_entry_balance(v_entry_id);
   UPDATE public.journal_entries SET status='posted',posted_at=now(),posted_by=auth.uid() WHERE id=v_entry_id AND status='draft';
   IF NOT FOUND THEN RAISE EXCEPTION 'Opening balance journal could not be posted'; END IF;
   PERFORM public.validate_journal_entry_balance(v_entry_id);
 END IF;

 UPDATE public.business_setup_import_staging SET status='committed',committed_at=now(),
   validation=validation||jsonb_build_object('commit_summary',jsonb_build_object(
    'accounts_created',v_accounts_created,'bank_accounts_created',v_banks_created,'customers_created',v_customers_created,
    'vendors_created',v_vendors_created,'categories_created',v_categories_created,'subcategories_created',v_subcategories_created,
    'products_services_created',v_items_created,'products_services_updated',v_items_updated,'opening_balance_journal_id',v_entry_id
   ))
 WHERE id=v_stage.id;
 RETURN jsonb_build_object('status','committed','import_id',v_stage.id,'accounts_created',v_accounts_created,'bank_accounts_created',v_banks_created,
   'customers_created',v_customers_created,'vendors_created',v_vendors_created,'categories_created',v_categories_created,
   'subcategories_created',v_subcategories_created,'products_services_created',v_items_created,'products_services_updated',v_items_updated,
   'opening_balance_journal_id',v_entry_id);
END;
$function$
;
REVOKE ALL ON FUNCTION public.commit_business_setup_import(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.commit_business_setup_import(uuid) TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;