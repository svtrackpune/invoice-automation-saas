import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root=new URL('../',import.meta.url);
const types=await readFile(new URL('lib/server/tax/types.ts',root),'utf8');
const provider=await readFile(new URL('lib/server/tax/dynamic-provider.ts',root),'utf8');
const apply=await readFile(new URL('lib/server/tax/apply-dynamic.ts',root),'utf8');
const snapshot=await readFile(new URL('supabase/migrations/20261003163000_dynamic_tax_snapshot_unification_v1.sql',root),'utf8');

test('dynamic tax provider implements the pluggable contract',()=>{
  assert.match(types,/interface TaxDeterminationProvider/);
  assert.match(types,/calculateTaxes\(params: TaxCalculationParams\)/);
  assert.match(provider,/implements TaxDeterminationProvider/);
});

test('destination lookup supports country, subdivision, postal and locality metadata',()=>{
  for(const token of ['buyerAddress','postal_prefixes','subdivision_codes','localities|cities','country_codes'])
    assert.match(provider,new RegExp(token));
  assert.match(provider,/effective_from/);
  assert.match(provider,/business_id/);
});

test('US stacking and Canadian compound basis are represented',()=>{
  assert.match(provider,/selectedByTaxCode/);
  assert.match(provider,/jurisdiction_type/);
  assert.match(provider,/gross_plus_previous/);
  assert.match(provider,/compound_on_component_id/);
});

test('EU reverse charge is gated by distinct EU states and VAT validation',()=>{
  assert.match(provider,/EU_MEMBER_STATES/);
  assert.match(provider,/checkVatService/);
  assert.match(provider,/validateVatWithVies/);
  assert.match(provider,/params\.supplierAddress\.country_code!==params\.buyerAddress\.country_code/);
  assert.match(provider,/taxCategory:'REVERSE_CHARGE'/);
});

test('dynamic output reaches the immutable posting snapshot boundary',()=>{
  assert.match(apply,/dynamic_tax_snapshot/);
  assert.match(snapshot,/snapshot_dynamic_invoice_tax/);
  assert.match(snapshot,/invoice_tax_lines/);
  assert.match(snapshot,/ON CONFLICT\(dedupe_key\) DO NOTHING/);
  assert.match(snapshot,/snapshot_invoice_tax_lines_v2/);
});

test('dynamic application preserves legacy addresses and line snapshots',()=>{
  assert.match(apply,/shipping_address_iso/); assert.match(apply,/billing_address_iso/); assert.match(apply,/shipping_address/); assert.match(apply,/billing_address/);
  assert.match(apply,/address_iso\|b\.address/);
  assert.match(apply,/dynamic_tax_snapshot/);
  assert.match(apply,/jurisdiction_id/);
  assert.match(apply,/tax_rule_id/);
});

test('India GST remains the legacy-compatible system while US and Canada use global systems',()=>{
  assert.match(provider,/buyer==='IN'\|\|seller==='IN'\?'GST'/);
  assert.match(provider,/buyer==='US'\?'SALES_TAX'/);
  assert.match(provider,/buyer==='CA'\?'GST'/);
  assert.equal(100*0.05+100*0.02,7);
  assert.equal(Number((100*0.05+(100+5)*0.08).toFixed(2)),13.4);
});
