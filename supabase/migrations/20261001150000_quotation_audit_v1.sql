-- Audit quotation lifecycle changes so draft/sent corrections are traceable.
DROP TRIGGER IF EXISTS trg_audit_quotations ON public.quotations;
CREATE TRIGGER trg_audit_quotations
AFTER INSERT OR DELETE OR UPDATE ON public.quotations
FOR EACH ROW EXECUTE FUNCTION public.audit_financial_row();

DROP TRIGGER IF EXISTS trg_audit_quotation_items ON public.quotation_items;
CREATE TRIGGER trg_audit_quotation_items
AFTER INSERT OR DELETE OR UPDATE ON public.quotation_items
FOR EACH ROW EXECUTE FUNCTION public.audit_financial_row();
