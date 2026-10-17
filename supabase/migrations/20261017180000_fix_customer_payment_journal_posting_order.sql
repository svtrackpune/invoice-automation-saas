BEGIN;

-- Customer payments were creating posted journal headers before inserting lines.
-- Keep the entry in draft until all tender lines are present and balanced.
CREATE OR REPLACE FUNCTION public.record_customer_payment(p_business_id uuid, p_customer_id uuid, p_invoice_id uuid, p_amount numeric, p_method payment_method, p_account_id uuid, p_reference text DEFAULT NULL::text, p_gateway_transaction_id text DEFAULT NULL::text, p_payment_date date DEFAULT CURRENT_DATE, p_notes text DEFAULT NULL::text, p_currency_code text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE inv public.invoices%rowtype; v_payment uuid; v_receipt uuid; v_entry uuid; v_ar uuid; v_credit_acct uuid; v_number text; v_allocated numeric; v_excess numeric; v_total numeric; v_business_currency char(3); v_transaction_currency char(3);
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
 INSERT INTO public.journal_entries(business_id,entry_number,entry_date,description,source_type,source_id,status,posted_at,posted_by,created_by,currency_code,total_debit,total_credit,is_system_generated) VALUES(p_business_id,(select coalesce(max(entry_number),0)+1 from public.journal_entries where business_id=p_business_id),p_payment_date,'Payment received for invoice '||inv.invoice_number,'payment',v_payment,'draft',NULL,NULL,auth.uid(),v_transaction_currency,p_amount,p_amount,true) RETURNING id INTO v_entry;
 INSERT INTO public.journal_lines(journal_entry_id,account_id,description,debit,credit,currency_code,entity_type,entity_id,exchange_rate,exchange_rate_source,transaction_currency_code,transaction_amount,base_currency_code,base_amount) VALUES(v_entry,p_account_id,'Customer payment',p_amount,0,v_transaction_currency,'customer',p_customer_id,1,'BASE_DOMESTIC',v_transaction_currency,p_amount,v_business_currency,p_amount);
 IF v_allocated>0 THEN INSERT INTO public.journal_lines(journal_entry_id,account_id,description,debit,credit,currency_code,entity_type,entity_id,exchange_rate,exchange_rate_source,transaction_currency_code,transaction_amount,base_currency_code,base_amount) VALUES(v_entry,v_ar,'Receivable settlement',0,v_allocated,v_transaction_currency,'customer',p_customer_id,1,'BASE_DOMESTIC',v_transaction_currency,v_allocated,v_business_currency,v_allocated); END IF;
 IF v_excess>0 THEN INSERT INTO public.journal_lines(journal_entry_id,account_id,description,debit,credit,currency_code,entity_type,entity_id,exchange_rate,exchange_rate_source,transaction_currency_code,transaction_amount,base_currency_code,base_amount) VALUES(v_entry,v_credit_acct,'Customer credit',0,v_excess,v_transaction_currency,'customer',p_customer_id,1,'BASE_DOMESTIC',v_transaction_currency,v_excess,v_business_currency,v_excess); END IF;
 PERFORM public.validate_journal_entry_balance(v_entry);
 -- LED-001: journal lines can only be attached while the header is draft.
 UPDATE public.journal_entries SET status='posted', posted_at=now(), posted_by=auth.uid() WHERE id=v_entry AND status='draft';
 IF NOT FOUND THEN RAISE EXCEPTION 'Payment posting refused: journal entry % did not transition from draft to posted', v_entry; END IF;
 PERFORM public.validate_journal_entry_balance(v_entry);
 UPDATE public.payments SET journal_entry_id=v_entry WHERE id=v_payment;
 SELECT coalesce(sum(pa.amount),0) INTO v_total FROM public.payment_allocations pa WHERE pa.invoice_id=inv.id;
 UPDATE public.invoices SET amount_paid=v_total,balance_due=greatest(total-v_total,0),status=case when v_total>=total then 'paid'::invoice_status when v_total>0 and due_date<current_date then 'overdue'::invoice_status when v_total>0 then 'partially_paid'::invoice_status when due_date<current_date then 'overdue'::invoice_status else 'sent'::invoice_status end,updated_at=now() WHERE id=inv.id;
 v_number:=public.next_document_number(p_business_id,'receipt');
 INSERT INTO public.receipts(business_id,customer_id,payment_id,receipt_number,receipt_date,amount,currency_code,payment_method,reference_number,notes,created_by) VALUES(p_business_id,p_customer_id,v_payment,v_number,p_payment_date,p_amount,v_transaction_currency,p_method::text,p_reference,p_notes,auth.uid()) RETURNING id INTO v_receipt;
 RETURN v_receipt;
END; $function$
;

REVOKE ALL ON FUNCTION public.record_customer_payment(uuid,uuid,uuid,numeric,payment_method,uuid,text,text,date,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_customer_payment(uuid,uuid,uuid,numeric,payment_method,uuid,text,text,date,text,text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
