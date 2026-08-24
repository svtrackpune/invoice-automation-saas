-- Prevent document bank-account RLS from recursively querying organization_members.
-- Reuse the established security-definer permission helpers instead.

drop policy if exists "business admins can manage document bank accounts" on public.business_document_bank_accounts;
drop policy if exists "business members can read document bank accounts" on public.business_document_bank_accounts;

create policy "business admins can manage document bank accounts"
on public.business_document_bank_accounts
for all
using (mm_private.has_business_permission(business_id, 'settings.manage'::text))
with check (mm_private.has_business_permission(business_id, 'settings.manage'::text));

create policy "business members can read document bank accounts"
on public.business_document_bank_accounts
for select
using (mm_private.is_org_member(mm_private.business_org(business_id)));
