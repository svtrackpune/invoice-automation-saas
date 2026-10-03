BEGIN;

ALTER TYPE public.member_role ADD VALUE IF NOT EXISTS 'cashier';
ALTER TYPE public.member_role ADD VALUE IF NOT EXISTS 'auditor';

COMMIT;