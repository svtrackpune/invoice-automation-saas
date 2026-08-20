-- Wire saved customer/recurring reminder settings into the recurring billing engine.

CREATE OR REPLACE FUNCTION public.process_due_recurring_invoices(p_now timestamptz DEFAULT now())
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, mm_private
AS $function$
DECLARE
  r record;
  run_id uuid;
  inv_id uuid;
  inv_num text;
  due_date date;
  next_date date;
  due_days integer;
  reminder_at timestamptz;
  item record;
  n integer := 0;
BEGIN
  FOR r IN
    SELECT ri.*, c.display_name, c.email, c.phone,
           c.payment_reminders_enabled, c.reminder_days_before_due,
           c.notify_customer
    FROM public.recurring_invoices ri
    JOIN public.customers c ON c.id = ri.customer_id AND c.business_id = ri.business_id
    WHERE ri.status = 'active'
      AND ri.next_run_date <= p_now::date
      AND (ri.end_date IS NULL OR ri.next_run_date <= ri.end_date)
    ORDER BY ri.next_run_date, ri.id
    FOR UPDATE OF ri
  LOOP
    INSERT INTO public.recurring_invoice_runs(business_id, recurring_invoice_id, scheduled_date)
    VALUES(r.business_id, r.id, r.next_run_date)
    ON CONFLICT(recurring_invoice_id, scheduled_date) DO NOTHING
    RETURNING id INTO run_id;

    IF run_id IS NULL THEN
      SELECT rir.id, rir.invoice_id, rir.status
      INTO run_id, inv_id, r.status
      FROM public.recurring_invoice_runs rir
      WHERE rir.recurring_invoice_id = r.id AND rir.scheduled_date = r.next_run_date;
      IF inv_id IS NOT NULL OR r.status IN ('generated','sent','skipped') THEN CONTINUE; END IF;
    END IF;

    BEGIN
      inv_num := public.next_document_number(r.business_id, 'invoice');
      due_date := CASE
        WHEN lower(coalesce(r.due_terms, '')) IN ('', 'due on receipt') THEN r.next_run_date
        WHEN regexp_replace(coalesce(r.due_terms,''), '[^0-9]', '', 'g') <> ''
          THEN r.next_run_date + regexp_replace(r.due_terms, '[^0-9]', '', 'g')::integer
        ELSE r.next_run_date
      END;

      INSERT INTO public.invoices(
        business_id, customer_id, invoice_number, invoice_date, due_date, status,
        currency_code, notes, terms, created_by
      ) VALUES(
        r.business_id, r.customer_id, inv_num, r.next_run_date, due_date,
        CASE WHEN r.auto_send THEN 'sent'::invoice_status ELSE 'draft'::invoice_status END,
        r.currency_code, r.notes, r.due_terms, NULL
      ) RETURNING id INTO inv_id;

      FOR item IN
        SELECT * FROM public.recurring_invoice_items
        WHERE recurring_invoice_id = r.id ORDER BY sort_order
      LOOP
        INSERT INTO public.invoice_items(
          invoice_id, product_service_id, description, quantity, unit_price,
          discount, tax_rate_id, sort_order
        ) VALUES(
          inv_id, item.product_service_id, item.description, item.quantity,
          item.unit_price, item.discount, item.tax_rate_id, item.sort_order
        );
      END LOOP;

      PERFORM public.recalculate_invoice_totals(inv_id);

      UPDATE public.recurring_invoice_runs
      SET invoice_id=inv_id,
          status=CASE WHEN r.auto_send THEN 'sent' ELSE 'generated' END,
          executed_at=p_now, updated_at=p_now, error_message=NULL
      WHERE id=run_id;

      next_date := CASE lower(r.frequency)
        WHEN 'weekly' THEN r.next_run_date + 7
        WHEN 'monthly' THEN (r.next_run_date + interval '1 month')::date
        WHEN 'quarterly' THEN (r.next_run_date + interval '3 months')::date
        WHEN 'half_yearly' THEN (r.next_run_date + interval '6 months')::date
        WHEN 'yearly' THEN (r.next_run_date + interval '1 year')::date
        WHEN 'custom' THEN CASE lower(coalesce(r.custom_interval_unit,'month'))
          WHEN 'day' THEN r.next_run_date + coalesce(r.custom_interval_count,1)
          WHEN 'week' THEN r.next_run_date + coalesce(r.custom_interval_count,1) * 7
          WHEN 'month' THEN (r.next_run_date + make_interval(months=>coalesce(r.custom_interval_count,1)))::date
          WHEN 'year' THEN (r.next_run_date + make_interval(months=>coalesce(r.custom_interval_count,1)*12))::date
          ELSE (r.next_run_date + interval '1 month')::date
        END
        ELSE (r.next_run_date + interval '1 month')::date
      END;

      UPDATE public.recurring_invoices
      SET next_run_date=next_date,
          status=CASE WHEN r.end_date IS NOT NULL AND next_date > r.end_date THEN 'completed' ELSE status END,
          updated_at=p_now
      WHERE id=r.id;

      IF r.auto_send AND coalesce(r.notify_customer,true) AND (r.email IS NOT NULL OR r.phone IS NOT NULL) THEN
        IF r.email IS NOT NULL THEN
          INSERT INTO public.notification_jobs(
            business_id, customer_id, invoice_id, channel, notification_type,
            recipient, subject, message, scheduled_for, metadata
          ) VALUES(
            r.business_id, r.customer_id, inv_id, 'email', 'recurring_invoice',
            r.email, 'Invoice '||inv_num,
            'Your recurring invoice '||inv_num||' is ready. Amount due: '||
              (SELECT total FROM public.invoices WHERE id=inv_id)||' '||r.currency_code||'.',
            p_now, jsonb_build_object('invoice_number',inv_num,'recurring_invoice_id',r.id)
          );
        END IF;
        IF r.phone IS NOT NULL THEN
          INSERT INTO public.notification_jobs(
            business_id, customer_id, invoice_id, channel, notification_type,
            recipient, subject, message, scheduled_for, metadata
          ) VALUES(
            r.business_id, r.customer_id, inv_id, 'whatsapp', 'recurring_invoice',
            r.phone, NULL,
            'Your recurring invoice '||inv_num||' is ready. Amount due: '||
              (SELECT total FROM public.invoices WHERE id=inv_id)||' '||r.currency_code||'.',
            p_now, jsonb_build_object('invoice_number',inv_num,'recurring_invoice_id',r.id)
          );
        END IF;
      END IF;

      IF r.auto_remind AND coalesce(r.payment_reminders_enabled,true) AND coalesce(r.notify_customer,true)
         AND (r.email IS NOT NULL OR r.phone IS NOT NULL) THEN
        IF r.reminder_before_due_days IS NOT NULL THEN
          reminder_at := due_date::timestamptz - make_interval(days=>greatest(r.reminder_before_due_days,0));
        ELSIF r.reminder_on_due THEN
          reminder_at := due_date::timestamptz;
        ELSIF r.reminder_after_due_days IS NOT NULL THEN
          reminder_at := due_date::timestamptz + make_interval(days=>greatest(r.reminder_after_due_days,0));
        ELSE
          due_days := greatest(coalesce(r.reminder_days_before_due,3),0);
          reminder_at := due_date::timestamptz - make_interval(days=>due_days);
        END IF;
        IF reminder_at < p_now THEN reminder_at := p_now; END IF;

        IF r.email IS NOT NULL THEN
          INSERT INTO public.notification_jobs(
            business_id, customer_id, invoice_id, channel, notification_type,
            recipient, subject, message, scheduled_for, metadata
          ) VALUES(
            r.business_id, r.customer_id, inv_id, 'email',
            CASE WHEN due_date < p_now::date THEN 'overdue' ELSE 'due_soon' END,
            r.email, 'Payment reminder · '||inv_num,
            'Payment reminder: invoice '||inv_num||' is due on '||due_date||
            '. Outstanding balance: '||(SELECT balance_due FROM public.invoices WHERE id=inv_id)||' '||r.currency_code||'.',
            reminder_at, jsonb_build_object('invoice_number',inv_num,'recurring_invoice_id',r.id,'source','recurring_settings')
          );
        END IF;
        IF r.phone IS NOT NULL THEN
          INSERT INTO public.notification_jobs(
            business_id, customer_id, invoice_id, channel, notification_type,
            recipient, subject, message, scheduled_for, metadata
          ) VALUES(
            r.business_id, r.customer_id, inv_id, 'whatsapp',
            CASE WHEN due_date < p_now::date THEN 'overdue' ELSE 'due_soon' END,
            r.phone, NULL,
            'Payment reminder: invoice '||inv_num||' is due on '||due_date||
            '. Outstanding balance: '||(SELECT balance_due FROM public.invoices WHERE id=inv_id)||' '||r.currency_code||'.',
            reminder_at, jsonb_build_object('invoice_number',inv_num,'recurring_invoice_id',r.id,'source','recurring_settings')
          );
        END IF;
      END IF;

      n := n + 1;
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.recurring_invoice_runs
      SET status='failed', error_message=SQLERRM, updated_at=p_now
      WHERE id=run_id;
    END;
  END LOOP;
  RETURN n;
END;
$function$;

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

SELECT cron.unschedule('moneymatters-invoice-reminders')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='moneymatters-invoice-reminders');
SELECT cron.unschedule('moneymatters-billing-automation')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='moneymatters-billing-automation');

SELECT cron.schedule(
  'moneymatters-billing-automation',
  '0 * * * *',
  $$
    SELECT public.process_due_recurring_invoices(now());
    SELECT public.enqueue_all_invoice_reminders(now());
    SELECT net.http_post(
      url := 'https://qpczmbvqflaqwvyphepf.supabase.co/functions/v1/process-notifications',
      body := jsonb_build_object('source','pg_cron','triggered_at',now()),
      headers := jsonb_build_object('Content-Type','application/json'),
      timeout_milliseconds := 10000
    );
  $$
)
WHERE NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname='moneymatters-billing-automation');

REVOKE ALL ON FUNCTION public.process_due_recurring_invoices(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_due_recurring_invoices(timestamptz) TO postgres, service_role;
