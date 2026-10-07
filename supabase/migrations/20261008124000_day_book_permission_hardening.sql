BEGIN;
CREATE OR REPLACE FUNCTION public.get_day_book(p_business_id UUID,p_date DATE)
RETURNS TABLE(entry_time TIMESTAMPTZ,module TEXT,document_number TEXT,party_name TEXT,reference TEXT,debit NUMERIC,credit NUMERIC,payment_mode TEXT,status TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,mm_private,pg_temp
AS $$
BEGIN
  IF NOT mm_private.has_business_permission(p_business_id,'reports.view',auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: reports.view permission required';
  END IF;
  RETURN QUERY
  SELECT i.created_at,CASE WHEN i.document_kind='cash_bill' THEN 'CASH BILL (POS)' ELSE 'TAX INVOICE' END,
    i.invoice_number,COALESCE(c.display_name,'Cash Customer'),COALESCE(i.buyer_reference,''),
    i.total::NUMERIC,0::NUMERIC,'CREDIT'::TEXT,i.status::TEXT
  FROM invoices i LEFT JOIN customers c ON c.id=i.customer_id
  WHERE i.business_id=p_business_id AND i.invoice_date=p_date AND i.status<>'void'
  UNION ALL
  SELECT p.created_at,'PAYMENT RECEIVED',COALESCE(p.reference,p.id::TEXT),
    COALESCE(c.display_name,v.display_name,'Direct Counter'),COALESCE(p.gateway_transaction_id,''),
    0::NUMERIC,p.amount::NUMERIC,p.method::TEXT,'COMPLETED'::TEXT
  FROM payments p LEFT JOIN customers c ON c.id=p.customer_id LEFT JOIN vendors v ON v.id=p.vendor_id
  WHERE p.business_id=p_business_id AND p.payment_date=p_date
  UNION ALL
  SELECT e.created_at,'EXPENSE',COALESCE(e.reference,'EXP'),COALESCE(v.display_name,e.description),
    e.description,e.amount::NUMERIC,0::NUMERIC,COALESCE(e.payment_method::TEXT,'CASH'),'POSTED'::TEXT
  FROM expenses e LEFT JOIN vendors v ON v.id=e.vendor_id
  WHERE e.business_id=p_business_id AND e.expense_date=p_date
  ORDER BY 1 ASC;
END;
$$;
COMMIT;