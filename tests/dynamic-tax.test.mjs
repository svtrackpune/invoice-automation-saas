import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const root=new URL('../',import.meta.url);
const provider=await readFile(new URL('lib/server/tax/dynamic-provider.ts',root),'utf8');
const apply=await readFile(new URL('lib/server/tax/apply-dynamic.ts',root),'utf8');
const migration=await readFile(new URL('supabase/migrations/20261003150000_strategic_gap_dynamic_tax_posting_v1.sql',root),'utf8');

test('dynamic tax provider implements the pluggable contract and destination lookup',()=>{
  assert.match(provider,/implements TaxDeterminationProvider/);
  assert.match(provider,/buyerAddress/);
  assert.match(provider,/postal_prefixes/);
  assert.match(provider,/localities|cities/);
  assert.match(provider,/business_id\.eq\.'\+params\.businessId/);
});

test('US-style stacking is represented as multiple selected tax rules, not a single winner',()=>{
  assert.match(provider,/selectedByCode/);
  assert.match(provider,/jurisdiction_type/);
  assert.match(provider,/state\?0.*county\?1.*city\?2/);
});

test('EU reverse charge requires VIES validation and distinct member states',()=>{
  assert.match(provider,/checkVatService/);
  assert.match(provider,/buyerVatValid/);
  assert.match(provider,/EU_MEMBER_STATES/);
  assert.match(provider,/isReverseCharge:true/);
});

test('dynamic taxes are carried into the posting boundary and snapshotted immutably',()=>{
  assert.match(apply,/dynamic_tax_snapshot/);
  assert.match(migration,/snapshot_dynamic_invoice_tax/);
  assert.match(migration,/invoice_tax_lines/);
  assert.match(migration,/ON CONFLICT\(dedupe_key\)/);
});