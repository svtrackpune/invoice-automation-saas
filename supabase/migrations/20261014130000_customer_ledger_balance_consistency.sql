BEGIN;

-- Customer ledger outstanding is a live, business-base-currency total.
-- Keep the shared helper and the customer_balances view on identical inclusion
-- rules so receipts and every workspace document show the same ledger figure.
CREATE OR REPLACE FUNCTION public.fn_get_customer_outstanding_balance(
  p_business_id uuid,
  p_customer_id uuid
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT round(coalesce(sum(coalesce(i.balance_due, 0)), 0), 2)::numeric(15,2)
  FROM public.invoices i
  JOIN public.businesses b ON b.id = i.business_id
  WHERE i.business_id = p_business_id
    AND i.customer_id = p_customer_id
    AND i.status::text NOT IN ('draft', 'void', 'cancelled')
    AND upper(i.currency_code::text) = upper(b.base_currency_code::text);
$function$;

REVOKE ALL ON FUNCTION public.fn_get_customer_outstanding_balance(uuid,uuid)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE VIEW public.customer_balances
WITH (security_invoker = true)
AS
SELECT
  c.business_id,
  c.id AS customer_id,
  c.display_name,
  coalesce(sum(i.total), 0)::numeric(20,4) AS invoiced,
  coalesce(sum(i.amount_paid), 0)::numeric(20,4) AS paid,
  round(coalesce(sum(coalesce(i.balance_due, 0)), 0), 2)::numeric(20,4) AS balance_due
FROM public.customers c
LEFT JOIN public.businesses bus
  ON bus.id = c.business_id
LEFT JOIN public.invoices i
  ON i.customer_id = c.id
 AND i.business_id = c.business_id
 AND i.status::text NOT IN ('draft', 'void', 'cancelled')
 AND upper(i.currency_code::text) = upper(bus.base_currency_code::text)
GROUP BY c.business_id, c.id, c.display_name;

COMMENT ON FUNCTION public.fn_get_customer_outstanding_balance(uuid,uuid) IS
  'Live customer outstanding balance in the business base currency; matches public.customer_balances and excludes draft, void, and cancelled invoices.';

COMMIT;
