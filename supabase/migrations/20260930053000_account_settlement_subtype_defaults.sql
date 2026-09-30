-- Keep the Cash/Bank settlement classification intact for accounts created after this release.
create or replace function public.set_account_settlement_subtype()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  if new.code='1000' and new.account_subtype is null then
    new.account_subtype:='cash';
  elsif new.code='1010' and new.account_subtype is null then
    new.account_subtype:='bank';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_account_settlement_subtype_defaults on public.accounts;
create trigger trg_account_settlement_subtype_defaults
before insert or update of code, account_subtype on public.accounts
for each row execute function public.set_account_settlement_subtype();
