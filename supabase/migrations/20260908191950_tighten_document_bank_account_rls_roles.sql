-- Document bank-account configuration is an authenticated business-user concern.
-- Customer-facing document rendering uses SECURITY DEFINER functions with business checks.
drop policy if exists "business admins can manage document bank accounts" on public.business_document_bank_accounts;
drop policy if exists "business members can read document bank accounts" on public.business_document_bank_accounts;

create policy "business admins can manage document bank accounts"
on public.business_document_bank_accounts
for all
to authenticated
using (mm_private.has_business_permission(business_id,'settings.manage'))
with check (mm_private.has_business_permission(business_id,'settings.manage'));

create policy "business members can read document bank accounts"
on public.business_document_bank_accounts
for select
to authenticated
using (mm_private.is_org_member(mm_private.business_org(business_id)));
