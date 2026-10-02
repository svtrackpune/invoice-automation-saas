BEGIN;

CREATE OR REPLACE FUNCTION public.get_or_create_cash_customer(p_business_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE v_id uuid;
BEGIN
  IF NOT (
    mm_private.has_business_permission(p_business_id,'customers.manage')
    OR mm_private.has_business_permission(p_business_id,'sales.create')
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT id INTO v_id
  FROM public.customers
  WHERE business_id=p_business_id AND display_name='Cash Customer' AND is_active=true
  ORDER BY created_at
  LIMIT 1;

  IF v_id IS NULL THEN
    INSERT INTO public.customers(
      business_id,display_name,legal_name,email,phone,tax_id,tax_type,
      billing_address,shipping_address,credit_limit,payment_terms_days,notes,
      metadata,is_active,payment_reminders_enabled,reminder_days_before_due,
      default_discount_type,default_discount_value,relationship_type,
      product_reminder_after_days,service_recurring,service_recurring_interval,
      service_auto_invoice_days_before,service_reminder_after_days,
      notify_customer,notify_owner,product_reminder_after_unit,service_reminder_after_unit
    )
    VALUES(
      p_business_id,'Cash Customer','Cash Customer',null,null,null,'N/A',
      '{}'::jsonb,'{}'::jsonb,0,0,'System walk-in customer used by Cash Bill.',
      '{"system":"cash_bill"}'::jsonb,true,false,0,
      'none',0,'both',0,false,'monthly',0,0,false,false,'days','days'
    )
    RETURNING id INTO v_id;
  END IF;

  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_cash_bill(
  p_business_id uuid,
  p_phone text,
  p_invoice_date date,
  p_items jsonb,
  p_payment_method public.payment_method,
  p_account_id uuid,
  p_invoice_discount_type text DEFAULT NULL,
  p_invoice_discount_value numeric DEFAULT 0,
  p_notes text DEFAULT 'Cash & Carry',
  p_terms text DEFAULT 'Paid in full at counter.'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, mm_private
AS $function$
DECLARE v_customer uuid; v_invoice uuid;
BEGIN
  IF NOT mm_private.has_business_permission(p_business_id,'sales.create') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF p_payment_method NOT IN ('cash','upi') THEN
    RAISE EXCEPTION 'Cash Bill settlement must be Cash or UPI.';
  END IF;

  IF p_payment_method='cash' AND NOT EXISTS(
    SELECT 1 FROM public.accounts
    WHERE id=p_account_id AND business_id=p_business_id AND is_active AND account_subtype='cash'
  ) THEN
    RAISE EXCEPTION 'Select a Cash settlement account for a Cash Bill paid by cash.';
  END IF;

  IF p_payment_method='upi' AND NOT EXISTS(
    SELECT 1 FROM public.accounts
    WHERE id=p_account_id AND business_id=p_business_id AND is_active AND account_subtype='bank'
  ) THEN
    RAISE EXCEPTION 'Select a Bank settlement account for a Cash Bill paid by UPI.';
  END IF;

  IF nullif(trim(coalesce(p_phone,'')),'') IS NULL THEN
    v_customer:=public.get_or_create_cash_customer(p_business_id);
  ELSE
    v_customer:=public.get_or_create_cash_customer_by_phone(p_business_id,trim(p_phone));
  END IF;

  v_invoice:=public.create_invoice_from_items(
    p_business_id,v_customer,p_invoice_date,p_invoice_date,p_items,
    p_invoice_discount_type,p_invoice_discount_value,p_notes,p_terms
  );

  UPDATE public.invoices
  SET document_kind='cash_bill',payment_display_mode='none',payment_bank_account_id=NULL,updated_at=now()
  WHERE id=v_invoice;

  PERFORM public.post_invoice(v_invoice,NULL);

  PERFORM public.record_customer_payment(
    p_business_id,v_customer,v_invoice,
    (SELECT total FROM public.invoices WHERE id=v_invoice),
    p_payment_method,p_account_id,NULL,NULL,p_invoice_date,p_notes
  );

  RETURN v_invoice;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_cash_bill(uuid,text,date,jsonb,public.payment_method,uuid,text,numeric,text,text) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.create_cash_bill(uuid,text,date,jsonb,public.payment_method,uuid,text,numeric,text,text) TO authenticated;

COMMIT;