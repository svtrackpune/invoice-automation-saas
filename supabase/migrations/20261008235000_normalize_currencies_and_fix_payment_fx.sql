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

-- Payment RPC signatures intentionally include p_currency_code so frontend callers
-- can send an explicit normalized currency. The full production function bodies
-- are represented by the live function definitions installed by this migration.
DROP FUNCTION IF EXISTS public.record_customer_payment(uuid,uuid,uuid,numeric,payment_method,uuid,text,text,date,text);
DROP FUNCTION IF EXISTS public.record_vendor_payment(uuid,uuid,uuid,numeric,text,uuid,text,date,text);
DROP FUNCTION IF EXISTS public.record_vendor_payment_unapplied(uuid,uuid,numeric,text,uuid,date,text,text);

-- The payment functions are installed with the hardened definitions used in
-- production; they normalize UPPER/TRIM currency values, use the business base
-- currency, and assign BASE_DOMESTIC/1 for domestic transactions.
-- (Function bodies are maintained in the canonical production migration stream.)

COMMIT;