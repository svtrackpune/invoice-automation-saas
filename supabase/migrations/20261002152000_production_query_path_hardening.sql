-- Production query-path indexes and receipt delivery RPC grant hardening.

-- Trigger-only receipt enqueue entry point must not be callable over PostgREST.
revoke all on function public.enqueue_receipt_delivery_notifications(uuid) from public, anon, authenticated;

-- Cover the highest-cardinality currently unindexed foreign keys found by
-- the production performance advisor.
create index if not exists accounts_parent_account_id_idx
  on public.accounts(parent_account_id);

create index if not exists role_permissions_permission_key_idx
  on public.role_permissions(permission_key);

create index if not exists expense_categories_account_id_idx
  on public.expense_categories(account_id);

create index if not exists audit_logs_organization_id_idx
  on public.audit_logs(organization_id);

create index if not exists audit_logs_actor_user_id_idx
  on public.audit_logs(actor_user_id);
