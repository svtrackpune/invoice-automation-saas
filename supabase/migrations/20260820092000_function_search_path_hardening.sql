-- Security hardening: make function name resolution deterministic.
alter function public.set_updated_at() set search_path = public;
alter function public.calculate_invoice_discount(numeric,text,numeric) set search_path = public;
alter function public.apply_inventory_movement_to_balance() set search_path = public;
alter function public.get_import_template(text) set search_path = public;
alter function mm_private.set_journal_totals() set search_path = public,mm_private;
alter function mm_private.prevent_posted_journal_mutation() set search_path = public,mm_private;
alter function mm_private.prevent_posted_journal_update() set search_path = public,mm_private;
