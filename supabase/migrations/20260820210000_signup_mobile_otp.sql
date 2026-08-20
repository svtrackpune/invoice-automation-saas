-- Signup mobile / OTP recovery foundation.
-- The signup UI passes an E.164 phone in auth user metadata. Copy it into
-- auth.users.phone at creation so Supabase Auth can use its native SMS OTP flow.
-- Existing accounts are untouched; they can opt into phone recovery later.

create or replace function public.mm_sync_signup_phone()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if new.phone is null or btrim(new.phone) = '' then
    new.phone := nullif(btrim(new.raw_user_meta_data->>'phone'), '');
  end if;
  return new;
end;
$$;

drop trigger if exists mm_sync_signup_phone on auth.users;
create trigger mm_sync_signup_phone
before insert on auth.users
for each row execute function public.mm_sync_signup_phone();

comment on function public.mm_sync_signup_phone() is
  'Copies the E.164 mobile supplied during Moneymatters signup into auth.users.phone for native Supabase SMS OTP recovery.';
