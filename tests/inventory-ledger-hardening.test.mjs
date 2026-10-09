import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  'supabase/migrations/20261009140000_inventory_ledger_hardening.sql',
  'utf8',
);

test('inventory movement trigger classifies all required inbound and outbound aliases', () => {
  for (const type of [
    'sale', 'pos_sale', 'delivery_challan_out', 'transfer_out',
    'return_to_vendor', 'damaged', 'purchase_in', 'transfer_in',
    'customer_return', 'opening_stock', 'stock_adjustment_in',
  ]) {
    assert.ok(migration.includes("WHEN '" + type + "'"), 'missing movement type: ' + type);
  }
  assert.match(migration, /Unsupported inventory movement type/);
  assert.match(migration, /Insufficient stock for product/);
  assert.match(migration, /allow_negative_stock/);
});

test('balance mutations in existing inventory RPCs are removed in favor of movements', () => {
  for (const rpc of [
    'public.post_invoice(uuid,uuid)',
    'public.create_delivery_challan(uuid,uuid,date,uuid,jsonb,text,text,text,text,text)',
    'public.commit_stock_audit_adjustment(uuid,uuid,jsonb)',
    'public.post_bill_legacy(uuid)',
    'public.post_credit_note(uuid,uuid)',
    'public.post_vendor_credit(uuid,uuid)',
    'public.update_bill_any_state(uuid,uuid,date,date,jsonb,text,boolean,boolean,text,text)',
    'public.update_invoice_any_state(uuid,uuid,date,date,jsonb,text,numeric,text,text,uuid,date,uuid,text,uuid)',
    'public.void_invoice(uuid,text)',
  ]) {
    assert.ok(
      migration.includes("'" + rpc + "'::regprocedure"),
      'missing balance-ledger rewrite for ' + rpc,
    );
  }
  assert.match(migration, /AFTER INSERT ON public\.inventory_movements/);
  assert.match(migration, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE/);
});

test('opening stock initialization is idempotent and uses only products with no current ledger', () => {
  assert.match(migration, /initialize_product_opening_stock/);
  assert.match(migration, /inventory_movements_opening_stock_once_idx/);
  assert.match(migration, /NOT EXISTS \(\s*SELECT 1 FROM public\.inventory_movements im/s);
  assert.match(migration, /NOT EXISTS \(\s*SELECT 1 FROM public\.inventory_balances ib/s);
  assert.match(migration, /Opening stock initialized from existing product master data/);
});

test('invoice amendments preserve the dispatch-first challan inventory invariant', () => {
  assert.match(migration, /Source delivery challan quantities must match invoice quantities/);
  assert.match(migration, /inv\.source_challan_id IS NULL AND EXISTS/);
  assert.match(migration, /never create invoice sale movements for a challan-sourced invoice/);
  assert.match(migration, /round\(v_challan_movement_qty, 6\) <> round\(v_challan_qty, 6\)/);
});

test('warehouse transfer RPC is tenant-scoped, authenticated, atomic and invoice-free', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.transfer_inventory_between_locations/);
  assert.match(migration, /has_business_permission\(p_business_id, 'inventory\.manage', v_user_id\)/);
  assert.match(migration, /'transfer_out'/);
  assert.match(migration, /'transfer_in'/);
  assert.match(migration, /Insufficient stock at the source location/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.transfer_inventory_between_locations/);
});
