BEGIN;

CREATE OR REPLACE FUNCTION public.replace_vendor_supply_mappings(p_business_id uuid,p_vendor_id uuid,p_items jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','mm_private','pg_temp'
AS $function$
DECLARE v_user_id uuid:=auth.uid(); v_item jsonb; v_item_name text; v_source_type text; v_product_id uuid; v_saved_count integer:=0;
BEGIN
 IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 IF NOT (mm_private.has_business_permission(p_business_id,'vendors.manage',v_user_id) OR mm_private.has_business_permission(p_business_id,'purchases.manage',v_user_id)) THEN
   RAISE EXCEPTION 'Access denied: vendors.manage or purchases.manage permission required';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM public.vendors v WHERE v.id=p_vendor_id AND v.business_id=p_business_id) THEN
   RAISE EXCEPTION 'Vendor does not belong to the selected business';
 END IF;
 IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Supplier mapping items must be a JSON array'; END IF;
 IF jsonb_array_length(p_items)>5000 THEN RAISE EXCEPTION 'Supplier mapping import exceeds the 5000-item limit'; END IF;
 FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) AS rows(value) LOOP
   v_item_name:=nullif(btrim(v_item->>'item_name'),'');
   IF v_item_name IS NULL THEN RAISE EXCEPTION 'Supplier mapping item names cannot be empty'; END IF;
   v_source_type:=coalesce(nullif(btrim(v_item->>'source_type'),''),'manual');
   IF v_source_type NOT IN ('catalog','manual','csv','xlsx','txt','image') THEN RAISE EXCEPTION 'Unsupported supplier mapping source type: %',v_source_type; END IF;
   BEGIN v_product_id:=nullif(btrim(v_item->>'product_service_id'),'')::uuid;
   EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'Supplier mapping product reference is not a valid ID'; END;
   IF v_product_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.products_services ps WHERE ps.id=v_product_id AND ps.business_id=p_business_id) THEN
     RAISE EXCEPTION 'Supplier mapping product must belong to the same business';
   END IF;
 END LOOP;
 -- Transactional replacement: any validation/insert failure rolls back this delete too.
 DELETE FROM public.vendor_supply_mappings WHERE business_id=p_business_id AND vendor_id=p_vendor_id AND is_active;
 WITH ranked AS (
   SELECT value, ordinality, row_number() OVER(PARTITION BY lower(btrim(value->>'item_name')) ORDER BY ordinality DESC) rn
   FROM jsonb_array_elements(p_items) WITH ORDINALITY AS rows(value,ordinality)
 )
 INSERT INTO public.vendor_supply_mappings(business_id,vendor_id,product_service_id,item_name,source_type,source_name,is_active,created_by)
 SELECT p_business_id,p_vendor_id,nullif(btrim(value->>'product_service_id'),'')::uuid,btrim(value->>'item_name'),
        coalesce(nullif(btrim(value->>'source_type'),''),'manual'),nullif(btrim(value->>'source_name'),''),true,v_user_id
 FROM ranked WHERE rn=1 ORDER BY lower(btrim(value->>'item_name'));
 GET DIAGNOSTICS v_saved_count=ROW_COUNT;
 RETURN jsonb_build_object('success',true,'saved_count',v_saved_count);
END;
$function$;
REVOKE ALL ON FUNCTION public.replace_vendor_supply_mappings(uuid,uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.replace_vendor_supply_mappings(uuid,uuid,jsonb) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION mm_private.guard_inventory_tracking_disable()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','mm_private','pg_temp'
AS $function$
BEGIN
 IF coalesce(OLD.inventory_tracked,false) AND NOT coalesce(NEW.inventory_tracked,false)
    AND (
      EXISTS(SELECT 1 FROM public.inventory_movements im WHERE im.business_id=OLD.business_id AND im.product_service_id=OLD.id)
      OR EXISTS(SELECT 1 FROM public.inventory_balances ib WHERE ib.business_id=OLD.business_id AND ib.product_service_id=OLD.id AND ib.quantity_on_hand<>0)
    )
 THEN
   RAISE EXCEPTION 'Inventory tracking cannot be disabled after stock history exists. Keep tracking enabled and use stock audit/returns to correct quantity.';
 END IF;
 RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION mm_private.guard_inventory_tracking_disable() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS trg_guard_inventory_tracking_disable ON public.products_services;
CREATE TRIGGER trg_guard_inventory_tracking_disable BEFORE UPDATE OF inventory_tracked ON public.products_services
FOR EACH ROW EXECUTE FUNCTION mm_private.guard_inventory_tracking_disable();

CREATE OR REPLACE FUNCTION public.post_bill_legacy(p_bill_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  b public.bills%rowtype;
  v_entry uuid;
  v_ap uuid;
  v_inventory uuid;
  v_expense uuid;
  v_input_tax uuid;
  v_location uuid;
  v_line record;
  v_total numeric:=0;
  v_base numeric:=0;
  v_tax numeric:=0;
  v_entry_number bigint;
  v_tax_registered boolean:=false;
  v_tax_creditable boolean:=false;
  v_old_qty numeric;
  v_old_cost numeric;
  v_new_qty numeric;
  v_new_cost numeric;
begin
  select * into b from public.bills where id=p_bill_id for update;
  if b.id is null then raise exception 'Bill not found'; end if;
  IF coalesce(b.is_purchase_order, false) THEN
    RAISE EXCEPTION 'Purchase orders cannot be posted directly. Receive goods and convert the order to a vendor bill.';
  END IF;
  if not mm_private.has_business_permission(b.business_id,'accounting.post') then raise exception 'Access denied'; end if;
  if b.journal_entry_id is not null then return b.journal_entry_id; end if;
  select id into v_ap from public.accounts where business_id=b.business_id and code='2000' and is_active;
  select id into v_inventory from public.accounts where business_id=b.business_id and code='1200' and is_active;
  select id into v_expense from public.accounts where business_id=b.business_id and code='6000' and is_active;
  select id into v_input_tax from public.accounts where business_id=b.business_id and code='1300' and is_active;
  select coalesce(tax_regime='GST' and gst_registration_type<>'COMPOSITION',false) into v_tax_creditable from public.business_tax_profiles where business_id=b.business_id;
  v_tax_registered:=coalesce((select tax_regime='GST' from public.business_tax_profiles where business_id=b.business_id),false);
  if v_tax_registered and v_tax_creditable and v_input_tax is null then raise exception 'Input GST account (1300) is missing'; end if;
  if v_ap is null then raise exception 'Accounts Payable account is missing'; end if;
  v_total:=round(coalesce(b.total,0),2);
  if v_total<=0 then raise exception 'Bill total must be greater than zero'; end if;
  select id into v_location
  from public.inventory_locations
  where business_id=b.business_id and is_active
  order by is_default desc, name, id
  limit 1;
  IF v_location IS NULL AND EXISTS (
    SELECT 1
    FROM public.bill_items bi
    JOIN public.products_services ps ON ps.id=bi.product_service_id AND ps.business_id=b.business_id
    WHERE bi.bill_id=b.id AND ps.inventory_tracked
  ) THEN
    RAISE EXCEPTION 'No active inventory location is configured. Create or activate a stock location before posting a tracked-item purchase bill.';
  END IF;
  perform pg_advisory_xact_lock(hashtext('journal-entry-number:'||b.business_id::text));
  select coalesce(max(entry_number),0)+1 into v_entry_number from public.journal_entries where business_id=b.business_id;
  insert into public.journal_entries(business_id,entry_number,entry_date,description,source_type,source_id,status,posted_at,posted_by,created_by,currency_code,total_debit,total_credit,is_system_generated)
  values(b.business_id,v_entry_number,b.bill_date,'Bill '||b.bill_number,'bill',b.id,'posted',now(),auth.uid(),b.created_by,b.currency_code,v_total,v_total,true) returning id into v_entry;
  for v_line in select bi.description,bi.line_total,bi.tax_amount,bi.quantity,bi.product_service_id,bi.expense_account_id,ps.inventory_tracked,ps.purchase_price from public.bill_items bi left join public.products_services ps on ps.id=bi.product_service_id where bi.bill_id=b.id order by bi.sort_order loop
    v_tax:=case when v_tax_registered and v_tax_creditable then round(coalesce(v_line.tax_amount,0),2) else 0 end;
    v_base:=round(coalesce(v_line.line_total,0)-v_tax,2);
    if v_line.inventory_tracked and v_inventory is not null then
      insert into public.journal_lines(journal_entry_id,account_id,description,debit,credit,currency_code) values(v_entry,v_inventory,v_line.description,v_base,0,b.currency_code);
      if v_location is not null then
        select quantity_on_hand,average_cost into v_old_qty,v_old_cost from public.inventory_balances where business_id=b.business_id and location_id=v_location and product_service_id=v_line.product_service_id for update;

        insert into public.inventory_movements(business_id,location_id,product_service_id,movement_type,quantity,unit_cost,reference_type,reference_id,created_by) values(b.business_id,v_location,v_line.product_service_id,'purchase',v_line.quantity,coalesce(v_base/nullif(v_line.quantity,0),v_line.purchase_price,0),'bill',b.id,auth.uid());
      end if;
    else
      insert into public.journal_lines(journal_entry_id,account_id,description,debit,credit,currency_code) values(v_entry,coalesce(v_line.expense_account_id,v_expense,v_inventory),v_line.description,v_base,0,b.currency_code);
    end if;
    if v_tax>0 then
      insert into public.journal_lines(journal_entry_id,account_id,description,debit,credit,currency_code) values(v_entry,v_input_tax,'Input GST / eligible tax credit',v_tax,0,b.currency_code);
    end if;
  end loop;
  insert into public.journal_lines(journal_entry_id,account_id,description,debit,credit,currency_code) values(v_entry,v_ap,'Accounts payable',0,v_total,b.currency_code);
  perform public.validate_journal_entry_balance(v_entry);
  update public.bills set journal_entry_id=v_entry,status=case when b.due_date<current_date then 'overdue'::bill_status else 'received'::bill_status end,updated_at=now() where id=b.id;
  return v_entry;
end;
$function$
;

REVOKE ALL ON FUNCTION public.post_bill_legacy(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.post_bill_legacy(uuid) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;