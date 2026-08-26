-- Invoice contact/tax hardening
-- Keep customer website available to document rendering and seed the current
-- standard GST sales-rate choices for regular GST businesses.

alter table public.customers
  add column if not exists website text;

insert into public.tax_rates (business_id,name,rate,tax_kind,component_code,is_compound,is_active,metadata)
select b.id, v.name, v.rate, 'sales', 'GST', false, true,
       jsonb_build_object('source','system_default','tax_group','GST')
from public.businesses b
join public.business_tax_profiles p on p.business_id = b.id
cross join (values
  ('GST 0%', numeric '0'),
  ('GST 5%', numeric '5'),
  ('GST 12%', numeric '12'),
  ('GST 18%', numeric '18'),
  ('GST 28%', numeric '28'),
  ('GST 40%', numeric '40')
) as v(name,rate)
where p.tax_regime = 'GST'
  and p.gst_registration_type = 'REGULAR'
  and not exists (
    select 1 from public.tax_rates t
    where t.business_id = b.id
      and t.rate = v.rate
      and t.tax_kind = 'sales'
      and t.is_active
  );
