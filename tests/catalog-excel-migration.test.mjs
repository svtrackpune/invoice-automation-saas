import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');
const page = read('app/next-workspace/items/page.tsx');
const workbook = read('lib/catalog-migration-workbook.ts');
const sidebar = read('app/next-workspace/layout.tsx');
const migration = read('supabase/migrations/20261017190000_catalog_excel_atomic_import.sql');

test('catalog template contains the exact migration schema and sample rows', () => {
  for (const header of [
    'Category', 'Subcategory', 'Type (product/service)', 'Item Name', 'Item Code / SKU',
    'HSN / SAC', 'Unit', 'Sale Price', 'Purchase Price', 'Tax Rate (%)', 'Opening Stock', 'Description',
  ]) assert.ok(workbook.includes("'" + header + "'"), 'missing template header: ' + header);
  assert.ok(workbook.includes('Slim Denim Blue'));
  assert.ok(workbook.includes('Cloud Deployment'));
  assert.ok(workbook.includes('Catalog-Migration-Template.xlsx'));
});

test('catalog workbook parser requires matching headers and preserves spreadsheet row numbers', () => {
  assert.ok(workbook.includes('parseCatalogImportWorkbook(file: File)'));
  assert.ok(workbook.includes('10 * 1024 * 1024'));
  assert.ok(workbook.includes('_sheet_row: rowNumber'));
  assert.ok(workbook.includes('workbook.xlsx.load(await file.arrayBuffer())'));
  assert.ok(workbook.includes('itemcodesku'));
  assert.ok(workbook.includes('taxratepercent'));
});

test('atomic import RPC enforces tenant permission, bounds input, upserts items, and reports invalid rows', () => {
  assert.ok(migration.includes('SECURITY DEFINER'));
  assert.ok(migration.includes("has_business_permission(p_business_id, 'inventory.manage', v_user_id)"));
  assert.ok(migration.includes('jsonb_array_length(p_rows) > 5000'));
  assert.ok(migration.includes('FOR UPDATE'));
  assert.ok(migration.includes('public.product_categories'));
  assert.ok(migration.includes('public.product_subcategories'));
  assert.ok(migration.includes('public.products_services'));
  assert.ok(migration.includes('EXCEPTION WHEN OTHERS THEN'));
  assert.ok(migration.includes("'skipped', v_skipped"));
  assert.ok(migration.includes('GRANT EXECUTE ON FUNCTION public.import_product_catalog(uuid, jsonb) TO authenticated'));
  assert.ok(!migration.includes('GRANT EXECUTE ON FUNCTION public.import_product_catalog(uuid, jsonb) TO anon'));
});

test('catalog UI exposes template import and master export with row-level result feedback', () => {
  assert.ok(page.includes('Download Migration Template (.xlsx)'));
  assert.ok(page.includes('Import Excel'));
  assert.ok(page.includes('Export Master Excel'));
  assert.ok(page.includes("supabase.rpc('import_product_catalog'"));
  assert.ok(page.includes('Successfully imported '));
  assert.ok(page.includes('Review skipped rows'));
  assert.ok(page.includes('downloadCatalogMasterWorkbook(ctx.business_name'));
  assert.ok(page.includes('HSN is required for goods.'));
  assert.ok(page.includes("unit:x.unit||'hrs'"));
});

test('Documents group appears immediately above System in the workspace sidebar', () => {
  const docsIndex = sidebar.indexOf("{ id: 'documents', name: 'Documents'");
  const systemIndex = sidebar.indexOf("{ id: 'system', name: 'System'");
  assert.ok(docsIndex >= 0 && systemIndex > docsIndex);
  assert.ok(sidebar.slice(docsIndex, systemIndex).includes("label: 'Templates & Branding'"));
  assert.ok(!sidebar.slice(docsIndex, systemIndex).includes("{ id: 'purchases'"));
});
