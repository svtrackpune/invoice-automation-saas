create or replace function public.create_payment_bank_account(p_business_id uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid := gen_random_uuid();
  v_account text := nullif(btrim(coalesce(p_payload->>'account_number','')), '');
  v_ifsc text := upper(nullif(btrim(coalesce(p_payload->>'ifsc_code','')), ''));
  v_name text := nullif(btrim(coalesce(p_payload->>'name','')), '');
  v_institution text := nullif(btrim(coalesce(p_payload->>'institution_name','')), '');
  v_holder text := nullif(btrim(coalesce(p_payload->>'account_holder_name','')), '');
  v_branch text := nullif(btrim(coalesce(p_payload->>'branch_name','')), '');
  v_linked uuid := nullif(p_payload->>'linked_account_id','')::uuid;
begin
  if auth.uid() is null or not mm_private.has_business_permission(p_business_id,'settings.manage',auth.uid()) then raise exception 'permission denied' using errcode='42501'; end if;
  if v_name is null or v_account is null or v_ifsc is null or v_ifsc !~ '^[A-Z]{4}0[A-Z0-9]{6}$' then raise exception 'invalid bank account details' using errcode='22023'; end if;
  if v_linked is not null and not exists (select 1 from public.accounts where id=v_linked and business_id=p_business_id) then raise exception 'invalid ledger account' using errcode='23503'; end if;
  insert into public.bank_accounts (id,business_id,name,institution_name,account_number,account_last4,account_holder_name,ifsc_code,branch_name,linked_account_id,is_active)
  values (v_id,p_business_id,v_name,coalesce(v_institution,v_name),v_account,right(v_account,4),v_holder,v_ifsc,v_branch,v_linked,true);
  return (select jsonb_build_object('id',id,'name',name,'institution_name',institution_name,'account_last4',account_last4,'account_number',account_number,'ifsc_code',ifsc_code,'branch_name',branch_name,'account_holder_name',account_holder_name,'linked_account_id',linked_account_id,'is_active',is_active) from public.bank_accounts where id=v_id);
end $$;
revoke all on function public.create_payment_bank_account(uuid,jsonb) from public, anon;
grant execute on function public.create_payment_bank_account(uuid,jsonb) to authenticated;
