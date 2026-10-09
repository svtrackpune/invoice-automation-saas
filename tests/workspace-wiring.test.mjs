import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const challans = readFileSync('app/next-workspace/delivery-challans/page.tsx', 'utf8');
const sidebar = readFileSync('app/next-workspace/layout.tsx', 'utf8');
const itemModal = readFileSync('app/next-workspace/invoices/new/ItemServiceModal.tsx', 'utf8');
const catalog = readFileSync('app/next-workspace/items/page.tsx', 'utf8');
const invoiceEditor = readFileSync('app/next-workspace/invoices/new/page.tsx', 'utf8');

test('delivery challans disambiguates the customer embed by the direct foreign key', () => {
  assert.match(challans, /customers!delivery_challans_customer_id_fkey\(display_name\)/);
  assert.doesNotMatch(challans, /customers\(display_name\)/);
});

test('delivery challans can create and immediately select a product and stock location', () => {
  assert.match(challans, /import ItemServiceModal from '\.\.\/invoices\/new\/ItemServiceModal'/);
  assert.match(challans, /\+ Create product/);
  assert.match(challans, /productOnly/);
  assert.match(challans, /onCreated=\{\(item\) =>/);
  assert.match(challans, /async function addLocation\(\)/);
  assert.match(challans, /from\('inventory_locations'\)/);
  assert.match(challans, /setLocationId\(data\.id\)/);
});

test('item creation returns HSN and stock-tracking fields to consumers', () => {
  assert.match(itemModal, /unit,hsn_sac,sales_price,default_tax_rate_id,inventory_tracked,track_batches,track_serials/);
  assert.match(itemModal, /productOnly\?:boolean/);
  assert.match(itemModal, /!productOnly && <Field label="Type">/);
});

test('the sidebar has a single canonical link for the banking workspace', () => {
  const start = sidebar.indexOf("{ name: 'Treasury & Banking'");
  const end = sidebar.indexOf("{ name: 'Settings & Configuration'", start);
  const group = sidebar.slice(start, end);
  assert.ok(start >= 0 && end > start, 'Treasury & Banking group exists');
  assert.equal((group.match(/href: '\/next-workspace\/banking'/g) || []).length, 1);
  assert.match(group, /label: 'Banking & Reconciliation'/);
});

test('catalog, challans and item creation format amounts using the active business currency', () => {
  assert.match(challans, /formatMoney\(total, ctx\?\.currency_code \|\| 'INR'\)/);
  assert.match(catalog, /money\(value,\s*ctx\?\.currency_code\s*\|\|\s*'INR'\)/);
  assert.match(catalog, /money\(x\.sales_price,\s*ctx\?\.currency_code\s*\|\|\s*'INR'\)/);
  assert.match(itemModal, /currencyCode\?:string/);
  assert.match(itemModal, /formatMoney\(profit, currencyCode\)/);
  assert.match(invoiceEditor, /currencyCode=\{ctx\.currency_code\}/);
});
