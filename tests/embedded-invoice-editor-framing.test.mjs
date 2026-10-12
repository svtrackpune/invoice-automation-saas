import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const middleware = readFileSync(new URL('../middleware.ts', import.meta.url), 'utf8');
const invoiceEditModal = readFileSync(new URL('../app/next-workspace/invoices/InvoiceEditModal.tsx', import.meta.url), 'utf8');
const quotationEditModal = readFileSync(new URL('../app/next-workspace/quotation/QuotationEditModal.tsx', import.meta.url), 'utf8');

test('invoice and quotation correction modals render editor cores directly', () => {
  assert.match(invoiceEditModal, /<InvoiceEditorCore documentId=\{invoiceId\} embedded documentKind=\{documentKind\} onCancel=\{onClose\} onSaved=\{onClose\} \/>/);
  assert.match(quotationEditModal, /<QuotationEditorCore quotationId=\{quotationId\} embedded onCancel=\{onClose\} onSaved=\{onClose\} \/>/);
  assert.doesNotMatch(invoiceEditModal, /<iframe/);
  assert.doesNotMatch(quotationEditModal, /<iframe/);
  assert.doesNotMatch(quotationEditModal, /\/next-workspace\/quotation\?edit=/);
});

test('workspace routes deny framing because document edit modals do not use iframes', () => {
  assert.match(middleware, /frame-ancestors 'none'/);
  assert.match(middleware, /response\.headers\.set\('X-Frame-Options', 'DENY'\)/);
  assert.doesNotMatch(middleware, /allowSameOriginFrames/);
  assert.doesNotMatch(middleware, /isEmbeddedInvoiceEditor/);
});
