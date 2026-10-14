import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('all current customer-ledger displays share posted base-currency outstanding rules', async () => {
  const migration = await read('supabase/migrations/20261014130000_customer_ledger_balance_consistency.sql');
  const viewer = await read('app/next-workspace/documents/DocumentViewer.tsx');
  const receiptPdf = await read('lib/server/receipt-pdf.ts');
  const publicTokens = await read('lib/server/documents/public-tokens.ts');
  const publicReceipt = await read('app/receipt/[token]/page.tsx');
  const printCompliance = await read('components/documents/PrintCompliance.tsx');

  assert.match(migration, /CREATE OR REPLACE FUNCTION public\\.fn_get_customer_outstanding_balance/);
  assert.match(migration, /status::text NOT IN \\('draft', 'void', 'cancelled'\\)/);
  assert.match(migration, /upper\\(i\\.currency_code::text\\) = upper\\(b\\.base_currency_code::text\\)/);
  assert.match(migration, /CREATE OR REPLACE VIEW public\\.customer_balances[\\s\\S]*?security_invoker = true/);
  assert.match(migration, /upper\\(i\\.currency_code::text\\) = upper\\(bus\\.base_currency_code::text\\)/);

  assert.match(viewer, /currency_code,base_currency_code,address/);
  assert.match(viewer, /customerBalanceCurrency=\\{String\\(mergedBusiness\\.base_currency_code\\|\\|mergedBusiness\\.currency_code\\|\\|'INR'\\)\\}/);
  assert.match(viewer, /money\\(customerBalance,ledgerCurrency\\)/);
  assert.match(receiptPdf, /fn_get_customer_outstanding_balance/);
  assert.match(receiptPdf, /base_currency_code: string \\| null/);
  assert.match(receiptPdf, /money\\(data\\.customer_outstanding, ledgerCurrency\\)/);
  assert.match(receiptPdf, /Linked invoice balance/);
  assert.match(publicTokens, /customerOutstandingCurrencyCode/);
  assert.match(publicReceipt, /money\\(outstanding,ledgerCurrency\\)/);
  assert.match(printCompliance, /Current customer ledger balance/);
  assert.match(printCompliance, /currency, maximumFractionDigits: 2/);
});
