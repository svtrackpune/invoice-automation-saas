-- Per-invoice payment display selection.
-- none = no payment block; bank = selected business bank account; online = backend gateway + Pay Now + QR.

alter table public.invoices add column if not exists payment_display_mode text not null default 'none', add column if not exists payment_bank_account_id uuid null;
alter table public.invoices drop constraint if exists invoices_payment_display_mode_check;
alter table public.invoices add constraint invoices_payment_display_mode_check check (payment_display_mode in ('none','bank','online'));
alter table public.invoices drop constraint if exists invoices_payment_bank_account_fk;
alter table public.invoices add constraint invoices_payment_bank_account_fk foreign key (payment_bank_account_id) references public.bank_accounts(id) on delete set null;
create index if not exists invoices_payment_bank_account_idx on public.invoices(payment_bank_account_id) where payment_bank_account_id is not null;

create or replace function public.set_invoice_payment_display(p_invoice_id uuid,p_payment_display_mode text,p_bank_account_id uuid default null)
returns public.invoices language plpgsql security definer set search_path = public, mm_private as $$
declare v_invoice public.invoices%rowtype;
begin
  select * into v_invoice from public.invoices where id=p_invoice_id for update;
  if not found then raise exception 'Invoice not found'; end if;
  if not (mm_private.has_business_permission(v_invoice.business_id,'sales.edit') or mm_private.has_business_permission(v_invoice.business_id,'sales.create')) then raise exception 'Access denied'; end if;
  if p_payment_display_mode not in ('none','bank','online') then raise exception 'Invalid payment display mode'; end if;
  if p_payment_display_mode='bank' then
    if p_bank_account_id is null then raise exception 'A bank account is required when bank details are selected'; end if;
    if not exists(select 1 from public.bank_accounts ba where ba.id=p_bank_account_id and ba.business_id=v_invoice.business_id and ba.is_active) then raise exception 'Selected bank account does not belong to this business or is inactive'; end if;
  end if;
  update public.invoices set payment_display_mode=p_payment_display_mode,payment_bank_account_id=case when p_payment_display_mode='bank' then p_bank_account_id else null end,updated_at=now() where id=p_invoice_id returning * into v_invoice;
  return v_invoice;
end;
$$;
revoke execute on function public.set_invoice_payment_display(uuid,text,uuid) from public,anon;
grant execute on function public.set_invoice_payment_display(uuid,text,uuid) to authenticated;
