import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const middleware = readFileSync(new URL('../middleware.ts', import.meta.url), 'utf8');
const invoiceEditModal = readFileSync(new URL('../app/next-workspace/invoices/InvoiceEditModal.tsx', import.meta.url), 'utf8');

test('invoice correction renders the editor core directly without a nested workspace iframe', () => {
  assert.match(invoiceEditModal, /import InvoiceEditorCore from '\.\/InvoiceEditorCore'/);
  assert.match(invoiceEditModal, /<InvoiceEditorCore documentId=\{invoiceId\} embedded documentKind=\{documentKind\} onCancel=\{onClose\} onSaved=\{onClose\} \/>/);
  assert.doesNotMatch(invoiceEditModal, /<iframe/);
  assert.doesNotMatch(invoiceEditModal, /\/next-workspace\/invoices\/new\?edit=/);
});

test('workspace routes deny framing now that the correction modal does not use an iframe', () => {
  assert.match(middleware, /frame-ancestors 'none'/);
  assert.match(middleware, /response\.headers\.set\('X-Frame-Options', 'DENY'\)/);
  assert.doesNotMatch(middleware, /allowSameOriginFrames/);
  assert.doesNotMatch(middleware, /isEmbeddedInvoiceEditor/);
});
