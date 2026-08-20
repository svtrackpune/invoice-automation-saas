-- Security hardening: report/subledger views must honor the caller's RLS policies.
-- This prevents SECURITY DEFINER view ownership from bypassing tenant isolation.
alter view public.customer_statement_lines set (security_invoker = true);
alter view public.vendor_statement_lines set (security_invoker = true);
alter view public.account_balances_live set (security_invoker = true);
alter view public.trial_balance_live set (security_invoker = true);
alter view public.profit_loss_live set (security_invoker = true);
alter view public.receivables_live set (security_invoker = true);
alter view public.payables_live set (security_invoker = true);
