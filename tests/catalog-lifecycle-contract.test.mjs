import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (p) => readFile(new URL(p, root), 'utf8');

test('catalogue delete remains reversible and new item creation does not require a SELECT return projection', async () => {
  const page = await read('app/next-workspace/items/page.tsx');
  assert.match(page, /update\(\{is_active:false\}\)/);
  assert.match(page, /update\(\{is_active:true\}\)/);
  assert.match(page, /supabase\.from\('products_services'\)\.insert\(payload\)/);
  assert.doesNotMatch(page, /products_services'\)\.insert\(payload\)\.select\(\)\.single\(\)/);
  assert.match(page, /You do not have permission to manage this catalogue/);
  assert.match(page, /Check the item code \/ SKU and barcode/);
  assert.match(page, /A selected category, subcategory, tax rate or account is no longer available/);
  assert.match(page, /setError\(catalogWriteError\(r\.error\)\)/);
});

test('catalogue item writes remain tenant-scoped and preserve category validation', async () => {
  const page = await read('app/next-workspace/items/page.tsx');
  assert.match(page, /business_id:ctx\.business_id/);
  assert.match(page, /\.eq\('business_id',ctx\.business_id\)/);
  assert.match(page, /Selected subcategory does not belong to the selected category/);
  assert.match(page, /HSN is required for this GST-enabled business/);
});
