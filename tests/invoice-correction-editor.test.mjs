import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('invoice correction remains available for non-void posted documents and hides it while state is unresolved', async () => {
  const review = await read('app/next-workspace/documents/DocumentReviewCenter.tsx');
  const editor = await read('app/next-workspace/invoices/new/page.tsx');
  assert.match(review, /const editable = type === 'invoice' && !\['loading','void','missing','error'\]\.includes\(status\)/);
  assert.match(review, /database RPC/);
  assert.match(editor, /if\(ir\.data\.status==='void'\)\{setError\('Void invoices cannot be edited\.'\)/);
  assert.match(editor, /rpc\('update_regular_invoice_any_state'/);
});

test('invoice edit hydration uses the selected business and safely normalizes missing item arrays', async () => {
  const review = await read('app/next-workspace/documents/DocumentReviewCenter.tsx');
  const editor = await read('app/next-workspace/invoices/new/page.tsx');
  assert.match(review, /moneymatters\.activeBusinessId/);
  assert.match(editor, /moneymatters\.activeBusinessId/);
  assert.match(editor, /const itemRows=Array\.isArray\(itemsResult\.data\)\?itemsResult\.data:\[\]/);
  assert.match(editor, /Invoice not found\./);
  assert.match(editor, /role="alert"/);
});

test('invoice correction surfaces iframe and fetch failures instead of a blank prohibited panel', async () => {
  const modal = await read('app/next-workspace/invoices/InvoiceEditModal.tsx');
  const editor = await read('app/next-workspace/invoices/new/page.tsx');
  assert.match(modal, /onLoad=\{handleEditorLoad\}/);
  assert.match(modal, /Correction form unavailable/);
  assert.match(modal, /Open correction editor/);
  assert.match(editor, /Unable to load the invoice editor/);
  assert.match(editor, /Business context not found/);
});

test('invoice editor API calls are same-origin relative URLs, never hardcoded HTTP fetches', async () => {
  const editor = await read('app/next-workspace/invoices/new/page.tsx');
  const review = await read('app/next-workspace/documents/DocumentReviewCenter.tsx');
  const modal = await read('app/next-workspace/invoices/InvoiceEditModal.tsx');
  assert.ok(editor.includes("fetch('/api/invoices/dynamic'"));
  assert.doesNotMatch(editor, /fetch\(\s*['"]http:\/\//i);
  assert.doesNotMatch(review, /fetch\(\s*['"]http:\/\//i);
  assert.equal(modal.includes('http://'), false);
});
