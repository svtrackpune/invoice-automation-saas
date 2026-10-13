BEGIN;

CREATE FUNCTION pg_temp.patch_function_definition(
  p_signature regprocedure,
  p_old text,
  p_new text
) RETURNS void
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public', 'mm_private', 'pg_temp'
AS $patch$
DECLARE
  v_definition text := pg_get_functiondef(p_signature);
BEGIN
  IF position(p_new IN v_definition) > 0 THEN
    RETURN;
  END IF;
  IF position(p_old IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Expected public tax metadata anchor not found in %', p_signature;
  END IF;
  v_definition := replace(v_definition, p_old, p_new);
  EXECUTE v_definition;
END;
$patch$;

-- A public invoice must not fall back to a legacy PAN/tax number and display it
-- as GSTIN when the current GST profile is incomplete. VAT/Sales Tax IDs remain
-- available for non-Indian businesses that configured those regimes.
SELECT pg_temp.patch_function_definition(
  'mm_private.get_public_invoice_by_token(text)'::regprocedure,
  $old$CASE
        WHEN upper(coalesce((SELECT tp.gst_registration_type
                               FROM public.business_tax_profiles tp
                              WHERE tp.business_id = i.business_id), 'NONE'))
             IN ('NONE', 'UNREGISTERED', 'NON_GST', 'NOT_REGISTERED')
          THEN NULL
        ELSE coalesce(
          (SELECT nullif(btrim(tp.gstin), '')
             FROM public.business_tax_profiles tp
            WHERE tp.business_id = i.business_id),
          b.tax_registration_number
        )
      END$old$,
  $new$CASE
        WHEN upper(coalesce((SELECT tp.tax_regime
                               FROM public.business_tax_profiles tp
                              WHERE tp.business_id = i.business_id), 'NONE')) = 'GST'
          THEN CASE
            WHEN upper(coalesce((SELECT tp.gst_registration_type
                                   FROM public.business_tax_profiles tp
                                  WHERE tp.business_id = i.business_id), 'NONE'))
                 IN ('REGULAR', 'CASUAL', 'NON_RESIDENT', 'SEZ')
             AND CASE
               WHEN upper(coalesce(b.country_code, 'IN')) = 'IN'
                 THEN upper(btrim(coalesce((SELECT tp.gstin
                                               FROM public.business_tax_profiles tp
                                              WHERE tp.business_id = i.business_id), '')))
                      ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$'
               ELSE nullif(btrim((SELECT tp.gstin
                                    FROM public.business_tax_profiles tp
                                   WHERE tp.business_id = i.business_id)), '') IS NOT NULL
             END
              THEN (SELECT nullif(btrim(tp.gstin), '')
                      FROM public.business_tax_profiles tp
                     WHERE tp.business_id = i.business_id)
            ELSE NULL
          END
        WHEN upper(coalesce(b.country_code, 'IN')) <> 'IN'
         AND upper(coalesce((SELECT tp.tax_regime
                               FROM public.business_tax_profiles tp
                              WHERE tp.business_id = i.business_id), 'NONE'))
             IN ('VAT', 'SALES_TAX', 'OTHER')
          THEN nullif(btrim(coalesce(
            (SELECT tp.tax_id FROM public.business_tax_profiles tp WHERE tp.business_id = i.business_id),
            b.tax_registration_number
          )), '')
        ELSE NULL
      END$new$
);

SELECT pg_temp.patch_function_definition(
  'mm_private.get_public_invoice_by_token(text)'::regprocedure,
  $old$'gst_registration_type',
      (SELECT tp.gst_registration_type
         FROM public.business_tax_profiles tp
        WHERE tp.business_id = i.business_id)$old$,
  $new$'gst_registration_type',
      (SELECT tp.gst_registration_type
         FROM public.business_tax_profiles tp
        WHERE tp.business_id = i.business_id),
    'tax_regime',
      upper(coalesce((SELECT tp.tax_regime
                        FROM public.business_tax_profiles tp
                       WHERE tp.business_id = i.business_id), 'NONE')),
    'country_code', upper(coalesce(b.country_code, 'IN')),
    'tax_id',
      (SELECT nullif(btrim(tp.tax_id), '')
         FROM public.business_tax_profiles tp
        WHERE tp.business_id = i.business_id)$new$
);

-- Do the same for public quotations, whose payload already has a joined tax
-- profile alias (tp).
SELECT pg_temp.patch_function_definition(
  'mm_private.get_public_quotation_by_token(text)'::regprocedure,
  $old$'tax_registration_number',
        CASE
          WHEN upper(coalesce(tp.gst_registration_type, 'NONE'))
               IN ('NONE', 'UNREGISTERED', 'NON_GST', 'NOT_REGISTERED')
            THEN NULL
          ELSE coalesce(nullif(btrim(tp.gstin), ''), b.tax_registration_number)
        END$old$,
  $new$'tax_registration_number',
        CASE
          WHEN upper(coalesce(tp.tax_regime, 'NONE')) = 'GST'
            THEN CASE
              WHEN upper(coalesce(tp.gst_registration_type, 'NONE'))
                   IN ('REGULAR', 'CASUAL', 'NON_RESIDENT', 'SEZ')
               AND CASE
                 WHEN upper(coalesce(b.country_code, 'IN')) = 'IN'
                   THEN upper(btrim(coalesce(tp.gstin, '')))
                        ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$'
                 ELSE nullif(btrim(coalesce(tp.gstin, '')), '') IS NOT NULL
               END
                THEN nullif(btrim(tp.gstin), '')
              ELSE NULL
            END
          WHEN upper(coalesce(b.country_code, 'IN')) <> 'IN'
           AND upper(coalesce(tp.tax_regime, 'NONE')) IN ('VAT', 'SALES_TAX', 'OTHER')
            THEN nullif(btrim(coalesce(tp.tax_id, b.tax_registration_number)), '')
          ELSE NULL
        END$new$
);

SELECT pg_temp.patch_function_definition(
  'mm_private.get_public_quotation_by_token(text)'::regprocedure,
  $old$'gst_registration_type', upper(coalesce(tp.gst_registration_type, 'NONE'))$old$,
  $new$'gst_registration_type', upper(coalesce(tp.gst_registration_type, 'NONE')),
      'tax_regime', upper(coalesce(tp.tax_regime, 'NONE')),
      'country_code', upper(coalesce(b.country_code, 'IN')),
      'tax_id', nullif(btrim(tp.tax_id), '')$new$
);

DROP FUNCTION pg_temp.patch_function_definition(regprocedure,text,text);

COMMIT;
