-- P0 payment ledger currency normalization and domestic FX hardening.
-- Production uses businesses.currency_code as the established operating currency;
-- public.chart_of_accounts and account-level currency_code do not exist.
BEGIN;

UPDATE public.businesses SET currency_code='INR'
WHERE currency_code IS NULL OR upper(btrim(currency_code))='INR';
UPDATE public.invoices SET currency_code='INR'
WHERE currency_code IS NULL OR upper(btrim(currency_code))='INR';
UPDATE public.bills SET currency_code='INR'
WHERE currency_code IS NULL OR upper(btrim(currency_code))='INR';

ALTER TABLE public.businesses DISABLE TRIGGER trg_business_base_currency_change;
ALTER TABLE public.journal_lines DISABLE TRIGGER trg_journal_line_dual_currency;
ALTER TABLE public.journal_lines DISABLE TRIGGER trg_immutable_journal_lines;
ALTER TABLE public.journal_lines DISABLE TRIGGER trg_prevent_posted_journal_lines;

UPDATE public.journal_lines jl
SET currency_code='INR', transaction_currency_code='INR', base_currency_code='INR',
    exchange_rate=1, exchange_rate_source='BASE_DOMESTIC',
    transaction_amount=round(abs(coalesce(jl.debit,0))+abs(coalesce(jl.credit,0)),6),
    base_amount=round(abs(coalesce(jl.debit,0))+abs(coalesce(jl.credit,0)),6)
FROM public.journal_entries je JOIN public.businesses b ON b.id=je.business_id
WHERE jl.journal_entry_id=je.id
  AND upper(coalesce(nullif(btrim(b.currency_code),''),'INR'))='INR'
  AND upper(coalesce(nullif(btrim(jl.transaction_currency_code),''),nullif(btrim(jl.currency_code),''),'INR'))='INR'
  AND jl.exchange_rate=1;

UPDATE public.businesses SET base_currency_code='INR'
WHERE upper(coalesce(nullif(btrim(currency_code),''),'INR'))='INR';

ALTER TABLE public.journal_lines ENABLE TRIGGER trg_prevent_posted_journal_lines;
ALTER TABLE public.journal_lines ENABLE TRIGGER trg_immutable_journal_lines;
ALTER TABLE public.journal_lines ENABLE TRIGGER trg_journal_line_dual_currency;
ALTER TABLE public.businesses ENABLE TRIGGER trg_business_base_currency_change;

CREATE OR REPLACE FUNCTION public.sync_journal_line_dual_currency()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','mm_private'
AS $function$
DECLARE v_business_base char(3); v_entry_currency char(3); v_side_amount numeric;
BEGIN
 SELECT upper(coalesce(nullif(btrim(je.currency_code),''),nullif(btrim(b.currency_code),''),nullif(btrim(b.base_currency_code),''),'INR')),
        upper(coalesce(nullif(btrim(b.base_currency_code),''),nullif(btrim(b.currency_code),''),'INR'))
 INTO v_entry_currency,v_business_base
 FROM public.journal_entries je JOIN public.businesses b ON b.id=je.business_id WHERE je.id=NEW.journal_entry_id;
 IF v_business_base IS NULL THEN RAISE EXCEPTION 'Journal entry not found for journal line'; END IF;
 NEW.transaction_currency_code:=upper(coalesce(nullif(btrim(NEW.transaction_currency_code),''),nullif(btrim(NEW.currency_code),''),v_entry_currency));
 NEW.base_currency_code:=upper(coalesce(nullif(btrim(NEW.base_currency_code),''),v_business_base));
 IF NEW.base_currency_code IS DISTINCT FROM v_business_base THEN RAISE EXCEPTION 'Journal line base currency must match the business base currency'; END IF;
 NEW.currency_code:=NEW.transaction_currency_code;
 IF NEW.transaction_currency_code=NEW.base_currency_code THEN
   NEW.exchange_rate:=1; NEW.exchange_rate_source:=coalesce(nullif(btrim(NEW.exchange_rate_source),''),'BASE_DOMESTIC');
 ELSIF NEW.exchange_rate IS NULL OR NEW.exchange_rate<=0 THEN
   RAISE EXCEPTION 'Foreign-currency journal lines require a positive exchange rate';
 ELSIF NEW.exchange_rate_source IS NULL OR btrim(NEW.exchange_rate_source)='' THEN
   RAISE EXCEPTION 'Foreign-currency journal lines require an exchange rate source';
 END IF;
 v_side_amount:=round(abs(coalesce(NEW.debit,0))+abs(coalesce(NEW.credit,0)),6);
 IF NEW.transaction_amount IS NULL THEN NEW.transaction_amount:=v_side_amount;
 ELSIF round(NEW.transaction_amount,6)<>v_side_amount THEN RAISE EXCEPTION 'Journal line transaction amount does not match debit/credit amount'; END IF;
 IF NEW.base_amount IS NULL THEN NEW.base_amount:=round(v_side_amount*NEW.exchange_rate,6);
 ELSIF round(NEW.base_amount,6)<>round(v_side_amount*NEW.exchange_rate,6) THEN RAISE EXCEPTION 'Journal line base amount does not match transaction amount and exchange rate'; END IF;
 NEW.exchange_rate_timestamp:=coalesce(NEW.exchange_rate_timestamp,now()); RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.validate_journal_entry_balance(p_entry_id uuid)
RETURNS boolean LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
DECLARE v_business_id uuid; v_business_base char(3); v_line_count integer; v_transaction_debit numeric; v_transaction_credit numeric; v_base_debit numeric; v_base_credit numeric; v_currency_count integer;
BEGIN
 SELECT je.business_id,upper(coalesce(nullif(btrim(b.base_currency_code),''),nullif(btrim(b.currency_code),''),'INR'))
 INTO v_business_id,v_business_base FROM public.journal_entries je JOIN public.businesses b ON b.id=je.business_id WHERE je.id=p_entry_id;
 IF v_business_id IS NULL THEN RAISE EXCEPTION 'Journal entry not found'; END IF;
 SELECT count(*),coalesce(sum(debit),0),coalesce(sum(credit),0),
        coalesce(sum(CASE WHEN debit>0 THEN base_amount ELSE 0 END),0),
        coalesce(sum(CASE WHEN credit>0 THEN base_amount ELSE 0 END),0),
        count(DISTINCT transaction_currency_code)
 INTO v_line_count,v_transaction_debit,v_transaction_credit,v_base_debit,v_base_credit,v_currency_count
 FROM public.journal_lines WHERE journal_entry_id=p_entry_id;
 IF v_line_count<2 THEN RAISE EXCEPTION 'Journal entry must contain at least two lines'; END IF;
 IF EXISTS(SELECT 1 FROM public.journal_lines jl WHERE jl.journal_entry_id=p_entry_id AND upper(coalesce(nullif(btrim(jl.base_currency_code),''),v_business_base)) IS DISTINCT FROM v_business_base) THEN RAISE EXCEPTION 'Journal entry contains a line with a base currency different from the business base currency'; END IF;
 IF v_currency_count<=1 AND v_transaction_debit<>v_transaction_credit THEN RAISE EXCEPTION 'Journal entry is not balanced: debit %, credit %',v_transaction_debit,v_transaction_credit; END IF;
 IF v_base_debit<>v_base_credit THEN RAISE EXCEPTION 'Journal entry is not balanced in business base currency: debit %, credit %',v_base_debit,v_base_credit; END IF;
 RETURN true;
END; $function$;

DROP FUNCTION IF EXISTS public.record_customer_payment(uuid,uuid,uuid,numeric,payment_method,uuid,text,text,date,text);
CREATE FUNCTION public.record_customer_payment(
 p_business_id uuid,p_customer_id uuid,p_invoice_id uuid,p_amount numeric,p_method payment_method,p_account_id uuid,
 p_reference text DEFAULT NULL,p_gateway_transaction_id text DEFAULT NULL,p_payment_date date DEFAULT CURRENT_DATE,
 p_notes text DEFAULT NULL,p_currency_code text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','mm_private'
AS $function$
DECLARE
 inv public.invoices%rowtype; v_payment uuid; v_receipt uuid; v_entry uuid; v_ar uuid; v_credit_acct uuid;
 v_number text; v_allocated numeric; v_excess numeric; v_total numeric; v_business_currency char(3); v_transaction_currency char(3);
BEGIN
 IF NOT mm_private.has_business_permission(p_business_id,'payments.receive') THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF p_amount<=0 THEN RAISE EXCEPTION 'Payment amount must be greater than zero'; END IF;
 PERFORM public.assert_accounting_period_open(p_business_id,p_payment_date);
 SELECT * INTO inv FROM public.invoices WHERE id=p_invoice_id AND business_id=p_business_id AND customer_id=p_customer_id FOR UPDATE;
 IF inv.id IS NULL THEN RAISE EXCEPTION 'Invoice not found'; END IF;
 IF inv.status='void' THEN RAISE EXCEPTION 'Cannot pay a void invoice'; END IF;
 IF inv.journal_entry_id IS NULL THEN PERFORM public.post_invoice(inv.id,NULL); SELECT * INTO inv FROM public.invoices WHERE id=inv.id FOR UPDATE; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.accounts WHERE id=p_account_id AND business_id=p_business_id AND is_active AND account_subtype IN ('cash','bank')) THEN RAISE EXCEPTION 'Deposit account must be Cash or Bank. Inventory, Furniture & Fixtures and other non-settlement accounts are not valid customer deposit accounts.'; END IF;
 SELECT upper(coalesce(nullif(btrim(base_currency_code),''),nullif(btrim(currency_code),''),'INR')) INTO v_business_currency FROM public.businesses WHERE id=p_business_id AND is_active;
 IF v_business_currency IS NULL THEN RAISE EXCEPTION 'Business not found'; END IF;
 v_transaction_currency:=upper(coalesce(nullif(btrim(p_currency_code),''),nullif(btrim(inv.currency_code),''),v_business_currency));
 IF v_transaction_currency<>v_business_currency THEN RAISE EXCEPTION 'Foreign-currency customer payments require an explicit FX rate workflow'; END IF;
 SELECT id INTO v_ar FROM public.accounts WHERE business_id=p_business_id AND code='1100' AND is_active;
 IF v_ar IS NULL THEN RAISE EXCEPTION 'Accounts receivable account is missing'; END IF;
 v_allocated:=least(p_amount,greatest(inv.balance_due,0)); v_excess:=greatest(p_amount-v_allocated,0);
 IF v_excess>0 THEN INSERT INTO public.accounts(business_id,code,name,account_type,normal_balance,is_system,is_active,description) SELECT p_business_id,'2150','Customer Credits','liability','credit',true,true,'Customer overpayments and unapplied credits' WHERE NOT EXISTS(SELECT 1 FROM public.accounts WHERE business_id=p_business_id AND code='2150'); END IF;
 SELECT id INTO v_credit_acct FROM public.accounts WHERE business_id=p_business_id AND code='2150' AND is_active;
 INSERT INTO public.payments(business_id,direction,customer_id,invoice_id,account_id,amount,currency_code,payment_date,method,reference,gateway_transaction_id,notes,created_by) VALUES(p_business_id,'inbound',p_customer_id,p_invoice_id,p_account_id,p_amount,v_transaction_currency,p_payment_date,p_method,p_reference,p_gateway_transaction_id,p_notes,auth.uid()) RETURNING id INTO v_payment;
 IF v_allocated>0 THEN INSERT INTO public.payment_allocations(business_id,payment_id,invoice_id,amount) VALUES(p_business_id,v_payment,p_invoice_id,v_allocated); END IF;
 IF v_excess>0 THEN INSERT INTO public.customer_credit_ledger(business_id,customer_id,payment_id,entry_type,amount,currency_code,description,created_by) VALUES(p_business_id,p_customer_id,v_payment,'overpayment',v_excess,v_transaction_currency,'Unapplied customer overpayment',auth.uid()); END IF;
 PERFORM pg_advisory_xact_lock(hashtext('journal-entry-number:'||p_business_id::text));
 INSERT INTO public.journal_entries(business_id,entry_number,entry_date,description,source_type,source_id,status,posted_at,posted_by,created_by,currency_code,total_debit,total_credit,is_system_generated) VALUES(p_business_id,(select coalesce(max(entry_number),0)+1 from public.journal_entries where business_id=p_business_id),p_payment_date,'Payment received for invoice '||inv.invoice_number,'payment',v_payment,'posted',now(),auth.uid(),auth.uid(),v_transaction_currency,p_amount,p_amount,true) RETURNING id INTO v_entry;
 INSERT INTO public.journal_lines(journal_entry_id,account_id,description,debit,credit,currency_code,entity_type,entity_id,exchange_rate,exchange_rate_source,transaction_currency_code,transaction_amount,base_currency_code,base_amount) VALUES(v_entry,p_account_id,'Customer payment',p_amount,0,v_transaction_currency,'customer',p_customer_id,1,'BASE_DOMESTIC',v_transaction_currency,p_amount,v_business_currency,p_amount);
 IF v_allocated>0 THEN INSERT INTO public.journal_lines(journal_entry_id,account_id,description,debit,credit,currency_code,entity_type,entity_id,exchange_rate,exchange_rate_source,transaction_currency_code,transaction_amount,base_currency_code,base_amount) VALUES(v_entry,v_ar,'Receivable settlement',0,v_allocated,v_transaction_currency,'customer',p_customer_id,1,'BASE_DOMESTIC',v_transaction_currency,v_allocated,v_business_currency,v_allocated); END IF;
 IF v_excess>0 THEN INSERT INTO public.journal_lines(journal_entry_id,account_id,description,debit,credit,currency_code,entity_type,entity_id,exchange_rate,exchange_rate_source,transaction_currency_code,transaction_amount,base_currency_code,base_amount) VALUES(v_entry,v_credit_acct,'Customer credit',0,v_excess,v_transaction_currency,'customer',p_customer_id,1,'BASE_DOMESTIC',v_transaction_currency,v_excess,v_business_currency,v_excess); END IF;
 PERFORM public.validate_journal_entry_balance(v_entry); UPDATE public.payments SET journal_entry_id=v_entry WHERE id=v_payment;
 SELECT coalesce(sum(pa.amount),0) INTO v_total FROM public.payment_allocations pa WHERE pa.invoice_id=inv.id;
 UPDATE public.invoices SET amount_paid=v_total,balance_due=greatest(total-v_total,0),status=case when v_total>=total then 'paid'::invoice_status when v_total>0 and due_date<current_date then 'overdue'::invoice_status when v_total>0 then 'partially_paid'::invoice_status when due_date<current_date then 'overdue'::invoice_status else 'sent'::invoice_status end,updated_at=now() WHERE id=inv.id;
 v_number:=public.next_document_number(p_business_id,'receipt');
 INSERT INTO public.receipts(business_id,customer_id,payment_id,receipt_number,receipt_date,amount,currency_code,payment_method,reference_number,notes,created_by) VALUES(p_business_id,p_customer_id,v_payment,v_number,p_payment_date,p_amount,v_transaction_currency,p_method::text,p_reference,p_notes,auth.uid()) RETURNING id INTO v_receipt;
 RETURN v_receipt;
END; $function$;
REVOKE ALL ON FUNCTION public.record_customer_payment(uuid,uuid,uuid,numeric,payment_method,uuid,text,text,date,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_customer_payment(uuid,uuid,uuid,numeric,payment_method,uuid,text,text,date,text,text) TO authenticated;

DROP FUNCTION IF EXISTS public.record_vendor_payment(uuid,uuid,uuid,numeric,text,uuid,text,date,text);
CREATE FUNCTION public.record_vendor_payment(
 p_business_id uuid,p_vendor_id uuid,p_bill_id uuid,p_amount numeric,p_method text,p_account_id uuid,
 p_reference text DEFAULT NULL,p_payment_date date DEFAULT CURRENT_DATE,p_notes text DEFAULT NULL,p_currency_code text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','mm_private'
AS $function$
DECLARE v_payment uuid; v_bill public.bills%rowtype; v_alloc numeric; v_remaining numeric; v_credit numeric; v_ap uuid; v_advance uuid; v_entry uuid; v_method payment_method; v_entry_number bigint; v_paid numeric; v_business_currency char(3); v_transaction_currency char(3);
BEGIN
 IF NOT mm_private.has_business_permission(p_business_id,'payments.pay') THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF p_amount<=0 THEN RAISE EXCEPTION 'Payment amount must be positive'; END IF;
 PERFORM public.assert_accounting_period_open(p_business_id,p_payment_date);
 v_method:=case lower(p_method) when 'gateway' then 'payment_gateway'::payment_method else lower(p_method)::payment_method end;
 SELECT * INTO v_bill FROM public.bills WHERE id=p_bill_id AND business_id=p_business_id AND vendor_id=p_vendor_id FOR UPDATE;
 IF v_bill.id IS NULL THEN RAISE EXCEPTION 'Bill not found'; END IF;
 SELECT upper(coalesce(nullif(btrim(base_currency_code),''),nullif(btrim(currency_code),''),'INR')) INTO v_business_currency FROM public.businesses WHERE id=p_business_id AND is_active;
 IF v_business_currency IS NULL THEN RAISE EXCEPTION 'Business not found'; END IF;
 v_transaction_currency:=upper(coalesce(nullif(btrim(p_currency_code),''),nullif(btrim(v_bill.currency_code),''),v_business_currency));
 IF v_transaction_currency<>v_business_currency THEN RAISE EXCEPTION 'Foreign-currency vendor payments require an explicit FX rate workflow'; END IF;
 SELECT coalesce(sum(vpa.amount),0) INTO v_alloc FROM public.vendor_payment_allocations vpa WHERE vpa.bill_id=p_bill_id;
 v_remaining:=greatest(v_bill.total-v_alloc,0); v_credit:=greatest(p_amount-v_remaining,0);
 IF NOT EXISTS(select 1 from public.accounts where id=p_account_id and business_id=p_business_id and is_active) THEN RAISE EXCEPTION 'Payment account is invalid'; END IF;
 SELECT id INTO v_ap FROM public.accounts WHERE business_id=p_business_id AND code='2000' AND is_active;
 IF v_ap IS NULL THEN RAISE EXCEPTION 'Accounts payable account is missing'; END IF;
 INSERT INTO public.payments(business_id,direction,vendor_id,bill_id,account_id,amount,currency_code,payment_date,method,reference,notes,created_by) VALUES(p_business_id,'outbound',p_vendor_id,p_bill_id,p_account_id,p_amount,v_transaction_currency,p_payment_date,v_method,p_reference,p_notes,auth.uid()) RETURNING id INTO v_payment;
 IF v_remaining>0 THEN INSERT INTO public.vendor_payment_allocations(business_id,payment_id,vendor_id,bill_id,amount) VALUES(p_business_id,v_payment,p_vendor_id,p_bill_id,least(p_amount,v_remaining)); END IF;
 IF v_credit>0 THEN INSERT INTO public.vendor_credit_ledger(business_id,vendor_id,payment_id,entry_type,amount,currency_code,description,created_by) VALUES(p_business_id,p_vendor_id,v_payment,'overpayment',v_credit,v_transaction_currency,'Unapplied vendor overpayment',auth.uid()); END IF;
 PERFORM pg_advisory_xact_lock(hashtext('journal-entry-number:'||p_business_id::text)); SELECT coalesce(max(entry_number),0)+1 INTO v_entry_number FROM public.journal_entries WHERE business_id=p_business_id;
 INSERT INTO public.journal_entries(business_id,entry_number,entry_date,description,source_type,source_id,status,posted_at,posted_by,created_by,currency_code,total_debit,total_credit,is_system_generated) VALUES(p_business_id,v_entry_number,p_payment_date,'Payment made to vendor for bill '||v_bill.bill_number,'vendor_payment',v_payment,'posted',now(),auth.uid(),auth.uid(),v_transaction_currency,p_amount,p_amount,true) RETURNING id INTO v_entry;
 INSERT INTO public.journal_lines(journal_entry_id,account_id,description,debit,credit,currency_code,entity_type,entity_id,exchange_rate,exchange_rate_source,transaction_currency_code,transaction_amount,base_currency_code,base_amount)
 VALUES(v_entry,v_ap,'Accounts payable settlement',least(p_amount,v_remaining),0,v_transaction_currency,'vendor',p_vendor_id,1,'BASE_DOMESTIC',v_transaction_currency,least(p_amount,v_remaining),v_business_currency,least(p_amount,v_remaining)),
       (v_entry,p_account_id,'Vendor payment',0,p_amount,v_transaction_currency,'vendor',p_vendor_id,1,'BASE_DOMESTIC',v_transaction_currency,p_amount,v_business_currency,p_amount);
 IF v_credit>0 THEN
   SELECT id INTO v_advance FROM public.accounts WHERE business_id=p_business_id AND code='1255' AND is_active;
   IF v_advance IS NULL THEN INSERT INTO public.accounts(business_id,code,name,account_type,normal_balance,is_system,is_active,description) VALUES(p_business_id,'1255','Vendor Advances','asset','debit',true,true,'Vendor overpayments and advances') RETURNING id INTO v_advance; END IF;
   INSERT INTO public.journal_lines(journal_entry_id,account_id,description,debit,credit,currency_code,entity_type,entity_id,exchange_rate,exchange_rate_source,transaction_currency_code,transaction_amount,base_currency_code,base_amount) VALUES(v_entry,v_advance,'Vendor overpayment / advance',v_credit,0,v_transaction_currency,'vendor',p_vendor_id,1,'BASE_DOMESTIC',v_transaction_currency,v_credit,v_business_currency,v_credit);
 END IF;
 PERFORM public.validate_journal_entry_balance(v_entry); UPDATE public.payments SET journal_entry_id=v_entry WHERE id=v_payment;
 SELECT coalesce(sum(vpa.amount),0) INTO v_paid FROM public.vendor_payment_allocations vpa WHERE vpa.bill_id=p_bill_id;
 UPDATE public.bills SET amount_paid=least(total,v_paid),balance_due=greatest(total-v_paid,0),status=case when total<=v_paid then 'paid'::bill_status when v_paid>0 then 'partially_paid'::bill_status else status end,updated_at=now() WHERE id=p_bill_id;
 RETURN v_payment;
END; $function$;
REVOKE ALL ON FUNCTION public.record_vendor_payment(uuid,uuid,uuid,numeric,text,uuid,text,date,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_vendor_payment(uuid,uuid,uuid,numeric,text,uuid,text,date,text,text) TO authenticated;

DROP FUNCTION IF EXISTS public.record_vendor_payment_unapplied(uuid,uuid,numeric,text,uuid,date,text,text);
CREATE FUNCTION public.record_vendor_payment_unapplied(
 p_business_id uuid,p_vendor_id uuid,p_amount numeric,p_method text,p_account_id uuid,p_payment_date date,
 p_reference text DEFAULT NULL,p_notes text DEFAULT NULL,p_currency_code text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','mm_private'
AS $function$
DECLARE v_payment uuid; v_entry uuid; v_advance uuid; v_vendor_business uuid; v_currency bpchar; v_method public.payment_method; v_entry_number bigint; v_business_currency char(3); v_transaction_currency char(3);
BEGIN
 IF NOT mm_private.has_business_permission(p_business_id,'payments.pay') THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF p_amount<=0 THEN RAISE EXCEPTION 'Payment amount must be greater than zero'; END IF;
 SELECT v.business_id INTO v_vendor_business FROM public.vendors v WHERE v.id=p_vendor_id AND v.business_id=p_business_id AND v.is_active;
 IF v_vendor_business IS NULL THEN RAISE EXCEPTION 'Supplier not found'; END IF;
 PERFORM public.assert_accounting_period_open(p_business_id,p_payment_date);
 IF NOT EXISTS(SELECT 1 FROM public.accounts a WHERE a.id=p_account_id AND a.business_id=p_business_id AND a.is_active AND a.account_subtype IN ('cash','bank')) THEN RAISE EXCEPTION 'Payment account must be an active Cash or Bank account'; END IF;
 SELECT upper(coalesce(nullif(btrim(base_currency_code),''),nullif(btrim(currency_code),''),'INR')) INTO v_business_currency FROM public.businesses WHERE id=p_business_id AND is_active;
 IF v_business_currency IS NULL THEN RAISE EXCEPTION 'Business not found'; END IF;
 v_transaction_currency:=upper(coalesce(nullif(btrim(p_currency_code),''),v_business_currency));
 IF v_transaction_currency<>v_business_currency THEN RAISE EXCEPTION 'Foreign-currency vendor payments require an explicit FX rate workflow'; END IF;
 v_currency:=v_transaction_currency;
 v_method:=case when lower(p_method)='gateway' then 'payment_gateway'::public.payment_method else lower(p_method)::public.payment_method end;
 SELECT id INTO v_advance FROM public.accounts WHERE business_id=p_business_id AND code='1255' AND is_active FOR UPDATE;
 IF v_advance IS NULL THEN INSERT INTO public.accounts(business_id,code,name,account_type,normal_balance,is_system,is_active,description) VALUES(p_business_id,'1255','Vendor Advances','asset','debit',true,true,'Vendor overpayments and advances') RETURNING id INTO v_advance; END IF;
 INSERT INTO public.payments(business_id,direction,vendor_id,account_id,amount,currency_code,payment_date,method,reference,notes,created_by) VALUES(p_business_id,'outbound',p_vendor_id,p_account_id,p_amount,v_currency,p_payment_date,v_method,nullif(trim(p_reference),''),p_notes,auth.uid()) RETURNING id INTO v_payment;
 INSERT INTO public.vendor_credit_ledger(business_id,vendor_id,payment_id,entry_type,amount,currency_code,description,created_by) VALUES(p_business_id,p_vendor_id,v_payment,'overpayment',p_amount,v_currency,'Unapplied supplier payment / vendor advance',auth.uid());
 PERFORM pg_advisory_xact_lock(hashtext('journal-entry-number:'||p_business_id::text)); SELECT coalesce(max(entry_number),0)+1 INTO v_entry_number FROM public.journal_entries WHERE business_id=p_business_id;
 INSERT INTO public.journal_entries(business_id,entry_number,entry_date,description,source_type,source_id,status,posted_at,posted_by,created_by,currency_code,total_debit,total_credit,is_system_generated) VALUES(p_business_id,v_entry_number,p_payment_date,'Unapplied supplier payment to '||p_vendor_id::text,'vendor_payment',v_payment,'posted',now(),auth.uid(),auth.uid(),v_currency,p_amount,p_amount,true) RETURNING id INTO v_entry;
 INSERT INTO public.journal_lines(journal_entry_id,account_id,description,debit,credit,currency_code,entity_type,entity_id,exchange_rate,exchange_rate_source,transaction_currency_code,transaction_amount,base_currency_code,base_amount)
 VALUES(v_entry,v_advance,'Vendor advance / unapplied supplier payment',p_amount,0,v_currency,'vendor',p_vendor_id,1,'BASE_DOMESTIC',v_currency,p_amount,v_business_currency,p_amount),
       (v_entry,p_account_id,'Supplier payment',0,p_amount,v_currency,'vendor',p_vendor_id,1,'BASE_DOMESTIC',v_currency,p_amount,v_business_currency,p_amount);
 PERFORM public.validate_journal_entry_balance(v_entry);
 UPDATE public.payments SET journal_entry_id=v_entry WHERE id=v_payment;
 RETURN v_payment;
END; $function$;
REVOKE ALL ON FUNCTION public.record_vendor_payment_unapplied(uuid,uuid,numeric,text,uuid,date,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_vendor_payment_unapplied(uuid,uuid,numeric,text,uuid,date,text,text,text) TO authenticated;

COMMIT;

COMMIT;