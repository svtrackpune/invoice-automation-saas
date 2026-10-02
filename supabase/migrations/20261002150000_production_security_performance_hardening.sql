-- Production security/performance hardening.
-- Safe, idempotent policy/index changes only. Service-role backend operations bypass RLS.

-- 1. Make auth.uid() initplan-stable in policies flagged by Supabase.
alter policy data_export_logs_member_insert on public.data_export_logs
  with check (
    exists (
      select 1 from public.businesses b
      where b.id = data_export_logs.business_id
        and mm_private.is_org_member(b.organization_id)
        and data_export_logs.requested_by = (select auth.uid())
    )
  );

alter policy notification_delivery_evidence_member_insert on public.notification_delivery_evidence
  with check (
    exists (
      select 1
      from public.organization_members om
      join public.businesses b on b.organization_id = om.organization_id
      where b.id = notification_delivery_evidence.business_id
        and om.user_id = (select auth.uid())
        and om.is_active
    )
  );

alter policy notification_delivery_evidence_member_select on public.notification_delivery_evidence
  using (
    exists (
      select 1
      from public.organization_members om
      join public.businesses b on b.organization_id = om.organization_id
      where b.id = notification_delivery_evidence.business_id
        and om.user_id = (select auth.uid())
        and om.is_active
    )
  );

alter policy notification_preferences_self_all on public.notification_preferences
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter policy organization_members_admin_manage on public.organization_members
  using (
    exists (
      select 1
      from public.organizations o
      where o.id = organization_members.organization_id
        and o.owner_user_id = (select auth.uid())
    )
    or exists (
      select 1
      from public.organization_members om
      where om.organization_id = organization_members.organization_id
        and om.user_id = (select auth.uid())
        and om.role = 'admin'::public.member_role
        and om.is_active
    )
  )
  with check (mm_private.is_org_member(organization_id));

alter policy organizations_owner_manage on public.organizations
  using (owner_user_id = (select auth.uid()))
  with check (owner_user_id = (select auth.uid()));

alter policy registered_devices_self_business_all on public.registered_devices
  using (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.businesses b
      where b.id = registered_devices.business_id
        and mm_private.is_org_member(b.organization_id)
    )
  )
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.businesses b
      where b.id = registered_devices.business_id
        and mm_private.is_org_member(b.organization_id)
    )
  );

alter policy sync_operations_self_business_all on public.sync_operations
  using (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.businesses b
      where b.id = sync_operations.business_id
        and mm_private.is_org_member(b.organization_id)
    )
  )
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.businesses b
      where b.id = sync_operations.business_id
        and mm_private.is_org_member(b.organization_id)
    )
  );

alter policy user_profiles_self on public.user_profiles
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter policy vendor_purchase_items_delete on public.vendor_purchase_items
  using (mm_private.has_business_permission(business_id, 'vendors.manage'::text, (select auth.uid())));

alter policy vendor_purchase_items_insert on public.vendor_purchase_items
  with check (mm_private.has_business_permission(business_id, 'vendors.manage'::text, (select auth.uid())));

alter policy vendor_purchase_items_update on public.vendor_purchase_items
  using (mm_private.has_business_permission(business_id, 'vendors.manage'::text, (select auth.uid())))
  with check (mm_private.has_business_permission(business_id, 'vendors.manage'::text, (select auth.uid())));

-- 2. Remove redundant permissive SELECT policies by making management policies
--    mutation-only. Members already have the dedicated SELECT policies.
drop policy if exists "business admins can manage document bank accounts" on public.business_document_bank_accounts;
create policy "business admins can insert document bank accounts"
  on public.business_document_bank_accounts
  for insert to authenticated
  with check (mm_private.has_business_permission(business_id, 'settings.manage'::text));
create policy "business admins can update document bank accounts"
  on public.business_document_bank_accounts
  for update to authenticated
  using (mm_private.has_business_permission(business_id, 'settings.manage'::text))
  with check (mm_private.has_business_permission(business_id, 'settings.manage'::text));
create policy "business admins can delete document bank accounts"
  on public.business_document_bank_accounts
  for delete to authenticated
  using (mm_private.has_business_permission(business_id, 'settings.manage'::text));

drop policy if exists business_payment_method_accounts_manage on public.business_payment_method_accounts;
create policy business_payment_method_accounts_insert
  on public.business_payment_method_accounts
  for insert to authenticated
  with check (mm_private.has_business_permission(business_id, 'settings.manage'::text));
create policy business_payment_method_accounts_update
  on public.business_payment_method_accounts
  for update to authenticated
  using (mm_private.has_business_permission(business_id, 'settings.manage'::text))
  with check (mm_private.has_business_permission(business_id, 'settings.manage'::text));
create policy business_payment_method_accounts_delete
  on public.business_payment_method_accounts
  for delete to authenticated
  using (mm_private.has_business_permission(business_id, 'settings.manage'::text));

drop policy if exists organization_members_admin_manage on public.organization_members;
create policy organization_members_admin_insert
  on public.organization_members
  for insert to authenticated
  with check (
    exists (
      select 1
      from public.organizations o
      where o.id = organization_members.organization_id
        and o.owner_user_id = (select auth.uid())
    )
    or exists (
      select 1 from public.organization_members om
      where om.organization_id = organization_members.organization_id
        and om.user_id = (select auth.uid())
        and om.role = 'admin'::public.member_role
        and om.is_active
    )
  );
create policy organization_members_admin_update
  on public.organization_members
  for update to authenticated
  using (
    exists (
      select 1
      from public.organizations o
      where o.id = organization_members.organization_id
        and o.owner_user_id = (select auth.uid())
    )
    or exists (
      select 1 from public.organization_members om
      where om.organization_id = organization_members.organization_id
        and om.user_id = (select auth.uid())
        and om.role = 'admin'::public.member_role
        and om.is_active
    )
  )
  with check (mm_private.is_org_member(organization_id));
create policy organization_members_admin_delete
  on public.organization_members
  for delete to authenticated
  using (
    exists (
      select 1
      from public.organizations o
      where o.id = organization_members.organization_id
        and o.owner_user_id = (select auth.uid())
    )
    or exists (
      select 1 from public.organization_members om
      where om.organization_id = organization_members.organization_id
        and om.user_id = (select auth.uid())
        and om.role = 'admin'::public.member_role
        and om.is_active
    )
  );

drop policy if exists organizations_owner_manage on public.organizations;
drop policy if exists organizations_member_select on public.organizations;
create policy organizations_member_select
  on public.organizations
  for select to authenticated
  using (mm_private.is_org_member(id) or owner_user_id = (select auth.uid()));
create policy organizations_owner_insert
  on public.organizations
  for insert to authenticated
  with check (owner_user_id = (select auth.uid()));
create policy organizations_owner_update
  on public.organizations
  for update to authenticated
  using (owner_user_id = (select auth.uid()))
  with check (owner_user_id = (select auth.uid()));
create policy organizations_owner_delete
  on public.organizations
  for delete to authenticated
  using (owner_user_id = (select auth.uid()));

-- 3. Harden trigger-only and token-minting function grants.
revoke all on function public.trg_enqueue_receipt_delivery_notifications() from public, anon, authenticated;
revoke all on function public.get_public_invoice_share_token(uuid) from authenticated;
grant execute on function public.get_public_invoice_share_token(uuid) to anon;

-- 4. Keep the webhook event table intentionally server-only while giving
-- authenticated callers an explicit deny policy so RLS is unambiguous.
drop policy if exists payment_webhook_events_deny_authenticated on public.payment_webhook_events;
create policy payment_webhook_events_deny_authenticated
  on public.payment_webhook_events
  for all to authenticated
  using (false)
  with check (false);

-- 5. Remove the exact duplicate index; retain the identically-defined index
-- with the stable schema-derived name.
drop index if exists public.idx_notification_delivery_evidence_business;
