import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL('../' + path, import.meta.url), 'utf8');

test('currency summary formatting groups amounts by ISO currency and labels mixed currencies', async () => {
  const i18n = await read('lib/i18n.ts');
  assert.match(i18n, /export function formatCurrencyTotals<T>/);
  assert.match(i18n, /const totals = new Map<string, number>\(\)/);
  assert.match(i18n, /totals\.set\(code, \(totals\.get\(code\) \?\? 0\) \+/);
  assert.match(i18n, /entries\.length === 1/);
  assert.match(i18n, /formatMoney\(amount, currency, locale, \{ displayCode: true \}\)/);
  assert.match(i18n, /function safeLocale/);
  assert.match(i18n, /COMMON_CURRENCY_CODES/);
});

test('invoice, procurement, payment, and receipt summaries do not sum mixed currencies', async () => {
  const [invoices, bills, payments, receipts] = await Promise.all([
    read('app/next-workspace/invoices/page.tsx'),
    read('app/next-workspace/bills/page.tsx'),
    read('app/next-workspace/payments/page.tsx'),
    read('app/next-workspace/receipts/page.tsx'),
  ]);
  assert.match(invoices, /formatCurrencyTotals\(rows, invoice => Number\(invoice\.total/);
  assert.match(invoices, /money\(invoice\.total, invoice\.currency_code, locale\)/);
  assert.match(invoices, /money\(invoice\.balance_due, invoice\.currency_code, locale\)/);
  assert.match(invoices, /String\(a\.currency_code \|\| 'INR'\)\.localeCompare/);
  assert.match(bills, /formatCurrencyTotals\(billRows/);
  assert.match(bills, /money\(tab==='pos'\?b\.total:b\.balance_due,b\.currency_code\|\|currencyCode,locale\)/);
  assert.match(payments, /formatCurrencyTotals\(inboundRows/);
  assert.match(payments, /formatCurrencyTotals\(outboundRows/);
  assert.match(payments, /formatCurrencyTotals\(rows,p=>p\.direction==='inbound'\?/);
  assert.match(payments, /money\(p\.amount,p\.currency_code,locale\)/);
  assert.match(receipts, /formatCurrencyTotals\(rows,row=>Number\(row\.amount\|\|0\),row=>receiptCurrency\(row\)/);
  assert.match(receipts, /select\('id,invoice_id,amount,reference,currency_code'\)/);
  assert.match(receipts, /currencyCode:row\?receiptCurrency\(row\):businessCurrency/);
  assert.match(receipts, /money\(r\.amount,receiptCurrency\(r\),locale\)/);
});

test('vendor payment allocation only offers posted bills with matching currency', async () => {
  const modal = await read('app/next-workspace/payments/VendorPaymentAllocationModal.tsx');
  assert.match(modal, /String\(b\.currency_code\|\|'INR'\)\.trim\(\)\.toUpperCase\(\)===String\(payment\.currency_code\|\|'INR'\)\.trim\(\)\.toUpperCase\(\)/);
  assert.match(modal, /money\(bill\.total,bill\.currency_code,locale\)/);
  assert.match(modal, /money\(bill\.balance_due,bill\.currency_code,locale\)/);
});

test('profile locale updates the active workspace and browser language/direction', async () => {
  const [profile, context, layout, translations] = await Promise.all([
    read('app/next-workspace/profile/page.tsx'),
    read('lib/locale-context.tsx'),
    read('app/next-workspace/layout.tsx'),
    read('lib/translations.ts'),
  ]);
  assert.match(profile, /select\('display_name,phone,locale,timezone'\)/);
  assert.match(profile, /moneymatters:locale-changed/);
  assert.match(context, /window\.addEventListener\('moneymatters:locale-changed'/);
  assert.match(context, /root\.lang = locale/);
  assert.match(context, /root\.dir = localeDirection\(locale\)/);
  assert.match(layout, /translate\(locale, item\.label\)/);
  assert.match(translations, /export function translate\(/);
  assert.match(translations, /export function translatedLocaleCoverage\(/);
  assert.match(translations, /return normalized\.startsWith\('en-'\) \|\| normalized\.startsWith\('mr-'\) \|\| normalized\.startsWith\('hi-'\)/);
});

test('translation catalogs contain no duplicate keys and unsupported locales are marked as English fallback', async () => {
  const source = await read('lib/translations.ts');
  function section(startText, endText) {
    const start = source.indexOf(startText);
    const end = source.indexOf(endText, start);
    assert.ok(start >= 0 && end > start, 'dictionary boundaries exist');
    return source.slice(start, end);
  }
  for (const [name, block] of [
    ['Hindi', section("  'hi-IN': {", "  'mr-IN': {")],
    ['Marathi', section("  'mr-IN': {", '\n};')],
  ]) {
    const keys = [...block.matchAll(/^\s*'((?:\\'|[^'])+)'\s*:/gm)].map((match) => match[1]);
    assert.equal(new Set(keys).size, keys.length, name + ' dictionary has duplicate keys');
  }
  assert.match(source, /'mr-IN': \{[\s\S]*?'Overview': 'आढावा'/);
  assert.match(source, /'hi-IN': \{[\s\S]*?'Overview': 'अवलोकन'/);
  assert.match(source, /normalized\.startsWith\('en-'\) \|\| normalized\.startsWith\('mr-'\) \|\| normalized\.startsWith\('hi-'\)/);
});

test('ISO date-only formatting is local-calendar safe', async () => {
  const i18n = await read('lib/i18n.ts');
  assert.match(i18n, /const match = value\.match\(\/\^\(\\d\{4\}\)-\(\\d\{2\}\)-\(\\d\{2\}\)\$\//);
  assert.match(i18n, /new Date\(Number\(match\[1\]\), Number\(match\[2\]\) - 1, Number\(match\[3\]\)\)/);
});
