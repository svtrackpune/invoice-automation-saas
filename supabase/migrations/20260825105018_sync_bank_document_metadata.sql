create or replace function public.sync_bank_document_metadata()
returns trigger
language plpgsql
as $$
begin
  new.metadata := coalesce(new.metadata, '{}'::jsonb)
    || jsonb_strip_nulls(jsonb_build_object(
      'account_holder_name', new.account_holder_name,
      'ifsc_code', new.ifsc_code,
      'branch_name', new.branch_name,
      'account_type', new.account_type
    ));
  return new;
end;
$$;

drop trigger if exists trg_sync_bank_document_metadata on public.bank_accounts;
create trigger trg_sync_bank_document_metadata
before insert or update of account_holder_name, ifsc_code, branch_name, account_type, metadata
on public.bank_accounts
for each row execute function public.sync_bank_document_metadata();

update public.bank_accounts
set metadata = coalesce(metadata, '{}'::jsonb)
  || jsonb_strip_nulls(jsonb_build_object(
    'account_holder_name', account_holder_name,
    'ifsc_code', ifsc_code,
    'branch_name', branch_name,
    'account_type', account_type
  ))
where account_holder_name is not null
   or ifsc_code is not null
   or branch_name is not null
   or account_type is not null;