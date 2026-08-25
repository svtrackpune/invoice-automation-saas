create or replace function public.prepare_document_render(p_document_type text, p_document_id uuid, p_template_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path to public, mm_private
as $function$
declare
  bid uuid;
  tid uuid;
  tv integer;
  payload jsonb;
  job uuid;
  bank_id uuid;
  bank_payload jsonb;
  show_bank boolean := false;
begin
  if p_document_type not in ('invoice','quotation','receipt','credit_note','debit_note') then
    raise exception 'Unsupported document type';
  end if;

  if p_document_type='invoice' then
    select business_id into bid from public.invoices where id=p_document_id;
  elsif p_document_type='quotation' then
    select business_id into bid from public.quotations where id=p_document_id;
  elsif p_document_type='receipt' then
    select business_id into bid from public.receipts where id=p_document_id;
  elsif p_document_type='credit_note' then
    select business_id into bid from public.credit_notes where id=p_document_id;
  else
    select business_id into bid from public.debit_notes where id=p_document_id;
  end if;

  if bid is null then raise exception 'Document not found'; end if;
  if not mm_private.is_org_member((select organization_id from public.businesses where id=bid)) then
    raise exception 'Access denied';
  end if;

  if p_template_id is null then
    select dp.template_id into tid
    from public.business_document_preferences dp
    where dp.business_id=bid and dp.document_type=p_document_type;
  end if;
  tid:=coalesce(tid,p_template_id);
  if tid is null then
    select id into tid
    from public.document_templates
    where document_type=p_document_type and is_active
    order by is_system desc,version desc
    limit 1;
  end if;
  if tid is not null then
    select version into tv from public.document_templates where id=tid and is_active;
  end if;

  select coalesce(dp.show_bank_details, false)
    into show_bank
  from public.business_document_preferences dp
  where dp.business_id=bid and dp.document_type=p_document_type;

  if p_document_type='invoice' then
    select i.payment_bank_account_id into bank_id
    from public.invoices i
    where i.id=p_document_id and i.business_id=bid;
  end if;

  if bank_id is null then
    select b.bank_account_id into bank_id
    from public.business_document_bank_accounts b
    join public.bank_accounts ba on ba.id=b.bank_account_id
    where b.business_id=bid
      and b.document_type=p_document_type
      and ba.business_id=bid
      and ba.is_active=true
    order by b.display_order asc, b.created_at asc
    limit 1;
  end if;

  if bank_id is null then
    select bs.default_bank_account_id into bank_id
    from public.business_settings bs
    join public.bank_accounts ba on ba.id=bs.default_bank_account_id
    where bs.business_id=bid
      and ba.business_id=bid
      and ba.is_active=true;
  end if;

  if bank_id is not null then
    select jsonb_build_object(
      'id', ba.id,
      'name', ba.name,
      'institution_name', ba.institution_name,
      'account_last4', ba.account_last4,
      'account_holder_name', ba.account_holder_name,
      'ifsc_code', ba.ifsc_code,
      'branch_name', ba.branch_name,
      'account_type', ba.account_type,
      'currency_code', ba.currency_code,
      'metadata', coalesce(ba.metadata, '{}'::jsonb)
    ) into bank_payload
    from public.bank_accounts ba
    where ba.id=bank_id and ba.business_id=bid and ba.is_active=true;
  end if;

  if p_document_type='invoice' then
    select to_jsonb(i)||jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(ii) order by ii.sort_order) from public.invoice_items ii where ii.invoice_id=i.id),'[]'::jsonb),'customer',to_jsonb(c),'business',to_jsonb(b)) into payload
    from public.invoices i join public.customers c on c.id=i.customer_id join public.businesses b on b.id=i.business_id where i.id=p_document_id;
  elsif p_document_type='quotation' then
    select to_jsonb(q)||jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(qi) order by qi.sort_order) from public.quotation_items qi where qi.quotation_id=q.id),'[]'::jsonb),'customer',to_jsonb(c),'business',to_jsonb(b)) into payload
    from public.quotations q join public.customers c on c.id=q.customer_id join public.businesses b on b.id=q.business_id where q.id=p_document_id;
  elsif p_document_type='receipt' then
    select to_jsonb(r)||jsonb_build_object('customer',to_jsonb(c),'business',to_jsonb(b),'payment',to_jsonb(p),'invoice',to_jsonb(i),'invoice_id',i.id,'invoice_number',i.invoice_number,'invoice_total',coalesce(i.total,0),'amount_received',coalesce(r.amount,0),'balance_due',greatest(coalesce(i.total,0)-coalesce(r.amount,0),0),'items',coalesce((select jsonb_agg(to_jsonb(ii) order by ii.sort_order) from public.invoice_items ii where ii.invoice_id=i.id),'[]'::jsonb)) into payload
    from public.receipts r join public.customers c on c.id=r.customer_id join public.businesses b on b.id=r.business_id left join public.payments p on p.id=r.payment_id left join public.invoices i on i.id=p.invoice_id where r.id=p_document_id;
  elsif p_document_type='credit_note' then
    select to_jsonb(n)||jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(ni) order by ni.sort_order) from public.credit_note_items ni where ni.credit_note_id=n.id),'[]'::jsonb),'customer',to_jsonb(c),'business',to_jsonb(b)) into payload
    from public.credit_notes n join public.customers c on c.id=n.customer_id join public.businesses b on b.id=n.business_id where n.id=p_document_id;
  else
    select to_jsonb(n)||jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(ni) order by ni.sort_order) from public.debit_note_items ni where ni.debit_note_id=n.id),'[]'::jsonb),'business',to_jsonb(b)) into payload
    from public.debit_notes n join public.businesses b on b.id=n.business_id where n.id=p_document_id;
  end if;

  payload := coalesce(payload,'{}'::jsonb) || jsonb_build_object(
    'document_context', jsonb_build_object('business_id', bid, 'document_type', p_document_type, 'show_bank_details', show_bank, 'selected_bank_account_id', bank_id),
    'bank_details', case when bank_payload is not null then bank_payload else null end
  );

  insert into public.document_render_jobs(business_id,document_type,document_id,template_id,template_version,payload,created_by)
  values(bid,p_document_type,p_document_id,tid,tv,coalesce(payload,'{}'::jsonb),auth.uid())
  on conflict(document_type,document_id,template_id,template_version)
  do update set payload=excluded.payload,status='ready',error_message=null,created_at=now()
  returning id into job;
  return job;
end;
$function$;