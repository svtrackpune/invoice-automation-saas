create or replace function public.enforce_master_contact_email()
returns trigger
language plpgsql
as $function$
begin
  if nullif(btrim(new.email),'') is null then
    if tg_table_name='customers' then
      new.email := null;
      return new;
    end if;
    raise exception 'Vendor email is required' using errcode='23514';
  end if;

  if btrim(new.email) !~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+([.][A-Za-z0-9-]+)+$' then
    raise exception '% email address is invalid', case when tg_table_name='customers' then 'Customer' else 'Vendor' end using errcode='23514';
  end if;

  new.email := lower(btrim(new.email));
  return new;
end;
$function$;
