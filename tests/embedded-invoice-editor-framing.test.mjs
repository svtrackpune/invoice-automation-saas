import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const middleware = readFileSync(new URL('../middleware.ts', import.meta.url), 'utf8');
const invoiceEditModal = readFileSync(new URL('../app/next-workspace/invoices/InvoiceEditModal.tsx', import.meta.url), 'utf8');

test('embedded invoice editor is the only route allowed to use same-origin framing', () => {
  assert.match(
    middleware,
    /const isEmbeddedInvoiceEditor = pathname === '\/next-workspace\/invoices\/new'\s*&& request\.nextUrl\.searchParams\.get\('embedded'\) === '1'\s*&& Boolean\(request\.nextUrl\.searchParams\.get\('edit'\)\);/,
  );
  assert.match(middleware, /allowSameOriginFrames \? "frame-ancestors 'self'" : "frame-ancestors 'none'"/);
  assert.match(middleware, /response\.headers\.set\('X-Frame-Options', isEmbeddedInvoiceEditor \? 'SAMEORIGIN' : 'DENY'\)/);
});

test('invoice correction modal embeds the editor with an existing invoice id', () => {
  assert.match(invoiceEditModal, /\/next-workspace\/invoices\/new\?edit=\$\{encodeURIComponent\(invoiceId\)\}&embedded=1/);
  assert.match(invoiceEditModal, /window\.location\.origin/);
});

test('frame policy remains fail-closed for every route outside the embedded editor', () => {
  assert.match(middleware, /allowSameOriginFrames = false/);
  assert.match(middleware, /allowSameOriginFrames \? "frame-ancestors 'self'" : "frame-ancestors 'none'"/);
  assert.match(middleware, /isEmbeddedInvoiceEditor \? 'SAMEORIGIN' : 'DENY'/);
});
