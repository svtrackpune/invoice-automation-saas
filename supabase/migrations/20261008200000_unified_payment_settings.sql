-- Unified merchant payment settings hub.
alter table public.document_payment_settings
  add column if not exists merchant_name text,
  add column if not exists default_bank_account_id uuid,
  add column if not exists enable_cash boolean not null default true,
  add column if not exists enable_upi boolean not null default true,
  add column if not exists enable_card boolean not null default true,
  add column if not exists enable_credit boolean not null default true,
  add column if not exists prefill_bill_amount boolean not null default true,
  add column if not exists qr_code_notes text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'document_payment_settings_default_bank_account_fk' and conrelid = 'public.document_payment_settings'::regclass) then
    alter table public.document_payment_settings add constraint document_payment_settings_default_bank_account_fk foreign key (default_bank_account_id) references public.bank_accounts (id) on delete set null;
  end if;
end $$;

create index if not exists document_payment_settings_default_bank_idx on public.document_payment_settings (business_id, default_bank_account_id);

create or replace function public.get_payment_settings(p_business_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_result jsonb;
begin
  if auth.uid() is null or not mm_private.has_business_permission(p_business_id, 'settings.manage', auth.uid()) then raise exception 'permission denied' using errcode='42501'; end if;
  select jsonb_build_object('business_id',b.id,'upi_id',coalesce(s.upi_id,''),'merchant_name',coalesce(s.merchant_name,b.legal_name,b.name,''),'default_bank_account_id',s.default_bank_account_id,'enable_cash',coalesce(s.enable_cash,true),'enable_upi',coalesce(s.enable_upi,true),'enable_card',coalesce(s.enable_card,true),'enable_credit',coalesce(s.enable_credit,true),'prefill_bill_amount',coalesce(s.prefill_bill_amount,true),'payment_qr_enabled',coalesce(s.payment_qr_enabled,true),'payment_instructions',coalesce(s.payment_instructions,''),'qr_code_notes',coalesce(s.qr_code_notes,'')) into v_result
  from public.businesses b left join public.document_payment_settings s on s.business_id=b.id where b.id=p_business_id;
  if v_result is null then raise exception 'business not found' using errcode='P0002'; end if;
  return v_result;
end $$;

create or replace function public.save_payment_settings(p_business_id uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_upi text := nullif(btrim(coalesce(p_payload->>'upi_id','')),'');
  v_bank uuid := nullif(p_payload->>'default_bank_account_id','')::uuid;
  v_merchant text := nullif(btrim(coalesce(p_payload->>'merchant_name','')),'');
  v_qr_enabled boolean := coalesce((p_payload->>'payment_qr_enabled')::boolean,true);
  v_cash boolean := coalesce((p_payload->>'enable_cash')::boolean,true);
  v_upi_enabled boolean := coalesce((p_payload->>'enable_upi')::boolean,true);
  v_card boolean := coalesce((p_payload->>'enable_card')::boolean,true);
  v_credit boolean := coalesce((p_payload->>'enable_credit')::boolean,true);
  v_prefill boolean := coalesce((p_payload->>'prefill_bill_amount')::boolean,true);
  v_instructions text := nullif(btrim(coalesce(p_payload->>'payment_instructions','')),'');
  v_notes text := nullif(btrim(coalesce(p_payload->>'qr_code_notes','')),'');
begin
  if auth.uid() is null or not mm_private.has_business_permission(p_business_id,'settings.manage',auth.uid()) then raise exception 'permission denied' using errcode='42501'; end if;
  if v_upi is not null and v_upi !~ '^[[:alnum:]_.-]+@[[:alnum:]_.-]+$' then raise exception 'invalid UPI VPA format' using errcode='22023'; end if;
  if v_bank is not null and not exists (select 1 from public.bank_accounts where id=v_bank and business_id=p_business_id and is_active=true) then raise exception 'invalid settlement bank account' using errcode='23503'; end if;
  insert into public.document_payment_settings (business_id,upi_id,merchant_name,default_bank_account_id,enable_cash,enable_upi,enable_card,enable_credit,prefill_bill_amount,payment_qr_enabled,payment_instructions,qr_code_notes,updated_at)
  values (p_business_id,v_upi,v_merchant,v_bank,v_cash,v_upi_enabled,v_card,v_credit,v_prefill,v_qr_enabled,v_instructions,v_notes,now())
  on conflict (business_id) do update set upi_id=excluded.upi_id,merchant_name=excluded.merchant_name,default_bank_account_id=excluded.default_bank_account_id,enable_cash=excluded.enable_cash,enable_upi=excluded.enable_upi,enable_card=excluded.enable_card,enable_credit=excluded.enable_credit,prefill_bill_amount=excluded.prefill_bill_amount,payment_qr_enabled=excluded.payment_qr_enabled,payment_instructions=excluded.payment_instructions,qr_code_notes=excluded.qr_code_notes,updated_at=now();
  return public.get_payment_settings(p_business_id);
end $$;

revoke all on function public.get_payment_settings(uuid) from public, anon;
revoke all on function public.save_payment_settings(uuid, jsonb) from public, anon;
grant execute on function public.get_payment_settings(uuid) to authenticated;
grant execute on function public.save_payment_settings(uuid, jsonb) to authenticated;
