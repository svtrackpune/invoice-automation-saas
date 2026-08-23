CREATE OR REPLACE FUNCTION public.convert_quotation_to_invoice(p_quotation_id uuid, p_invoice_date date DEFAULT CURRENT_DATE, p_due_date date DEFAULT NULL::date)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'mm_private'
AS $function$
declare q public.quotations%rowtype; c public.customers%rowtype; v_invoice uuid; v_items jsonb; v_due date;
begin
 select * into q from public.quotations where id=p_quotation_id for update;
 if q.id is null then raise exception 'Quotation not found'; end if;
 if not mm_private.has_business_permission(q.business_id,'sales.create') then raise exception 'Access denied'; end if;
 if q.invoice_id is not null then return q.invoice_id; end if;
 if q.status not in ('sent','accepted') then raise exception 'Quotation must be sent or accepted before conversion'; end if;
 if q.valid_until is not null and q.valid_until < current_date and q.status <> 'accepted' then raise exception 'Quotation has expired'; end if;
 select * into c from public.customers where id=q.customer_id and business_id=q.business_id;
 if c.id is null then raise exception 'Customer not found'; end if;
 v_due:=coalesce(p_due_date,p_invoice_date + greatest(coalesce(c.payment_terms_days,0),0),p_invoice_date,current_date);
 select coalesce(jsonb_agg(jsonb_build_object('product_service_id',qi.product_service_id,'description',qi.description,'quantity',qi.quantity,'unit_price',qi.unit_price,'discount_type',qi.discount_type,'discount_value',qi.discount_value,'tax_rate_id',qi.tax_rate_id) order by qi.sort_order),'[]'::jsonb) into v_items from public.quotation_items qi where qi.quotation_id=q.id;
 if jsonb_array_length(v_items)=0 then raise exception 'Quotation has no items'; end if;
 v_invoice:=public.create_invoice_from_items(q.business_id,q.customer_id,coalesce(p_invoice_date,current_date),v_due,v_items,null,0,q.notes,q.terms);
 update public.invoices set source_quotation_id=q.id,template_id=q.template_id where id=v_invoice;
 update public.quotations set invoice_id=v_invoice,status='converted',converted_at=now(),converted_by=auth.uid(),updated_at=now() where id=q.id;
 return v_invoice;
end;
$function$;