import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (p) => readFile(new URL(p, root), 'utf8');

test('opening stock is creation-time only, not a misleading current-stock editor', async () => {
  const items = await read('app/next-workspace/items/page.tsx');
  assert.match(items, /!editing\?<><Field label="Opening stock quantity"/);
  assert.match(items, /Opening stock is locked after creation/);
  assert.match(items, /Use Stock Audit to adjust current quantity/);
  assert.match(items, /\.\.\.\(editing\?\{\}:\{opening_stock:service\?0:Math\.max\(0,Number\(f\.opening\)\|\|0\),opening_stock_cost:service\?0:Math\.max\(0,Number\(f\.openingCost\)\|\|0\)\}\)/);
});

test('inventory tracking cannot be disabled while movements or nonzero stock remain', async () => {
  const migration = await read('supabase/migrations/20261017130000_procurement_inventory_vendor_hardening.sql');
  assert.match(migration, /CREATE OR REPLACE FUNCTION mm_private\.guard_inventory_tracking_disable/);
  assert.match(migration, /OLD\.inventory_tracked[\s\S]*?NOT coalesce\(NEW\.inventory_tracked,false\)/);
  assert.match(migration, /FROM public\.inventory_movements im[\s\S]*?im\.product_service_id=OLD\.id/);
  assert.match(migration, /FROM public\.inventory_balances ib[\s\S]*?ib\.quantity_on_hand<>0/);
  assert.match(migration, /CREATE TRIGGER trg_guard_inventory_tracking_disable/);
});

test('supplier mapping import deduplicates names and uses transactional server-side replacement', async () => {
  const vendor = await read('app/next-workspace/vendors/page.tsx');
  const migration = await read('supabase/migrations/20261017130000_procurement_inventory_vendor_hardening.sql');
  assert.match(vendor, /existing\.add\(key\)/);
  assert.match(vendor, /supabase\.rpc\('replace_vendor_supply_mappings'/);
  assert.doesNotMatch(vendor, /supabase\.from\('vendor_supply_mappings'\)\.delete\(\)/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.replace_vendor_supply_mappings/);
  assert.match(migration, /Transactional replacement: any validation\/insert failure rolls back this delete too/);
  assert.match(migration, /row_number\(\) OVER\(PARTITION BY lower\(btrim\(value->>'item_name'\)\)/);
  assert.match(migration, /Supplier mapping product must belong to the same business/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.replace_vendor_supply_mappings\(uuid,uuid,jsonb\) TO authenticated,service_role/);
});

test('purchase posting resolves active-location fallback and blocks direct PO posting', async () => {
  const migration = await read('supabase/migrations/20261017130000_procurement_inventory_vendor_hardening.sql');
  assert.match(migration, /order by is_default desc, name, id\s+limit 1/);
  assert.match(migration, /No active inventory location is configured[\s\S]*?tracked-item purchase bill/);
  assert.match(migration, /Purchase orders cannot be posted directly/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.post_bill_legacy\(uuid\) FROM PUBLIC,anon,authenticated/);
});
