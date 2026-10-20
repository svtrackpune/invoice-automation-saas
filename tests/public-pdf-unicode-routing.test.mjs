import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const tokens = readFileSync('lib/server/documents/public-tokens.ts', 'utf8');
const route = readFileSync('app/api/public-documents/pdf/route.ts', 'utf8');
const share = readFileSync('lib/client/share-document.ts', 'utf8');
const publicPdf = readFileSync('lib/server/documents/public-pdf.ts', 'utf8');
const receiptPdf = readFileSync('lib/server/receipt-pdf.ts', 'utf8');
const pdfKit = readFileSync('lib/server/documents/pdf-kit.ts', 'utf8');
const migration = readFileSync('supabase/migrations/20261020120000_expand_public_document_pdf_and_unicode.sql', 'utf8');

test('public token resolution and PDF route cover all seven supported document types', () => {
  for (const type of ['invoice', 'quotation', 'receipt', 'challan', 'purchase_order', 'credit_note', 'cash_bill']) {
    assert.ok(tokens.includes("'" + type + "'"), 'token resolver missing ' + type);
    assert.ok(route.includes("'" + type + "'"), 'PDF route missing ' + type);
  }
  assert.match(tokens, /public_share_token/);
  assert.match(tokens, /let foundQuery = db\.from\(table\)\.select\('id,business_id'\)/);
  assert.doesNotMatch(tokens, /foundQuery = db\.from\(table\)\.select\([^)]*document_kind/);
  assert.match(migration, /bills_public_share_token_uidx/);
  assert.match(migration, /credit_notes_public_share_token_uidx/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_public_document_link/);
  assert.match(route, /Content-Disposition/);
  assert.match(route, /buildDocumentDownloadFilename/);
  assert.match(share, /api\/public-documents\/pdf/);
});

test('vector PDF renderers embed a Unicode-capable font and do not strip non-ASCII text', () => {
  assert.match(pdfKit, /NotoSansDevanagari/);
  assert.match(pdfKit, /registerFont/);
  assert.match(publicPdf, /createUnicodePdfDocument/);
  assert.match(receiptPdf, /createUnicodePdfDocument/);
  assert.match(publicPdf, /pdfDocumentToBuffer/);
  assert.match(receiptPdf, /pdfDocumentToBuffer/);
  assert.equal(publicPdf.includes('replace(/[^\\x20-\\x7E]/g'), false);
  assert.equal(receiptPdf.includes('replace(/[^\\x20-\\x7E]/g'), false);
  assert.ok(existsSync('public/fonts/NotoSansDevanagari[wdth,wght].ttf'));
  assert.ok(existsSync('public/fonts/OFL-NotoSansDevanagari.txt'));
});


test('Noto Devanagari font can be embedded into a generated PDF', async () => {
  const PDFDocument = (await import('pdfkit')).default;
  const fontPath = path.resolve('public/fonts/NotoSansDevanagari[wdth,wght].ttf');
  const document = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true });
  document.registerFont('NotoSansDevanagari', fontPath);
  const chunks = [];
  const outputPromise = new Promise((resolve, reject) => {
    document.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    document.once('end', () => resolve(Buffer.concat(chunks)));
    document.once('error', reject);
  });
  document.font('NotoSansDevanagari').fontSize(14).text('मराठी ग्राहक सेवा - नांदेड', 40, 40);
  document.end();
  const output = await outputPromise;
  const encodedPdf = output.toString('latin1');
  assert.ok(output.length > 1000, 'expected a non-empty generated PDF');
  assert.ok(encodedPdf.includes('/FontFile2'), 'expected the Unicode TrueType font to be embedded');
  assert.ok(encodedPdf.includes('/ToUnicode'), 'expected a ToUnicode mapping for searchable text');
});
