BEGIN;

CREATE OR REPLACE FUNCTION public.get_transaction_360(p_entity_type text,p_entity_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public,mm_private
AS $function$
DECLARE
  v_business_id uuid;
BEGIN
  IF p_entity_type IN ('invoice','cash_bill') THEN
    SELECT business_id INTO v_business_id FROM public.invoices WHERE id=p_entity_id;
    IF v_business_id IS NULL THEN RAISE EXCEPTION 'Invoice/Cash Bill not found'; END IF;
  ELSIF p_entity_type='quotation' THEN
    SELECT business_id INTO v_business_id FROM public.quotations WHERE id=p_entity_id;
  ELSIF p_entity_type='payment' THEN
    SELECT business_id INTO v_business_id FROM public.payments WHERE id=p_entity_id;
  ELSIF p_entity_type='purchase_bill' THEN
    SELECT business_id INTO v_business_id FROM public.bills WHERE id=p_entity_id;
  ELSIF p_entity_type='expense' THEN
    SELECT business_id INTO v_business_id FROM public.expenses WHERE id=p_entity_id;
  ELSE
    RAISE EXCEPTION 'Unsupported transaction type';
  END IF;

  IF v_business_id IS NULL THEN RAISE EXCEPTION 'Transaction not found'; END IF;
  IF NOT mm_private.has_business_permission(v_business_id,'accounting.view') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF p_entity_type IN ('invoice','cash_bill') THEN
    RETURN jsonb_build_object(
      'entity_type',p_entity_type,
      'entity', (SELECT to_jsonb(i) FROM public.invoices i WHERE i.id=p_entity_id),
      'customer', (SELECT to_jsonb(c) FROM public.customers c JOIN public.invoices i ON i.customer_id=c.id AND c.business_id=i.business_id WHERE i.id=p_entity_id),
      'source_quotation', (SELECT to_jsonb(q) FROM public.quotations q JOIN public.invoices i ON i.source_quotation_id=q.id WHERE i.id=p_entity_id),
      'items', coalesce((SELECT jsonb_agg(to_jsonb(ii) ORDER BY ii.sort_order) FROM public.invoice_items ii WHERE ii.invoice_id=p_entity_id),'[]'::jsonb),
      'payments', coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.payment_date,p.created_at) FROM public.payments p WHERE p.invoice_id=p_entity_id),'[]'::jsonb),
      'receipts', coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.receipt_date,r.created_at) FROM public.receipts r WHERE r.payment_id IN (SELECT p.id FROM public.payments p WHERE p.invoice_id=p_entity_id)),'[]'::jsonb),
      'journal', (SELECT to_jsonb(j) FROM public.journal_entries j JOIN public.invoices i ON i.journal_entry_id=j.id WHERE i.id=p_entity_id),
      'journal_lines', coalesce((SELECT jsonb_agg(to_jsonb(jl) ORDER BY jl.id) FROM public.journal_lines jl JOIN public.invoices i ON i.journal_entry_id=jl.journal_entry_id WHERE i.id=p_entity_id),'[]'::jsonb),
      'inventory_movements', coalesce((SELECT jsonb_agg(to_jsonb(im) ORDER BY im.created_at,im.id) FROM public.inventory_movements im WHERE im.reference_id=p_entity_id AND im.reference_type IN ('invoice','invoice_amendment')),'[]'::jsonb),
      'bank_transactions', coalesce((SELECT jsonb_agg(to_jsonb(bt) ORDER BY bt.transaction_date,bt.id) FROM public.bank_transactions bt WHERE bt.matched_payment_id IN (SELECT p.id FROM public.payments p WHERE p.invoice_id=p_entity_id)),'[]'::jsonb),
      'corrections', coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.created_at DESC) FROM public.audit_logs a WHERE a.business_id=v_business_id AND a.entity_type IN ('invoice','invoice_item') AND a.entity_id=p_entity_id),'[]'::jsonb)
    );
  ELSIF p_entity_type='quotation' THEN
    RETURN jsonb_build_object(
      'entity_type',p_entity_type,
      'entity',(SELECT to_jsonb(q) FROM public.quotations q WHERE q.id=p_entity_id),
      'customer',(SELECT to_jsonb(c) FROM public.customers c JOIN public.quotations q ON q.customer_id=c.id AND c.business_id=q.business_id WHERE q.id=p_entity_id),
      'items',coalesce((SELECT jsonb_agg(to_jsonb(qi) ORDER BY qi.sort_order) FROM public.quotation_items qi WHERE qi.quotation_id=p_entity_id),'[]'::jsonb),
      'converted_invoice',(SELECT to_jsonb(i) FROM public.invoices i WHERE i.source_quotation_id=p_entity_id),
      'corrections',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.created_at DESC) FROM public.audit_logs a WHERE a.business_id=v_business_id AND a.entity_type IN ('quotation','quotation_item') AND a.entity_id=p_entity_id),'[]'::jsonb)
    );
  ELSIF p_entity_type='payment' THEN
    RETURN jsonb_build_object(
      'entity_type','payment',
      'entity',(SELECT to_jsonb(p) FROM public.payments p WHERE p.id=p_entity_id),
      'invoice',(SELECT to_jsonb(i) FROM public.invoices i WHERE i.id=(SELECT p.invoice_id FROM public.payments p WHERE p.id=p_entity_id)),
      'purchase_bill',(SELECT to_jsonb(b) FROM public.bills b WHERE b.id=(SELECT p.bill_id FROM public.payments p WHERE p.id=p_entity_id)),
      'customer',(SELECT to_jsonb(c) FROM public.customers c JOIN public.payments p ON p.customer_id=c.id AND c.business_id=p.business_id WHERE p.id=p_entity_id),
      'vendor',(SELECT to_jsonb(v) FROM public.vendors v JOIN public.payments p ON p.vendor_id=v.id AND v.business_id=p.business_id WHERE p.id=p_entity_id),
      'allocations',coalesce((SELECT jsonb_agg(to_jsonb(pa) ORDER BY pa.created_at,pa.id) FROM public.payment_allocations pa WHERE pa.payment_id=p_entity_id),'[]'::jsonb),
      'vendor_allocations',coalesce((
        SELECT jsonb_agg(
          jsonb_build_object(
            'id',vpa.id,
            'payment_id',vpa.payment_id,
            'business_id',vpa.business_id,
            'vendor_id',vpa.vendor_id,
            'bill_id',vpa.bill_id,
            'bill_number',b.bill_number,
            'bill_date',b.bill_date,
            'amount',vpa.amount,
            'currency_code',b.currency_code
          )
          ORDER BY b.bill_date,b.bill_number,vpa.id
        )
        FROM public.vendor_payment_allocations vpa
        JOIN public.bills b
          ON b.id=vpa.bill_id
         AND b.business_id=vpa.business_id
         AND b.vendor_id=vpa.vendor_id
        WHERE vpa.payment_id=p_entity_id
      ),'[]'::jsonb),
      'receipts',coalesce((SELECT jsonb_agg(to_jsonb(r)) FROM public.receipts r WHERE r.payment_id=p_entity_id),'[]'::jsonb),
      'customer_credit_ledger',coalesce((SELECT jsonb_agg(to_jsonb(ccl) ORDER BY ccl.created_at,ccl.id) FROM public.customer_credit_ledger ccl WHERE ccl.payment_id=p_entity_id),'[]'::jsonb),
      'customer_refunds',coalesce((SELECT jsonb_agg(to_jsonb(cr) ORDER BY cr.refund_date,cr.created_at) FROM public.customer_refunds cr WHERE cr.payment_id=p_entity_id),'[]'::jsonb),
      'supplier_credit_ledger',coalesce((SELECT jsonb_agg(to_jsonb(vcl) ORDER BY vcl.created_at,vcl.id) FROM public.vendor_credit_ledger vcl WHERE vcl.payment_id=p_entity_id),'[]'::jsonb),
      'corrections',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.created_at DESC) FROM public.audit_logs a WHERE a.business_id=v_business_id AND a.entity_type='payment' AND a.entity_id=p_entity_id),'[]'::jsonb),
      'journal',(SELECT to_jsonb(j) FROM public.journal_entries j JOIN public.payments p ON p.journal_entry_id=j.id WHERE p.id=p_entity_id),
      'bank_transactions',coalesce((SELECT jsonb_agg(to_jsonb(bt)) FROM public.bank_transactions bt WHERE bt.matched_payment_id=p_entity_id),'[]'::jsonb)
    );
  ELSIF p_entity_type='purchase_bill' THEN
    RETURN jsonb_build_object(
      'entity_type','purchase_bill',
      'entity',(SELECT to_jsonb(b) FROM public.bills b WHERE b.id=p_entity_id),
      'vendor',(SELECT to_jsonb(v) FROM public.vendors v JOIN public.bills b ON b.vendor_id=v.id AND v.business_id=b.business_id WHERE b.id=p_entity_id),
      'items',coalesce((SELECT jsonb_agg(to_jsonb(bi) ORDER BY bi.sort_order) FROM public.bill_items bi WHERE bi.bill_id=p_entity_id),'[]'::jsonb),
      'payments',coalesce((
        SELECT jsonb_agg(to_jsonb(p) ORDER BY p.payment_date,p.created_at)
        FROM public.payments p
        WHERE p.business_id=v_business_id
          AND (
            p.bill_id=p_entity_id
            OR EXISTS (
              SELECT 1
              FROM public.vendor_payment_allocations vpa
              WHERE vpa.payment_id=p.id
                AND vpa.business_id=v_business_id
                AND vpa.bill_id=p_entity_id
            )
          )
      ),'[]'::jsonb),
      'supplier_credits',coalesce((SELECT jsonb_agg(to_jsonb(vc) ORDER BY vc.credit_date,vc.created_at) FROM public.vendor_credits vc WHERE vc.bill_id=p_entity_id),'[]'::jsonb),
      'supplier_credit_ledger',coalesce((SELECT jsonb_agg(to_jsonb(vcl) ORDER BY vcl.created_at,vcl.id) FROM public.vendor_credit_ledger vcl WHERE vcl.bill_id=p_entity_id),'[]'::jsonb),
      'corrections', coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.created_at DESC) FROM public.audit_logs a WHERE a.business_id=v_business_id AND a.entity_type IN ('bill','bill_item') AND a.entity_id=p_entity_id),'[]'::jsonb),
      'journal',(SELECT to_jsonb(j) FROM public.journal_entries j JOIN public.bills b ON b.journal_entry_id=j.id WHERE b.id=p_entity_id),
      'inventory_movements',coalesce((SELECT jsonb_agg(to_jsonb(im) ORDER BY im.created_at,im.id) FROM public.inventory_movements im WHERE im.reference_id=p_entity_id AND im.reference_type IN ('bill','bill_amendment','vendor_credit')),'[]'::jsonb),
      'bank_transactions',coalesce((
        SELECT jsonb_agg(to_jsonb(bt))
        FROM public.bank_transactions bt
        WHERE bt.matched_payment_id IN (
          SELECT p.id
          FROM public.payments p
          WHERE p.business_id=v_business_id
            AND (
              p.bill_id=p_entity_id
              OR EXISTS (
                SELECT 1
                FROM public.vendor_payment_allocations vpa
                WHERE vpa.payment_id=p.id
                  AND vpa.business_id=v_business_id
                  AND vpa.bill_id=p_entity_id
              )
            )
        )
      ),'[]'::jsonb)
    );
  ELSE
    RETURN jsonb_build_object(
      'entity_type','expense',
      'entity',(SELECT to_jsonb(e) FROM public.expenses e WHERE e.id=p_entity_id),
      'vendor',(SELECT to_jsonb(v) FROM public.vendors v JOIN public.expenses e ON e.vendor_id=v.id AND v.business_id=e.business_id WHERE e.id=p_entity_id),
      'corrections',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.created_at DESC) FROM public.audit_logs a WHERE a.business_id=v_business_id AND a.entity_type='expense' AND a.entity_id=p_entity_id),'[]'::jsonb),
      'journal',(SELECT to_jsonb(j) FROM public.journal_entries j JOIN public.expenses e ON e.journal_entry_id=j.id WHERE e.id=p_entity_id),
      'bank_transactions','[]'::jsonb
    );
  END IF;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_transaction_360(text,uuid) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.get_transaction_360(text,uuid) TO authenticated;
COMMIT;