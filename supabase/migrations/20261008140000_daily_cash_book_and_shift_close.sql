BEGIN;

-- Daily cash drawer / shift reconciliation.
CREATE TABLE IF NOT EXISTS public.daily_cash_shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  shift_date DATE NOT NULL,
  opened_by UUID REFERENCES auth.users(id),
  closed_by UUID REFERENCES auth.users(id),
  opening_float NUMERIC(15, 2) NOT NULL DEFAULT 0.00 CHECK (opening_float >= 0),
  cash_sales NUMERIC(15, 2) NOT NULL DEFAULT 0.00 CHECK (cash_sales >= 0),
  cash_inflow NUMERIC(15, 2) NOT NULL DEFAULT 0.00 CHECK (cash_inflow >= 0),
  cash_expenses NUMERIC(15, 2) NOT NULL DEFAULT 0.00 CHECK (cash_expenses >= 0),
  bank_deposits NUMERIC(15, 2) NOT NULL DEFAULT 0.00 CHECK (bank_deposits >= 0),
  expected_closing NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
  actual_closing NUMERIC(15, 2) NOT NULL DEFAULT 0.00 CHECK (actual_closing >= 0),
  variance NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status = ANY (ARRAY['open'::text, 'closed'::text, 'audited'::text])),
  notes TEXT,
  journal_entry_id UUID REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_biz_shift_date UNIQUE (business_id, shift_date)
);

CREATE INDEX IF NOT EXISTS daily_cash_shifts_business_date_idx
  ON public.daily_cash_shifts (business_id, shift_date DESC);

ALTER TABLE public.daily_cash_shifts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS daily_cash_shifts_select ON public.daily_cash_shifts;
CREATE POLICY daily_cash_shifts_select
  ON public.daily_cash_shifts
  FOR SELECT
  TO authenticated
  USING (
    mm_private.has_business_permission(business_id, 'reports.view', auth.uid())
    OR mm_private.has_business_permission(business_id, 'accounting.view', auth.uid())
    OR mm_private.has_business_permission(business_id, 'pos.cash_bill.create', auth.uid())
  );

GRANT SELECT ON public.daily_cash_shifts TO authenticated;

-- Read-only calculation. Closed/audited shifts are frozen to the reconciled values
-- so later transaction edits do not silently rewrite a completed close.
CREATE OR REPLACE FUNCTION public.get_daily_cash_summary(
  p_business_id UUID,
  p_date DATE,
  p_opening_float NUMERIC DEFAULT 0.00
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, mm_private, pg_temp
AS $$
DECLARE
  v_cash_sales NUMERIC := 0.00;
  v_cash_inflow NUMERIC := 0.00;
  v_cash_expenses NUMERIC := 0.00;
  v_bank_deposits NUMERIC := 0.00;
  v_expected NUMERIC := 0.00;
  v_shift public.daily_cash_shifts%ROWTYPE;
  v_actor UUID := auth.uid();
BEGIN
  IF v_actor IS NULL OR NOT (
    mm_private.has_business_permission(p_business_id, 'reports.view', v_actor)
    OR mm_private.has_business_permission(p_business_id, 'accounting.view', v_actor)
    OR mm_private.has_business_permission(p_business_id, 'pos.cash_bill.create', v_actor)
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT *
  INTO v_shift
  FROM public.daily_cash_shifts
  WHERE business_id = p_business_id
    AND shift_date = p_date
  LIMIT 1;

  IF v_shift.id IS NOT NULL AND v_shift.status IN ('closed', 'audited') THEN
    RETURN jsonb_build_object(
      'shift_date', p_date,
      'status', v_shift.status,
      'opening_float', v_shift.opening_float,
      'cash_sales', v_shift.cash_sales,
      'cash_inflow', v_shift.cash_inflow,
      'cash_expenses', v_shift.cash_expenses,
      'bank_deposits', v_shift.bank_deposits,
      'expected_closing', v_shift.expected_closing,
      'actual_closing', v_shift.actual_closing,
      'variance', v_shift.variance,
      'notes', COALESCE(v_shift.notes, '')
    );
  END IF;

  -- Cash Bills are fully settled through an inbound payment. Count those
  -- payments as cash sales and exclude them from general cash inflow.
  SELECT COALESCE(SUM(p.amount), 0.00)
  INTO v_cash_sales
  FROM public.payments p
  JOIN public.invoices i
    ON i.id = p.invoice_id
   AND i.business_id = p.business_id
  WHERE p.business_id = p_business_id
    AND p.payment_date = p_date
    AND p.direction = 'inbound'
    AND p.method = 'cash'
    AND i.document_kind = 'cash_bill'
    AND i.status = 'paid';

  SELECT COALESCE(SUM(p.amount), 0.00)
  INTO v_cash_inflow
  FROM public.payments p
  LEFT JOIN public.invoices i
    ON i.id = p.invoice_id
   AND i.business_id = p.business_id
  WHERE p.business_id = p_business_id
    AND p.payment_date = p_date
    AND p.direction = 'inbound'
    AND p.method = 'cash'
    AND COALESCE(i.document_kind, '') <> 'cash_bill';

  SELECT COALESCE(SUM(e.amount), 0.00)
  INTO v_cash_expenses
  FROM public.expenses e
  WHERE e.business_id = p_business_id
    AND e.expense_date = p_date
    AND (e.payment_method = 'cash' OR e.payment_method IS NULL);

  v_bank_deposits := COALESCE(v_shift.bank_deposits, 0.00);
  v_expected :=
    COALESCE(v_shift.opening_float, p_opening_float)
    + v_cash_sales
    + v_cash_inflow
    - v_cash_expenses
    - v_bank_deposits;

  RETURN jsonb_build_object(
    'shift_date', p_date,
    'status', COALESCE(v_shift.status, 'open'),
    'opening_float', COALESCE(v_shift.opening_float, p_opening_float),
    'cash_sales', v_cash_sales,
    'cash_inflow', v_cash_inflow,
    'cash_expenses', v_cash_expenses,
    'bank_deposits', v_bank_deposits,
    'expected_closing', v_expected,
    'actual_closing', COALESCE(NULLIF(v_shift.actual_closing, 0.00), v_expected),
    'variance', COALESCE(v_shift.variance, 0.00),
    'notes', COALESCE(v_shift.notes, '')
  );
END;
$$;

-- Close exactly one open shift and post one variance journal, if required.
CREATE OR REPLACE FUNCTION public.close_daily_cash_shift(
  p_business_id UUID,
  p_date DATE,
  p_opening_float NUMERIC,
  p_actual_closing NUMERIC,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, mm_private, pg_temp
AS $$
DECLARE
  v_summary JSONB;
  v_expected NUMERIC;
  v_variance NUMERIC;
  v_entry_id UUID;
  v_entry_number BIGINT;
  v_cash_acc UUID;
  v_variance_acc UUID;
  v_shift public.daily_cash_shifts%ROWTYPE;
  v_actor UUID := auth.uid();
  v_currency CHAR(3);
BEGIN
  IF v_actor IS NULL
     OR NOT mm_private.has_business_permission(p_business_id, 'accounting.post', v_actor)
     OR NOT mm_private.has_business_permission(p_business_id, 'accounting.adjust', v_actor) THEN
    RAISE EXCEPTION 'Access denied: accounting.post and accounting.adjust permissions are required';
  END IF;

  IF p_opening_float < 0 OR p_actual_closing < 0 THEN
    RAISE EXCEPTION 'Opening float and actual closing cash cannot be negative';
  END IF;

  PERFORM public.assert_accounting_period_open(p_business_id, p_date);

  -- Serialize close operations per business/date.
  PERFORM pg_advisory_xact_lock(
    hashtext('daily-cash-shift:' || p_business_id::text || ':' || p_date::text)
  );

  SELECT *
  INTO v_shift
  FROM public.daily_cash_shifts
  WHERE business_id = p_business_id
    AND shift_date = p_date
  FOR UPDATE;

  IF v_shift.id IS NOT NULL AND v_shift.status <> 'open' THEN
    RAISE EXCEPTION 'Daily cash shift is already % and cannot be closed again', v_shift.status;
  END IF;

  v_summary := public.get_daily_cash_summary(p_business_id, p_date, p_opening_float);
  v_expected := (v_summary->>'expected_closing')::NUMERIC;
  v_variance := ROUND(p_actual_closing - v_expected, 2);

  IF v_shift.id IS NULL THEN
    INSERT INTO public.daily_cash_shifts (
      business_id,
      shift_date,
      opened_by,
      opening_float,
      cash_sales,
      cash_inflow,
      cash_expenses,
      bank_deposits,
      expected_closing,
      actual_closing,
      variance,
      status,
      notes
    )
    VALUES (
      p_business_id,
      p_date,
      v_actor,
      (v_summary->>'opening_float')::NUMERIC,
      (v_summary->>'cash_sales')::NUMERIC,
      (v_summary->>'cash_inflow')::NUMERIC,
      (v_summary->>'cash_expenses')::NUMERIC,
      (v_summary->>'bank_deposits')::NUMERIC,
      v_expected,
      0.00,
      0.00,
      'open',
      p_notes
    )
    RETURNING * INTO v_shift;
  ELSE
    IF v_shift.opening_float <> p_opening_float THEN
      RAISE EXCEPTION 'Opening float does not match the existing open shift';
    END IF;

    UPDATE public.daily_cash_shifts
    SET
      opened_by = COALESCE(opened_by, v_actor),
      cash_sales = (v_summary->>'cash_sales')::NUMERIC,
      cash_inflow = (v_summary->>'cash_inflow')::NUMERIC,
      cash_expenses = (v_summary->>'cash_expenses')::NUMERIC,
      bank_deposits = (v_summary->>'bank_deposits')::NUMERIC,
      expected_closing = v_expected,
      notes = COALESCE(p_notes, notes),
      updated_at = now()
    WHERE id = v_shift.id
    RETURNING * INTO v_shift;
  END IF;

  SELECT base_currency_code
  INTO v_currency
  FROM public.businesses
  WHERE id = p_business_id
    AND is_active;

  IF v_currency IS NULL THEN
    RAISE EXCEPTION 'Business is missing an active base currency';
  END IF;

  IF v_variance <> 0 THEN
    -- Create the project-standard variance account on demand for older/new businesses.
    INSERT INTO public.accounts (
      business_id,
      code,
      name,
      account_type,
      normal_balance,
      is_system,
      is_active,
      description
    )
    SELECT
      p_business_id,
      '6250',
      'Cash Over / Short',
      'expense',
      'debit',
      true,
      true,
      'Daily cash drawer over/short variance'
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.accounts
      WHERE business_id = p_business_id
        AND code = '6250'
    );

    SELECT id
    INTO v_cash_acc
    FROM public.accounts
    WHERE business_id = p_business_id
      AND code = '1000'
      AND is_active
    LIMIT 1;

    SELECT id
    INTO v_variance_acc
    FROM public.accounts
    WHERE business_id = p_business_id
      AND code = '6250'
      AND is_active
    LIMIT 1;

    IF v_cash_acc IS NULL OR v_variance_acc IS NULL THEN
      RAISE EXCEPTION 'Cash or Cash Over / Short account is missing';
    END IF;

    PERFORM pg_advisory_xact_lock(
      hashtext('journal-entry-number:' || p_business_id::text)
    );

    SELECT COALESCE(MAX(entry_number), 0) + 1
    INTO v_entry_number
    FROM public.journal_entries
    WHERE business_id = p_business_id;

    INSERT INTO public.journal_entries (
      business_id,
      entry_number,
      entry_date,
      description,
      source_type,
      source_id,
      status,
      posted_at,
      posted_by,
      created_by,
      currency_code,
      total_debit,
      total_credit,
      is_system_generated,
      metadata
    )
    VALUES (
      p_business_id,
      v_entry_number,
      p_date,
      'Daily Cash Register Variance Settlement',
      'cash_shift_variance',
      v_shift.id,
      'posted',
      now(),
      v_actor,
      v_actor,
      v_currency,
      ABS(v_variance),
      ABS(v_variance),
      true,
      jsonb_build_object(
        'shift_id', v_shift.id,
        'expected_closing', v_expected,
        'actual_closing', p_actual_closing,
        'variance', v_variance
      )
    )
    RETURNING id INTO v_entry_id;

    IF v_variance < 0 THEN
      INSERT INTO public.journal_lines (
        journal_entry_id,
        account_id,
        description,
        debit,
        credit,
        currency_code,
        transaction_currency_code,
        transaction_amount,
        base_currency_code,
        base_amount
      )
      VALUES
        (
          v_entry_id,
          v_variance_acc,
          'Cash shortage',
          ABS(v_variance),
          0.00,
          v_currency,
          v_currency,
          ABS(v_variance),
          v_currency,
          ABS(v_variance)
        ),
        (
          v_entry_id,
          v_cash_acc,
          'Cash drawer adjustment',
          0.00,
          ABS(v_variance),
          v_currency,
          v_currency,
          ABS(v_variance),
          v_currency,
          ABS(v_variance)
        );
    ELSE
      INSERT INTO public.journal_lines (
        journal_entry_id,
        account_id,
        description,
        debit,
        credit,
        currency_code,
        transaction_currency_code,
        transaction_amount,
        base_currency_code,
        base_amount
      )
      VALUES
        (
          v_entry_id,
          v_cash_acc,
          'Cash drawer surplus',
          v_variance,
          0.00,
          v_currency,
          v_currency,
          v_variance,
          v_currency,
          v_variance
        ),
        (
          v_entry_id,
          v_variance_acc,
          'Cash over',
          0.00,
          v_variance,
          v_currency,
          v_currency,
          v_variance,
          v_currency,
          v_variance
        );
    END IF;

    PERFORM public.validate_journal_entry_balance(v_entry_id);
  END IF;

  UPDATE public.daily_cash_shifts
  SET
    closed_by = v_actor,
    actual_closing = p_actual_closing,
    variance = v_variance,
    status = 'closed',
    notes = p_notes,
    journal_entry_id = v_entry_id,
    closed_at = now(),
    updated_at = now()
  WHERE id = v_shift.id;

  RETURN jsonb_build_object(
    'success', true,
    'shift_id', v_shift.id,
    'expected', v_expected,
    'actual', p_actual_closing,
    'variance', v_variance,
    'journal_entry_id', v_entry_id
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_daily_cash_summary(UUID, DATE, NUMERIC)
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.close_daily_cash_shift(UUID, DATE, NUMERIC, NUMERIC, TEXT)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_daily_cash_summary(UUID, DATE, NUMERIC)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_daily_cash_shift(UUID, DATE, NUMERIC, NUMERIC, TEXT)
  TO authenticated;

COMMIT;