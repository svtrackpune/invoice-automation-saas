-- Keep notification enqueue return counts accurate after idempotent inserts.\nCREATE OR REPLACE FUNCTION public.enqueue_payment_link_notification(
  p_business_id uuid,
  p_payment_link_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,mm_private
AS $function$
DECLARE
  pl record;
  n integer:=0;
  v_rows integer:=0;
  msg text;
BEGIN
  IF NOT mm_private.has_business_permission(p_business_id,'payments.receive') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT pl.*,i.invoice_number,i.customer_id,c.display_name,c.email,c.phone
  INTO pl
  FROM public.payment_links pl
  JOIN public.invoices i ON i.id=pl.invoice_id
  JOIN public.customers c ON c.id=i.customer_id
  WHERE pl.id=p_payment_link_id AND pl.business_id=p_business_id;

  IF pl.id IS NULL THEN
    RAISE EXCEPTION 'Payment link not found';
  END IF;

  msg:='Payment link for invoice '||pl.invoice_number||': '||coalesce(pl.short_url,'');

  IF pl.email IS NOT NULL THEN
    INSERT INTO public.notification_jobs(
      business_id,customer_id,invoice_id,channel,notification_type,recipient,subject,message,
      action_url,metadata
    ) VALUES(
      p_business_id,pl.customer_id,pl.invoice_id,'email','payment_link',pl.email,
      'Payment link · '||pl.invoice_number,msg,pl.short_url,
      jsonb_build_object('payment_link_id',pl.id,'idempotency_key','payment_link:'||pl.id||':email')
    ) ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    n:=n+v_rows;
  END IF;

  IF pl.phone IS NOT NULL THEN
    INSERT INTO public.notification_jobs(
      business_id,customer_id,invoice_id,channel,notification_type,recipient,subject,message,
      action_url,metadata
    ) VALUES(
      p_business_id,pl.customer_id,pl.invoice_id,'whatsapp',pl.phone,
      'payment_link',pl.phone,NULL,msg,pl.short_url,
      jsonb_build_object('payment_link_id',pl.id,'idempotency_key','payment_link:'||pl.id||':whatsapp')
    ) ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    n:=n+v_rows;
  END IF;

  RETURN n;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enqueue_invoice_reminders(
  p_business_id uuid,
  p_now timestamptz DEFAULT now()
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,mm_private
AS $function$
DECLARE
  n integer:=0;
  v_rows integer:=0;
  inv record;
  due_days integer;
  target timestamptz;
  body text;
  kind text;
BEGIN
  IF NOT mm_private.has_business_permission(p_business_id,'payments.receive') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  FOR inv IN
    SELECT i.id,i.invoice_number,i.customer_id,i.due_date,i.balance_due,i.currency_code,
           c.display_name,c.email,c.phone,c.payment_reminders_enabled,c.reminder_days_before_due
    FROM public.invoices i
    JOIN public.customers c ON c.id=i.customer_id AND c.business_id=i.business_id
    WHERE i.business_id=p_business_id
      AND i.status IN ('sent','partially_paid','overdue')
      AND i.balance_due>0
      AND c.payment_reminders_enabled
      AND (c.email IS NOT NULL OR c.phone IS NOT NULL)
  LOOP
    due_days:=greatest(coalesce(inv.reminder_days_before_due,3),0);
    target:=(inv.due_date::timestamptz - make_interval(days=>due_days));

    IF p_now>=target THEN
      kind:=CASE WHEN inv.due_date<p_now::date THEN 'overdue' ELSE 'due_soon' END;
      body:=CASE
        WHEN kind='overdue' THEN
          'Payment reminder: invoice '||inv.invoice_number||' is overdue. Outstanding balance: '||
          inv.balance_due||' '||inv.currency_code||'.'
        ELSE
          'Payment reminder: invoice '||inv.invoice_number||' is due on '||inv.due_date||
          '. Outstanding balance: '||inv.balance_due||' '||inv.currency_code||'.'
      END;

      IF inv.email IS NOT NULL THEN
        INSERT INTO public.notification_jobs(
          business_id,customer_id,invoice_id,channel,notification_type,recipient,subject,message,
          scheduled_for,metadata
        ) VALUES(
          p_business_id,inv.customer_id,inv.id,'email',kind,inv.email,
          'Payment reminder · '||inv.invoice_number,body,p_now,
          jsonb_build_object(
            'invoice_number',inv.invoice_number,
            'idempotency_key','invoice:'||inv.id||':'||kind||':'||inv.due_date||':email'
          )
        ) ON CONFLICT DO NOTHING;
        GET DIAGNOSTICS v_rows = ROW_COUNT;
        n:=n+v_rows;
      END IF;

      IF inv.phone IS NOT NULL THEN
        INSERT INTO public.notification_jobs(
          business_id,customer_id,invoice_id,channel,notification_type,recipient,subject,message,
          scheduled_for,metadata
        ) VALUES(
          p_business_id,inv.customer_id,inv.id,'whatsapp',kind,inv.phone,
          NULL,body,p_now,
          jsonb_build_object(
            'invoice_number',inv.invoice_number,
            'idempotency_key','invoice:'||inv.id||':'||kind||':'||inv.due_date||':whatsapp'
          )
        ) ON CONFLICT DO NOTHING;
        GET DIAGNOSTICS v_rows = ROW_COUNT;
        n:=n+v_rows;
      END IF;
    END IF;
  END LOOP;

  RETURN n;
END;
$function$;
