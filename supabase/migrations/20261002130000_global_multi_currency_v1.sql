BEGIN;

-- Wave 1: global multi-currency accounting foundation.
-- Existing financial/RLS boundaries stay in place; legacy INR data is backfilled.

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS base_currency_code varchar(3) DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS default_timezone varchar(50) DEFAULT 'UTC';

ALTER TABLE public.businesses
  ALTER COLUMN country_code SET DEFAULT 'US';

UPDATE public.businesses
SET base_currency_code = upper(btrim(currency_code))
WHERE base_currency_code IS NULL OR btrim(base_currency_code) = '';

UPDATE public.businesses
SET default_timezone = coalesce(nullif(btrim(timezone),''),'UTC')
WHERE default_timezone IS NULL OR btrim(default_timezone) = '';

ALTER TABLE public.businesses
  ALTER COLUMN base_currency_code SET NOT NULL,
  ALTER COLUMN default_timezone SET NOT NULL;

ALTER TABLE public.businesses
  DROP CONSTRAINT IF EXISTS businesses_base_currency_code_chk,
  DROP CONSTRAINT IF EXISTS businesses_country_code_iso_chk;

ALTER TABLE public.businesses
  ADD CONSTRAINT businesses_base_currency_code_chk
    CHECK (base_currency_code ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT businesses_country_code_iso_chk
    CHECK (country_code ~ '^[A-Z]{2}$');

ALTER TABLE public.organizations
  DROP CONSTRAINT IF EXISTS organizations_base_currency_code_chk,
  DROP CONSTRAINT IF EXISTS organizations_country_code_iso_chk;

ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_base_currency_code_chk
    CHECK (base_currency ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT organizations_country_code_iso_chk
    CHECK (country_code ~ '^[A-Z]{2}$');

CREATE OR REPLACE FUNCTION public.guard_business_base_currency_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,mm_private
AS $$
BEGIN
  IF NEW.base_currency_code IS DISTINCT FROM OLD.base_currency_code
     AND EXISTS (
       SELECT 1
       FROM public.journal_entries
       WHERE business_id=OLD.id
     ) THEN
    RAISE EXCEPTION 'Business base currency cannot be changed after journal activity exists';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_business_base_currency_change ON public.businesses;
CREATE TRIGGER trg_business_base_currency_change
BEFORE UPDATE OF base_currency_code ON public.businesses
FOR EACH ROW EXECUTE FUNCTION public.guard_business_base_currency_change();

REVOKE ALL ON FUNCTION public.guard_business_base_currency_change() FROM public,anon,authenticated;

ALTER TABLE public.journal_lines
  ADD COLUMN IF NOT EXISTS transaction_currency_code char(3),
  ADD COLUMN IF NOT EXISTS transaction_amount numeric(20,6),
  ADD COLUMN IF NOT EXISTS base_currency_code char(3),
  ADD COLUMN IF NOT EXISTS base_amount numeric(20,6),
  ADD COLUMN IF NOT EXISTS exchange_rate_source text,
  ADD COLUMN IF NOT EXISTS exchange_rate_timestamp timestamptz;

UPDATE public.journal_lines jl
SET
  transaction_currency_code = upper(coalesce(nullif(btrim(jl.currency_code),''), nullif(btrim(je.currency_code),''),'INR')),
  transaction_amount = round(abs(coalesce(jl.debit,0)) + abs(coalesce(jl.credit,0)), 6),
  base_currency_code = upper(b.base_currency_code),
  exchange_rate = coalesce(jl.exchange_rate,1),
  base_amount = round(
    (abs(coalesce(jl.debit,0)) + abs(coalesce(jl.credit,0)))
    * coalesce(jl.exchange_rate,1),
    6
  ),
  exchange_rate_source = coalesce(jl.exchange_rate_source,'legacy_identity'),
  exchange_rate_timestamp = coalesce(jl.exchange_rate_timestamp,je.created_at,now())
FROM public.journal_entries je
JOIN public.businesses b ON b.id=je.business_id
WHERE je.id=jl.journal_entry_id;

ALTER TABLE public.journal_lines
  ALTER COLUMN exchange_rate SET DEFAULT 1,
  ALTER COLUMN exchange_rate SET NOT NULL,
  ALTER COLUMN transaction_currency_code SET NOT NULL,
  ALTER COLUMN transaction_amount SET NOT NULL,
  ALTER COLUMN base_currency_code SET NOT NULL,
  ALTER COLUMN base_amount SET NOT NULL;

ALTER TABLE public.journal_lines
  DROP CONSTRAINT IF EXISTS journal_lines_transaction_currency_chk,
  DROP CONSTRAINT IF EXISTS journal_lines_base_currency_chk,
  DROP CONSTRAINT IF EXISTS journal_lines_exchange_rate_positive_chk,
  DROP CONSTRAINT IF EXISTS journal_lines_base_amount_positive_chk;

ALTER TABLE public.journal_lines
  ADD CONSTRAINT journal_lines_transaction_currency_chk
    CHECK (transaction_currency_code ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT journal_lines_base_currency_chk
    CHECK (base_currency_code ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT journal_lines_exchange_rate_positive_chk
    CHECK (exchange_rate > 0),
  ADD CONSTRAINT journal_lines_base_amount_positive_chk
    CHECK (base_amount >= 0);

CREATE INDEX IF NOT EXISTS journal_lines_tx_currency_idx
  ON public.journal_lines(journal_entry_id,transaction_currency_code);

CREATE OR REPLACE FUNCTION public.sync_journal_line_dual_currency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,mm_private
AS $$
DECLARE
  v_business_base char(3);
  v_entry_currency char(3);
  v_side_amount numeric;
BEGIN
  SELECT upper(coalesce(nullif(btrim(je.currency_code),''),'INR')),upper(b.base_currency_code)
    INTO v_entry_currency,v_business_base
  FROM public.journal_entries je
  JOIN public.businesses b ON b.id=je.business_id
  WHERE je.id=NEW.journal_entry_id;

  IF v_business_base IS NULL THEN
    RAISE EXCEPTION 'Journal entry not found for journal line';
  END IF;

  NEW.transaction_currency_code :=
    upper(coalesce(nullif(btrim(NEW.transaction_currency_code),''),nullif(btrim(NEW.currency_code),''),v_entry_currency));
  NEW.base_currency_code := upper(coalesce(nullif(btrim(NEW.base_currency_code),''),v_business_base));

  IF NEW.base_currency_code IS DISTINCT FROM v_business_base THEN
    RAISE EXCEPTION 'Journal line base currency must match the business base currency';
  END IF;

  NEW.currency_code := NEW.transaction_currency_code;

  IF NEW.transaction_currency_code = NEW.base_currency_code THEN
    NEW.exchange_rate := 1;
  ELSIF NEW.exchange_rate IS NULL OR NEW.exchange_rate <= 0 THEN
    RAISE EXCEPTION 'Foreign-currency journal lines require a positive exchange rate';
  ELSIF NEW.exchange_rate_source IS NULL OR btrim(NEW.exchange_rate_source)='' THEN
    RAISE EXCEPTION 'Foreign-currency journal lines require an exchange rate source';
  END IF;

  v_side_amount := round(abs(coalesce(NEW.debit,0)) + abs(coalesce(NEW.credit,0)),6);

  IF NEW.transaction_amount IS NULL THEN
    NEW.transaction_amount := v_side_amount;
  ELSIF round(NEW.transaction_amount,6) <> v_side_amount THEN
    RAISE EXCEPTION 'Journal line transaction amount does not match debit/credit amount';
  END IF;

  IF NEW.base_amount IS NULL THEN
    NEW.base_amount := round(v_side_amount * NEW.exchange_rate,6);
  ELSIF round(NEW.base_amount,6) <> round(v_side_amount * NEW.exchange_rate,6) THEN
    RAISE EXCEPTION 'Journal line base amount does not match transaction amount and exchange rate';
  END IF;

  NEW.exchange_rate_timestamp := coalesce(NEW.exchange_rate_timestamp,now());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_journal_line_dual_currency ON public.journal_lines;
CREATE TRIGGER trg_journal_line_dual_currency
BEFORE INSERT OR UPDATE OF
  debit,credit,currency_code,exchange_rate,
  transaction_currency_code,transaction_amount,base_currency_code,
  base_amount,exchange_rate_source,exchange_rate_timestamp
ON public.journal_lines
FOR EACH ROW EXECUTE FUNCTION public.sync_journal_line_dual_currency();

REVOKE ALL ON FUNCTION public.sync_journal_line_dual_currency() FROM public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.validate_journal_entry_balance(p_entry_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SET search_path=public
AS $$
DECLARE
  v_business_id uuid;
  v_business_base char(3);
  v_line_count integer;
  v_transaction_debit numeric;
  v_transaction_credit numeric;
  v_base_debit numeric;
  v_base_credit numeric;
  v_currency_count integer;
BEGIN
  SELECT je.business_id,upper(b.base_currency_code)
    INTO v_business_id,v_business_base
  FROM public.journal_entries je
  JOIN public.businesses b ON b.id=je.business_id
  WHERE je.id=p_entry_id;

  IF v_business_id IS NULL THEN RAISE EXCEPTION 'Journal entry not found'; END IF;

  SELECT
    count(*),
    coalesce(sum(debit),0),
    coalesce(sum(credit),0),
    coalesce(sum(CASE WHEN debit>0 THEN base_amount ELSE 0 END),0),
    coalesce(sum(CASE WHEN credit>0 THEN base_amount ELSE 0 END),0),
    count(DISTINCT transaction_currency_code)
  INTO v_line_count,v_transaction_debit,v_transaction_credit,v_base_debit,v_base_credit,v_currency_count
  FROM public.journal_lines
  WHERE journal_entry_id=p_entry_id;

  IF v_line_count < 2 THEN
    RAISE EXCEPTION 'Journal entry must contain at least two lines';
  END IF;

  IF EXISTS(
    SELECT 1 FROM public.journal_lines jl
    WHERE jl.journal_entry_id=p_entry_id
      AND jl.base_currency_code IS DISTINCT FROM v_business_base
  ) THEN
    RAISE EXCEPTION 'Journal entry contains a line with a base currency different from the business base currency';
  END IF;

  IF v_currency_count <= 1 AND v_transaction_debit <> v_transaction_credit THEN
    RAISE EXCEPTION 'Journal entry is not balanced: debit %, credit %',v_transaction_debit,v_transaction_credit;
  END IF;

  IF v_base_debit <> v_base_credit THEN
    RAISE EXCEPTION 'Journal entry is not balanced in business base currency: debit %, credit %',v_base_debit,v_base_credit;
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_journal_entry_balance(uuid) FROM public,anon;

CREATE OR REPLACE FUNCTION public.reverse_journal_entry(
  p_entry_id uuid,p_reversal_date date,p_reason text,p_created_by uuid DEFAULT auth.uid()
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,mm_private AS $$
DECLARE
  v_old public.journal_entries%rowtype;
  v_new uuid;
  v_num bigint;
  v_period text;
BEGIN
  SELECT * INTO v_old FROM public.journal_entries WHERE id=p_entry_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Journal entry not found'; END IF;
  IF NOT mm_private.has_business_permission(v_old.business_id,'accounting.adjust') THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF v_old.status<>'posted' THEN RAISE EXCEPTION 'Only posted entries can be reversed'; END IF;
  PERFORM public.assert_accounting_period_open(v_old.business_id,p_reversal_date);

  SELECT status INTO v_period
  FROM public.accounting_periods
  WHERE business_id=v_old.business_id AND p_reversal_date BETWEEN period_start AND period_end
  ORDER BY period_start DESC LIMIT 1;
  IF v_period IN ('closed','locked') THEN RAISE EXCEPTION 'Reversal period is %',v_period; END IF;

  PERFORM pg_advisory_xact_lock(hashtext('journal-entry-number:'||v_old.business_id::text));
  SELECT coalesce(max(entry_number),0)+1 INTO v_num FROM public.journal_entries WHERE business_id=v_old.business_id;

  INSERT INTO public.journal_entries(
    business_id,entry_number,entry_date,description,source_type,source_id,status,
    currency_code,reversal_of_id,created_by,is_system_generated
  ) VALUES(
    v_old.business_id,v_num,p_reversal_date,coalesce(p_reason,'Reversal of '||v_old.entry_number),
    'reversal',v_old.id,'draft',v_old.currency_code,v_old.id,auth.uid(),true
  ) RETURNING id INTO v_new;

  INSERT INTO public.journal_lines(
    journal_entry_id,account_id,description,debit,credit,currency_code,
    transaction_currency_code,transaction_amount,base_currency_code,base_amount,
    exchange_rate,exchange_rate_source,exchange_rate_timestamp,entity_type,entity_id,metadata
  )
  SELECT
    v_new,account_id,description,credit,debit,currency_code,
    transaction_currency_code,transaction_amount,base_currency_code,base_amount,
    exchange_rate,exchange_rate_source,exchange_rate_timestamp,entity_type,entity_id,metadata
  FROM public.journal_lines
  WHERE journal_entry_id=p_entry_id;

  PERFORM public.post_journal_entry(v_new);
  RETURN v_new;
END;
$$;

ALTER TABLE public.payment_allocations
  ADD COLUMN IF NOT EXISTS currency_code char(3);

UPDATE public.payment_allocations pa
SET currency_code=upper(p.currency_code)
FROM public.payments p
WHERE p.id=pa.payment_id AND pa.currency_code IS NULL;

ALTER TABLE public.payment_allocations ALTER COLUMN currency_code SET NOT NULL;

ALTER TABLE public.vendor_payment_allocations
  ADD COLUMN IF NOT EXISTS currency_code char(3);

UPDATE public.vendor_payment_allocations vpa
SET currency_code=upper(p.currency_code)
FROM public.payments p
WHERE p.id=vpa.payment_id AND vpa.currency_code IS NULL;

ALTER TABLE public.vendor_payment_allocations ALTER COLUMN currency_code SET NOT NULL;

CREATE OR REPLACE FUNCTION public.guard_payment_allocation_currency()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,mm_private A$$
DECLARE
  p public.payments%rowtype;
  i public.invoices%rowtype;
  b public.bills%rowtype;
  v_invoice_id uuid;
  v_bill_id uuid;
BEGIN
  SELECT * INTO p FROM public.payments WHERE id=NEW.payment_id;
  IF p.id IS NULL THEN RAISE EXCEPTION 'Payment not found for allocation'; END IF;
  IF p.business_id IS DISTINCT FROM NEW.business_id THEN
    RAISE EXCEPTION 'Payment allocation business does not match payment';
  END IF;

  IF NEW.currency_code IS NULL THEN
    NEW.currency_code:=upper(p.currency_code);
  ELSE
    NEW.currency_code:=upper(btrim(NEW.currency_code));
  END IF;

  IF NEW.currency_code IS DISTINCT FROM upper(p.currency_code) THEN
    RAISE EXCEPTION 'Payment allocation currency does not match payment currency';
  END IF;

  -- Convert optional fields through JSON so the same trigger function is
  -- safe for both allocation table shapes.
  v_invoice_id:=NULLIF(to_jsonb(NEW)->>'invoice_id','')::uuid;
  v_bill_id:=NULLIF(to_jsonb(NEW)->>'bill_id','')::uuid;

  IF v_invoice_id IS NOT NULL THEN
    SELECT * INTO i FROM public.invoices WHERE id=v_invoice_id;
    IF i.id IS NULL THEN RAISE EXCEPTION 'Invoice not found for payment allocation'; END IF;
    IF i.business_id IS DISTINCT FROM NEW.business_id THEN
      RAISE EXCEPTION 'Payment allocation invoice business does not match';
    END IF;
    IF i.currency_code IS DISTINCT FROM NEW.currency_code THEN
      RAISE EXCEPTION 'Payment allocation currency does not match invoice currency';
    END IF;
  END IF;

  IF v_bill_id IS NOT NULL THEN
    SELECT * INTO b FROM public.bills WHERE id=v_bill_id;
    IF b.id IS NULL THEN RAISE EXCEPTION 'Bill not found for payment allocation'; END IF;
    IF b.business_id IS DISTINCT FROM NEW.business_id THEN
      RAISE EXCEPTION 'Payment allocation bill business does not match';
    END IF;
    IF b.currency_code IS DISTINCT FROM NEW.currency_code THEN
      RAISE EXCEPTION 'Payment allocation currency does not match bill currency';
    END IF;
  END IF;

  IF TG_TABLE_NAME='payment_allocations' AND v_invoice_id IS NULL AND v_bill_id IS NULL THEN
    RAISE EXCEPTION 'Payment allocation must reference an invoice or bill';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payment_allocation_currency_guard ON public.payment_allocations;
CREATE TRIGGER trg_payment_allocation_currency_guard
BEFORE INSERT OR UPDATE OF payment_id,business_id,invoice_id,bill_id,currency_code
ON public.payment_allocations
FOR EACH ROW EXECUTE FUNCTION public.guard_payment_allocation_currency();

DROP TRIGGER IF EXISTS trg_vendor_payment_allocation_currency_guard ON public.vendor_payment_allocations;
CREATE TRIGGER trg_vendor_payment_allocation_currency_guard
BEFORE INSERT OR UPDATE OF payment_id,business_id,bill_id,currency_code
ON public.vendor_payment_allocations
FOR EACH ROW EXECUTE FUNCTION public.guard_payment_allocation_currency();

REVOKE ALL ON FUNCTION public.guard_payment_allocation_currency() FROM public,anon,authenticated;

DROP FUNCTION IF EXISTS public.customer_credit_balance(uuid,uuid);

CREATE OR REPLACE FUNCTION public.customer_credit_balance(
  p_business_id uuid,p_customer_id uuid,p_currency_code char(3)
)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,mm_private AS $$
DECLARE
  v_total numeric:=0;
  v_currency char(3):=upper(btrim(p_currency_code));
BEGIN
  IF NOT (
    mm_private.has_business_permission(p_business_id,'customers.view')
    OR mm_private.has_business_permission(p_business_id,'accounting.view')
    OR mm_private.has_business_permission(p_business_id,'payments.receive')
  ) THEN RAISE EXCEPTION 'Access denied'; END IF;

  IF v_currency IS NULL OR v_currency !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'Valid credit currency is required';
  END IF;

  IF NOT EXISTS(
    SELECT 1 FROM public.customers WHERE id=p_customer_id AND business_id=p_business_id
  ) THEN RAISE EXCEPTION 'Customer not found'; END IF;

  SELECT coalesce(sum(amount),0) INTO v_total
  FROM public.customer_credit_ledger
  WHERE business_id=p_business_id AND customer_id=p_customer_id
    AND upper(currency_code)=v_currency;

  RETURN v_total;
END;
$$;

REVOKE ALL ON FUNCTION public.customer_credit_balance(uuid,uuid,char) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.customer_credit_balance(uuid,uuid,char) TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_customer_credit_currency()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,mm_private AS $$
DECLARE
  v_expected char(3);
  v_customer_business uuid;
  v_payment public.payments%rowtype;
  v_refund public.customer_refunds%rowtype;
  v_credit_note public.credit_notes%rowtype;
BEGIN
  SELECT c.business_id INTO v_customer_business FROM public.customers c WHERE c.id=NEW.customer_id;

  IF v_customer_business IS NULL OR v_customer_business IS DISTINCT FROM NEW.business_id THEN
    RAISE EXCEPTION 'Customer credit ledger customer does not belong to the business';
  END IF;

  IF length(btrim(NEW.currency_code))<>3 OR upper(NEW.currency_code) !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'Customer credit ledger requires a valid ISO currency code';
  END IF;
  NEW.currency_code:=upper(btrim(NEW.currency_code));

  IF NEW.payment_id IS NOT NULL THEN
    SELECT * INTO v_payment FROM public.payments WHERE id=NEW.payment_id;
    IF v_payment.id IS NULL OR v_payment.business_id IS DISTINCT FROM NEW.business_id
       OR v_payment.customer_id IS DISTINCT FROM NEW.customer_id THEN
      RAISE EXCEPTION 'Customer credit payment link is invalid';
    END IF;
    v_expected:=upper(v_payment.currency_code);
  END IF;

  IF NEW.refund_id IS NOT NULL THEN
    SELECT * INTO v_refund FROM public.customer_refunds WHERE id=NEW.refund_id;
    IF v_refund.id IS NULL OR v_refund.business_id IS DISTINCT FROM NEW.business_id
       OR v_refund.customer_id IS DISTINCT FROM NEW.customer_id THEN
      RAISE EXCEPTION 'Customer refund link is invalid';
    END IF;
    IF v_expected IS NOT NULL AND v_expected IS DISTINCT FROM upper(v_refund.currency_code) THEN
      RAISE EXCEPTION 'Customer credit ledger links use different currencies';
    END IF;
    v_expected:=upper(v_refund.currency_code);
  END IF;

  IF NEW.credit_note_id IS NOT NULL THEN
    SELECT * INTO v_credit_note FROM public.credit_notes WHERE id=NEW.credit_note_id;
    IF v_credit_note.id IS NULL OR v_credit_note.business_id IS DISTINCT FROM NEW.business_id
       OR v_credit_note.customer_id IS DISTINCT FROM NEW.customer_id THEN
      RAISE EXCEPTION 'Customer credit note link is invalid';
    END IF;
    IF v_expected IS NOT NULL AND v_expected IS DISTINCT FROM upper(v_credit_note.currency_code) THEN
      RAISE EXCEPTION 'Customer credit ledger links use different currencies';
    END IF;
    v_expected:=upper(v_credit_note.currency_code);
  END IF;

  IF v_expected IS NOT NULL AND NEW.currency_code IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'Customer credit currency does not match the source transaction currency';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_customer_credit_currency_guard ON public.customer_credit_ledger;
CREATE TRIGGER trg_customer_credit_currency_guard
BEFORE INSERT OR UPDATE OF
  business_id,customer_id,payment_id,credit_note_id,refund_id,currency_code
ON public.customer_credit_ledger
FOR EACH ROW EXECUTE FUNCTION public.guard_customer_credit_currency();

REVOKE ALL ON FUNCTION public.guard_customer_credit_currency() FROM public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.apply_customer_credit_to_invoice(
  p_business_id uuid,p_customer_id uuid,p_invoice_id uuid,p_amount numeric,
  p_application_date date DEFAULT current_date
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,mm_private AS $$
DECLARE
  inv public.invoices%rowtype;
  v_credit_acct uuid;
  v_ar uuid;
  v_available numeric:=0;
  v_application numeric;
  v_ledger_id uuid;
  v_entry uuid;
BEGIN
  IF NOT mm_private.has_business_permission(p_business_id,'accounting.adjust') THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF p_amount<=0 THEN RAISE EXCEPTION 'Credit application amount must be greater than zero'; END IF;

  PERFORM pg_advisory_xact_lock(hashtext('customer-credit:'||p_business_id::text||':'||p_customer_id::text));
  PERFORM public.assert_accounting_period_open(p_business_id,p_application_date);

  SELECT * INTO inv
  FROM public.invoices
  WHERE id=p_invoice_id AND business_id=p_business_id AND customer_id=p_customer_id
  FOR UPDATE;

  IF inv.id IS NULL THEN RAISE EXCEPTION 'Invoice not found for this customer and business'; END IF;
  IF inv.status='void' THEN RAISE EXCEPTION 'Cannot apply customer credit to a void invoice'; END IF;
  IF inv.journal_entry_id IS NULL THEN RAISE EXCEPTION 'Target invoice must be posted'; END IF;
  IF p_application_date<inv.invoice_date THEN RAISE EXCEPTION 'Credit application date cannot be before invoice date'; END IF;

  SELECT public.customer_credit_balance(p_business_id,p_customer_id,inv.currency_code) INTO v_available;

  IF v_available+0.005<p_amount THEN
    RAISE EXCEPTION 'Application exceeds available customer credit in invoice currency';
  END IF;

  v_application:=least(p_amount,greatest(inv.balance_due,0));
  IF v_application<=0 THEN RAISE EXCEPTION 'Target invoice has no outstanding balance'; END IF;
  IF v_application+0.005<p_amount THEN RAISE EXCEPTION 'Application exceeds the target invoice balance'; END IF;

  SELECT id INTO v_credit_acct FROM public.accounts
  WHERE business_id=p_business_id AND code='2150' AND is_active;
  SELECT id INTO v_ar FROM public.accounts
  WHERE business_id=p_business_id AND code='1100' AND is_active;

  IF v_credit_acct IS NULL THEN RAISE EXCEPTION 'Customer credit account is missing'; END IF;
  IF v_ar IS NULL THEN RAISE EXCEPTION 'Accounts receivable account is missing'; END IF;

  PERFORM pg_advisory_xact_lock(hashtext('journal-entry-number:'||p_business_id::text));

  INSERT INTO public.customer_credit_ledger(
    business_id,customer_id,entry_type,amount,currency_code,description,created_by
  ) VALUES(
    p_business_id,p_customer_id,'application',-v_application,inv.currency_code,
    'Applied customer credit to invoice '||inv.invoice_number,auth.uid()
  ) RETURNING id INTO v_ledger_id;

  INSERT INTO public.journal_entries(
    business_id,entry_number,entry_date,description,source_type,source_id,status,
    posted_at,posted_by,created_by,currency_code,total_debit,total_credit,is_system_generated
  ) VALUES(
    p_business_id,
    (SELECT coalesce(max(entry_number),0)+1 FROM public.journal_entries WHERE business_id=p_business_id),
    p_application_date,'Customer credit applied to invoice '||inv.invoice_number,
    'customer_credit_application',v_ledger_id,'posted',
    now(),auth.uid(),auth.uid(),inv.currency_code,v_application,v_application,true
  ) RETURNING id INTO v_entry;

  INSERT INTO public.journal_lines(
    journal_entry_id,account_id,description,debit,credit,currency_code,entity_type,entity_id
  ) VALUES
    (v_entry,v_credit_acct,'Customer credit applied',v_application,0,inv.currency_code,'customer',p_customer_id),
    (v_entry,v_ar,'Receivable settlement from customer credit',0,v_application,inv.currency_code,'customer',p_customer_id);

  PERFORM public.validate_journal_entry_balance(v_entry);

  UPDATE public.invoices
  SET balance_due=greatest(balance_due-v_application,0),
      status=CASE
        WHEN greatest(balance_due-v_application,0)<=0 THEN 'paid'::invoice_status
        WHEN due_date<current_date THEN 'overdue'::invoice_status
        WHEN amount_paid>0 THEN 'partially_paid'::invoice_status
        ELSE 'sent'::invoice_status
      END,
      updated_at=now()
  WHERE id=inv.id;

  RETURN v_ledger_id;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_customer_credit_to_invoice(uuid,uuid,uuid,numeric,date) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.apply_customer_credit_to_invoice(uuid,uuid,uuid,numeric,date) TO authenticated;

DROP FUNCTION IF EXISTS public.refund_customer_credit(uuid,uuid,numeric,uuid,text,text,text,date);

CREATE OR REPLACE FUNCTION public.refund_customer_credit(
  p_business_id uuid,p_customer_id uuid,p_amount numeric,p_account_id uuid,p_method text,
  p_reference text DEFAULT NULL,p_reason text DEFAULT NULL,p_refund_date date DEFAULT current_date,
  p_currency_code char(3) DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,mm_private AS $$
DECLARE
  v_balance numeric;
  v_refund uuid;
  v_entry uuid;
  v_credit_acct uuid;
  v_currency char(3);
BEGIN
  IF NOT mm_private.has_business_permission(p_business_id,'payments.receive') THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF p_amount<=0 THEN RAISE EXCEPTION 'Refund amount must be greater than zero'; END IF;

  PERFORM pg_advisory_xact_lock(hashtext('customer-credit:'||p_business_id::text||':'||p_customer_id::text));
  PERFORM public.assert_accounting_period_open(p_business_id,p_refund_date);

  SELECT upper(coalesce(nullif(btrim(p_currency_code),''),nullif(btrim(currency_code),'')))
    INTO v_currency
  FROM public.businesses
  WHERE id=p_business_id;

  IF v_currency IS NULL OR v_currency !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'Valid refund currency is required';
  END IF;

  SELECT public.customer_credit_balance(p_business_id,p_customer_id,v_currency) INTO v_balance;
  IF p_amount>v_balance+0.005 THEN
    RAISE EXCEPTION 'Refund exceeds available customer credit in refund currency';
  END IF;

  IF NOT EXISTS(
    SELECT 1 FROM public.customers
    WHERE id=p_customer_id AND business_id=p_business_id AND is_active
  ) THEN RAISE EXCEPTION 'Customer not found or inactive'; END IF;

  IF NOT EXISTS(
    SELECT 1 FROM public.accounts
    WHERE id=p_account_id AND business_id=p_business_id
      AND is_active AND account_subtype IN ('cash','bank')
  ) THEN RAISE EXCEPTION 'Refund account must be an active Cash or Bank account'; END IF;

  SELECT id INTO v_credit_acct
  FROM public.accounts
  WHERE business_id=p_business_id AND code='2150' AND is_active;
  IF v_credit_acct IS NULL THEN RAISE EXCEPTION 'Customer credit account is missing'; END IF;

  INSERT INTO public.customer_refunds(
    business_id,customer_id,refund_date,amount,currency_code,method,account_id,
    reference,reason,created_by
  ) VALUES(
    p_business_id,p_customer_id,p_refund_date,p_amount,v_currency,p_method,
    p_account_id,p_reference,p_reason,auth.uid()
  ) RETURNING id INTO v_refund;

  INSERT INTO public.customer_credit_ledger(
    business_id,customer_id,refund_id,entry_type,amount,currency_code,description,created_by
  ) VALUES(
    p_business_id,p_customer_id,v_refund,'refund',-p_amount,v_currency,
    'Customer credit refund',auth.uid()
  );

  PERFORM pg_advisory_xact_lock(hashtext('journal-entry-number:'||p_business_id::text));

  INSERT INTO public.journal_entries(
    business_id,entry_number,entry_date,description,source_type,source_id,status,
    posted_at,posted_by,created_by,currency_code,total_debit,total_credit,is_system_generated
  ) VALUES(
    p_business_id,
    (SELECT coalesce(max(entry_number),0)+1 FROM public.journal_entries WHERE business_id=p_business_id),
    p_refund_date,'Customer credit refund','refund',v_refund,'posted',
    now(),auth.uid(),auth.uid(),v_currency,p_amount,p_amount,true
  ) RETURNING id INTO v_entry;

  INSERT INTO public.journal_lines(
    journal_entry_id,account_id,description,debit,credit,currency_code,entity_type,entity_id
  ) VALUES
    (v_entry,v_credit_acct,'Customer credit refund',p_amount,0,v_currency,'customer',p_customer_id),
    (v_entry,p_account_id,'Refund paid',0,p_amount,v_currency,'customer',p_customer_id);

  PERFORM public.validate_journal_entry_balance(v_entry);

  UPDATE public.customer_refunds
  SET journal_entry_id=v_entry,status='posted'
  WHERE id=v_refund;

  RETURN v_refund;
END;
$$;

REVOKE ALL ON FUNCTION public.refund_customer_credit(uuid,uuid,numeric,uuid,text,text,text,date,char) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.refund_customer_credit(uuid,uuid,numeric,uuid,text,text,text,date,char) TO authenticated;

DROP FUNCTION IF EXISTS public.vendor_credit_balance(uuid,uuid);

CREATE OR REPLACE FUNCTION public.vendor_credit_balance(
  p_business_id uuid,p_vendor_id uuid,p_currency_code char(3)
) RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,mm_private AS $$
DECLARE v_total numeric:=0; v_currency char(3):=upper(btrim(p_currency_code));
BEGIN
  IF NOT mm_private.has_business_permission(p_business_id,'accounting.view') THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF v_currency IS NULL OR v_currency !~ '^[A-Z]{3}$' THEN RAISE EXCEPTION 'Valid credit currency is required'; END IF;
  SELECT coalesce(sum(vcl.amount),0) INTO v_total
  FROM public.vendor_credit_ledger vcl
  WHERE vcl.business_id=p_business_id AND vcl.vendor_id=p_vendor_id
    AND upper(vcl.currency_code)=v_currency;
  RETURN v_total;
END;
$$;

REVOKE ALL ON FUNCTION public.vendor_credit_balance(uuid,uuid,char) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.vendor_credit_balance(uuid,uuid,char) TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_vendor_credit_currency()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,mm_private AS $$
DECLARE
  v_credit public.vendor_credits%rowtype;
  v_bill public.bills%rowtype;
  v_payment public.payments%rowtype;
BEGIN
  IF length(btrim(NEW.currency_code))<>3 OR upper(NEW.currency_code) !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'Vendor credit ledger requires a valid ISO currency code';
  END IF;
  NEW.currency_code:=upper(btrim(NEW.currency_code));

  IF NEW.vendor_credit_id IS NOT NULL THEN
    SELECT * INTO v_credit FROM public.vendor_credits WHERE id=NEW.vendor_credit_id;
    IF v_credit.id IS NULL OR v_credit.business_id IS DISTINCT FROM NEW.business_id
       OR v_credit.vendor_id IS DISTINCT FROM NEW.vendor_id THEN
      RAISE EXCEPTION 'Vendor credit ledger link is invalid';
    END IF;
    IF NEW.currency_code IS DISTINCT FROM upper(v_credit.currency_code) THEN
      RAISE EXCEPTION 'Vendor credit currency does not match the supplier credit';
    END IF;
  END IF;

  IF NEW.bill_id IS NOT NULL THEN
    SELECT * INTO v_bill FROM public.bills WHERE id=NEW.bill_id;
    IF v_bill.id IS NULL OR v_bill.business_id IS DISTINCT FROM NEW.business_id
       OR v_bill.vendor_id IS DISTINCT FROM NEW.vendor_id THEN
      RAISE EXCEPTION 'Vendor credit bill link is invalid';
    END IF;
    IF NEW.entry_type='application' AND NEW.currency_code IS DISTINCT FROM upper(v_bill.currency_code) THEN
      RAISE EXCEPTION 'Vendor credit currency does not match the target purchase bill';
    END IF;
  END IF;

  IF NEW.payment_id IS NOT NULL THEN
    SELECT * INTO v_payment FROM public.payments WHERE id=NEW.payment_id;
    IF v_payment.id IS NULL OR v_payment.business_id IS DISTINCT FROM NEW.business_id
       OR v_payment.vendor_id IS DISTINCT FROM NEW.vendor_id THEN
      RAISE EXCEPTION 'Vendor credit payment link is invalid';
    END IF;
    IF NEW.currency_code IS DISTINCT FROM upper(v_payment.currency_code) THEN
      RAISE EXCEPTION 'Vendor credit currency does not match the payment currency';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_vendor_credit_currency_guard ON public.vendor_credit_ledger;
CREATE TRIGGER trg_vendor_credit_currency_guard
BEFORE INSERT OR UPDATE OF
  business_id,vendor_id,vendor_credit_id,bill_id,payment_id,currency_code
ON public.vendor_credit_ledger
FOR EACH ROW EXECUTE FUNCTION public.guard_vendor_credit_currency();

REVOKE ALL ON FUNCTION public.guard_vendor_credit_currency() FROM public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.apply_vendor_credit_to_bill(
  p_business_id uuid,p_vendor_credit_id uuid,p_bill_id uuid,p_amount numeric
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,mm_private AS $$
DECLARE
  vc public.vendor_credits%rowtype;
  b public.bills%rowtype;
  available numeric:=0;
  paid numeric:=0;
  applied numeric:=0;
  outstanding numeric:=0;
  v_entry uuid;
BEGIN
  IF NOT mm_private.has_business_permission(p_business_id,'accounting.adjust') THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF p_amount<=0 THEN RAISE EXCEPTION 'Application amount must be greater than zero'; END IF;

  PERFORM public.assert_accounting_period_open(p_business_id,current_date);

  SELECT * INTO vc
  FROM public.vendor_credits
  WHERE id=p_vendor_credit_id AND business_id=p_business_id
  FOR UPDATE;
  IF vc.id IS NULL OR vc.status<>'posted' THEN RAISE EXCEPTION 'Posted supplier credit not found'; END IF;

  SELECT * INTO b
  FROM public.bills
  WHERE id=p_bill_id AND business_id=p_business_id AND vendor_id=vc.vendor_id
  FOR UPDATE;
  IF b.id IS NULL OR b.status='void' THEN RAISE EXCEPTION 'Target purchase bill not found or void'; END IF;
  IF b.journal_entry_id IS NULL THEN RAISE EXCEPTION 'Target purchase bill must be posted'; END IF;

  IF upper(vc.currency_code) IS DISTINCT FROM upper(b.currency_code) THEN
    RAISE EXCEPTION 'Supplier credit and target purchase bill use different currencies; post an explicit FX settlement before allocation';
  END IF;

  SELECT coalesce(sum(vcl.amount),0) INTO available
  FROM public.vendor_credit_ledger vcl
  WHERE vcl.vendor_credit_id=vc.id AND upper(vcl.currency_code)=upper(vc.currency_code);

  IF available+0.005<p_amount THEN
    RAISE EXCEPTION 'Application exceeds available supplier credit in target bill currency';
  END IF;

  SELECT coalesce(sum(vpa.amount),0) INTO paid
  FROM public.vendor_payment_allocations vpa
  WHERE vpa.bill_id=b.id AND upper(vpa.currency_code)=upper(b.currency_code);

  SELECT greatest(-coalesce(sum(vcl.amount) FILTER (WHERE vcl.entry_type='application'),0),0)
    INTO applied
  FROM public.vendor_credit_ledger vcl
  WHERE vcl.bill_id=b.id AND upper(vcl.currency_code)=upper(b.currency_code);

  outstanding:=greatest(b.total-paid-applied,0);
  IF p_amount>outstanding+0.005 THEN RAISE EXCEPTION 'Application exceeds the target purchase bill balance'; END IF;

  INSERT INTO public.vendor_credit_ledger(
    business_id,vendor_id,vendor_credit_id,bill_id,entry_type,amount,currency_code,description,created_by
  ) VALUES(
    p_business_id,vc.vendor_id,vc.id,b.id,'application',-p_amount,vc.currency_code,
    'Applied to purchase bill '||b.bill_number,auth.uid()
  ) RETURNING id INTO v_entry;

  PERFORM public.recalculate_bill_settlement_state(b.id);
  RETURN v_entry;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.apply_vendor_credit_to_bill(uuid,uuid,uuid,numeric) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.apply_vendor_credit_to_bill(uuid,uuid,uuid,numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.recalculate_bill_settlement_state(p_bill_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,mm_private AS $$
DECLARE
  b public.bills%rowtype;
  v_paid numeric:=0;
  v_credit_applied numeric:=0;
  v_settled numeric:=0;
BEGIN
  SELECT * INTO b FROM public.bills WHERE id=p_bill_id FOR UPDATE;
  IF b.id IS NULL THEN RETURN; END IF;

  SELECT coalesce(sum(vpa.amount),0) INTO v_paid
  FROM public.vendor_payment_allocations vpa
  WHERE vpa.bill_id=b.id AND upper(vpa.currency_code)=upper(b.currency_code);

  SELECT greatest(-coalesce(sum(vcl.amount) FILTER (WHERE vcl.entry_type='application'),0),0)
    INTO v_credit_applied
  FROM public.vendor_credit_ledger vcl
  WHERE vcl.bill_id=b.id AND upper(vcl.currency_code)=upper(b.currency_code);

  v_settled:=greatest(v_paid+v_credit_applied,0);

  UPDATE public.bills
  SET amount_paid=least(total,v_paid),
      balance_due=greatest(total-v_settled,0),
      status=CASE
        WHEN status='void' THEN 'void'::bill_status
        WHEN journal_entry_id IS NULL THEN 'draft'::bill_status
        WHEN v_settled>=total THEN 'paid'::bill_status
        WHEN v_settled>0 AND due_date<current_date THEN 'overdue'::bill_status
        WHEN v_settled>0 THEN 'partially_paid'::bill_status
        WHEN due_date<current_date THEN 'overdue'::bill_status
        ELSE 'received'::bill_status
      END,
      updated_at=now()
  WHERE id=b.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_gateway_payment(
  p_provider text,p_provider_link_id text,p_provider_transaction_id text,p_event_id text,
  p_amount numeric,p_payment_date date DEFAULT current_date,p_notes text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,mm_private AS $$
DECLARE
  v_provider text:=lower(btrim(coalesce(p_provider,'')));
  v_link public.payment_links%rowtype;
  v_inv public.invoices%rowtype;
  v_payment uuid;
  v_receipt uuid;
  v_entry uuid;
  v_ar uuid;
  v_account uuid;
  v_allocated numeric;
  v_receipt_number text;
BEGIN
  IF v_provider='' THEN RAISE EXCEPTION 'Payment provider is required'; END IF;
  IF nullif(trim(p_provider_link_id),'') IS NULL THEN RAISE EXCEPTION 'Provider link id is required'; END IF;
  IF nullif(trim(p_provider_transaction_id),'') IS NULL THEN RAISE EXCEPTION 'Provider transaction id is required'; END IF;
  IF p_amount<=0 THEN RAISE EXCEPTION 'Payment amount must be greater than zero'; END IF;

  PERFORM pg_advisory_xact_lock(hashtext('gateway-transaction:'||v_provider||':'||p_provider_transaction_id));

  SELECT id INTO v_payment FROM public.payments
  WHERE gateway_transaction_id=p_provider_transaction_id LIMIT 1;

  IF v_payment IS NOT NULL THEN
    SELECT id INTO v_receipt FROM public.receipts WHERE payment_id=v_payment LIMIT 1;
    RETURN coalesce(v_receipt,v_payment);
  END IF;

  SELECT * INTO v_link
  FROM public.payment_links
  WHERE lower(provider)=v_provider AND provider_link_id=p_provider_link_id
  FOR UPDATE;
  IF v_link.id IS NULL THEN RAISE EXCEPTION 'Payment link not found'; END IF;

  SELECT * INTO v_inv
  FROM public.invoices
  WHERE id=v_link.invoice_id AND business_id=v_link.business_id
  FOR UPDATE;
  IF v_inv.id IS NULL THEN RAISE EXCEPTION 'Invoice not found'; END IF;
  IF v_inv.status='void' THEN RAISE EXCEPTION 'Cannot record payment for void invoice'; END IF;
  IF v_inv.journal_entry_id IS NULL THEN RAISE EXCEPTION 'Invoice must be posted before gateway payment'; END IF;
  IF upper(v_link.currency_code) IS DISTINCT FROM upper(v_inv.currency_code) THEN
    RAISE EXCEPTION 'Payment link currency does not match invoice currency';
  END IF;
  IF p_amount > greatest(v_inv.balance_due,0) THEN RAISE EXCEPTION 'Payment exceeds invoice balance'; END IF;

  SELECT id INTO v_account FROM public.accounts
  WHERE business_id=v_link.business_id AND code='1010' AND is_active LIMIT 1;
  IF v_account IS NULL THEN RAISE EXCEPTION 'Gateway payment account is missing'; END IF;

  SELECT id INTO v_ar FROM public.accounts
  WHERE business_id=v_link.business_id AND code='1100' AND is_active LIMIT 1;
  IF v_ar IS NULL THEN RAISE EXCEPTION 'Accounts receivable account is missing'; END IF;

  INSERT INTO public.payments(
    business_id,direction,customer_id,invoice_id,account_id,amount,currency_code,
    payment_date,method,reference,gateway_transaction_id,notes,created_by
  ) VALUES(
    v_link.business_id,'inbound',v_inv.customer_id,v_inv.id,v_account,p_amount,
    v_inv.currency_code,p_payment_date,'payment_gateway'::public.payment_method,
    coalesce(p_provider_transaction_id,p_event_id),p_provider_transaction_id,
    coalesce(p_notes,'Gateway payment: '||v_provider),NULL
  ) RETURNING id INTO v_payment;

  INSERT INTO public.payment_allocations(business_id,payment_id,invoice_id,amount,currency_code)
  VALUES(v_link.business_id,v_payment,v_inv.id,p_amount,v_inv.currency_code);

  PERFORM pg_advisory_xact_lock(hashtext('journal-entry-number:'||v_link.business_id::text));

  INSERT INTO public.journal_entries(
    business_id,entry_number,entry_date,description,source_type,source_id,status,
    posted_at,posted_by,created_by,currency_code,total_debit,total_credit,is_system_generated
  ) VALUES(
    v_link.business_id,
    (SELECT coalesce(max(entry_number),0)+1 FROM public.journal_entries WHERE business_id=v_link.business_id),
    p_payment_date,'Gateway payment for invoice '||v_inv.invoice_number,'payment',v_payment,
    'posted',now(),NULL,NULL,v_inv.currency_code,p_amount,p_amount,true
  ) RETURNING id INTO v_entry;

  INSERT INTO public.journal_lines(
    journal_entry_id,account_id,description,debit,credit,currency_code,entity_type,entity_id
  ) VALUES
    (v_entry,v_account,'Gateway customer payment',p_amount,0,v_inv.currency_code,'customer',v_inv.customer_id),
    (v_entry,v_ar,'Receivable settlement',0,p_amount,v_inv.currency_code,'customer',v_inv.customer_id);

  PERFORM public.validate_journal_entry_balance(v_entry);
  UPDATE public.payments SET journal_entry_id=v_entry WHERE id=v_payment;

  SELECT coalesce(sum(pa.amount),0) INTO v_allocated
  FROM public.payment_allocations pa
  WHERE pa.invoice_id=v_inv.id AND upper(pa.currency_code)=upper(v_inv.currency_code);

  UPDATE public.invoices
  SET amount_paid=v_allocated,balance_due=greatest(total-v_allocated,0),
      status=CASE
        WHEN v_allocated>=total THEN 'paid'::invoice_status
        WHEN v_allocated>0 AND due_date<current_date THEN 'overdue'::invoice_status
        WHEN v_allocated>0 THEN 'partially_paid'::invoice_status
        WHEN due_date<current_date THEN 'overdue'::invoice_status
        ELSE 'sent'::invoice_status
      END,
      updated_at=now()
  WHERE id=v_inv.id;

  v_receipt_number:=public.next_document_number(v_link.business_id,'receipt');

  INSERT INTO public.receipts(
    business_id,customer_id,payment_id,receipt_number,receipt_date,amount,currency_code,
    payment_method,reference_number,notes,created_by
  ) VALUES(
    v_link.business_id,v_inv.customer_id,v_payment,v_receipt_number,p_payment_date,p_amount,
    v_inv.currency_code,'payment_gateway',p_provider_transaction_id,p_notes,NULL
  ) RETURNING id INTO v_receipt;

  RETURN v_receipt;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_gateway_payment(text,text,text,text,numeric,date,text) FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_gateway_payment(text,text,text,text,numeric,date,text) TO service_role;

CREATE OR REPLACE FUNCTION public.create_business_for_current_user(
  p_business_name text,
  p_business_type business_type DEFAULT 'sole_proprietorship',
  p_country_code character DEFAULT 'IN',
  p_currency_code character DEFAULT 'INR',
  p_tax_enabled boolean DEFAULT true,
  p_tax_region text DEFAULT 'IN-MH',
  p_tax_mode text DEFAULT NULL,
  p_notification_email boolean DEFAULT true,
  p_notification_whatsapp boolean DEFAULT true,
  p_notification_sms boolean DEFAULT false,
  p_category_id uuid DEFAULT NULL,
  p_subcategory_id uuid DEFAULT NULL,
  p_selling_model text DEFAULT NULL,
  p_sales_channels jsonb DEFAULT '[]'::jsonb,
  p_team_size text DEFAULT NULL,
  p_tax_state text DEFAULT NULL,
  p_gstin text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_org uuid;
  v_business uuid;
  v_user uuid:=auth.uid();
  v_country char(2):=upper(btrim(p_country_code));
  v_currency char(3):=upper(btrim(p_currency_code));
  v_tax_mode text:=lower(coalesce(nullif(btrim(p_tax_mode),''),
    CASE WHEN p_tax_enabled THEN CASE WHEN v_country='IN' THEN 'gst' ELSE 'other' END ELSE 'non_gst' END));
  v_region text;
  v_timezone text;
  v_tax_regime text;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF nullif(trim(p_business_name),'') IS NULL THEN RAISE EXCEPTION 'Business name is required'; END IF;
  IF v_country IS NULL OR v_country !~ '^[A-Z]{2}$' THEN RAISE EXCEPTION 'Valid ISO 3166-1 country code is required'; END IF;
  IF v_currency IS NULL OR v_currency !~ '^[A-Z]{3}$' THEN RAISE EXCEPTION 'Valid ISO 4217 currency code is required'; END IF;
  IF v_tax_mode NOT IN ('gst','non_gst','vat','sales_tax','other') THEN RAISE EXCEPTION 'Unsupported tax mode'; END IF;

  IF p_category_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public.business_categories WHERE id=p_category_id AND is_active
  ) THEN RAISE EXCEPTION 'Invalid business category'; END IF;

  IF p_subcategory_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public.business_subcategories s
    WHERE s.id=p_subcategory_id AND s.is_active
      AND (p_category_id IS NULL OR s.category_id=p_category_id)
  ) THEN RAISE EXCEPTION 'Invalid business sub-category'; END IF;

  IF p_selling_model IS NOT NULL AND p_selling_model NOT IN ('products','services','both') THEN
    RAISE EXCEPTION 'Invalid selling model';
  END IF;

  IF EXISTS(
    SELECT 1
    FROM public.businesses b
    JOIN public.organization_members om ON om.organization_id=b.organization_id
    WHERE om.user_id=v_user AND om.is_active AND b.is_active
      AND lower(b.name)=lower(trim(p_business_name))
  ) THEN RAISE EXCEPTION 'A business with this name already exists for your account'; END IF;

  v_region:=CASE
    WHEN v_tax_mode='gst' THEN coalesce(nullif(trim(p_tax_region),''),'IN-MH')
    ELSE nullif(trim(p_tax_region),'')
  END CASE;

  v_timezone:=CASE WHEN v_country='IN' THEN 'Asia/Kolkata' ELSE 'UTC' END;
  v_tax_regime:=CASE v_tax_mode
    WHEN 'gst' THEN 'GST'
    WHEN 'vat' THEN 'VAT'
    WHEN 'sales_tax' THEN 'SALES_TAX'
    WHEN 'other' THEN 'OTHER'
    ELSE 'NONE'
  END;

  INSERT INTO public.organizations(
    name,legal_name,owner_user_id,country_code,base_currency,
    fiscal_year_start_month,tax_enabled,default_tax_region,settings
  ) VALUES(
    trim(p_business_name),trim(p_business_name),v_user,v_country,v_currency,
    CASE WHEN v_country='IN' THEN 4 ELSE 1 END,v_tax_mode<>'non_gst',
    v_region,'{}'::jsonb
  ) RETURNING id INTO v_org;

  INSERT INTO public.organization_members(organization_id,user_id,role,is_active)
  VALUES(v_org,v_user,'owner',true);

  INSERT INTO public.businesses(
    organization_id,name,legal_name,business_type,country_code,currency_code,
    base_currency_code,fiscal_year_start_month,timezone,default_timezone,
    address,tax_settings,numbering_settings,is_active,category_id,subcategory_id,
    selling_model,sales_channels,team_size
  ) VALUES(
    v_org,trim(p_business_name),trim(p_business_name),p_business_type,v_country,v_currency,
    v_currency,CASE WHEN v_country='IN' THEN 4 ELSE 1 END,v_timezone,v_timezone,
    '{}'::jsonb,
    jsonb_build_object('enabled',v_tax_mode<>'non_gst','mode',v_tax_mode,'region',v_region),
    '{}'::jsonb,true,p_category_id,p_subcategory_id,p_selling_model,
    coalesce(p_sales_channels,'[]'::jsonb),p_team_size
  ) RETURNING id INTO v_business;

  INSERT INTO public.business_preferences(
    business_id,tax_mode,notification_email_enabled,
    notification_whatsapp_enabled,notification_sms_enabled
  ) VALUES(v_business,v_tax_mode,p_notification_email,p_notification_whatsapp,p_notification_sms)
  ON CONFLICT (business_id) DO UPDATE
  SET tax_mode=excluded.tax_mode,notification_email_enabled=excluded.notification_email_enabled,
      notification_whatsapp_enabled=excluded.notification_whatsapp_enabled,
      notification_sms_enabled=excluded.notification_sms_enabled,updated_at=now();

  INSERT INTO public.business_tax_profiles(
    business_id,tax_regime,gst_registration_type,gstin,tax_country,tax_state
  ) VALUES(
    v_business,v_tax_regime,
    CASE WHEN v_tax_mode='gst' THEN 'REGULAR' ELSE 'NONE' END,
    CASE WHEN v_country='IN' AND v_tax_mode='gst' THEN nullif(trim(p_gstin),'') ELSE NULL END,
    v_country,
    CASE WHEN v_country='IN' AND v_tax_mode='gst' THEN nullif(trim(p_tax_state),'') ELSE NULL END
  )
  ON CONFLICT (business_id) DO UPDATE
  SET tax_regime=excluded.tax_regime,gst_registration_type=excluded.gst_registration_type,
      gstin=excluded.gstin,tax_country=excluded.tax_country,tax_state=excluded.tax_state,
      updated_at=now();

  UPDATE public.business_settings
  SET default_sales_account_id=(SELECT id FROM public.accounts WHERE business_id=v_business AND code='4000'),
      default_receivable_account_id=(SELECT id FROM public.accounts WHERE business_id=v_business AND code='1100'),
      default_cash_account_id=(SELECT id FROM public.accounts WHERE business_id=v_business AND code='1000'),
      default_bank_account_id=(SELECT id FROM public.accounts WHERE business_id=v_business AND code='1010'),
      updated_at=now()
  WHERE business_id=v_business;

  RETURN v_business;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_business_for_current_user(
  p_business_name text,
  p_business_type business_type DEFAULT 'sole_proprietorship',
  p_country_code character DEFAULT 'IN',
  p_currency_code character DEFAULT 'INR',
  p_tax_enabled boolean DEFAULT true,
  p_tax_region text DEFAULT 'IN-MH',
  p_tax_mode text DEFAULT NULL,
  p_notification_email boolean DEFAULT true,
  p_notification_whatsapp boolean DEFAULT true,
  p_notification_sms boolean DEFAULT false,
  p_category_id uuid DEFAULT NULL,
  p_subcategory_id uuid DEFAULT NULL,
  p_selling_model text DEFAULT NULL,
  p_sales_channels jsonb DEFAULT '[]'::jsonb,
  p_team_size text DEFAULT NULL,
  p_tax_state text DEFAULT NULL,
  p_gstin text DEFAULT NULL,
  p_feature_flags jsonb DEFAULT '{}'::jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_business uuid;
BEGIN
  v_business:=public.create_business_for_current_user(
    p_business_name,p_business_type,p_country_code,p_currency_code,p_tax_enabled,
    p_tax_region,p_tax_mode,p_notification_email,p_notification_whatsapp,
    p_notification_sms,p_category_id,p_subcategory_id,p_selling_model,
    p_sales_channels,p_team_size,p_tax_state,p_gstin
  );

  UPDATE public.businesses
  SET feature_flags=coalesce(p_feature_flags,'{}'::jsonb),
      base_currency_code=upper(currency_code)
  WHERE id=v_business;

  PERFORM public.seed_business_defaults(v_business);
  RETURN v_business;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_business_for_current_user(
  text,business_type,character,character,boolean,text,text,boolean,boolean,boolean,
  uuid,uuid,text,jsonb,text,text,text
) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.create_business_for_current_user(
  text,business_type,character,character,boolean,text,text,boolean,boolean,boolean,
  uuid,uuid,text,jsonb,text,text,text
) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.create_business_for_current_user(
  text,business_type,character,character,boolean,text,text,boolean,boolean,boolean,
  uuid,uuid,text,jsonb,text,text,text,jsonb
) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.create_business_for_current_user(
  text,business_type,character,character,boolean,text,text,boolean,boolean,boolean,
  uuid,uuid,text,jsonb,text,text,text,jsonb
) TO authenticated;


-- Currency-aware AR/AP read models.
CREATE OR REPLACE VIEW public.customer_currency_balances WITH (security_invoker=true) AS
SELECT
  c.business_id,c.id AS customer_id,c.display_name,i.currency_code,
  COALESCE(SUM(i.total),0)::numeric(20,4) AS invoiced,
  COALESCE(SUM(i.amount_paid),0)::numeric(20,4) AS paid,
  COALESCE(SUM(i.balance_due),0)::numeric(20,4) AS balance_due
FROM public.customers c
JOIN public.invoices i
  ON i.customer_id=c.id AND i.business_id=c.business_id AND i.status <> 'void'
GROUP BY c.business_id,c.id,c.display_name,i.currency_code;

CREATE OR REPLACE VIEW public.vendor_currency_balances WITH (security_invoker=true) AS
SELECT
  v.business_id,v.id AS vendor_id,v.display_name,b.currency_code,
  COALESCE(SUM(b.total),0)::numeric(20,4) AS billed,
  COALESCE(SUM(b.amount_paid),0)::numeric(20,4) AS paid,
  COALESCE(SUM(b.balance_due),0)::numeric(20,4) AS balance_due
FROM public.vendors v
JOIN public.bills b
  ON b.vendor_id=v.id AND b.business_id=v.business_id AND b.status <> 'void'
GROUP BY v.business_id,v.id,v.display_name,b.currency_code;

-- Preserve the legacy one-row-per-party contract without ever mixing currencies:
-- it exposes only the business base currency. New UI should use the currency views.
CREATE OR REPLACE VIEW public.customer_balances WITH (security_invoker=true) AS
SELECT
  c.business_id,c.id AS customer_id,c.display_name,
  COALESCE(SUM(i.total),0)::numeric(20,4) AS invoiced,
  COALESCE(SUM(i.amount_paid),0)::numeric(20,4) AS paid,
  COALESCE(SUM(i.balance_due),0)::numeric(20,4) AS balance_due
FROM public.customers c
LEFT JOIN public.businesses bus ON bus.id=c.business_id
LEFT JOIN public.invoices i
  ON i.customer_id=c.id
 AND i.business_id=c.business_id
 AND i.status <> 'void'
 AND upper(i.currency_code)=upper(bus.base_currency_code)
GROUP BY c.business_id,c.id,c.display_name;

CREATE OR REPLACE VIEW public.vendor_balances WITH (security_invoker=true) AS
SELECT
  v.business_id,v.id AS vendor_id,v.display_name,
  COALESCE(SUM(b.total),0)::numeric(20,4) AS billed,
  COALESCE(SUM(b.amount_paid),0)::numeric(20,4) AS paid,
  COALESCE(SUM(b.balance_due),0)::numeric(20,4) AS balance_due
FROM public.vendors v
LEFT JOIN public.businesses bus ON bus.id=v.business_id
LEFT JOIN public.bills b
  ON b.vendor_id=v.id
 AND b.business_id=v.business_id
 AND b.status <> 'void'
 AND upper(b.currency_code)=upper(bus.base_currency_code)
GROUP BY v.business_id,v.id,v.display_name;

COMMIT;
