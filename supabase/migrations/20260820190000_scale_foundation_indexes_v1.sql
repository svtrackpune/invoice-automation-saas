-- Moneymatters scale foundation v1
--
-- Goal: make the current relational model scale without locking us into a
-- distributed architecture prematurely. Tenant/business filters remain the
-- first-class access path; search uses PostgreSQL trigram indexes; common
-- foreign-key and status/date access paths are indexed.
--
-- This migration deliberately does NOT introduce caches, replicas,
-- partitioning, or denormalized read models yet. Those can be added later
-- without changing the source-of-truth transaction model.

create extension if not exists pg_trgm;

-- Tenant and membership lookup paths used by RLS/permission checks.
create index if not exists organization_members_org_user_active_idx
  on public.organization_members(organization_id,user_id,is_active);

create index if not exists member_permissions_org_user_key_idx
  on public.member_permissions(organization_id,user_id,permission_key);

create index if not exists role_permissions_role_key_idx
  on public.role_permissions(role,permission_key);

-- Customer list/search paths.
create index if not exists customers_business_active_created_idx
  on public.customers(business_id,is_active,created_at desc,id desc);

create index if not exists customers_business_display_name_trgm_idx
  on public.customers using gin (lower(display_name) gin_trgm_ops);

create index if not exists customers_business_legal_name_trgm_idx
  on public.customers using gin (lower(legal_name) gin_trgm_ops)
  where legal_name is not null;

create index if not exists customers_business_email_trgm_idx
  on public.customers using gin (lower(email) gin_trgm_ops)
  where email is not null;

create index if not exists customers_business_phone_trgm_idx
  on public.customers using gin (phone gin_trgm_ops)
  where phone is not null;

create index if not exists customers_business_tax_id_trgm_idx
  on public.customers using gin (lower(tax_id) gin_trgm_ops)
  where tax_id is not null;

-- Vendor list/search paths.
create index if not exists vendors_business_active_created_idx
  on public.vendors(business_id,is_active,created_at desc,id desc);

create index if not exists vendors_business_display_name_trgm_idx
  on public.vendors using gin (lower(display_name) gin_trgm_ops);

create index if not exists vendors_business_legal_name_trgm_idx
  on public.vendors using gin (lower(legal_name) gin_trgm_ops)
  where legal_name is not null;

create index if not exists vendors_business_email_trgm_idx
  on public.vendors using gin (lower(email) gin_trgm_ops)
  where email is not null;

create index if not exists vendors_business_phone_trgm_idx
  on public.vendors using gin (phone gin_trgm_ops)
  where phone is not null;

create index if not exists vendors_business_tax_id_trgm_idx
  on public.vendors using gin (lower(tax_id) gin_trgm_ops)
  where tax_id is not null;

-- Sales/purchase document access paths.
create index if not exists invoices_business_status_date_idx
  on public.invoices(business_id,status,due_date desc,id desc);

create index if not exists invoices_business_customer_date_idx
  on public.invoices(business_id,customer_id,invoice_date desc,id desc);

create index if not exists invoices_business_number_idx
  on public.invoices(business_id,invoice_number);

create index if not exists bills_business_status_date_idx
  on public.bills(business_id,status,due_date desc,id desc);

create index if not exists bills_business_vendor_date_idx
  on public.bills(business_id,vendor_id,bill_date desc,id desc);

create index if not exists bills_business_number_idx
  on public.bills(business_id,bill_number);

-- Payment and allocation access paths.
create index if not exists payments_business_customer_date_idx
  on public.payments(business_id,customer_id,payment_date desc,id desc);

create index if not exists payments_business_vendor_date_idx
  on public.payments(business_id,vendor_id,payment_date desc,id desc);

create index if not exists payments_business_direction_date_idx
  on public.payments(business_id,direction,payment_date desc,id desc);

create index if not exists payment_allocations_business_invoice_idx
  on public.payment_allocations(business_id,invoice_id,payment_id);

-- Product/catalog access paths used by purchases, sales and vendor mapping.
create index if not exists products_services_business_active_name_idx
  on public.products_services(business_id,is_active,name,id);

create index if not exists products_services_business_sku_idx
  on public.products_services(business_id,sku)
  where sku is not null;

-- Vendor/product mapping is a frequent future purchase lookup.
create index if not exists vendor_purchase_items_business_vendor_active_idx
  on public.vendor_purchase_items(business_id,vendor_id,is_active,created_at desc,id desc);

create index if not exists vendor_purchase_items_business_product_idx
  on public.vendor_purchase_items(business_id,product_service_id,vendor_id);

-- Inventory access paths.
create index if not exists inventory_movements_business_product_date_idx
  on public.inventory_movements(business_id,product_service_id,created_at desc,id desc);

-- Accounting ledger access paths.
create index if not exists journal_entries_business_status_date_idx
  on public.journal_entries(business_id,status,entry_date desc,id desc);

create index if not exists journal_entries_business_source_idx
  on public.journal_entries(business_id,source_type,source_id);

create index if not exists journal_lines_journal_account_idx
  on public.journal_lines(journal_entry_id,account_id);

create index if not exists journal_lines_account_entity_idx
  on public.journal_lines(account_id,entity_type,entity_id);

-- Bank/reconciliation paths.
create index if not exists bank_transactions_account_date_status_idx
  on public.bank_transactions(bank_account_id,transaction_date desc,status,id desc);

-- Explicit tenant-scoped lookup indexes for reporting/summary tables already
-- present in the project. These are intentionally narrow and additive.
create index if not exists customer_credit_ledger_business_customer_date_idx
  on public.customer_credit_ledger(business_id,customer_id,created_at desc,id desc);

create index if not exists customer_refunds_business_customer_date_idx
  on public.customer_refunds(business_id,customer_id,refund_date desc,id desc);

create index if not exists write_offs_business_customer_date_idx
  on public.write_offs(business_id,customer_id,writeoff_date desc,id desc)
  where customer_id is not null;

create index if not exists write_offs_business_vendor_date_idx
  on public.write_offs(business_id,vendor_id,writeoff_date desc,id desc)
  where vendor_id is not null;

-- Guard against accidental cross-tenant joins in the application by making
-- the intended access path obvious in the schema. No data is changed here.
comment on index customers_business_active_created_idx is
  'Primary keyset pagination path for customer lists: business_id + is_active + created_at + id.';

comment on index vendors_business_active_created_idx is
  'Primary keyset pagination path for vendor lists: business_id + is_active + created_at + id.';

comment on index invoices_business_customer_date_idx is
  'Customer invoice history path; always scope by business_id first.';
