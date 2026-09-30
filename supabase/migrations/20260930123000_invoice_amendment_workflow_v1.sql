-- Controlled invoice amendment workflow.
-- Allows non-void invoices, including paid Cash & Carry bills, to be corrected without changing the document number.
-- Posted invoices are reversed in accounting/inventory, amended, then reposted in one transaction.

create or replace function public.amend_invoice(
  p_invoice_id uuid,
  p_customer_id uuid,
  p_invoice_date date,
  p_due_date date,
  p_items jsonb,
  p_invoice_discount_type text default null,
  p_invoice_discount_value numeric default 0,
  p_notes text default null,
  p_terms text default null,
  p_template_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, mm_private
as $$
declare
  inv public.invoices%rowtype;
  v_total numeric;
  v_amount_paid numeric;
  v_old_customer uuid;
begin
  select * into inv from public.invoices where id=p_invoice_id for update;
  if inv.id is null then raise exception 'Invoice not found'; end if;
  if inv.status='void' then raise exception 'Void invoices cannot be edited'; end if;
  if not (mm_private.has_business_permission(inv.business_id,'sales.edit') or mm_private.has_business_permission(inv.business_id,'sales.create')) then
    raise exception 'Access denied';
  end if;
  if not exists(select 1 from public.customers where id=p_customer_id and business_id=inv.business_id and is_active) then
    raise exception 'Customer not found or inactive';
  end if;
  if jsonb_typeof(coalesce(p_items,'[]'::jsonb))<>'array' or jsonb_array_length(coalesce(p_items,'[]'::jsonb))=0 then
    raise exception 'At least one invoice item is required';
  end if;
  if p_template_id is not null and not exists(select 1 from public.document_templates where id=p_template_id and document_type='invoice' and is_active) then
    raise exception 'Invalid or inactive invoice template';
  end if;

  v_old_customer:=inv.customer_id;
  v_amount_paid:=coalesce(inv.amount_paid,0);
  if v_amount_paid>0 and p_customer_id<>v_old_customer then
    raise exception 'Customer cannot be changed after a payment has been recorded. Correct the existing customer instead.';
  end if;

  if inv.status='draft' and inv.journal_entry_id is null then
    perform public.update_invoice_draft(p_invoice_id,p_customer_id,p_invoice_date,p_due_date,p_items,p_invoice_discount_type,p_invoice_discount_value,p_notes,p_terms,p_template_id);
    select total,amount_paid into v_total,v_amount_paid from public.invoices where id=p_invoice_id for update;
    if v_total < v_amount_paid then raise exception 'Corrected invoice total cannot be lower than the amount already received (%).', v_amount_paid; end if;
    return p_invoice_id;
  end if;

  if not mm_private.has_business_permission(inv.business_id,'accounting.post') then
    raise exception 'Accounting posting permission is required to amend a posted invoice';
  end if;

  perform public.void_invoice(p_invoice_id,'Invoice amended: controlled correction');

  update public.invoices set status='draft'::invoice_status,journal_entry_id=null,updated_at=now() where id=p_invoice_id;

  perform public.update_invoice_draft(p_invoice_id,p_customer_id,p_invoice_date,p_due_date,p_items,p_invoice_discount_type,p_invoice_discount_value,p_notes,p_terms,p_template_id);

  select total,amount_paid into v_total,v_amount_paid from public.invoices where id=p_invoice_id for update;
  if v_total < v_amount_paid then raise exception 'Corrected invoice total (%) cannot be lower than the amount already received (%).', v_total, v_amount_paid; end if;

  perform public.post_invoice(p_invoice_id,null);
  return p_invoice_id;
end;
$$;

revoke execute on function public.amend_invoice(uuid,uuid,date,date,jsonb,text,numeric,text,text,uuid) from public, anon;
grant execute on function public.amend_invoice(uuid,uuid,date,date,jsonb,text,numeric,text,text,uuid) to authenticated;
