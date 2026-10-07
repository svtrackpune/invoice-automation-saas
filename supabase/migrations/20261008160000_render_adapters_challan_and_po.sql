BEGIN;

-- Preserve the existing renderer intact and place the new physical-document
-- adapters behind the same public RPC contract used by the application.
ALTER FUNCTION public.prepare_document_render(text, uuid, uuid)
  RENAME TO prepare_document_render_legacy;

CREATE OR REPLACE FUNCTION public.prepare_document_render(
  p_document_type text,
  p_document_id uuid,
  p_template_id uuid DEFAULT NULL::uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'mm_private', 'pg_temp'
AS $function$
DECLARE
  bid uuid;
  tid uuid;
  tv integer;
  payload jsonb;
  job uuid;
  bank_id uuid;
  bank_payload jsonb;
  show_bank boolean := false;
  document_template_id uuid;
  theme_payload jsonb;
BEGIN
  IF p_document_type NOT IN (
    'invoice','quotation','receipt','credit_note','debit_note',
    'delivery_challan','purchase_order'
  ) THEN
    RAISE EXCEPTION 'Unsupported document type';
  END IF;

  -- Dedicated physical-document adapters.
  IF p_document_type IN ('delivery_challan','purchase_order') THEN
    IF p_document_type='delivery_challan' THEN
      SELECT dc.business_id
      INTO bid
      FROM public.delivery_challans dc
      WHERE dc.id=p_document_id;

      IF bid IS NULL THEN
        RAISE EXCEPTION 'Delivery challan % not found', p_document_id;
      END IF;
    ELSE
      SELECT b.business_id
      INTO bid
      FROM public.bills b
      WHERE b.id=p_document_id;

      IF bid IS NULL THEN
        RAISE EXCEPTION 'Purchase order/bill % not found', p_document_id;
      END IF;
    END IF;

    IF NOT (
      mm_private.has_business_permission(bid,'invoices.view',auth.uid())
      OR mm_private.has_business_permission(bid,'inventory.view',auth.uid())
    ) THEN
      RAISE EXCEPTION 'Access denied: insufficient permissions to render document';
    END IF;

    -- Resolve the document-specific visual template exactly as the Studio
    -- expects: explicit override, then business preference, then system default.
    IF p_template_id IS NOT NULL THEN
      SELECT dt.id
      INTO tid
      FROM public.document_templates dt
      WHERE dt.id=p_template_id
        AND dt.document_type=p_document_type
        AND dt.is_active;
    END IF;

    IF tid IS NULL THEN
      SELECT dp.template_id
      INTO tid
      FROM public.business_document_preferences dp
      JOIN public.document_templates dt
        ON dt.id=dp.template_id
       AND dt.document_type=p_document_type
       AND dt.is_active
      WHERE dp.business_id=bid
        AND dp.document_type=p_document_type;
    END IF;

    IF tid IS NULL THEN
      SELECT dt.id
      INTO tid
      FROM public.document_templates dt
      WHERE dt.document_type=p_document_type
        AND dt.is_active
      ORDER BY dt.is_system DESC,dt.version DESC
      LIMIT 1;
    END IF;

    SELECT dt.version
    INTO tv
    FROM public.document_templates dt
    WHERE dt.id=tid
      AND dt.is_active;

    SELECT coalesce(dp.show_bank_details,false), to_jsonb(dp)
    INTO show_bank, theme_payload
    FROM public.business_document_preferences dp
    WHERE dp.business_id=bid
      AND dp.document_type=p_document_type;

    -- Bank selection follows the same precedence used by the legacy renderer.
    IF bank_id IS NULL THEN
      SELECT bda.bank_account_id
      INTO bank_id
      FROM public.business_document_bank_accounts bda
      JOIN public.bank_accounts ba
        ON ba.id=bda.bank_account_id
      WHERE bda.business_id=bid
        AND bda.document_type=p_document_type
        AND ba.business_id=bid
        AND ba.is_active=true
      ORDER BY bda.display_order ASC,bda.created_at ASC
      LIMIT 1;
    END IF;

    IF bank_id IS NULL THEN
      SELECT bs.default_bank_account_id
      INTO bank_id
      FROM public.business_settings bs
      JOIN public.bank_accounts ba
        ON ba.id=bs.default_bank_account_id
      WHERE bs.business_id=bid
        AND ba.business_id=bid
        AND ba.is_active=true;
    END IF;

    show_bank := show_bank OR bank_id IS NOT NULL;

    IF bank_id IS NOT NULL THEN
      SELECT jsonb_build_object(
        'id',ba.id,
        'name',ba.name,
        'institution_name',ba.institution_name,
        'account_last4',ba.account_last4,
        'account_holder_name',ba.account_holder_name,
        'ifsc_code',ba.ifsc_code,
        'branch_name',ba.branch_name,
        'account_type',ba.account_type,
        'currency_code',ba.currency_code,
        'metadata',coalesce(ba.metadata,'{}'::jsonb)
      )
      INTO bank_payload
      FROM public.bank_accounts ba
      WHERE ba.id=bank_id
        AND ba.business_id=bid
        AND ba.is_active=true;
    END IF;

    IF p_document_type='delivery_challan' THEN
      SELECT
        jsonb_build_object(
          'document_type','delivery_challan',
          'document_id',dc.id,
          'document_number',dc.challan_number,
          'challan_number',dc.challan_number,
          'document_date',dc.challan_date,
          'challan_date',dc.challan_date,
          'status',dc.status,
          'title',coalesce(nullif(dp.document_title_override,''),'DELIVERY CHALLAN'),
          'transporter_name',dc.transporter_name,
          'vehicle_number',dc.vehicle_number,
          'eway_bill_number',dc.eway_bill_number,
          'subtotal',dc.subtotal,
          'total',dc.total,
          'notes',dc.notes,
          'terms',coalesce(dc.terms,b.default_terms_template),
          'currency_code',coalesce(b.currency_code,b.base_currency_code,'INR'),
          'party',jsonb_build_object(
            'id',c.id,
            'name',c.display_name,
            'display_name',c.display_name,
            'legal_name',c.legal_name,
            'tax_id',c.tax_id,
            'phone',c.phone,
            'email',c.email,
            'address',c.billing_address,
            'billing_address',c.billing_address,
            'shipping_address',c.shipping_address
          ),
          'customer',jsonb_build_object(
            'id',c.id,
            'name',c.display_name,
            'display_name',c.display_name,
            'legal_name',c.legal_name,
            'tax_id',c.tax_id,
            'phone',c.phone,
            'email',c.email,
            'address',c.billing_address,
            'billing_address',c.billing_address,
            'shipping_address',c.shipping_address
          ),
          'items',coalesce((
            SELECT jsonb_agg(
              jsonb_build_object(
                'id',dci.id,
                'description',dci.description,
                'name',dci.description,
                'quantity',dci.quantity,
                'unit',dci.unit,
                'unit_price',dci.unit_price,
                'line_total',dci.line_total,
                'hsn_sac',dci.hsn_sac,
                'batch_number',dci.batch_number,
                'serial_number',dci.serial_number,
                'sort_order',dci.sort_order,
                'product_service_id',dci.product_service_id
              )
              ORDER BY dci.sort_order ASC,dci.created_at ASC
            )
            FROM public.delivery_challan_items dci
            WHERE dci.challan_id=dc.id
          ),'[]'::jsonb),
          'business',to_jsonb(b),
          'theme',coalesce(theme_payload,'{}'::jsonb)
        )
      INTO payload
      FROM public.delivery_challans dc
      JOIN public.businesses b
        ON b.id=dc.business_id
      LEFT JOIN public.customers c
        ON c.id=dc.customer_id
       AND c.business_id=dc.business_id
      LEFT JOIN public.business_document_preferences dp
        ON dp.business_id=dc.business_id
       AND dp.document_type='delivery_challan'
      WHERE dc.id=p_document_id
        AND dc.business_id=bid;

    ELSE
      SELECT
        jsonb_build_object(
          'document_type','purchase_order',
          'document_id',b.id,
          'document_number',b.bill_number,
          'bill_number',b.bill_number,
          'document_date',b.bill_date,
          'bill_date',b.bill_date,
          'due_date',b.due_date,
          'status',b.status,
          'title',coalesce(nullif(dp.document_title_override,''),'PURCHASE ORDER'),
          'subtotal',b.subtotal,
          'discount_total',b.discount_total,
          'tax_total',b.tax_total,
          'total',b.total,
          'amount_paid',b.amount_paid,
          'balance_due',b.balance_due,
          'notes',b.notes,
          'terms',coalesce(b.terms,biz.default_terms_template),
          'currency_code',coalesce(b.currency_code,biz.currency_code,biz.base_currency_code,'INR'),
          'party',jsonb_build_object(
            'id',v.id,
            'name',v.display_name,
            'display_name',v.display_name,
            'legal_name',v.legal_name,
            'tax_id',v.tax_id,
            'phone',v.phone,
            'email',v.email,
            'address',v.address
          ),
          'vendor',jsonb_build_object(
            'id',v.id,
            'name',v.display_name,
            'display_name',v.display_name,
            'legal_name',v.legal_name,
            'tax_id',v.tax_id,
            'phone',v.phone,
            'email',v.email,
            'address',v.address
          ),
          'customer',jsonb_build_object(
            'id',v.id,
            'name',v.display_name,
            'display_name',v.display_name,
            'legal_name',v.legal_name,
            'tax_id',v.tax_id,
            'phone',v.phone,
            'email',v.email,
            'address',v.address
          ),
          'items',coalesce((
            SELECT jsonb_agg(
              jsonb_build_object(
                'id',bi.id,
                'description',bi.description,
                'name',bi.description,
                'quantity',bi.quantity,
                'unit_price',bi.unit_price,
                'discount',bi.discount,
                'tax_amount',bi.tax_amount,
                'line_total',bi.line_total,
                'sort_order',bi.sort_order,
                'product_service_id',bi.product_service_id,
                'tax_rate_id',bi.tax_rate_id
              )
              ORDER BY bi.sort_order ASC,bi.id ASC
            )
            FROM public.bill_items bi
            WHERE bi.bill_id=b.id
          ),'[]'::jsonb),
          'business',to_jsonb(biz),
          'theme',coalesce(theme_payload,'{}'::jsonb)
        )
      INTO payload
      FROM public.bills b
      JOIN public.businesses biz
        ON biz.id=b.business_id
      LEFT JOIN public.vendors v
        ON v.id=b.vendor_id
       AND v.business_id=b.business_id
      LEFT JOIN public.business_document_preferences dp
        ON dp.business_id=b.business_id
       AND dp.document_type='purchase_order'
      WHERE b.id=p_document_id
        AND b.business_id=bid;
    END IF;

    IF payload IS NULL THEN
      RAISE EXCEPTION 'Unable to assemble document data';
    END IF;

    payload := payload || jsonb_build_object(
      'document_context',jsonb_build_object(
        'business_id',bid,
        'document_type',p_document_type,
        'selected_template_id',tid,
        'selected_template_version',tv,
        'show_bank_details',show_bank,
        'selected_bank_account_id',bank_id
      ),
      'bank_details',CASE WHEN bank_payload IS NOT NULL THEN bank_payload ELSE NULL END
    );

    INSERT INTO public.document_render_jobs(
      business_id,document_type,document_id,template_id,template_version,payload,created_by
    )
    VALUES(
      bid,p_document_type,p_document_id,tid,tv,payload,auth.uid()
    )
    ON CONFLICT(document_type,document_id,template_id,template_version)
    DO UPDATE SET
      payload=excluded.payload,
      status='ready',
      error_message=NULL,
      created_at=now()
    RETURNING id INTO job;

    RETURN job;
  END IF;

  -- All existing financial-document behavior remains in the previous
  -- production renderer, including template resolution, bank context,
  -- branding, and legacy payload normalization.
  RETURN public.prepare_document_render_legacy(
    p_document_type,
    p_document_id,
    p_template_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.prepare_document_render(text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prepare_document_render(text, uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.prepare_document_render_legacy(text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prepare_document_render_legacy(text, uuid, uuid) TO authenticated;

COMMIT;
