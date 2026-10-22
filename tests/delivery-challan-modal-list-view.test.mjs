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

test('challan popup fits the viewport and item-entry controls cannot force horizontal overflow', () => {
  const page = read('app/next-workspace/delivery-challans/page.tsx');
  const itemModal = read('app/next-workspace/invoices/new/ItemServiceModal.tsx');
  assert.match(page, /fixed inset-0 z-\[60\][^"]*overflow-x-hidden overflow-y-auto/);
  assert.match(page, /max-h-\[calc\(100dvh-2rem\)\] w-\[calc\(100vw-1\.5rem\)\] max-w-5xl min-w-0 overflow-x-hidden overflow-y-auto/);
  assert.match(page, /sm:grid-cols-2 lg:grid-cols-\[minmax\(0,1\.7fr\)_minmax\(75px,\.6fr\)_minmax\(90px,\.8fr\)_minmax\(120px,\.9fr\)_36px\]/);
  assert.doesNotMatch(page, /md:grid-cols-\[1\.7fr_\.6fr_\.8fr_\.8fr_32px\]/);
  assert.match(page, /sticky bottom-0 z-10[^"]*sm:flex-row/);
  assert.match(page, /modalLayerClassName="z-\[80\]"/);
  assert.match(itemModal, /modalLayerClassName='z-50'/);
  assert.match(itemModal, /fixed inset-0 \$\{modalLayerClassName\}/);
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
