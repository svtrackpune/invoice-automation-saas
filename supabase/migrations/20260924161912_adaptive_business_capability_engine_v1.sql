alter table public.businesses
  add column if not exists feature_flags jsonb not null default jsonb_build_object(
    'version', 1,
    'has_physical_inventory', false,
    'track_batch_serial', false,
    'has_manufacturing', false,
    'has_services_projects', false,
    'has_recurring_subscriptions', false,
    'is_b2b', false,
    'is_b2c_retail', false,
    'requires_approval_workflows', false,
    'is_tax_registered', false,
    'multi_currency', false,
    'has_credit_terms', false,
    'has_multi_location', false,
    'industry_preset', 'custom'
  );

create index if not exists idx_businesses_feature_flags_gin
  on public.businesses using gin (feature_flags);

update public.businesses b
set feature_flags = jsonb_build_object(
  'version', 1,
  'has_physical_inventory', coalesce(b.inventory_enabled, false),
  'track_batch_serial', false,
  'has_manufacturing', false,
  'has_services_projects', false,
  'has_recurring_subscriptions', false,
  'is_b2b', coalesce((b.sales_channels ? 'b2b'), false),
  'is_b2c_retail', false,
  'requires_approval_workflows', false,
  'is_tax_registered', coalesce((b.tax_settings->>'enabled')::boolean, false),
  'multi_currency', false,
  'has_credit_terms', false,
  'has_multi_location', false,
  'industry_preset', 'custom'
);

create or replace function public.normalize_business_feature_flags()
returns trigger
language plpgsql
set search_path = public
as $$
declare v jsonb := coalesce(new.feature_flags, '{}'::jsonb);
begin
  if jsonb_typeof(v) <> 'object' then raise exception 'feature_flags must be a JSON object'; end if;
  new.feature_flags := jsonb_build_object(
    'version', 1,
    'has_physical_inventory', case when jsonb_typeof(v->'has_physical_inventory')='boolean' then (v->>'has_physical_inventory')::boolean else false end,
    'track_batch_serial', case when jsonb_typeof(v->'track_batch_serial')='boolean' then (v->>'track_batch_serial')::boolean else false end,
    'has_manufacturing', case when jsonb_typeof(v->'has_manufacturing')='boolean' then (v->>'has_manufacturing')::boolean else false end,
    'has_services_projects', case when jsonb_typeof(v->'has_services_projects')='boolean' then (v->>'has_services_projects')::boolean else false end,
    'has_recurring_subscriptions', case when jsonb_typeof(v->'has_recurring_subscriptions')='boolean' then (v->>'has_recurring_subscriptions')::boolean else false end,
    'is_b2b', case when jsonb_typeof(v->'is_b2b')='boolean' then (v->>'is_b2b')::boolean else false end,
    'is_b2c_retail', case when jsonb_typeof(v->'is_b2c_retail')='boolean' then (v->>'is_b2c_retail')::boolean else false end,
    'requires_approval_workflows', case when jsonb_typeof(v->'requires_approval_workflows')='boolean' then (v->>'requires_approval_workflows')::boolean else false end,
    'is_tax_registered', case when jsonb_typeof(v->'is_tax_registered')='boolean' then (v->>'is_tax_registered')::boolean else false end,
    'multi_currency', case when jsonb_typeof(v->'multi_currency')='boolean' then (v->>'multi_currency')::boolean else false end,
    'has_credit_terms', case when jsonb_typeof(v->'has_credit_terms')='boolean' then (v->>'has_credit_terms')::boolean else false end,
    'has_multi_location', case when jsonb_typeof(v->'has_multi_location')='boolean' then (v->>'has_multi_location')::boolean else false end,
    'industry_preset', case when jsonb_typeof(v->'industry_preset')='string' then coalesce(nullif(trim(v->>'industry_preset'),''),'custom') else 'custom' end
  );
  if (new.feature_flags->>'track_batch_serial')::boolean then
    new.feature_flags = jsonb_set(new.feature_flags, '{has_physical_inventory}', 'true'::jsonb, true);
  end if;
  return new;
end;
$$;

drop trigger if exists business_feature_flags_normalize on public.businesses;
create trigger business_feature_flags_normalize
before insert or update of feature_flags on public.businesses
for each row execute function public.normalize_business_feature_flags();

create or replace function public.seed_business_defaults(p_business_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare f jsonb; n integer;
begin
  select feature_flags into f from public.businesses where id = p_business_id;
  if f is null then raise exception 'Business not found for feature default seeding'; end if;

  insert into public.accounts(business_id,code,name,account_type,normal_balance,is_system,is_active,description)
  values
    (p_business_id,'1000','Cash','asset','debit',true,true,'Cash on hand'),
    (p_business_id,'1010','Bank','asset','debit',true,true,'Business bank accounts'),
    (p_business_id,'1100','Accounts Receivable','asset','debit',true,true,'Customer receivables'),
    (p_business_id,'2000','Accounts Payable','liability','credit',true,true,'Vendor payables'),
    (p_business_id,'3000','Owner Equity','equity','credit',true,true,'Owner capital and equity'),
    (p_business_id,'3100','Retained Earnings','equity','credit',true,true,'Retained earnings'),
    (p_business_id,'4000','Sales Revenue','income','credit',true,true,'Core sales income'),
    (p_business_id,'4100','Other Income','income','credit',true,true,'Other operating income'),
    (p_business_id,'6000','Operating Expenses','expense','debit',true,true,'General operating expenses'),
    (p_business_id,'6200','Bank & Payment Fees','expense','debit',true,true,'Bank and payment processing fees')
  on conflict (business_id,code) do nothing;

  if coalesce((f->>'has_physical_inventory')::boolean,false) then
    insert into public.accounts(business_id,code,name,account_type,normal_balance,is_system,is_active,description)
    values (p_business_id,'1200','Inventory','asset','debit',true,true,'Inventory asset'),
           (p_business_id,'5000','Cost of Goods Sold','expense','debit',true,true,'Cost of inventory sold')
    on conflict (business_id,code) do nothing;
  end if;

  if coalesce((f->>'is_tax_registered')::boolean,false) then
    insert into public.accounts(business_id,code,name,account_type,normal_balance,is_system,is_active,description)
    values (p_business_id,'1300','Input Tax Credit','asset','debit',true,true,'Recoverable input GST/VAT'),
           (p_business_id,'2100','Tax Payable','liability','credit',true,true,'Output GST/VAT payable')
    on conflict (business_id,code) do nothing;
  end if;

  if coalesce((f->>'has_manufacturing')::boolean,false) then
    insert into public.accounts(business_id,code,name,account_type,normal_balance,is_system,is_active,description)
    values
      (p_business_id,'1210','Production Work in Progress','asset','debit',true,true,'Manufacturing work in progress'),
      (p_business_id,'1220','Finished Goods','asset','debit',true,true,'Manufactured finished goods'),
      (p_business_id,'1230','Raw Materials','asset','debit',true,true,'Raw material inventory'),
      (p_business_id,'5010','Production Overheads','expense','debit',true,true,'Manufacturing production overheads')
    on conflict (business_id,code) do nothing;
  end if;

  if coalesce((f->>'has_services_projects')::boolean,false) then
    insert into public.accounts(business_id,code,name,account_type,normal_balance,is_system,is_active,description)
    values
      (p_business_id,'1250','Project Work in Progress','asset','debit',true,true,'Billable project work in progress'),
      (p_business_id,'4010','Project & Service Revenue','income','credit',true,true,'Project and professional service revenue')
    on conflict (business_id,code) do nothing;
  end if;

  if coalesce((f->>'has_recurring_subscriptions')::boolean,false) then
    insert into public.accounts(business_id,code,name,account_type,normal_balance,is_system,is_active,description)
    values
      (p_business_id,'2200','Deferred Revenue','liability','credit',true,true,'Revenue received before service delivery'),
      (p_business_id,'4020','Subscription Revenue','income','credit',true,true,'Recurring subscription revenue')
    on conflict (business_id,code) do nothing;
  end if;

  if coalesce((f->>'multi_currency')::boolean,false) then
    insert into public.accounts(business_id,code,name,account_type,normal_balance,is_system,is_active,description)
    values
      (p_business_id,'4050','Realized FX Gain','income','credit',true,true,'Realized foreign exchange gains'),
      (p_business_id,'4051','Unrealized FX Gain','income','credit',true,true,'Unrealized foreign exchange gains'),
      (p_business_id,'6050','Realized FX Loss','expense','debit',true,true,'Realized foreign exchange losses'),
      (p_business_id,'6051','Unrealized FX Loss','expense','debit',true,true,'Unrealized foreign exchange losses')
    on conflict (business_id,code) do nothing;
  end if;

  if coalesce((f->>'has_multi_location')::boolean,false) then
    insert into public.accounts(business_id,code,name,account_type,normal_balance,is_system,is_active,description)
    values
      (p_business_id,'1410','Inter-Branch Receivable','asset','debit',true,true,'Inter-branch receivable clearing'),
      (p_business_id,'2010','Inter-Branch Payable','liability','credit',true,true,'Inter-branch payable clearing')
    on conflict (business_id,code) do nothing;
  end if;

  insert into public.business_settings(
    business_id,invoice_prefix,bill_prefix,estimate_prefix,receipt_prefix,
    next_invoice_number,next_bill_number,next_estimate_number,next_receipt_number
  )
  values(p_business_id,'INV-','BILL-','EST-','RCT-',1,1,1,1)
  on conflict (business_id) do nothing;

  update public.businesses
  set numbering_settings = jsonb_build_object(
    'invoice_prefix','INV-','bill_prefix','BILL-','estimate_prefix','EST-','receipt_prefix','RCT-',
    'next_invoice_number',coalesce((numbering_settings->>'next_invoice_number')::bigint,1),
    'next_bill_number',coalesce((numbering_settings->>'next_bill_number')::bigint,1),
    'next_estimate_number',coalesce((numbering_settings->>'next_estimate_number')::bigint,1),
    'next_receipt_number',coalesce((numbering_settings->>'next_receipt_number')::bigint,1)
  )
  where id = p_business_id;

  select count(*) into n from public.accounts where business_id=p_business_id;
  return n;
end;
$$;

create or replace function public.initialize_business_defaults()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  insert into public.business_settings(business_id) values(new.id) on conflict do nothing;
  perform public.seed_business_defaults(new.id);
  perform public.initialize_document_preferences(new.id);
  return new;
end;
$$;

create or replace function public.create_business_for_current_user(
  p_business_name text,
  p_business_type business_type default 'sole_proprietorship',
  p_country_code character default 'IN',
  p_currency_code character default 'INR',
  p_tax_enabled boolean default true,
  p_tax_region text default 'IN-MH',
  p_tax_mode text default null,
  p_notification_email boolean default true,
  p_notification_whatsapp boolean default true,
  p_notification_sms boolean default false,
  p_category_id uuid default null,
  p_subcategory_id uuid default null,
  p_selling_model text default null,
  p_sales_channels jsonb default '[]'::jsonb,
  p_team_size text default null,
  p_tax_state text default null,
  p_gstin text default null,
  p_feature_flags jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_business uuid;
begin
  v_business := public.create_business_for_current_user(
    p_business_name,p_business_type,p_country_code,p_currency_code,p_tax_enabled,p_tax_region,p_tax_mode,
    p_notification_email,p_notification_whatsapp,p_notification_sms,p_category_id,p_subcategory_id,p_selling_model,
    p_sales_channels,p_team_size,p_tax_state,p_gstin
  );

  update public.businesses set feature_flags=coalesce(p_feature_flags,'{}'::jsonb) where id=v_business;
  perform public.seed_business_defaults(v_business);
  return v_business;
end;
$$;

revoke execute on function public.create_business_for_current_user(
  text,business_type,character,character,boolean,text,text,boolean,boolean,boolean,uuid,uuid,text,jsonb,text,text,text,jsonb
) from public, anon;

grant execute on function public.create_business_for_current_user(
  text,business_type,character,character,boolean,text,text,boolean,boolean,boolean,uuid,uuid,text,jsonb,text,text,text,jsonb
) to authenticated;

grant execute on function public.seed_business_defaults(uuid) to service_role;
