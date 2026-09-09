CREATE UNIQUE INDEX IF NOT EXISTS payment_links_one_active_per_invoice_uidx
ON public.payment_links(business_id,invoice_id)
WHERE status IN ('created','paid','partially_paid');