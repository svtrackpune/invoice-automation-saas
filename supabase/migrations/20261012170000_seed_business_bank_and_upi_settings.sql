-- Configure operator-supplied settlement details for the exact Vijay Industries business.
-- This data migration intentionally fails closed if the business name is ambiguous.
BEGIN;

DO $$
DECLARE
  v_business_id uuid;
  v_business_matches integer;
  v_account_id uuid;
  v_updated_rows integer;
BEGIN
  SELECT count(DISTINCT id)
    INTO v_business_matches
  FROM public.businesses
  WHERE lower(btrim(name)) = 'vijay industries'
     OR lower(btrim(coalesce(legal_name, ''))) = 'vijay industries';

  IF v_business_matches <> 1 THEN
    RAISE EXCEPTION
      'Expected exactly one business named Vijay Industries; found %',
      v_business_matches;
  END IF;

  SELECT id
    INTO v_business_id
  FROM public.businesses
  WHERE lower(btrim(name)) = 'vijay industries'
     OR lower(btrim(coalesce(legal_name, ''))) = 'vijay industries'
  ORDER BY (lower(btrim(name)) = 'vijay industries') DESC, created_at
  LIMIT 1;

  -- Prefer a pre-existing row with the supplied account number; otherwise reuse
  -- this business's primary account so existing invoice references remain valid.
  SELECT id
    INTO v_account_id
  FROM public.bank_accounts
  WHERE business_id = v_business_id
    AND (account_number = '30981234567' OR is_primary = true)
  ORDER BY (account_number = '30981234567') DESC, is_primary DESC, created_at
  LIMIT 1;

  IF v_account_id IS NULL THEN
    INSERT INTO public.bank_accounts (
      business_id,
      name,
      institution_name,
      account_holder_name,
      account_number,
      account_last4,
      currency_code,
      ifsc_code,
      branch_name,
      account_type,
      is_primary,
      is_active,
      metadata,
      created_at,
      updated_at
    ) VALUES (
      v_business_id,
      'State Bank of India',
      'State Bank of India',
      'Vijay Industries',
      '30981234567',
      '4567',
      'INR',
      'SBIN0001234',
      NULL,
      NULL,
      true,
      true,
      jsonb_build_object(
        'institution_name', 'State Bank of India',
        'account_holder_name', 'Vijay Industries',
        'account_number', '30981234567',
        'account_last4', '4567',
        'ifsc_code', 'SBIN0001234',
        'currency_code', 'INR',
        'upi_id', '9922040001@upi'
      ),
      now(),
      now()
    )
    RETURNING id INTO v_account_id;
  ELSE
    UPDATE public.bank_accounts
    SET name = 'State Bank of India',
        institution_name = 'State Bank of India',
        account_holder_name = 'Vijay Industries',
        account_number = '30981234567',
        account_last4 = '4567',
        currency_code = 'INR',
        ifsc_code = 'SBIN0001234',
        -- Do not retain the former bank's branch or account-type metadata.
        branch_name = NULL,
        account_type = NULL,
        is_primary = true,
        is_active = true,
        metadata = jsonb_build_object(
          'institution_name', 'State Bank of India',
          'account_holder_name', 'Vijay Industries',
          'account_number', '30981234567',
          'account_last4', '4567',
          'ifsc_code', 'SBIN0001234',
          'currency_code', 'INR',
          'upi_id', '9922040001@upi'
        ),
        updated_at = now()
    WHERE id = v_account_id
      AND business_id = v_business_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Selected bank account could not be updated safely';
    END IF;
  END IF;

  -- Keep exactly one active primary account for this business.
  UPDATE public.bank_accounts
  SET is_primary = false,
      updated_at = now()
  WHERE business_id = v_business_id
    AND id <> v_account_id
    AND is_primary = true;

  UPDATE public.business_settings
  SET default_bank_account_id = v_account_id,
      updated_at = now()
  WHERE business_id = v_business_id;

  GET DIAGNOSTICS v_updated_rows = ROW_COUNT;
  IF v_updated_rows = 0 THEN
    RAISE EXCEPTION 'Business settings row is missing for Vijay Industries';
  END IF;

  INSERT INTO public.document_payment_settings (
    business_id,
    payment_qr_enabled,
    upi_id,
    payment_instructions,
    merchant_name,
    default_bank_account_id,
    enable_upi,
    prefill_bill_amount,
    qr_code_notes,
    created_at,
    updated_at
  ) VALUES (
    v_business_id,
    true,
    '9922040001@upi',
    'Scan the QR code to pay via a UPI app such as Google Pay, PhonePe, or Paytm.',
    'Vijay Industries',
    v_account_id,
    true,
    true,
    'Scan QR code to pay via any UPI app (GPay, PhonePe, Paytm).',
    now(),
    now()
  )
  ON CONFLICT (business_id) DO UPDATE
    SET payment_qr_enabled = true,
        upi_id = EXCLUDED.upi_id,
        payment_instructions = EXCLUDED.payment_instructions,
        merchant_name = EXCLUDED.merchant_name,
        default_bank_account_id = EXCLUDED.default_bank_account_id,
        enable_upi = true,
        prefill_bill_amount = true,
        qr_code_notes = EXCLUDED.qr_code_notes,
        updated_at = now();

  -- Internal templates use this preference to decide whether settlement details appear.
  UPDATE public.business_document_preferences
  SET show_bank_details = true
  WHERE business_id = v_business_id
    AND document_type IN ('invoice', 'quotation');

  IF (
    SELECT count(*)
    FROM public.business_document_preferences
    WHERE business_id = v_business_id
      AND document_type IN ('invoice', 'quotation')
      AND show_bank_details = true
  ) <> 2 THEN
    RAISE EXCEPTION 'Invoice and quotation bank-detail preferences could not both be enabled';
  END IF;

  -- Select the same account for both document types and remove conflicting selections.
  DELETE FROM public.business_document_bank_accounts
  WHERE business_id = v_business_id
    AND document_type IN ('invoice', 'quotation')
    AND bank_account_id <> v_account_id;

  INSERT INTO public.business_document_bank_accounts (
    business_id, document_type, bank_account_id, display_order
  ) VALUES
    (v_business_id, 'invoice', v_account_id, 0),
    (v_business_id, 'quotation', v_account_id, 0)
  ON CONFLICT (business_id, document_type, bank_account_id)
  DO UPDATE SET display_order = EXCLUDED.display_order;

  IF NOT EXISTS (
    SELECT 1 FROM public.bank_accounts
    WHERE id = v_account_id
      AND business_id = v_business_id
      AND is_active = true
      AND is_primary = true
      AND account_number = '30981234567'
      AND ifsc_code = 'SBIN0001234'
      AND metadata->>'upi_id' = '9922040001@upi'
  ) THEN
    RAISE EXCEPTION 'Bank-account verification failed after configuration';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.document_payment_settings
    WHERE business_id = v_business_id
      AND default_bank_account_id = v_account_id
      AND payment_qr_enabled = true
      AND enable_upi = true
      AND upi_id = '9922040001@upi'
  ) THEN
    RAISE EXCEPTION 'Document payment-settings verification failed after configuration';
  END IF;
END;
$$;

COMMIT;
