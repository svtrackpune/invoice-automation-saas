import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('canonical branding assets are generated before web and Android preparation', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.scripts.prebuild, 'node scripts/prepare-brand-assets.js');
  assert.equal(pkg.scripts.predev, 'node scripts/prepare-brand-assets.js');
  assert.equal(pkg.scripts['branding:assets'], 'node scripts/prepare-brand-assets.js');
  assert.equal(pkg.scripts['precap:prepare'], 'node scripts/prepare-brand-assets.js');
  const script = read('scripts/prepare-brand-assets.js');
  for (const required of [
    'app/icon.png', 'app/apple-icon.png', 'app/favicon.ico',
    'public/moneymatters-192.png', 'public/moneymatters-512.png',
    'public/moneymatters-pdf.png', 'mipmap-mdpi/ic_launcher.png',
    'mipmap-xxxhdpi/ic_launcher_foreground.png',
  ]) assert.ok(script.includes(required), 'missing generated output: ' + required);
});

test('Money Matters branding uses the canonical mark in application and public document surfaces', () => {
  const sources = [
    'app/page.tsx', 'app/onboarding/page.tsx', 'app/next-workspace/layout.tsx',
    'app/auth/forgot-password/page.tsx', 'app/next-workspace/brand/BrandManager.tsx',
    'app/next-workspace/brand/DocumentThemeStudio.tsx', 'app/next-workspace/documents/DocumentViewer.tsx',
    'app/invoice/[token]/page.tsx', 'app/quote/[token]/page.tsx', 'app/receipt/[token]/page.tsx',
    'app/challan/[token]/page.tsx', 'app/delivery-challan/[token]/page.tsx',
  ].map(read).join('\n');
  assert.ok(sources.includes('/moneymatters-192.png'));
  assert.ok(sources.includes('/moneymatters-pdf.png'));
  assert.ok(sources.includes('Money Matters FinOps'));
  const manifest = JSON.parse(read('public/manifest.json'));
  assert.ok(manifest.icons.some((icon) => icon.src === '/moneymatters-192.png'));
  assert.ok(manifest.icons.some((icon) => icon.src === '/moneymatters-512.png'));
});

test('generated PDFs include the official brand mark while retaining a text-only fallback', () => {
  const renderer = read('lib/server/documents/public-pdf.ts');
  const receiptRenderer = read('lib/server/receipt-pdf.ts');
  assert.ok(renderer.includes('imageBytes(platformMark'));
  assert.ok(renderer.includes('else c.text(W / 2, 803, poweredText'));
  assert.ok(receiptRenderer.includes('pdf.image(platformMark'));
  assert.ok(receiptRenderer.includes('Powered by Money Matters FinOps'));
});
