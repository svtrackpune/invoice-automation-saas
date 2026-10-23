import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL('../' + path, import.meta.url), 'utf8');

test('purchase reference attachments stay private and permission scoped', async () => {
  const migration = await read('supabase/migrations/20261023100000_vendor_purchase_attachments.sql');
  assert.match(migration, /'vendor-purchase-attachments'[\s\S]*?false[\s\S]*?20971520/);
  assert.match(migration, /'purchases\.view'/);
  assert.match(migration, /'purchases\.manage'/);
  assert.doesNotMatch(migration, /TO anon/);
  const form = await read('app/next-workspace/purchases/new/page.tsx');
  assert.match(form, /capture="environment"/);
  assert.match(form, /accept="\.pdf,image\/jpeg,image\/png,image\/webp,image\/heic,image\/heif"/);
  assert.match(form, /file\.size>20\*1024\*1024/);
  assert.match(form, /supabase\.storage\.from\('vendor-purchase-attachments'\)\.upload/);
  assert.match(form, /document_type:'vendor_purchase_reference'/);
  assert.match(form, /linked_entity_type:'bill',linked_entity_id:billId/);
  assert.doesNotMatch(form, /storage\.from\('business-branding-public'\)\.upload/);
});

test('purchase detail shows expiring private links without changing posting RPCs', async () => {
  const detail = await read('app/next-workspace/purchases/[id]/page.tsx');
  assert.match(detail, /createSignedUrl\(document\.storage_path,300\)/);
  assert.match(detail, /Original vendor bill \/ reference/);
  assert.match(detail, /attachment_error/);
  const form = await read('app/next-workspace/purchases/new/page.tsx');
  assert.match(form, /supabase\.rpc\('create_purchase_document'/);
  assert.match(form, /supabase\.rpc\('post_bill'/);
  assert.match(form, /do not post accounting entries by themselves/);
});
