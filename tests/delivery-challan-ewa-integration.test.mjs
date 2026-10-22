import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('physical document render check admits types handled by the renderer', () => {
  const migration = read('supabase/migrations/20261022113000_allow_physical_document_render_jobs.sql');
  for (const type of ['invoice', 'quotation', 'receipt', 'credit_note', 'debit_note', 'delivery_challan', 'purchase_order']) {
    assert.ok(migration.includes(`'${type}'`), `render job constraint must permit ${type}`);
  }
  assert.ok(migration.includes('DROP CONSTRAINT IF EXISTS document_render_jobs_document_type_check'));
  assert.ok(migration.includes('ADD CONSTRAINT document_render_jobs_document_type_check'));
  assert.ok(!/DROP TABLE|TRUNCATE|DELETE FROM/i.test(migration), 'repair must not discard production documents');
});

test('delivery challan e-way bill controls require a valid registered GST profile', () => {
  const page = read('app/next-workspace/delivery-challans/page.tsx');
  assert.ok(page.includes("rpc('get_delivery_challan_eway_tax_profile'"), 'GST profile reads must use the permission-checked RPC');
  assert.ok(page.includes("tax_regime"));
  assert.ok(page.includes("gst_registration_type"));
  assert.ok(page.includes("^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$"), 'GSTIN must be validated before showing GST e-way tools');
  assert.ok(page.includes("https://ewaybillgst.gov.in/"), 'users need the official GST e-way bill portal');
  assert.ok(page.includes('An E-way Bill Number must contain exactly 12 digits.'));
  assert.ok(page.includes('then record the official 12-digit e-way bill from Recent Challans'));
  assert.ok(page.includes("rpc('record_delivery_challan_eway_bill'"));
  assert.ok(page.includes('Direct government generation/update/cancellation requires a configured authorized GSP/API provider'));
  assert.ok(page.includes('Update E-way Bill'));
  assert.ok(page.includes('E-way Bill: {row.eway_bill_number}'));

});

test('delivery challan renderer and public PDF paths preserve e-way bill fields', () => {
  const renderer = read('supabase/migrations/20261008160000_render_adapters_challan_and_po.sql');
  const publicPage = read('app/delivery-challan/[token]/page.tsx');
  const publicTokens = read('lib/server/documents/public-tokens.ts');
  assert.ok(renderer.includes("'eway_bill_number',dc.eway_bill_number"));
  assert.ok(publicPage.includes('doc.ewayBillNumber'));
  assert.ok(publicTokens.includes('eway_bill_number'));
});

test('e-way bill recording is permission-checked, tenant-scoped, idempotent, and audited', () => {
  const migration = read('supabase/migrations/20261022122000_delivery_challan_eway_bill_audit.sql');
  for (const required of [
    'CREATE TABLE IF NOT EXISTS public.delivery_challan_eway_bill_events',
    'ENABLE ROW LEVEL SECURITY',
    "'inventory.manage'",
    'WHERE dc.id = p_challan_id',
    'AND dc.business_id = p_business_id',
    "'^[0-9]{12}$'",
    'FOR UPDATE',
    "'manual_recorded'",
    "'manual_updated'",
    'previous_eway_bill_number',
    'REVOKE ALL ON FUNCTION public.record_delivery_challan_eway_bill',
    'GRANT EXECUTE ON FUNCTION public.record_delivery_challan_eway_bill(uuid, uuid, text) TO authenticated',
  ]) assert.ok(migration.includes(required), 'missing e-way bill guard: ' + required);
  assert.ok(migration.includes("IF v_challan.eway_bill_number = v_new_number THEN"), 'same-number retries must not create duplicate audit events');
});
