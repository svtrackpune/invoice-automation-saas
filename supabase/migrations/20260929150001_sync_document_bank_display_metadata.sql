create or replace function public.sync_document_bank_display_metadata()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  display_branch text;
begin
  display_branch := case
    when new.branch_name is not null and new.account_type is not null then 'Branch: ' || new.branch_name || ' · Account Type: ' || new.account_type
    when new.branch_name is not null then 'Branch: ' || new.branch_name
    when new.account_type is not null then 'Account Type: ' || new.account_type
    else null
  end;

  new.metadata := coalesce(new.metadata, '{}'::jsonb)
    || jsonb_build_object(
      'account_number', new.account_number,
      'account_holder_name', new.account_holder_name,
      'account_type', new.account_type,
      'ifsc_code', new.ifsc_code,
      'branch_name', display_branch
    );

  return new;
end;
$$;

drop trigger if exists sync_document_bank_display_metadata on public.bank_accounts;
create trigger sync_document_bank_display_metadata
before insert or update of account_number, account_holder_name, account_type, ifsc_code, branch_name, metadata
on public.bank_accounts
for each row
execute function public.sync_document_bank_display_metadata();

update public.bank_accounts
set metadata = coalesce(metadata, '{}'::jsonb)
  || jsonb_build_object(
    'account_number', account_number,
    'account_holder_name', account_holder_name,
    'account_type', account_type,
    'ifsc_code', ifsc_code,
    'branch_name', case
      when branch_name is not null and account_type is not null then 'Branch: ' || branch_name || ' · Account Type: ' || account_type
      when branch_name is not null then 'Branch: ' || branch_name
      when account_type is not null then 'Account Type: ' || account_type
      else null
    end
  )
where is_active = true;
