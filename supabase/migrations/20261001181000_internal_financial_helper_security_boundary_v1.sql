BEGIN;

REVOKE ALL ON FUNCTION public.reverse_journal_entry(uuid,date,text,uuid) FROM public,anon,authenticated;
REVOKE ALL ON FUNCTION public.post_journal_entry(uuid) FROM public,anon,authenticated;
REVOKE ALL ON FUNCTION public.generate_receipt_for_payment(uuid) FROM public,anon,authenticated;
REVOKE ALL ON FUNCTION public.get_or_create_cash_customer(uuid) FROM public,anon,authenticated;

COMMIT;