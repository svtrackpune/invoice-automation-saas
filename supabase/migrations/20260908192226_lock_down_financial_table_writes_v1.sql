create or replace function public.set_invoice_template(p_invoice_id uuid,p_template_id uuid default null)
returns public.invoices
language plpgsql
security definer
set search_path='public','mm_private'
as $$
declare v_invoice public.invoices%rowtype;
begin
  select * into v_invoice from public.invoices where id=p_invoice_id for update;
  if not found then raise exception 'Invoice not found'; end if;
  if not (mm_private.has_business_permission(v_invoice.business_id,'sales.edit') or mm_private.has_business_permission(v_invoice.business_id,'sales.create')) then
    raise exception 'Access denied';
  end if;
  if p_template_id is not null and not exists (
    select 1 from public.document_templates dt
    where dt.id=p_template_id and dt.document_type='invoice' and dt.is_active
  ) then
    raise exception 'Invoice template not found or inactive';
  end if;
  update public.invoices set template_id=p_template_id,updated_at=now() where id=p_invoice_id returning * into v_invoice;
  return v_invoice;
end;
$$;

revoke execute on function public.set_invoice_template(uuid,uuid) from public,anon;
grant execute on function public.set_invoice_template(uuid,uuid) to authenticated;

revoke all on public.quotations from authenticated;
grant select on public.quotations to authenticated;
revoke all on public.invoices from authenticated;
grant select on public.invoices to authenticated;
revoke all on public.payments from authenticated;
grant select on public.payments to authenticated;
revoke all on public.receipts from authenticated;
grant select on public.receipts to authenticated;
revoke all on public.payment_links from authenticated;
grant select on public.payment_links to authenticated;

drop policy if exists "quotations_member_all" on public.quotations;
create policy "quotations_member_select"
on public.quotations
for select to authenticated
using (exists (select 1 from public.businesses b where b.id=quotations.business_id and mm_private.is_org_member(b.organization_id)));

drop policy if exists "invoices_member_all" on public.invoices;
create policy "invoices_member_select"
on public.invoices
for select to authenticated
using (mm_private.is_org_member(mm_private.business_org(business_id)));

drop policy if exists "payments_member_all" on public.payments;
create policy "payments_member_select"
on public.payments
for select to authenticated
using (mm_private.is_org_member(mm_private.business_org(business_id)));

drop policy if exists "receipts_member_all" on public.receipts;
create policy "receipts_member_select"
on public.receipts
for select to authenticated
using (exists (select 1 from public.businesses b where b.id=receipts.business_id and mm_private.is_org_member(b.organization_id)));

drop policy if exists "payment_links_business_access" on public.payment_links;
create policy "payment_links_member_select"
on public.payment_links
for select to authenticated
using (mm_private.has_business_permission(business_id,'payments.receive'));
