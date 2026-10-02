-- Expand financial audit coverage to every core correction surface.
CREATE OR REPLACE FUNCTION public.install_core_financial_audit_triggers()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, mm_private
AS $$
BEGIN
  EXECUTE 'DROP TRIGGER IF EXISTS trg_audit_invoices ON public.invoices';
  EXECUTE 'CREATE TRIGGER trg_audit_invoices AFTER INSERT OR DELETE OR UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.audit_financial_row()';
  EXECUTE 'DROP TRIGGER IF EXISTS trg_audit_bills ON public.bills';
  EXECUTE 'CREATE TRIGGER trg_audit_bills AFTER INSERT OR DELETE OR UPDATE ON public.bills FOR EACH ROW EXECUTE FUNCTION public.audit_financial_row()';
  EXECUTE 'DROP TRIGGER IF EXISTS trg_audit_expenses ON public.expenses';
  EXECUTE 'CREATE TRIGGER trg_audit_expenses AFTER INSERT OR DELETE OR UPDATE ON public.expenses FOR EACH ROW EXECUTE FUNCTION public.audit_financial_row()';
  EXECUTE 'DROP TRIGGER IF EXISTS trg_audit_receipts ON public.receipts';
  EXECUTE 'CREATE TRIGGER trg_audit_receipts AFTER INSERT OR DELETE OR UPDATE ON public.receipts FOR EACH ROW EXECUTE FUNCTION public.audit_financial_row()';
  EXECUTE 'DROP TRIGGER IF EXISTS trg_audit_invoice_items ON public.invoice_items';
  EXECUTE 'CREATE TRIGGER trg_audit_invoice_items AFTER INSERT OR DELETE OR UPDATE ON public.invoice_items FOR EACH ROW EXECUTE FUNCTION public.audit_financial_row()';
  EXECUTE 'DROP TRIGGER IF EXISTS trg_audit_bill_items ON public.bill_items';
  EXECUTE 'CREATE TRIGGER trg_audit_bill_items AFTER INSERT OR DELETE OR UPDATE ON public.bill_items FOR EACH ROW EXECUTE FUNCTION public.audit_financial_row()';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.install_core_financial_audit_triggers() FROM public, anon, authenticated;
SELECT public.install_core_financial_audit_triggers();
