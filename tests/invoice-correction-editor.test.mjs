import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('invoice correction allows controlled posted edits and prevents void invoice edits', async () => {
  const review = await read('app/next-workspace/documents/DocumentReviewCenter.tsx');
  const editor = await read('app/next-workspace/invoices/InvoiceEditorCore.tsx');
  assert.match(review, /const editable = type === 'invoice' && !\['loading','void','missing','error'\]\.includes\(status\)/);
  assert.match(editor, /if\(ir\.data\.status==='void'\)\{setError\('Void invoices cannot be edited\.'\)/);
  assert.match(editor, /rpc\('rpc_correct_posted_invoice'/);
});

test('invoice editor hydration safely normalizes missing line item arrays and reports load errors', async () => {
  const review = await read('app/next-workspace/documents/DocumentReviewCenter.tsx');
  const editor = await read('app/next-workspace/invoices/InvoiceEditorCore.tsx');
  assert.match(review, /moneymatters\.activeBusinessId/);
  assert.match(editor, /moneymatters\.activeBusinessId/);
  assert.match(editor, /const itemRows=Array\.isArray\(itemsResult\.data\)\?itemsResult\.data:\[\]/);
  assert.match(editor, /Invoice not found\./);
  assert.match(editor, /role="alert"/);
});

test('invoice editor API calls use relative same-origin paths', async () => {
  const editor = await read('app/next-workspace/invoices/InvoiceEditorCore.tsx');
  const review = await read('app/next-workspace/documents/DocumentReviewCenter.tsx');
  const modal = await read('app/next-workspace/invoices/InvoiceEditModal.tsx');
  assert.ok(editor.includes("fetch('/api/invoices/dynamic'"));
  assert.doesNotMatch(editor, /fetch\(\s*['"]http:\/\//i);
  assert.doesNotMatch(review, /fetch\(\s*['"]http:\/\//i);
  assert.equal(modal.includes('http://'), false);
});
