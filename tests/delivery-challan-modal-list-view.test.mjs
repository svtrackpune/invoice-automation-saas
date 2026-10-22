import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const read = (file) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

test('delivery challan creation is opened in a modal while recent challans occupy the page list', () => {
  const page = read('app/next-workspace/delivery-challans/page.tsx');
  assert.match(page, /const \[showChallanModal, setShowChallanModal\] = useState\(false\)/);
  assert.match(page, /aria-modal="true" aria-labelledby="new-challan-modal-title"/);
  assert.match(page, /New Challan/);
  assert.match(page, /Recent Challans/);
  assert.match(page, /divide-y divide-slate-100/);
  assert.match(page, /md:grid-cols-\[minmax\(0,1\.4fr\)_minmax\(120px,\.55fr\)_minmax\(260px,1\.25fr\)\] md:items-center/);
  assert.match(page, /View \/ Print/);
  assert.match(page, /Convert to Tax Invoice/);
  assert.match(page, /Record E-way Bill/);
});

test('creating a challan closes the modal and preserves the stock dispatch workflow', () => {
  const page = read('app/next-workspace/delivery-challans/page.tsx');
  const create = page.slice(page.indexOf('async function create()'), page.indexOf('function editEwayBill'));
  assert.match(create, /supabase\.rpc\('create_delivery_challan'/);
  assert.match(create, /setShowChallanModal\(false\)/);
  assert.match(create, /await load\(\)/);
  assert.match(page, /onClick=\{\(\) => void addLocation\(\)\}/);
  assert.match(page, /setShowItemModal\(true\)/);
  assert.match(page, /GST e-Way Bill/);
});
