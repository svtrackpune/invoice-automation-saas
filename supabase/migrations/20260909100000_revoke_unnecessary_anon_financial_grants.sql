-- Public customers never need direct table access; customer-facing access is mediated by explicit public RPCs.
-- Financial tables are likewise server/business-user controlled. RLS remains the primary boundary for authenticated users.
revoke all on public.invoices from anon;
revoke all on public.payments from anon;
revoke all on public.receipts from anon;
revoke all on public.payment_links from anon;
