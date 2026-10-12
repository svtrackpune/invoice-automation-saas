import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('Vijay Industries payment seed uses the live schema and targets the exact business', async () => {
  const migration = await read('supabase/migrations/20261012170000_seed_business_bank_and_upi_settings.sql');

  assert.match(migration, /lower\(btrim\(name\)\) = 'vijay industries'/);
  assert.match(migration, /institution_name = 'State Bank of India'/);
  assert.match(migration, /account_holder_name = 'Vijay Industries'/);
  assert.match(migration, /is_primary = true/);
  assert.match(migration, /default_bank_account_id = v_account_id/);
  assert.match(migration, /payment_qr_enabled = true/);
  assert.match(migration, /upi_id = '9922040001@upi'/);
  assert.match(migration, /document_type IN \('invoice', 'quotation'\)[\s\S]*?show_bank_details = true/);
  assert.match(migration, /'invoice', v_account_id/);
  assert.match(migration, /'quotation', v_account_id/);
  assert.doesNotMatch(migration, /\bbank_name\b|\baccount_name\b|\bis_default\b|\benable_bank_details\b|\benable_upi_qr\b/);
});

test('public invoice PDFs fall back to active business settlement settings when no invoice bank is selected', async () => {
  const helper = await read('lib/server/documents/public-tokens.ts');

  assert.match(helper, /\.eq\('business_id', businessId\)\.eq\('document_type', type\)/);
  assert.match(helper, /selectedBankId = nullable\(settingsResult\.data\?\.default_bank_account_id\)/);
  assert.match(helper, /if \(!bankResult\.data\)[\s\S]*?\.order\('is_primary', \{ ascending: false \}\)/);
  assert.match(helper, /upiId = nullable\(settingsResult\.data\?\.upi_id\)/);
});
