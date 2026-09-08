-- Public quotation access is mediated exclusively through get_public_quotation().
-- Remove redundant direct table privileges for anon; authenticated access remains RLS-controlled.
revoke all on public.quotations from anon;
