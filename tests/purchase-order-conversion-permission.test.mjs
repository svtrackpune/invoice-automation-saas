import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (p) => readFile(new URL(p, root), 'utf8');

test('purchase order conversion checks the established procurement and accounting permissions', async () => {
  const migration = await read('supabase/migrations/20261016150000_fix_purchase_order_conversion_permission.sql');

  assert.match(migration, /has_business_permission\(p_business_id, 'purchases\.manage', v_user\)/);
  assert.match(migration, /has_business_permission\(p_business_id, 'accounting\.post', v_user\)/);
  assert.match(migration, /Access denied: purchases\.manage and accounting\.post permissions are required/);
  assert.doesNotMatch(migration, /has_business_permission\(p_business_id, 'bills\.create'/);
});

test('conversion keeps tenant, replay, cancellation, duplicate-number and posting guards', async () => {
  const migration = await read('supabase/migrations/20261016150000_fix_purchase_order_conversion_permission.sql');

  assert.match(migration, /WHERE id = p_po_id\s+AND business_id = p_business_id\s+AND is_purchase_order = TRUE/);
  assert.match(migration, /v_po\.converted_bill_id IS NOT NULL/);
  assert.match(migration, /v_po\.po_status = 'cancelled'/);
  assert.match(migration, /lower\(b\.bill_number\) = lower\(v_invoice_number\)/);
  assert.match(migration, /PERFORM public\.post_bill\(v_new_bill_id\)/);
  assert.match(migration, /SET po_status = 'fulfilled',\s+converted_bill_id = v_new_bill_id/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.convert_purchase_order_to_bill\(uuid, uuid, text, date\) FROM PUBLIC, anon/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.convert_purchase_order_to_bill\(uuid, uuid, text, date\) TO authenticated/);
});
