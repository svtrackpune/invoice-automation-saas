-- Adaptive invoice inventory and tracking fields.

alter table public.invoices
  add column if not exists delivery_date date,
  add column if not exists inventory_location_id uuid references public.inventory_locations(id);

alter table public.invoice_items
  add column if not exists hsn_sac text,
  add column if not exists batch_number text,
  add column if not exists serial_number text;

create index if not exists idx_invoices_inventory_location
  on public.invoices (business_id, inventory_location_id)
  where inventory_location_id is not null;

create index if not exists idx_invoice_items_tracking
  on public.invoice_items (invoice_id, product_service_id, batch_number, serial_number);

CREATE OR REPLACE FUNCTION public.set_invoice_operational_details(p_invoice_id uuid, p_delivery_date date DEFAULT NULL::date, p_location_id uuid DEFAULT NULL::uuid, p_items jsonb DEFAULT '[]'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'mm_private'
AS $function$
declare
  inv public.invoices%rowtype;
  v_item jsonb;
  v_sort integer;
  v_product uuid;
  v_qty numeric;
  v_batch text;
  v_serial text;
  v_physical boolean;
  v_track boolean;
begin
  select * into inv from public.invoices where id=p_invoice_id for update;
  if inv.id is null then raise exception 'Invoice not found'; end if;
  if not (mm_private.has_business_permission(inv.business_id,'sales.edit') or mm_private.has_business_permission(inv.business_id,'sales.create')) then raise exception 'Access denied'; end if;
  if inv.status <> 'draft' or inv.journal_entry_id is not null then raise exception 'Only draft invoices can be updated'; end if;
  if jsonb_typeof(coalesce(p_items,'[]'::jsonb)) <> 'array' then raise exception 'Operational line details must be an array'; end if;

  select
    coalesce((feature_flags->>'has_physical_inventory')::boolean,false),
    coalesce((feature_flags->>'track_batch_serial')::boolean,false)
  into v_physical,v_track
  from public.businesses where id=inv.business_id;

  if not v_physical and (p_delivery_date is not null or p_location_id is not null or exists (
    select 1 from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) x
    where nullif(trim(coalesce(x->>'batch_number','')),'') is not null
       or nullif(trim(coalesce(x->>'serial_number','')),'') is not null
  )) then
    raise exception 'Inventory capabilities are disabled for this business';
  end if;

  if p_location_id is not null and not exists (
    select 1 from public.inventory_locations
    where id=p_location_id and business_id=inv.business_id and is_active
  ) then
    raise exception 'Inventory location is invalid for this business';
  end if;

  update public.invoices
  set delivery_date=case when v_physical then p_delivery_date else null end,
      inventory_location_id=case when v_physical then p_location_id else null end,
      updated_at=now()
  where id=inv.id;

  update public.invoice_items set batch_number=null, serial_number=null where invoice_id=inv.id;

  for v_item in select * from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) loop
    v_sort:=nullif(v_item->>'sort_order','')::integer;
    v_product:=nullif(v_item->>'product_service_id','')::uuid;
    v_qty:=coalesce((v_item->>'quantity')::numeric,0);
    v_batch:=nullif(trim(coalesce(v_item->>'batch_number','')),'');
    v_serial:=nullif(trim(coalesce(v_item->>'serial_number','')),'');

    if v_sort is null then raise exception 'Inventory line sort order is required'; end if;

    if v_product is not null then
      if not exists(select 1 from public.products_services where id=v_product and business_id=inv.business_id and is_active and sell_enabled) then
        raise exception 'Product/service not found';
      end if;

      if v_track and exists(select 1 from public.products_services where id=v_product and business_id=inv.business_id and inventory_tracked and track_batches) and v_batch is null then
        raise exception 'Batch number is required for tracked product line %',v_sort+1;
      end if;

      if v_track and exists(select 1 from public.products_services where id=v_product and business_id=inv.business_id and inventory_tracked and track_serials) then
        if v_serial is null then raise exception 'Serial number is required for tracked product line %',v_sort+1; end if;
        if v_qty <> 1 then raise exception 'Serial-tracked products must be invoiced one unit per line'; end if;
      end if;
    end if;

    update public.invoice_items
    set batch_number=v_batch, serial_number=v_serial
    where invoice_id=inv.id and sort_order=v_sort;
    if not found then raise exception 'Invoice line % was not found',v_sort+1; end if;
  end loop;

  return inv.id;
end;
$function$


revoke execute on function public.set_invoice_operational_details(uuid,date,uuid,jsonb) from public, anon;
grant execute on function public.set_invoice_operational_details(uuid,date,uuid,jsonb) to authenticated;

CREATE OR REPLACE FUNCTION public.create_invoice_from_items(p_business_id uuid, p_customer_id uuid, p_invoice_date date, p_due_date date, p_items jsonb, p_invoice_discount_type text DEFAULT NULL::text, p_invoice_discount_value numeric DEFAULT 0, p_notes text DEFAULT NULL::text, p_terms text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'mm_private'
AS $function$
declare
  v_invoice_id uuid; v_number text; v_currency char(3); v_tax_enabled boolean;
  v_item jsonb; v_product uuid; v_qty numeric; v_price numeric; v_desc text;
  v_disc_type text; v_disc_value numeric; v_tax uuid; v_base numeric;
  v_line_discount numeric; v_tax_rate numeric; v_tax_amount numeric; v_line_total numeric;
  v_discount_type text; v_hsn text;
begin
  if not mm_private.has_business_permission(p_business_id,'sales.create') then raise exception 'Access denied'; end if;
  if not exists(select 1 from public.customers where id=p_customer_id and business_id=p_business_id and is_active) then raise exception 'Customer not found or inactive'; end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'At least one invoice item is required'; end if;

  select b.currency_code,coalesce((b.feature_flags->>'is_tax_registered')::boolean,false)
    into v_currency,v_tax_enabled
    from public.businesses b where b.id=p_business_id and b.is_active;

  if v_currency is null then raise exception 'Business not found or inactive'; end if;
  if p_invoice_discount_type is not null and p_invoice_discount_type not in ('amount','fixed','percentage','') then raise exception 'Invalid invoice discount type'; end if;
  if coalesce(p_invoice_discount_value,0)<0 then raise exception 'Discount value cannot be negative'; end if;
  v_discount_type:=case when p_invoice_discount_type in ('amount','fixed') then 'fixed' when p_invoice_discount_type='percentage' then 'percentage' else null end;

  v_number:=public.next_document_number(p_business_id,'invoice');
  insert into public.invoices(business_id,customer_id,invoice_number,invoice_date,due_date,status,currency_code,subtotal,discount_total,tax_total,total,amount_paid,balance_due,notes,terms,discount_type,discount_value,discount_before_tax,created_by)
  values(p_business_id,p_customer_id,v_number,coalesce(p_invoice_date,current_date),coalesce(p_due_date,coalesce(p_invoice_date,current_date)),'draft',v_currency,0,0,0,0,0,0,p_notes,p_terms,v_discount_type,coalesce(p_invoice_discount_value,0),true,auth.uid())
  returning id into v_invoice_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_product:=nullif(v_item->>'product_service_id','')::uuid;
    v_qty:=coalesce((v_item->>'quantity')::numeric,0);
    v_price:=coalesce((v_item->>'unit_price')::numeric,0);
    v_desc:=coalesce(nullif(v_item->>'description',''),(select name from public.products_services where id=v_product));
    v_disc_type:=nullif(v_item->>'discount_type',''); if v_disc_type='amount' then v_disc_type='fixed'; end if;
    v_disc_value:=coalesce((v_item->>'discount_value')::numeric,0); v_tax:=nullif(v_item->>'tax_rate_id','')::uuid;

    if v_qty<=0 or v_price<0 or v_desc is null then raise exception 'Invalid invoice item'; end if;
    if v_product is not null and not exists(select 1 from public.products_services where id=v_product and business_id=p_business_id and is_active and sell_enabled) then raise exception 'Product/service not found'; end if;
    if v_disc_type is not null and v_disc_type not in ('percentage','fixed') then raise exception 'Invalid line discount type'; end if;
    if v_disc_value<0 then raise exception 'Discount value cannot be negative'; end if;

    if v_tax_enabled then
      if v_product is null then raise exception 'HSN / SAC is required for every tax-registered invoice line'; end if;
      select nullif(trim(hsn_sac),'') into v_hsn from public.products_services where id=v_product and business_id=p_business_id;
      if v_hsn is null then raise exception 'HSN / SAC is required for tax-registered invoice item %',v_desc; end if;
    else
      v_hsn:=nullif(trim(v_item->>'hsn_sac'),'');
    end if;

    v_base:=round(v_qty*v_price,2);
    v_line_discount:=public.calculate_invoice_line_discount(p_business_id,v_product,v_base,v_disc_type,v_disc_value);
    v_tax_rate:=case when v_tax_enabled and v_tax is not null then coalesce((select rate from public.tax_rates where id=v_tax and business_id=p_business_id and is_active),0) else 0 end;
    v_tax_amount:=round((v_base-v_line_discount)*v_tax_rate/100,2);
    v_line_total:=round(v_base-v_line_discount+v_tax_amount,2);

    insert into public.invoice_items(invoice_id,product_service_id,description,quantity,unit_price,discount,discount_type,discount_value,unit_price_before_discount,tax_rate_id,tax_amount,line_total,sort_order,hsn_sac)
    values(v_invoice_id,v_product,v_desc,v_qty,v_price,v_line_discount,v_disc_type,v_disc_value,v_price,v_tax,v_tax_amount,v_line_total,(select count(*) from public.invoice_items where invoice_id=v_invoice_id),v_hsn);
  end loop;

  perform public.recalculate_invoice_totals(v_invoice_id);
  return v_invoice_id;
end;
$function$


CREATE OR REPLACE FUNCTION public.update_invoice_draft(p_invoice_id uuid, p_customer_id uuid, p_invoice_date date, p_due_date date, p_items jsonb, p_invoice_discount_type text DEFAULT NULL::text, p_invoice_discount_value numeric DEFAULT 0, p_notes text DEFAULT NULL::text, p_terms text DEFAULT NULL::text, p_template_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'mm_private'
AS $function$
declare
  inv public.invoices%rowtype; v_tax_enabled boolean; v_item jsonb; v_product uuid; v_qty numeric; v_price numeric; v_desc text;
  v_disc_type text; v_disc_value numeric; v_tax uuid; v_base numeric; v_line_discount numeric; v_tax_rate numeric;
  v_tax_amount numeric; v_line_total numeric; v_discount_type text; v_hsn text;
begin
  select * into inv from public.invoices where id=p_invoice_id for update;
  if inv.id is null then raise exception 'Invoice not found'; end if;
  if not (mm_private.has_business_permission(inv.business_id,'sales.edit') or mm_private.has_business_permission(inv.business_id,'sales.create')) then raise exception 'Access denied'; end if;
  if inv.status<>'draft' or inv.journal_entry_id is not null then raise exception 'Only draft invoices can be edited'; end if;
  if not exists(select 1 from public.customers where id=p_customer_id and business_id=inv.business_id and is_active) then raise exception 'Customer not found or inactive'; end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'At least one invoice item is required'; end if;
  if p_template_id is not null and not exists(select 1 from public.document_templates where id=p_template_id and document_type='invoice' and is_active) then raise exception 'Invalid or inactive invoice template'; end if;

  select coalesce((b.feature_flags->>'is_tax_registered')::boolean,false) into v_tax_enabled from public.businesses b where b.id=inv.business_id;
  v_discount_type:=case when p_invoice_discount_type in ('amount','fixed') then 'fixed' when p_invoice_discount_type='percentage' then 'percentage' else null end;

  update public.invoices set customer_id=p_customer_id,invoice_date=coalesce(p_invoice_date,invoice_date),due_date=coalesce(p_due_date,due_date),notes=p_notes,terms=p_terms,discount_type=v_discount_type,discount_value=coalesce(p_invoice_discount_value,0),template_id=p_template_id,updated_at=now() where id=p_invoice_id;
  delete from public.invoice_items where invoice_id=p_invoice_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_product:=nullif(v_item->>'product_service_id','')::uuid; v_qty:=coalesce((v_item->>'quantity')::numeric,0); v_price:=coalesce((v_item->>'unit_price')::numeric,0);
    v_desc:=coalesce(nullif(v_item->>'description',''),(select name from public.products_services where id=v_product));
    v_disc_type:=nullif(v_item->>'discount_type',''); if v_disc_type='amount' then v_disc_type='fixed'; end if;
    v_disc_value:=coalesce((v_item->>'discount_value')::numeric,0); v_tax:=nullif(v_item->>'tax_rate_id','')::uuid;

    if v_qty<=0 or v_price<0 or v_desc is null then raise exception 'Invalid invoice item'; end if;
    if v_product is not null and not exists(select 1 from public.products_services where id=v_product and business_id=inv.business_id and is_active and sell_enabled) then raise exception 'Product/service not found'; end if;
    if v_disc_type is not null and v_disc_type not in ('percentage','fixed') then raise exception 'Invalid line discount type'; end if;
    if v_disc_value<0 then raise exception 'Discount value cannot be negative'; end if;

    if v_tax_enabled then
      if v_product is null then raise exception 'HSN / SAC is required for every tax-registered invoice line'; end if;
      select nullif(trim(hsn_sac),'') into v_hsn from public.products_services where id=v_product and business_id=inv.business_id;
      if v_hsn is null then raise exception 'HSN / SAC is required for tax-registered invoice item %',v_desc; end if;
    else
      v_hsn:=nullif(trim(v_item->>'hsn_sac'),'');
    end if;

    v_base:=round(v_qty*v_price,2);
    v_line_discount:=public.calculate_invoice_line_discount(inv.business_id,v_product,v_base,v_disc_type,v_disc_value);
    v_tax_rate:=case when v_tax_enabled and v_tax is not null then coalesce((select rate from public.tax_rates where id=v_tax and business_id=inv.business_id and is_active),0) else 0 end;
    v_tax_amount:=round((v_base-v_line_discount)*v_tax_rate/100,2);
    v_line_total:=round(v_base-v_line_discount+v_tax_amount,2);

    insert into public.invoice_items(invoice_id,product_service_id,description,quantity,unit_price,discount,discount_type,discount_value,unit_price_before_discount,tax_rate_id,tax_amount,line_total,sort_order,hsn_sac)
    values(p_invoice_id,v_product,v_desc,v_qty,v_price,v_line_discount,v_disc_type,v_disc_value,v_price,v_tax,v_tax_amount,v_line_total,(select coalesce(max(sort_order),-1)+1 from public.invoice_items where invoice_id=p_invoice_id),v_hsn);
  end loop;

  perform public.recalculate_invoice_totals(p_invoice_id);
  return p_invoice_id;
end;
$function$


CREATE OR REPLACE FUNCTION public.post_invoice(p_invoice_id uuid, p_location_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'mm_private'
AS $function$
declare
  inv public.invoices%rowtype;
  v_entry uuid; v_ar uuid; v_sales uuid; v_tax uuid; v_inventory uuid; v_cogs uuid; v_location uuid;
  v_cogs_total numeric:=0; v_cost numeric; v_qty numeric; v_physical boolean; v_track boolean; v_product record;
begin
  select * into inv from public.invoices where id=p_invoice_id for update;
  if inv.id is null then raise exception 'Invoice not found'; end if;
  if not mm_private.has_business_permission(inv.business_id,'accounting.post') then raise exception 'Access denied'; end if;
  if inv.status='void' then raise exception 'Cannot post a void invoice'; end if;
  if inv.journal_entry_id is not null then return inv.journal_entry_id; end if;

  perform public.recalculate_invoice_totals(inv.id);
  select * into inv from public.invoices where id=inv.id for update;

  select coalesce((b.feature_flags->>'has_physical_inventory')::boolean,false),
         coalesce((b.feature_flags->>'track_batch_serial')::boolean,false)
    into v_physical,v_track from public.businesses b where b.id=inv.business_id;

  select id into v_ar from public.accounts where business_id=inv.business_id and code='1100' and is_active;
  select id into v_sales from public.accounts where business_id=inv.business_id and code='4000' and is_active;
  select id into v_tax from public.accounts where business_id=inv.business_id and code='2100' and is_active;
  select id into v_inventory from public.accounts where business_id=inv.business_id and code='1200' and is_active;
  select id into v_cogs from public.accounts where business_id=inv.business_id and code='5000' and is_active;

  if v_ar is null or v_sales is null then raise exception 'Default AR or Sales account is missing'; end if;

  if v_physical and exists(select 1 from public.invoice_items ii join public.products_services ps on ps.id=ii.product_service_id where ii.invoice_id=inv.id and ps.inventory_tracked) then
    v_location:=coalesce(p_location_id,inv.inventory_location_id);
    if v_location is null then raise exception 'Inventory location is required before posting this invoice'; end if;
    if not exists(select 1 from public.inventory_locations where id=v_location and business_id=inv.business_id and is_active) then raise exception 'Inventory location is invalid'; end if;
  end if;

  perform pg_advisory_xact_lock(hashtext('journal-entry-number:'||inv.business_id::text));
  insert into public.journal_entries(business_id,entry_number,entry_date,description,source_type,source_id,status,posted_at,posted_by,created_by,currency_code,total_debit,total_credit,is_system_generated)
  values(inv.business_id,(select coalesce(max(entry_number),0)+1 from public.journal_entries where business_id=inv.business_id),inv.invoice_date,'Invoice '||inv.invoice_number,'invoice',inv.id,'posted',now(),auth.uid(),auth.uid(),inv.currency_code,inv.total,inv.total,true)
  on conflict do nothing returning id into v_entry;

  if v_entry is null then
    select id into v_entry from public.journal_entries where source_type='invoice' and source_id=inv.id limit 1;
    return v_entry;
  end if;

  insert into public.journal_lines(journal_entry_id,account_id,description,debit,credit,currency_code,entity_type,entity_id)
  values(v_entry,v_ar,'Invoice receivable',inv.total,0,inv.currency_code,'customer',inv.customer_id),
        (v_entry,v_sales,'Sales revenue',0,inv.subtotal-inv.discount_total,inv.currency_code,null,null);

  if inv.tax_total>0 then
    if v_tax is null then raise exception 'Output tax account is missing'; end if;
    insert into public.journal_lines(journal_entry_id,account_id,description,debit,credit,currency_code)
    values(v_entry,v_tax,'Output tax',0,inv.tax_total,inv.currency_code);
  end if;

  if v_physical and v_location is not null then
    for v_product in
      select ii.product_service_id,ii.quantity,ii.batch_number,ii.serial_number,ps.track_batches,ps.track_serials,ps.inventory_tracked
      from public.invoice_items ii join public.products_services ps on ps.id=ii.product_service_id
      where ii.invoice_id=inv.id and ii.product_service_id is not null and ps.inventory_tracked
    loop
      if v_track and v_product.track_batches and nullif(trim(coalesce(v_product.batch_number,'')),'') is null then raise exception 'Batch number is required before posting inventory-tracked item'; end if;
      if v_track and v_product.track_serials then
        if nullif(trim(coalesce(v_product.serial_number,'')),'') is null then raise exception 'Serial number is required before posting serial-tracked item'; end if;
        if v_product.quantity<>1 then raise exception 'Serial-tracked products must be invoiced one unit per line'; end if;
      end if;

      select average_cost,quantity_on_hand into v_cost,v_qty from public.inventory_balances
      where business_id=inv.business_id and location_id=v_location and product_service_id=v_product.product_service_id for update;

      if v_cost is null or v_qty < v_product.quantity then raise exception 'Insufficient inventory for product %',v_product.product_service_id; end if;
      v_cogs_total:=v_cogs_total+round(v_product.quantity*v_cost,2);

      update public.inventory_balances set quantity_on_hand=quantity_on_hand-v_product.quantity,updated_at=now()
      where business_id=inv.business_id and location_id=v_location and product_service_id=v_product.product_service_id;

      insert into public.inventory_movements(business_id,location_id,product_service_id,movement_type,quantity,unit_cost,reference_type,reference_id,batch_number,serial_number,created_by)
      values(inv.business_id,v_location,v_product.product_service_id,'sale',v_product.quantity,v_cost,'invoice',inv.id,v_product.batch_number,v_product.serial_number,auth.uid());
    end loop;
  end if;

  if v_cogs_total>0 then
    if v_cogs is null or v_inventory is null then raise exception 'Inventory accounting accounts are missing'; end if;
    insert into public.journal_lines(journal_entry_id,account_id,description,debit,credit,currency_code)
    values(v_entry,v_cogs,'Cost of goods sold',v_cogs_total,0,inv.currency_code),(v_entry,v_inventory,'Inventory asset reduction',0,v_cogs_total,inv.currency_code);
    update public.journal_entries set total_debit=total_debit+v_cogs_total,total_credit=total_credit+v_cogs_total where id=v_entry;
  end if;

  perform public.validate_journal_entry_balance(v_entry);
  update public.invoices set journal_entry_id=v_entry,status=case when balance_due<=0 then 'paid'::invoice_status when due_date<current_date then 'overdue'::invoice_status when amount_paid>0 then 'partially_paid'::invoice_status else 'sent'::invoice_status end,updated_at=now() where id=inv.id;
  return v_entry;
end;
$function$


revoke execute on function public.post_invoice(uuid,uuid) from public, anon;
grant execute on function public.post_invoice(uuid,uuid) to authenticated;
