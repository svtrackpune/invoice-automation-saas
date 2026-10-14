import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('all current customer-ledger displays share posted base-currency outstanding rules', async () => {
  const migration = await read('supabase/migrations/20261014081007_customer_ledger_balance_consistency.sql');
  const viewer = await read('app/next-workspace/documents/DocumentViewer.tsx');
  const receiptPdf = await read('lib/server/receipt-pdf.ts');
  const publicTokens = await read('lib/server/documents/public-tokens.ts');
  const publicReceipt = await read('app/receipt/[token]/page.tsx');
  const printCompliance = await read('components/documents/PrintCompliance.tsx');

  assert.ok(migration.includes('CREATE OR REPLACE FUNCTION public.fn_get_customer_outstanding_balance'));
  assert.ok(migration.includes("i.status::text NOT IN ('draft', 'void', 'cancelled')"));
  assert.ok(migration.includes('upper(i.currency_code::text) = upper(b.base_currency_code::text)'));
  assert.ok(migration.includes('CREATE OR REPLACE VIEW public.customer_balances'));
  assert.ok(migration.includes('WITH (security_invoker = true)'));
  assert.ok(migration.includes('upper(i.currency_code::text) = upper(bus.base_currency_code::text)'));

  assert.ok(viewer.includes('currency_code,base_currency_code,address'));
  assert.ok(viewer.includes("customerBalanceCurrency={String(mergedBusiness.base_currency_code||mergedBusiness.currency_code||'INR')}"));
  assert.ok(viewer.includes('money(customerBalance,ledgerCurrency)'));
  assert.ok(receiptPdf.includes("rpc('fn_get_customer_outstanding_balance'"));
  assert.ok(receiptPdf.includes('base_currency_code: string | null'));
  assert.ok(receiptPdf.includes('money(data.customer_outstanding, ledgerCurrency)'));
  assert.ok(receiptPdf.includes('Current customer ledger balance'));
  assert.doesNotMatch(receiptPdf, /Linked invoice balance/);
  assert.equal((receiptPdf.match(/Current customer ledger balance/g) || []).length, 1);
  assert.ok(publicTokens.includes('customerOutstandingCurrencyCode'));
  assert.ok(publicReceipt.includes('money(outstanding,ledgerCurrency)'));
  assert.ok(viewer.includes('Current customer ledger balance'));
  assert.ok(publicReceipt.includes('Customer Ledger Balance'));
  assert.doesNotMatch(printCompliance, /Received with thanks from/);
  assert.doesNotMatch(printCompliance, /Current customer ledger balance/);
});
