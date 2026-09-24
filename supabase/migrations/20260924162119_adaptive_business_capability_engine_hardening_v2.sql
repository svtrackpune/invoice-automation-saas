alter table public.businesses alter column feature_flags set default '{}'::jsonb;

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
    'has_physical_inventory', case when v ? 'has_physical_inventory' and jsonb_typeof(v->'has_physical_inventory')='boolean' then (v->>'has_physical_inventory')::boolean else coalesce(new.inventory_enabled,false) end,
    'track_batch_serial', case when jsonb_typeof(v->'track_batch_serial')='boolean' then (v->>'track_batch_serial')::boolean else false end,
    'has_manufacturing', case when jsonb_typeof(v->'has_manufacturing')='boolean' then (v->>'has_manufacturing')::boolean else false end,
    'has_services_projects', case when jsonb_typeof(v->'has_services_projects')='boolean' then (v->>'has_services_projects')::boolean else false end,
    'has_recurring_subscriptions', case when jsonb_typeof(v->'has_recurring_subscriptions')='boolean' then (v->>'has_recurring_subscriptions')::boolean else false end,
    'is_b2b', case when jsonb_typeof(v->'is_b2b')='boolean' then (v->>'is_b2b')::boolean else coalesce(new.sales_channels ? 'b2b',false) end,
    'is_b2c_retail', case when jsonb_typeof(v->'is_b2c_retail')='boolean' then (v->>'is_b2c_retail')::boolean else false end,
    'requires_approval_workflows', case when jsonb_typeof(v->'requires_approval_workflows')='boolean' then (v->>'requires_approval_workflows')::boolean else false end,
    'is_tax_registered', case when jsonb_typeof(v->'is_tax_registered')='boolean' then (v->>'is_tax_registered')::boolean else coalesce((new.tax_settings->>'enabled')::boolean,false) end,
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

create or replace function public.seed_business_feature_flags_after_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.seed_business_defaults(new.id);
  return new;
end;
$$;

drop trigger if exists business_feature_flags_seed on public.businesses;
create trigger business_feature_flags_seed
after update of feature_flags on public.businesses
for each row
when (old.feature_flags is distinct from new.feature_flags)
execute function public.seed_business_feature_flags_after_update();

update public.businesses set feature_flags = feature_flags;
