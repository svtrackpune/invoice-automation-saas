import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (p) => readFile(new URL(p, root), 'utf8');

test('empty purchase orders cannot attempt conversion and get an actionable correction message', async () => {
  const detail = await read('app/next-workspace/purchases/[id]/page.tsx');
  const migration = await read('supabase/migrations/20261017160000_guard_empty_purchase_order_conversion.sql');

  assert.match(detail, /isPO&&!bill\.converted_bill_id&&items\.length===0/);
  assert.match(detail, /Purchase order has no line items\./);
  assert.match(detail, /items\.length>0&&<button type="button" onClick=\{\(\)=>setConvertOpen\(true\)\}/);
  assert.match(migration, /IF NOT EXISTS \([\s\S]*?FROM public\.bill_items bi WHERE bi\.bill_id = v_po\.id/);
  assert.match(migration, /Purchase order has no line items\. Edit the order and add at least one product or service before receiving goods\./);
  assert.ok(migration.indexOf('Purchase order has no line items') < migration.indexOf('INSERT INTO public.bills'));
});
