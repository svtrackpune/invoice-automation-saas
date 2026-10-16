import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (p) => readFile(new URL(p, root), 'utf8');

test('Document Studio provides dedicated receipt layout and template-specific vector motifs', async () => {
  const studio = await read('app/next-workspace/brand/DocumentThemeStudio.tsx');

  assert.match(studio, /function StudioCornerArt/);
  assert.match(studio, /if \(isReceipt\) \{/);
  assert.match(studio, /w-\[340px\] max-w-full/);
  assert.match(studio, /Payment Receipt/);
  assert.match(studio, /Amount received/);
  assert.match(studio, /Customer ledger balance/);
  assert.match(studio, /templateKey === 'classic'/);
  assert.match(studio, /templateKey === 'minimal'/);
  assert.match(studio, /templateKey === 'premium'/);
  assert.match(studio, /templateKey === 'professional'/);
});

test('selected preference template and Studio palette are authoritative in the final print viewer', async () => {
  const viewer = await read('app/next-workspace/documents/DocumentViewer.tsx');

  assert.match(viewer, /select\('template_id,primary_color,secondary_color,accent_color,text_color,background_color,font_family,custom_fields/);
  assert.match(viewer, /const studioTheme = \{ \.\.\.\(fields\?\.theme_studio \|\| \{\}\), primary_color: preferences\?\.primary_color/);
  assert.match(viewer, /preferences\?\.primary_color/);
  assert.match(viewer, /let resolvedTemplate = templateResult\.data/);
  assert.match(viewer, /preferenceResult\.data\?\.template_id/);
  assert.match(viewer, /style=\{\{'--accent':accentColor,'--table':primaryColor,'--line':lineColor/);
  assert.match(viewer, /function CornerVectorArt/);
  assert.match(viewer, /<CornerVectorArt templateKey=/);
  assert.doesNotMatch(viewer, /sales-document-standard\{--accent:#7c3aed!important/);
});

test('receipt print layout is compact and palette-driven rather than scattered and fixed yellow', async () => {
  const viewer = await read('app/next-workspace/documents/DocumentViewer.tsx');

  assert.match(viewer, /\.receipt-paper\{position:relative;width:390px;max-width:100%/);
  assert.match(viewer, /\.receipt-ledger-balance\{display:flex;justify-content:space-between;gap:10px;margin:6px 10px 0;padding:8px 9px;border:1px solid var\(--line\)/);
  assert.match(viewer, /\.receipt-paper \.receipt-customer/);
  assert.match(viewer, /\.document-corner-art-top/);
  assert.match(viewer, /\.receipt-paper \.document-corner-art-top/);
});

test('official receipt PDF reads the selected template and uses palette-specific vector accents', async () => {
  const renderer = await read('lib/server/receipt-pdf.ts');

  assert.match(renderer, /type ReceiptTheme =/);
  assert.match(renderer, /documentTheme\?: ReceiptTheme/);
  assert.match(renderer, /business_document_preferences/);
  assert.match(renderer, /templateKey: plain\(templateResult\.data\?\.template_key \|\| 'modern'\)/);
  assert.match(renderer, /function resolveReceiptPalette/);
  assert.match(renderer, /const drawVectorCorners =/);
  assert.match(renderer, /palette\.accentPale/);
  assert.match(renderer, /drawVectorCorners\(page\)/);
  assert.match(renderer, /drawVectorCorners\(page\);\s*y = pageHeight - top/);
  assert.match(renderer, /palette\.primary/);
});

test('public customer PDFs use selected theme colors, page background and varied vector corners', async () => {
  const tokens = await read('lib/server/documents/public-tokens.ts');
  const renderer = await read('lib/server/documents/public-pdf.ts');

  assert.match(tokens, /documentTheme\?: \{/);
  assert.match(tokens, /const preferenceType = type === 'challan' \? 'delivery_challan' : type/);
  assert.match(tokens, /const preferenceResult = await db\.from\('business_document_preferences'\)/);
  assert.match(tokens, /templateKey: templateKey \|\| 'modern'/);
  assert.match(tokens, /documentTheme,/);
  assert.match(renderer, /function resolvePublicPdfPalette/);
  assert.match(renderer, /const palette = resolvePublicPdfPalette\(doc\.documentTheme\)/);
  assert.match(renderer, /const drawCornerVectors =/);
  assert.match(renderer, /key === 'classic'/);
  assert.match(renderer, /key === 'minimal'/);
  assert.match(renderer, /key === 'premium'/);
  assert.match(renderer, /key === 'professional'/);
  assert.match(renderer, /c\.rect\(0, 0, W, H, palette\.background\)/);
});

test('database render job resolves current business-selected template before legacy document template', async () => {
  const migration = await read('supabase/migrations/20261017100000_fix_document_template_precedence.sql');
  const preferenceAt = migration.indexOf('if tid is null then select dp.template_id into tid');
  const documentAt = migration.indexOf('if tid is null and document_template_id is not null');
  const explicitAt = migration.indexOf('if p_template_id is not null then');

  assert.ok(explicitAt >= 0, 'explicit render override should remain supported');
  assert.ok(preferenceAt > explicitAt, 'business preference should follow explicit override');
  assert.ok(documentAt > preferenceAt, 'business preference should precede document-level template');
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.prepare_document_render_legacy/);
});
