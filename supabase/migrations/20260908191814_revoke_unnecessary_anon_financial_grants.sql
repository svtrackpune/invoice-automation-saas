-- Customer-facing financial access is mediated through explicit authenticated RPCs
-- or the external payment provider. Anonymous direct table access is unnecessary.
revoke all on public.invoices from anon;
revoke all on public.payments from anon;
revoke all on public.receipts from anon;
revoke all on public.payment_links from anon;
