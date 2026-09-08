-- Keep the canonical gateway transaction uniqueness index and remove the duplicate copy.
drop index if exists public.payments_business_gateway_txn_uidx;
