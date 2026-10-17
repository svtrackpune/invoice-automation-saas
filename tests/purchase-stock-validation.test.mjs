import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (p) => readFile(new URL(p, root), 'utf8');

test('purchase bills and orders reject invalid quantity, unit price, and discounts before saving', async () => {
  const page = await read('app/next-workspace/purchases/new/page.tsx');
  assert.match(page, /const invalidLine=calc\.lines\.find/);
  assert.match(page, /quantity<=0/);
  assert.match(page, /unitPrice<0/);
  assert.match(page, /discount<0/);
  assert.match(page, /r\.discount_type==='percentage'&&discount>100/);
  assert.match(page, /r\.discount_type==='amount'&&discount>gross/);
  assert.match(page, /Percentage discounts must be 100% or less/);
});

test('tracked purchase bills require the inventory asset account', async () => {
  const migration = await read('supabase/migrations/20261017140000_guard_purchase_stock_posting.sql');
  assert.match(migration, /IF v_inventory IS NULL AND EXISTS/);
  assert.match(migration, /ps\.inventory_tracked/);
  assert.match(migration, /Inventory asset account \(1200\) is missing for tracked purchase items/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.post_bill_legacy/);
});
