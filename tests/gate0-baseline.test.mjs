import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root=new URL('../',import.meta.url);
const read=(path)=>readFile(new URL(path,root),'utf8');

test('Gate 0 migration decouples gateway settlement and preserves the compatibility wrapper',async()=>{
  const sql=await read('supabase/migrations/20261003170000_gate0_baseline_synchronization.sql');
  assert.match(sql,/IN \('razorpay','stripe','payable','manual'\)/);
  assert.match(sql,/p_gross_amount numeric/);
  assert.match(sql,/p_fee_amount numeric DEFAULT 0/);
  assert.match(sql,/p_net_amount numeric DEFAULT NULL/);
  assert.match(sql,/lower\(provider\) = v_provider/);
  assert.match(sql,/provider_link_id = p_provider_link_id/);
  assert.match(sql,/code = '6200'/);
  assert.match(sql,/Payment processing fee/);
  assert.match(sql,/validate_journal_entry_balance\(v_entry\)/);
  assert.match(sql,/record_gateway_payment\(\n    p_provider,/);
  assert.doesNotMatch(sql,/IF lower\(coalesce\(p_provider,''\)\) <> 'razorpay'/);
});

test('Gate 0 reconciliation cleanup is fail-closed and quotation FKs are deferred SET NULL',async()=>{
  const sql=await read('supabase/migrations/20261003170000_gate0_baseline_synchronization.sql');
  assert.match(sql,/v_reconciliation_rows <> 0 OR v_reconciliation_item_rows <> 0/);
  assert.match(sql,/v_external_fks <> 0/);
  assert.match(sql,/DROP TABLE IF EXISTS public\.reconciliation_items/);
  assert.match(sql,/DROP TABLE IF EXISTS public\.reconciliations/);
  assert.match(sql,/invoices_source_quotation_id_fkey/);
  assert.match(sql,/quotations_invoice_id_fkey/);
  assert.match(sql,/ON DELETE SET NULL/);
  assert.match(sql,/DEFERRABLE INITIALLY DEFERRED/);
});

test('Gate 0 verification script checks the 15 pending migrations and Gate 0',async()=>{
  const sql=await read('supabase/verify_gate0_baseline.sql');
  for(const version of [
    '20261003100000','20261003120000','20261003123000','20261003130000',
    '20261003140000','20261003142550','20261003142900','20261003143000',
    '20261003143510','20261003150000','20261003162000','20261003163000',
    '20261003163500','20261003164000','20261003164500','20261003170000'
  ]) assert.match(sql,new RegExp(version));
  assert.match(sql,/required table/);
  assert.match(sql,/legacy reconciliation tables still exist/);
  assert.match(sql,/provider-neutral record_gateway_payment signature missing/);
  assert.match(sql,/condeferrable/);
});

test('Deprecated reconciliation tables are removed from business export paths',async()=>{
  const page=await read('app/next-workspace/data-export/page.tsx');
  assert.doesNotMatch(page,/(?:'reconciliations'|'reconciliation_items')/);
  assert.match(page,/'bank_reconciliations'/);
  assert.match(page,/'bank_reconciliation_items'/);
});

test('Offline POS test points at the migration actually present in main',async()=>{
  const testFile=await read('tests/offline-pos.test.mjs');
  assert.match(testFile,/20261003143510_strategic_gap_entitlement_enforcement_v1\.sql/);
  assert.doesNotMatch(testFile,/20261003143500_strategic_gap_entitlement_enforcement_v1\.sql/);
});
