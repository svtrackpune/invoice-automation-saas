-- Remove duplicate non-unique indexes reported by Supabase Performance Advisor.
drop index if exists public.journal_entries_business_date_idx;
drop index if exists public.journal_lines_entity_idx;
drop index if exists public.quotation_items_quotation_sort_idx;
drop index if exists public.quotations_business_status_date_idx;
