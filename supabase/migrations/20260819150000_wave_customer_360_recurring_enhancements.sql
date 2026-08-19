-- Moneymatters: Wave-inspired customer 360, statements and flexible recurring billing.

ALTER TABLE public.recurring_invoices
  DROP CONSTRAINT IF EXISTS recurring_invoices_frequency_check;
ALTER TABLE public.recurring_invoices
  ADD CONSTRAINT recurring_invoices_frequency_check
  CHECK (frequency IN ('weekly','monthly','quarterly','half_yearly','yearly','custom'));

ALTER TABLE public.recurring_invoices
  ADD COLUMN IF NOT EXISTS custom_interval_count integer,
  ADD COLUMN IF NOT EXISTS custom_interval_unit text,
  ADD COLUMN IF NOT EXISTS due_terms text,
  ADD COLUMN IF NOT EXISTS reminder_before_due_days integer,
  ADD COLUMN IF NOT EXISTS reminder_on_due boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reminder_after_due_days integer,
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Asia/Kolkata';

ALTER TABLE public.recurring_invoices
  DROP CONSTRAINT IF EXISTS recurring_invoices_custom_interval_check;
ALTER TABLE public.recurring_invoices
  ADD CONSTRAINT recurring_invoices_custom_interval_check
  CHECK (frequency <> 'custom' OR (custom_interval_count IS NOT NULL AND custom_interval_count > 0 AND custom_interval_unit IN ('day','week','month','year')));

ALTER TABLE public.recurring_invoices
  DROP CONSTRAINT IF EXISTS recurring_invoices_reminder_days_check;
ALTER TABLE public.recurring_invoices
  ADD CONSTRAINT recurring_invoices_reminder_days_check
  CHECK ((reminder_before_due_days IS NULL OR reminder_before_due_days BETWEEN 0 AND 365) AND (reminder_after_due_days IS NULL OR reminder_after_due_days BETWEEN 0 AND 365));

CREATE OR REPLACE VIEW public.customer_statement_entries AS
SELECT i.business_id, i.customer_id, i.invoice_date AS entry_date, 'invoice'::text AS entry_type, i.invoice_number AS reference, i.id AS source_id, i.total AS debit, 0::numeric AS credit
FROM public.invoices i WHERE i.status <> 'void'
UNION ALL
SELECT p.business_id, p.customer_id, p.payment_date, 'payment'::text, COALESCE(p.reference, 'Payment'), p.id, 0::numeric, p.amount
FROM public.payments p WHERE p.direction = 'inbound' AND p.customer_id IS NOT NULL
UNION ALL
SELECT q.business_id, q.customer_id, q.quotation_date, 'quotation'::text, q.quotation_number, q.id, 0::numeric, 0::numeric
FROM public.quotations q;

CREATE OR REPLACE VIEW public.customer_statement_running AS
SELECT e.*, SUM(e.debit - e.credit) OVER (PARTITION BY e.business_id, e.customer_id ORDER BY e.entry_date, e.entry_type, e.source_id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_balance
FROM public.customer_statement_entries e;

CREATE OR REPLACE VIEW public.customer_360_summary AS
SELECT c.id AS customer_id, c.business_id, c.display_name, c.email, c.phone, c.is_active,
 c.payment_reminders_enabled, c.reminder_days_before_due,
 COUNT(DISTINCT i.id) FILTER (WHERE i.status <> 'void') AS invoice_count,
 COALESCE(SUM(i.total) FILTER (WHERE i.status <> 'void'),0)::numeric AS lifetime_invoiced,
 COALESCE(SUM(i.amount_paid) FILTER (WHERE i.status <> 'void'),0)::numeric AS lifetime_paid_on_invoices,
 COALESCE(SUM(i.balance_due) FILTER (WHERE i.status <> 'void'),0)::numeric AS outstanding,
 COALESCE(SUM(i.balance_due) FILTER (WHERE i.status = 'overdue'),0)::numeric AS overdue,
 MAX(p.payment_date) AS last_payment_date,
 COALESCE(SUM(p.amount) FILTER (WHERE p.direction = 'inbound'),0)::numeric AS lifetime_payments,
 COUNT(DISTINCT q.id) AS quotation_count, COUNT(DISTINCT r.id) AS receipt_count, MAX(i.invoice_date) AS last_invoice_date
FROM public.customers c
LEFT JOIN public.invoices i ON i.customer_id=c.id AND i.business_id=c.business_id
LEFT JOIN public.payments p ON p.customer_id=c.id AND p.business_id=c.business_id
LEFT JOIN public.quotations q ON q.customer_id=c.id AND q.business_id=c.business_id
LEFT JOIN public.receipts r ON r.customer_id=c.id AND r.business_id=c.business_id
GROUP BY c.id,c.business_id,c.display_name,c.email,c.phone,c.is_active,c.payment_reminders_enabled,c.reminder_days_before_due;

ALTER VIEW public.customer_statement_entries SET (security_invoker = true);
ALTER VIEW public.customer_statement_running SET (security_invoker = true);
ALTER VIEW public.customer_360_summary SET (security_invoker = true);

CREATE INDEX IF NOT EXISTS invoices_customer_date_idx ON public.invoices (business_id, customer_id, invoice_date);
CREATE INDEX IF NOT EXISTS payments_customer_date_idx ON public.payments (business_id, customer_id, payment_date);
CREATE INDEX IF NOT EXISTS quotations_customer_date_idx ON public.quotations (business_id, customer_id, quotation_date);
