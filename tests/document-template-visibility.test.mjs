import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (p) => readFile(new URL(p, root), 'utf8');

test('workspace navigation exposes document operations and receipts', async () => {
  const layout = await read('app/next-workspace/layout.tsx');
  assert.match(layout, /name: 'Documents'/);
  assert.match(layout, /href: '\/next-workspace\/documents\/library'/);
  assert.match(layout, /href: '\/next-workspace\/brand'/);
  assert.match(layout, /href: '\/next-workspace\/receipts'/);
  assert.match(layout, /'\/next-workspace\/brand': 'Templates & Branding'/);
  assert.match(layout, /'\/next-workspace\/documents\/library': 'Document Library'/);
});

test('document settings uses the canonical production template catalog', async () => {
  const settings = await read('app/next-workspace/brand/UnifiedDocumentSettings.tsx');
  assert.match(settings, /\['classic', 'minimal', 'modern', 'premium', 'professional'\] as const/);
  assert.match(settings, /raw === 'bold'.*professional/);
  assert.match(settings, /raw === 'compact'.*premium/);
  assert.match(settings, /new URLSearchParams\(window\.location\.search\)/);
});

test('invoice and quotation editors link directly to template management and preview', async () => {
  const invoice = await read('app/next-workspace/invoices/new/page.tsx');
  const quotation = await read('app/next-workspace/quotation/QuotationWorkspaceControlled.tsx');
  assert.match(invoice, /\/next-workspace\/brand\?type=invoice/);
  assert.match(quotation, /\/next-workspace\/brand\?type=quotation/);
});

test('document viewer and receipt PDF renderer remain present', async () => {
  const viewer = await read('app/next-workspace/documents/DocumentViewer.tsx');
  const receiptPdf = await read('lib/server/receipt-pdf.ts');
  assert.match(viewer, /THEMES/);
  for (const key of ['classic', 'minimal', 'modern', 'premium', 'professional']) {
    assert.match(viewer, new RegExp(`\\b${key}:\\s*\\{`));
  }
  assert.match(receiptPdf, /export async function loadReceiptPdfData/);
  assert.match(receiptPdf, /export \{ buildReceiptPdf \}/);
});
