import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('Cash Bill View/Print uses the stored POS receipt format even when the render route is invoice', async () => {
  const viewer = await read('app/next-workspace/documents/DocumentViewer.tsx');
  const cashPage = await read('app/next-workspace/cash-bill/page.tsx');

  assert.match(cashPage, /setReceiptFormat=\{\(value\)=>\{setReceiptFormat\(value\);window\.localStorage\.setItem\('moneymatters\.cashBillReceiptFormat',value\)\}\}/);
  assert.match(viewer, /String\(model\.document_kind \|\| ''\)\.toLowerCase\(\) === 'cash_bill'/);
  assert.match(viewer, /const savedFormat = window\.localStorage\.getItem\('moneymatters\.cashBillReceiptFormat'\)/);
  assert.match(viewer, /savedFormat === 'thermal80' \|\| savedFormat === 'thermal58' \|\| savedFormat === 'a4' \|\| savedFormat === 'a5'[\s\S]*?savedFormat : 'thermal80'/);
  assert.match(viewer, /\{isCashBillDocument&&<MMFormSelectControl aria-label="Cash Bill print format"/);
  assert.match(viewer, /documentFilenameLabel\(isCashBillDocument \? 'cash_bill' : type\)/);
});

test('Cash Bill preview uses the cash-bill template and receipt-sized geometry instead of an oversized invoice logo', async () => {
  const viewer = await read('app/next-workspace/documents/DocumentViewer.tsx');

  assert.match(viewer, /const preferenceType = type === 'cash_bill' \|\| String\(payload\.document_kind \|\| ''\)\.toLowerCase\(\) === 'cash_bill' \? 'cash_bill' : renderType/);
  assert.match(viewer, /\.eq\('document_type', preferenceType\)\.maybeSingle\(\)/);
  assert.match(viewer, /\.business-identity \.logo\{display:flex;flex:0 0 124px;width:124px;height:88px/);
  assert.match(viewer, /\.cash-bill-paper\.cash-bill-thermal80\{width:302px;min-width:302px;max-width:302px;min-height:0/);
  assert.match(viewer, /\.cash-bill-paper \.business-identity \.logo\{flex-basis:116px;width:116px;height:76px\}/);
  assert.match(viewer, /\.cash-bill-paper \.invoice-heading \.document-title\{font-size:21px/);
});
