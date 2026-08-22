create or replace function public.get_or_create_cash_customer(p_business_id uuid)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare v_id uuid;
begin
 select id into v_id from public.customers where business_id=p_business_id and display_name='Cash Customer' and is_active=true order by created_at limit 1;
 if v_id is null then
   insert into public.customers(business_id,display_name,legal_name,email,phone,tax_id,tax_type,billing_address,shipping_address,credit_limit,payment_terms_days,notes,metadata,is_active,payment_reminders_enabled,reminder_days_before_due,default_discount_type,default_discount_value,relationship_type,product_reminder_after_days,service_recurring,service_recurring_interval,service_auto_invoice_days_before,service_reminder_after_days,notify_customer,notify_owner,product_reminder_after_unit,service_reminder_after_unit)
   values(p_business_id,'Cash Customer','Cash Customer',null,null,null,'N/A','{}'::jsonb,'{}'::jsonb,0,0,'System walk-in customer used by Cash Bill.','{"system":"cash_bill"}'::jsonb,true,false,0,'none',0,'both',0,false,'monthly',0,0,false,false,'days','days')
   returning id into v_id;
 end if;
 return v_id;
end; $$;