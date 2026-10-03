-- Gate 0 deployment verification. READ-ONLY: this script performs no DDL/DML.
-- Run only after the 15 October 3 migrations and Gate 0 migration are deployed.

DO $$
DECLARE
  v_expected text[] := ARRAY[
    '20261003100000',
    '20261003120000',
    '20261003123000',
    '20261003130000',
    '20261003140000',
    '20261003142550',
    '20261003142900',
    '20261003143000',
    '20261003143510',
    '20261003150000',
    '20261003162000',
    '20261003163000',
    '20261003163500',
    '20261003164000',
    '20261003164500',
    '20261003170000'
  ];
  v_missing text[];
  v_table text;
  v_required_tables text[] := ARRAY[
    'jurisdictions',
    'business_tax_registrations',
    'tax_rules',
    'tax_rule_components',
    'customer_tax_profiles',
    'invoice_tax_lines',
    'api_keys',
    'webhook_subscriptions',
    'webhook_events',
    'webhook_delivery_logs',
    'saas_entitlements',
    'offline_cash_bill_sync',
    'bank_accounts',
    'bank_transactions',
    'bank_reconciliations',
    'bank_reconciliation_items',
    'role_permissions'
  ];
BEGIN
  SELECT coalesce(array_agg(v ORDER BY v), ARRAY[]::text[])
  INTO v_missing
  FROM unnest(v_expected) AS v
  WHERE NOT EXISTS (
    SELECT 1
    FROM supabase_migrations.schema_migrations m
    WHERE m.version = v
  );

  IF cardinality(v_missing) > 0 THEN
    RAISE EXCEPTION 'Gate 0 verification failed: missing migrations %', v_missing;
  END IF;

  FOREACH v_table IN ARRAY v_required_tables LOOP
    IF to_regclass('public.' || v_table) IS NULL THEN
      RAISE EXCEPTION 'Gate 0 verification failed: required table public.% is missing', v_table;
    END IF;
  END LOOP;

  IF to_regclass('public.reconciliations') IS NOT NULL
     OR to_regclass('public.reconciliation_items') IS NOT NULL THEN
    RAISE EXCEPTION 'Gate 0 verification failed: legacy reconciliation tables still exist';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='businesses' AND column_name='address_iso'
  ) THEN
    RAISE EXCEPTION 'Gate 0 verification failed: businesses.address_iso missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='customers' AND column_name='billing_address_iso'
  ) THEN
    RAISE EXCEPTION 'Gate 0 verification failed: customers.billing_address_iso missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='vendors' AND column_name='address_iso'
  ) THEN
    RAISE EXCEPTION 'Gate 0 verification failed: vendors.address_iso missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='businesses' AND column_name='e_invoice_endpoint_id'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='customers' AND column_name='e_invoice_endpoint_id'
  ) THEN
    RAISE EXCEPTION 'Gate 0 verification failed: e-invoice endpoint columns are incomplete';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='invoices' AND column_name='buyer_reference'
  ) THEN
    RAISE EXCEPTION 'Gate 0 verification failed: invoices.buyer_reference missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='offline_cash_bill_sync' AND column_name='temp_pos_uuid'
  ) THEN
    RAISE EXCEPTION 'Gate 0 verification failed: offline POS idempotency column missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='api_keys' AND column_name='key_hash'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='webhook_subscriptions' AND column_name='business_id'
  ) THEN
    RAISE EXCEPTION 'Gate 0 verification failed: API/webhook columns are incomplete';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='saas_entitlements' AND column_name='business_id'
  ) THEN
    RAISE EXCEPTION 'Gate 0 verification failed: SaaS entitlement columns are incomplete';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public'
      AND p.proname='api_create_invoice_from_items'
      AND pg_get_function_identity_arguments(p.oid)
        = 'p_api_key_hash text, p_business_id uuid, p_customer_id uuid, p_invoice_date date, p_due_date date, p_items jsonb, p_invoice_discount_type text, p_invoice_discount_value numeric, p_notes text, p_terms text, p_post boolean'
  ) THEN
    RAISE EXCEPTION 'Gate 0 verification failed: api_create_invoice_from_items signature missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public'
      AND p.proname='api_create_customer'
      AND pg_get_function_identity_arguments(p.oid)
        = 'p_api_key_hash text, p_business_id uuid, p_customer jsonb'
  ) THEN
    RAISE EXCEPTION 'Gate 0 verification failed: api_create_customer signature missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public'
      AND p.proname='api_create_invoice_with_dynamic_tax'
      AND pg_get_function_identity_arguments(p.oid)
        = 'p_api_key_hash text, p_business_id uuid, p_customer_id uuid, p_invoice_date date, p_due_date date, p_items jsonb, p_notes text, p_terms text, p_buyer_reference text, p_post boolean'
  ) THEN
    RAISE EXCEPTION 'Gate 0 verification failed: dynamic-tax API RPC signature missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public'
      AND p.proname='get_my_business_access'
      AND pg_get_function_identity_arguments(p.oid)='p_business_id uuid'
  ) THEN
    RAISE EXCEPTION 'Gate 0 verification failed: get_my_business_access signature missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public'
      AND p.proname='record_gateway_payment'
      AND pg_get_function_identity_arguments(p.oid)
        = 'p_provider text, p_provider_link_id text, p_provider_transaction_id text, p_event_id text, p_gross_amount numeric, p_fee_amount numeric, p_net_amount numeric, p_payment_date date, p_notes text'
  ) THEN
    RAISE EXCEPTION 'Gate 0 verification failed: provider-neutral record_gateway_payment signature missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public'
      AND p.proname='record_gateway_payment'
      AND pg_get_function_identity_arguments(p.oid)
        = 'p_provider text, p_provider_link_id text, p_provider_transaction_id text, p_event_id text, p_amount numeric, p_payment_date date, p_notes text'
  ) THEN
    RAISE EXCEPTION 'Gate 0 verification failed: backward-compatible gateway wrapper missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname='invoices_source_quotation_id_fkey'
      AND condeferrable
      AND condeferred
      AND pg_get_constraintdef(oid) ILIKE '%ON DELETE SET NULL%'
  ) THEN
    RAISE EXCEPTION 'Gate 0 verification failed: invoices.source_quotation_id FK is not deferred SET NULL';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname='quotations_invoice_id_fkey'
      AND condeferrable
      AND condeferred
      AND pg_get_constraintdef(oid) ILIKE '%ON DELETE SET NULL%'
  ) THEN
    RAISE EXCEPTION 'Gate 0 verification failed: quotations.invoice_id FK is not deferred SET NULL';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      VALUES
        ('api_keys'),
        ('webhook_subscriptions'),
        ('webhook_events'),
        ('webhook_delivery_logs'),
        ('saas_entitlements'),
        ('offline_cash_bill_sync'),
        ('bank_accounts'),
        ('bank_transactions'),
        ('bank_reconciliations'),
        ('bank_reconciliation_items')
    ) AS required_tables(name)
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=required_tables.name
        AND c.relrowsecurity
    )
  ) THEN
    RAISE EXCEPTION 'Gate 0 verification failed: one or more enterprise tables do not have RLS enabled';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.businesses b
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.accounts a
      WHERE a.business_id=b.id
        AND a.code='6200'
        AND a.is_active
    )
  ) THEN
    RAISE EXCEPTION 'Gate 0 verification failed: one or more businesses lack active payment-processing-fee account 6200';
  END IF;

  RAISE NOTICE 'Gate 0 verification passed: 16 migrations present, canonical banking model present, legacy reconciliation tables absent, gateway RPCs/provider support present, quotation FKs deferred SET NULL, and required RLS/fee-account checks passed.';
END;
$$;

-- Human-readable inspection result.
SELECT
  p.proname,
  pg_get_function_identity_arguments(p.oid) AS signature,
  CASE WHEN p.prosecdef THEN 'SECURITY DEFINER' ELSE 'SECURITY INVOKER' END AS security_mode
FROM pg_proc p
JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public'
  AND p.proname IN (
    'record_gateway_payment',
    'api_create_invoice_from_items',
    'api_create_customer',
    'api_create_invoice_with_dynamic_tax',
    'get_my_business_access'
  )
ORDER BY p.proname, signature;

SELECT
  conname,
  pg_get_constraintdef(oid) AS definition,
  condeferrable,
  condeferred
FROM pg_constraint
WHERE conname IN (
  'invoices_source_quotation_id_fkey',
  'quotations_invoice_id_fkey'
)
ORDER BY conname;
