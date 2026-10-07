BEGIN;
CREATE OR REPLACE FUNCTION public.create_delivery_challan(
  p_business_id UUID,p_customer_id UUID,p_challan_date DATE,p_location_id UUID,
  p_items JSONB,p_transporter_name TEXT DEFAULT NULL,p_vehicle_number TEXT DEFAULT NULL,
  p_eway_bill_number TEXT DEFAULT NULL,p_notes TEXT DEFAULT NULL,p_terms TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,mm_private,pg_temp
AS $$
DECLARE v_id UUID; v_number TEXT; v_item RECORD; v_subtotal NUMERIC:=0;
BEGIN
  IF NOT mm_private.has_business_permission(p_business_id,'inventory.manage',auth.uid()) THEN RAISE EXCEPTION 'Access denied: inventory.manage permission required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM customers WHERE id=p_customer_id AND business_id=p_business_id AND is_active) THEN RAISE EXCEPTION 'Customer is invalid for this business'; END IF;
  IF NOT EXISTS (SELECT 1 FROM inventory_locations WHERE id=p_location_id AND business_id=p_business_id AND is_active) THEN RAISE EXCEPTION 'Inventory location is invalid'; END IF;
  v_number:='DC-'||to_char(CURRENT_DATE,'YYYYMMDD')||'-'||lpad((SELECT count(*)+1 FROM delivery_challans WHERE business_id=p_business_id AND challan_date=CURRENT_DATE)::text,4,'0');
  INSERT INTO delivery_challans(business_id,customer_id,challan_number,challan_date,transporter_name,vehicle_number,eway_bill_number,notes,terms,created_by)
  VALUES(p_business_id,p_customer_id,v_number,p_challan_date,p_transporter_name,p_vehicle_number,p_eway_bill_number,p_notes,p_terms,auth.uid()) RETURNING id INTO v_id;
  FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(product_service_id UUID,description TEXT,quantity NUMERIC,unit TEXT,unit_price NUMERIC,hsn_sac TEXT,batch_number TEXT,serial_number TEXT) LOOP
    IF v_item.product_service_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM products_services WHERE id=v_item.product_service_id AND business_id=p_business_id AND is_active) THEN RAISE EXCEPTION 'Product/service is invalid for this business'; END IF;
    INSERT INTO delivery_challan_items(business_id,challan_id,product_service_id,description,quantity,unit,unit_price,line_total,hsn_sac,batch_number,serial_number,sort_order)
    VALUES(p_business_id,v_id,v_item.product_service_id,v_item.description,v_item.quantity,v_item.unit,COALESCE(v_item.unit_price,0),v_item.quantity*COALESCE(v_item.unit_price,0),v_item.hsn_sac,v_item.batch_number,v_item.serial_number,0);
    v_subtotal:=v_subtotal+(v_item.quantity*COALESCE(v_item.unit_price,0));
    IF v_item.product_service_id IS NOT NULL AND EXISTS (SELECT 1 FROM products_services WHERE id=v_item.product_service_id AND business_id=p_business_id AND inventory_tracked) THEN
      INSERT INTO inventory_movements(business_id,product_service_id,location_id,movement_type,quantity,unit_cost,reference_type,reference_id,batch_number,serial_number,notes,created_by)
      SELECT p_business_id,v_item.product_service_id,p_location_id,'delivery_challan_out',v_item.quantity,purchase_price,'delivery_challan',v_id,v_item.batch_number,v_item.serial_number,'Delivery challan dispatch',auth.uid() FROM products_services WHERE id=v_item.product_service_id;
      UPDATE inventory_balances SET quantity_on_hand=quantity_on_hand-v_item.quantity,updated_at=now() WHERE business_id=p_business_id AND product_service_id=v_item.product_service_id AND location_id=p_location_id;
    END IF;
  END LOOP;
  UPDATE delivery_challans SET subtotal=v_subtotal,total=v_subtotal,updated_at=now() WHERE id=v_id;
  RETURN v_id;
END;
$$;
COMMIT;