-- Fix document render payload destruction when GST/tax registration is NULL.
-- jsonb_set is strict: passing SQL NULL as the replacement makes the whole JSONB value NULL.
-- Use an explicit JSON null so non-GST businesses still render complete invoices/quotations/receipts.

create or replace function public.prepare_document_render(p_document_type text, p_document_id uuid, p_template_id uuid default null::uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public','mm_private'
as $function$
declare
  bid uuid; tid uuid; tv integer; payload jsonb; job uuid;
  bank_id uuid; bank_payload jsonb; show_bank boolean := false;
  gstin text; logo_url text; document_template_id uuid;
begin
  if p_document_type not in ('invoice','quotation','receipt','credit_note','debit_note') then raise exception 'Unsupported document type'; end if;

  if p_document_type='invoice' then select business_id,template_id into bid,document_template_id from public.invoices where id=p_document_id;
  elsif p_document_type='quotation' then select business_id,template_id into bid,document_template_id from public.quotations where id=p_document_id;
  elsif p_document_type='receipt' then select business_id,template_id into bid,document_template_id from public.receipts where id=p_document_id;
  elsif p_document_type='credit_note' then select business_id into bid from public.credit_notes where id=p_document_id;
  else select business_id into bid from public.debit_notes where id=p_document_id; end if;

  if bid is null then raise exception 'Document not found'; end if;
  if not mm_private.is_org_member((select organization_id from public.businesses where id=bid)) then raise exception 'Access denied'; end if;
  set local row_security=off;

  if p_template_id is not null then select id into tid from public.document_templates where id=p_template_id and document_type=p_document_type and is_active; end if;
  if tid is null and document_template_id is not null then select id into tid from public.document_templates where id=document_template_id and document_type=p_document_type and is_active; end if;
  if tid is null then select dp.template_id into tid from public.business_document_preferences dp join public.document_templates dt on dt.id=dp.template_id and dt.document_type=p_document_type and dt.is_active where dp.business_id=bid and dp.document_type=p_document_type; end if;
  if tid is null then select id into tid from public.document_templates where document_type=p_document_type and is_active order by is_system desc,version desc limit 1; end if;
  if tid is not null then select version into tv from public.document_templates where id=tid and is_active; end if;

  select coalesce(dp.show_bank_details,false) into show_bank from public.business_document_preferences dp where dp.business_id=bid and dp.document_type=p_document_type;
  if p_document_type='invoice' then select payment_bank_account_id into bank_id from public.invoices where id=p_document_id and business_id=bid; end if;
  if bank_id is null then select b.bank_account_id into bank_id from public.business_document_bank_accounts b join public.bank_accounts ba on ba.id=b.bank_account_id where b.business_id=bid and b.document_type=p_document_type and ba.business_id=bid and ba.is_active order by b.display_order,b.created_at limit 1; end if;
  if bank_id is null then select bs.default_bank_account_id into bank_id from public.business_settings bs join public.bank_accounts ba on ba.id=bs.default_bank_account_id where bs.business_id=bid and ba.business_id=bid and ba.is_active; end if;
  show_bank:=show_bank or bank_id is not null;
  if bank_id is not null then select jsonb_build_object('id',ba.id,'name',ba.name,'institution_name',ba.institution_name,'account_last4',ba.account_last4,'account_holder_name',ba.account_holder_name,'ifsc_code',ba.ifsc_code,'branch_name',ba.branch_name,'account_type',ba.account_type,'currency_code',ba.currency_code,'metadata',coalesce(ba.metadata,'{}'::jsonb)) into bank_payload from public.bank_accounts ba where ba.id=bank_id and ba.business_id=bid and ba.is_active; end if;

  if p_document_type='invoice' then
    select coalesce((select to_jsonb(i) from public.invoices i where i.id=p_document_id),'{}'::jsonb)||jsonb_build_object('customer',coalesce((select to_jsonb(c) from public.customers c where c.id=(select customer_id from public.invoices where id=p_document_id)),'{}'::jsonb),'business',coalesce((select to_jsonb(b) from public.businesses b where b.id=bid),'{}'::jsonb),'items',coalesce((select jsonb_agg(to_jsonb(ii) order by ii.sort_order) from public.invoice_items ii where ii.invoice_id=p_document_id),'[]'::jsonb)) into payload;
  elsif p_document_type='quotation' then
    select coalesce((select to_jsonb(q) from public.quotations q where q.id=p_document_id),'{}'::jsonb)||jsonb_build_object('customer',coalesce((select to_jsonb(c) from public.customers c where c.id=(select customer_id from public.quotations where id=p_document_id)),'{}'::jsonb),'business',coalesce((select to_jsonb(b) from public.businesses b where b.id=bid),'{}'::jsonb),'items',coalesce((select jsonb_agg(to_jsonb(qi) order by qi.sort_order) from public.quotation_items qi where qi.quotation_id=p_document_id),'[]'::jsonb)) into payload;
  elsif p_document_type='receipt' then
    select coalesce((select to_jsonb(r) from public.receipts r where r.id=p_document_id),'{}'::jsonb)||jsonb_build_object('customer',coalesce((select to_jsonb(c) from public.customers c where c.id=(select customer_id from public.receipts where id=p_document_id)),'{}'::jsonb),'business',coalesce((select to_jsonb(b) from public.businesses b where b.id=bid),'{}'::jsonb),'payment',(select to_jsonb(p) from public.payments p where p.id=(select payment_id from public.receipts where id=p_document_id)),'invoice',(select to_jsonb(i) from public.invoices i where i.id=(select p.invoice_id from public.payments p where p.id=(select payment_id from public.receipts where id=p_document_id))),'items',coalesce((select jsonb_agg(to_jsonb(ii) order by ii.sort_order) from public.invoice_items ii where ii.invoice_id=(select p.invoice_id from public.payments p where p.id=(select payment_id from public.receipts where id=p_document_id))),'[]'::jsonb)) into payload;
  elsif p_document_type='credit_note' then
    select coalesce((select to_jsonb(n) from public.credit_notes n where n.id=p_document_id),'{}'::jsonb)||jsonb_build_object('customer',coalesce((select to_jsonb(c) from public.customers c where c.id=(select customer_id from public.credit_notes where id=p_document_id)),'{}'::jsonb),'business',coalesce((select to_jsonb(b) from public.businesses b where b.id=bid),'{}'::jsonb),'items',coalesce((select jsonb_agg(to_jsonb(ni) order by ni.sort_order) from public.credit_note_items ni where ni.credit_note_id=p_document_id),'[]'::jsonb)) into payload;
  else
    select coalesce((select to_jsonb(n) from public.debit_notes n where n.id=p_document_id),'{}'::jsonb)||jsonb_build_object('business',coalesce((select to_jsonb(b) from public.businesses b where b.id=bid),'{}'::jsonb),'items',coalesce((select jsonb_agg(to_jsonb(ni) order by ni.sort_order) from public.debit_note_items ni where ni.debit_note_id=p_document_id),'[]'::jsonb)) into payload;
  end if;

  if payload is null then raise exception 'Unable to assemble document data'; end if;
  if p_document_type in ('invoice','quotation','receipt') and (coalesce(payload->'business','{}'::jsonb)='{}'::jsonb or coalesce(payload->'customer','{}'::jsonb)='{}'::jsonb or jsonb_typeof(payload->'items')<>'array') then raise exception 'Incomplete document render payload'; end if;

  select nullif(tp.gstin,'') into gstin from public.business_tax_profiles tp where tp.business_id=bid limit 1;
  select case when b.logo_storage_path is not null and b.logo_storage_path<>'' then 'https://qpczmbvqflaqwvyphepf.supabase.co/storage/v1/object/public/business-branding-public/'||replace(b.logo_storage_path,' ','%20') end into logo_url from public.businesses b where b.id=bid;
  if gstin is null then select nullif(b.tax_registration_number,'') into gstin from public.businesses b where b.id=bid; end if;
  if payload ? 'business' then
    payload:=jsonb_set(payload,'{business,tax_registration_number}',coalesce(to_jsonb(gstin),'null'::jsonb),true);
    if logo_url is not null then payload:=jsonb_set(payload,'{business,logo_url}',to_jsonb(logo_url),true); end if;
  end if;
  if p_document_type='receipt' and payload->'invoice' is not null then
    payload:=payload||jsonb_build_object('invoice_id',nullif(payload->'invoice'->>'id','')::uuid,'invoice_number',payload->'invoice'->>'invoice_number','invoice_total',coalesce((payload->'invoice'->>'total')::numeric,0),'amount_received',coalesce((payload->'receipt'->>'amount')::numeric,0),'balance_due',greatest(coalesce((payload->'invoice'->>'total')::numeric,0)-coalesce((payload->'receipt'->>'amount')::numeric,0),0));
  end if;
  payload:=payload||jsonb_build_object('document_context',jsonb_build_object('business_id',bid,'document_type',p_document_type,'selected_template_id',tid,'selected_template_version',tv,'show_bank_details',show_bank,'selected_bank_account_id',bank_id),'bank_details',case when bank_payload is not null then bank_payload else 'null'::jsonb end);

  insert into public.document_render_jobs(business_id,document_type,document_id,template_id,template_version,payload,created_by)
  values(bid,p_document_type,p_document_id,tid,tv,payload,auth.uid())
  on conflict(document_type,document_id,template_id,template_version) do update set payload=excluded.payload,status='ready',error_message=null,created_at=now()
  returning id into job;
  return job;
end;
$function$;