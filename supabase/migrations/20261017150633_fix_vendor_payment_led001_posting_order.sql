-- LED-001 compatibility fix for both allocated vendor bill payments and
-- unapplied vendor advances. Keep posted journal entries immutable: build lines
-- under draft status, then post only after all lines have been inserted.
BEGIN;

CREATE OR REPLACE FUNCTION public.record_vendor_payment(
 p_business_id uuid,
 p_vendor_id uuid,
 p_bill_id uuid,
 p_amount numeric,
 p_method text,
 p_account_id uuid,
 p_reference text DEFAULT NULL,
 p_payment_date date DEFAULT CURRENT_DATE,
 p_notes text DEFAULT NULL,
 p_currency_code text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','mm_private'
AS $function$
DECLARE
 v_payment uuid;
 v_bill public.bills%rowtype;
 v_alloc numeric;
 v_remaining numeric;
 v_credit numeric;
 v_ap uuid;
 v_advance uuid;
 v_entry uuid;
 v_method payment_method;
 v_entry_number bigint;
 v_paid numeric;
 v_business_currency char(3);
 v_transaction_currency char(3);
BEGIN
 IF NOT mm_private.has_business_permission(p_business_id,'payments.pay') THEN
   RAISE EXCEPTION 'Access denied';
 END IF;
 IF p_amount IS NULL OR p_amount<=0 THEN
   RAISE EXCEPTION 'Payment amount must be positive';
 END IF;
 PERFORM public.assert_accounting_period_open(p_business_id,p_payment_date);
 v_method:=CASE lower(p_method) WHEN 'gateway' THEN 'payment_gateway'::payment_method ELSE lower(p_method)::payment_method END;

 SELECT * INTO v_bill
 FROM public.bills
 WHERE id=p_bill_id AND business_id=p_business_id AND vendor_id=p_vendor_id
 FOR UPDATE;
 IF v_bill.id IS NULL THEN RAISE EXCEPTION 'Bill not found'; END IF;

 SELECT upper(coalesce(nullif(btrim(base_currency_code),''),nullif(btrim(currency_code),''),'INR'))
 INTO v_business_currency
 FROM public.businesses WHERE id=p_business_id AND is_active;
 IF v_business_currency IS NULL THEN RAISE EXCEPTION 'Business not found'; END IF;
 v_transaction_currency:=upper(coalesce(nullif(btrim(p_currency_code),''),nullif(btrim(v_bill.currency_code),''),v_business_currency));
 IF v_transaction_currency<>v_business_currency THEN
   RAISE EXCEPTION 'Foreign-currency vendor payments require an explicit FX rate workflow';
 END IF;

 SELECT coalesce(sum(vpa.amount),0) INTO v_alloc
 FROM public.vendor_payment_allocations vpa WHERE vpa.bill_id=p_bill_id;
 v_remaining:=greatest(v_bill.total-v_alloc,0);
 v_credit:=greatest(p_amount-v_remaining,0);

 IF NOT EXISTS (
   SELECT 1 FROM public.accounts
   WHERE id=p_account_id AND business_id=p_business_id AND is_active
     AND account_subtype IN ('cash','bank')
 ) THEN
   RAISE EXCEPTION 'Payment account must be an active Cash or Bank account';
 END IF;
 SELECT id INTO v_ap FROM public.accounts
 WHERE business_id=p_business_id AND code='2000' AND is_active;
 IF v_ap IS NULL THEN RAISE EXCEPTION 'Accounts payable account is missing'; END IF;

 INSERT INTO public.payments(
   business_id,direction,vendor_id,bill_id,account_id,amount,currency_code,
   payment_date,method,reference,notes,created_by
 ) VALUES (
   p_business_id,'outbound',p_vendor_id,p_bill_id,p_account_id,p_amount,
   v_transaction_currency,p_payment_date,v_method,p_reference,p_notes,auth.uid()
 ) RETURNING id INTO v_payment;

 IF v_remaining>0 THEN
   INSERT INTO public.vendor_payment_allocations(business_id,payment_id,vendor_id,bill_id,amount)
   VALUES(p_business_id,v_payment,p_vendor_id,p_bill_id,least(p_amount,v_remaining));
 END IF;
 IF v_credit>0 THEN
   INSERT INTO public.vendor_credit_ledger(
     business_id,vendor_id,payment_id,entry_type,amount,currency_code,description,created_by
   ) VALUES(
     p_business_id,p_vendor_id,v_payment,'overpayment',v_credit,v_transaction_currency,
     'Unapplied vendor overpayment',auth.uid()
   );
 END IF;

 PERFORM pg_advisory_xact_lock(hashtext('journal-entry-number:'||p_business_id::text));
 SELECT coalesce(max(entry_number),0)+1 INTO v_entry_number
 FROM public.journal_entries WHERE business_id=p_business_id;

 INSERT INTO public.journal_entries(
   business_id,entry_number,entry_date,description,source_type,source_id,status,
   posted_at,posted_by,created_by,currency_code,total_debit,total_credit,is_system_generated
 ) VALUES(
   p_business_id,v_entry_number,p_payment_date,
   'Payment made to vendor for bill '||v_bill.bill_number,
   'vendor_payment',v_payment,'draft',NULL,NULL,auth.uid(),
   v_transaction_currency,0,0,true
 ) RETURNING id INTO v_entry;

 -- Avoid a zero/zero AP journal line if the bill is already fully allocated.
 IF v_remaining>0 THEN
   INSERT INTO public.journal_lines(
     journal_entry_id,account_id,description,debit,credit,currency_code,entity_type,entity_id,
     exchange_rate,exchange_rate_source,transaction_currency_code,transaction_amount,
     base_currency_code,base_amount
   ) VALUES(
     v_entry,v_ap,'Accounts payable settlement',least(p_amount,v_remaining),0,
     v_transaction_currency,'vendor',p_vendor_id,1,'BASE_DOMESTIC',
     v_transaction_currency,least(p_amount,v_remaining),v_business_currency,least(p_amount,v_remaining)
   );
 END IF;

 INSERT INTO public.journal_lines(
   journal_entry_id,account_id,description,debit,credit,currency_code,entity_type,entity_id,
   exchange_rate,exchange_rate_source,transaction_currency_code,transaction_amount,
   base_currency_code,base_amount
 ) VALUES(
   v_entry,p_account_id,'Vendor payment',0,p_amount,v_transaction_currency,'vendor',p_vendor_id,
   1,'BASE_DOMESTIC',v_transaction_currency,p_amount,v_business_currency,p_amount
 );

 IF v_credit>0 THEN
   SELECT id INTO v_advance FROM public.accounts
   WHERE business_id=p_business_id AND code='1255' AND is_active;
   IF v_advance IS NULL THEN
     INSERT INTO public.accounts(
       business_id,code,name,account_type,normal_balance,is_system,is_active,description
     ) VALUES(
       p_business_id,'1255','Vendor Advances','asset','debit',true,true,
       'Vendor overpayments and advances'
     ) RETURNING id INTO v_advance;
   END IF;
   INSERT INTO public.journal_lines(
     journal_entry_id,account_id,description,debit,credit,currency_code,entity_type,entity_id,
     exchange_rate,exchange_rate_source,transaction_currency_code,transaction_amount,
     base_currency_code,base_amount
   ) VALUES(
     v_entry,v_advance,'Vendor overpayment / advance',v_credit,0,v_transaction_currency,
     'vendor',p_vendor_id,1,'BASE_DOMESTIC',v_transaction_currency,v_credit,
     v_business_currency,v_credit
   );
 END IF;

 UPDATE public.journal_entries
 SET status='posted',posted_at=now(),posted_by=auth.uid()
 WHERE id=v_entry AND status='draft';
 PERFORM public.validate_journal_entry_balance(v_entry);
 UPDATE public.payments SET journal_entry_id=v_entry WHERE id=v_payment;

 SELECT coalesce(sum(vpa.amount),0) INTO v_paid
 FROM public.vendor_payment_allocations vpa WHERE vpa.bill_id=p_bill_id;
 UPDATE public.bills
 SET amount_paid=least(total,v_paid),
     balance_due=greatest(total-v_paid,0),
     status=CASE
       WHEN total<=v_paid THEN 'paid'::bill_status
       WHEN v_paid>0 THEN 'partially_paid'::bill_status
       ELSE status
     END,
     updated_at=now()
 WHERE id=p_bill_id;

 RETURN v_payment;
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_vendor_payment_unapplied(
 p_business_id uuid,
 p_vendor_id uuid,
 p_amount numeric,
 p_method text,
 p_account_id uuid,
 p_payment_date date,
 p_reference text DEFAULT NULL,
 p_notes text DEFAULT NULL,
 p_currency_code text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','mm_private'
AS $function$
DECLARE
 v_payment uuid;
 v_entry uuid;
 v_advance uuid;
 v_vendor_business uuid;
 v_currency bpchar;
 v_method public.payment_method;
 v_entry_number bigint;
 v_business_currency char(3);
 v_transaction_currency char(3);
BEGIN
 IF NOT mm_private.has_business_permission(p_business_id,'payments.pay') THEN
   RAISE EXCEPTION 'Access denied';
 END IF;
 IF p_amount IS NULL OR p_amount<=0 THEN
   RAISE EXCEPTION 'Payment amount must be greater than zero';
 END IF;
 SELECT v.business_id INTO v_vendor_business
 FROM public.vendors v
 WHERE v.id=p_vendor_id AND v.business_id=p_business_id AND v.is_active;
 IF v_vendor_business IS NULL THEN RAISE EXCEPTION 'Supplier not found'; END IF;
 PERFORM public.assert_accounting_period_open(p_business_id,p_payment_date);
 IF NOT EXISTS(
   SELECT 1 FROM public.accounts a
   WHERE a.id=p_account_id AND a.business_id=p_business_id AND a.is_active
     AND a.account_subtype IN ('cash','bank')
 ) THEN
   RAISE EXCEPTION 'Payment account must be an active Cash or Bank account';
 END IF;
 SELECT upper(coalesce(nullif(btrim(base_currency_code),''),nullif(btrim(currency_code),''),'INR'))
 INTO v_business_currency
 FROM public.businesses WHERE id=p_business_id AND is_active;
 IF v_business_currency IS NULL THEN RAISE EXCEPTION 'Business not found'; END IF;
 v_transaction_currency:=upper(coalesce(nullif(btrim(p_currency_code),''),v_business_currency));
 IF v_transaction_currency<>v_business_currency THEN
   RAISE EXCEPTION 'Foreign-currency vendor payments require an explicit FX rate workflow';
 END IF;
 v_currency:=v_transaction_currency;
 v_method:=CASE WHEN lower(p_method)='gateway' THEN 'payment_gateway'::public.payment_method ELSE lower(p_method)::public.payment_method END;

 SELECT id INTO v_advance FROM public.accounts
 WHERE business_id=p_business_id AND code='1255' AND is_active FOR UPDATE;
 IF v_advance IS NULL THEN
   INSERT INTO public.accounts(
     business_id,code,name,account_type,normal_balance,is_system,is_active,description
   ) VALUES(
     p_business_id,'1255','Vendor Advances','asset','debit',true,true,
     'Vendor overpayments and advances'
   ) RETURNING id INTO v_advance;
 END IF;

 INSERT INTO public.payments(
   business_id,direction,vendor_id,account_id,amount,currency_code,payment_date,
   method,reference,notes,created_by
 ) VALUES(
   p_business_id,'outbound',p_vendor_id,p_account_id,p_amount,v_currency,p_payment_date,
   v_method,nullif(trim(p_reference),''),p_notes,auth.uid()
 ) RETURNING id INTO v_payment;

 INSERT INTO public.vendor_credit_ledger(
   business_id,vendor_id,payment_id,entry_type,amount,currency_code,description,created_by
 ) VALUES(
   p_business_id,p_vendor_id,v_payment,'overpayment',p_amount,v_currency,
   'Unapplied supplier payment / vendor advance',auth.uid()
 );

 PERFORM pg_advisory_xact_lock(hashtext('journal-entry-number:'||p_business_id::text));
 SELECT coalesce(max(entry_number),0)+1 INTO v_entry_number
 FROM public.journal_entries WHERE business_id=p_business_id;

 INSERT INTO public.journal_entries(
   business_id,entry_number,entry_date,description,source_type,source_id,status,
   posted_at,posted_by,created_by,currency_code,total_debit,total_credit,is_system_generated
 ) VALUES(
   p_business_id,v_entry_number,p_payment_date,'Unapplied supplier payment to '||p_vendor_id::text,
   'vendor_payment',v_payment,'draft',NULL,NULL,auth.uid(),v_currency,0,0,true
 ) RETURNING id INTO v_entry;

 INSERT INTO public.journal_lines(
   journal_entry_id,account_id,description,debit,credit,currency_code,entity_type,entity_id,
   exchange_rate,exchange_rate_source,transaction_currency_code,transaction_amount,
   base_currency_code,base_amount
 ) VALUES
 (
   v_entry,v_advance,'Vendor advance / unapplied supplier payment',p_amount,0,v_currency,
   'vendor',p_vendor_id,1,'BASE_DOMESTIC',v_currency,p_amount,v_business_currency,p_amount
 ),
 (
   v_entry,p_account_id,'Supplier payment',0,p_amount,v_currency,
   'vendor',p_vendor_id,1,'BASE_DOMESTIC',v_currency,p_amount,v_business_currency,p_amount
 );

 UPDATE public.journal_entries
 SET status='posted',posted_at=now(),posted_by=auth.uid()
 WHERE id=v_entry AND status='draft';
 PERFORM public.validate_journal_entry_balance(v_entry);
 UPDATE public.payments SET journal_entry_id=v_entry WHERE id=v_payment;
 RETURN v_payment;
END;
$function$;

REVOKE ALL ON FUNCTION public.record_vendor_payment(uuid,uuid,uuid,numeric,text,uuid,text,date,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_vendor_payment(uuid,uuid,uuid,numeric,text,uuid,text,date,text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.record_vendor_payment_unapplied(uuid,uuid,numeric,text,uuid,date,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_vendor_payment_unapplied(uuid,uuid,numeric,text,uuid,date,text,text,text) TO authenticated;

COMMIT;
