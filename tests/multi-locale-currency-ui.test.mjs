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

test('transaction-currency selectors require manual repricing and preserve currency across posting paths', async () => {
  const [sales, procurement, quotation, billDetail, translations] = await Promise.all([
    read('app/next-workspace/sales/SalesWorkflow.tsx'),
    read('app/next-workspace/purchases/new/page.tsx'),
    read('app/next-workspace/quotation/QuotationEditorCore.tsx'),
    read('app/next-workspace/purchases/[id]/page.tsx'),
    read('lib/translations.ts'),
  ]);
  assert.match(sales, /getCurrencyOptions\(locale\)/);
  assert.match(sales, /set_draft_invoice_currency/);
  assert.match(sales, /p_currency_code:created\.currency_code\|\|transactionCurrency/);
  assert.match(sales, /unit_price:0/);
  assert.match(procurement, /getCurrencyOptions\(locale\)/);
  assert.match(procurement, /p_currency_code:transactionCurrency/);
  assert.match(procurement, /disabled=\{Boolean\(editId\)\}/);
  assert.match(procurement, /unit_price:0,discount:0/);
  assert.match(procurement, /post_error=\$\{encodeURIComponent\(pe\.message\|\|'Posting failed'\)\}/);
  assert.match(billDetail, /p_currency_code:bill\.currency_code\|\|ctx\.currency_code\|\|'INR'/);
  assert.match(billDetail, /Bill saved as draft; posting was blocked/);
  assert.match(quotation, /getCurrencyOptions\(locale\)/);
  assert.match(quotation, /set_draft_quotation_currency/);
  assert.match(quotation, /currencyCode:quote\.currency_code\|\|ctx\?\.currency_code\|\|'INR'/);
  assert.match(quotation, /unit_price:0,discount_value:0/);
  assert.match(translations, /'Transaction currency':/);
  assert.match(translations, /'Currency changed\. Re-enter unit prices in the selected currency; product prices are not automatically converted\.'/);
});

test('Hindi translation catalog does not contain accidentally localized Spanish payment labels', async () => {
  const source = await read('lib/translations.ts');
  const start = source.indexOf("  'hi-IN': {");
  const end = source.indexOf("  'mr-IN': {", start);
  const hindi = source.slice(start, end);
  assert.match(hindi, /'Show': 'दिखाएँ'/);
  assert.match(hindi, /'Received': 'प्राप्त'/);
  assert.match(hindi, /'No payments found': 'कोई भुगतान नहीं मिला'/);
  assert.match(hindi, /'Bills & Procurement': 'बिल और खरीद'/);
  assert.doesNotMatch(hindi, /'Show': 'Mostrar'/);
  assert.doesNotMatch(hindi, /'Received': 'Recibido'/);
});

test('document library displays each invoice, quotation, and receipt in its stored transaction currency', async () => {
  const library = await read('app/next-workspace/documents/library/page.tsx');
  assert.match(library, /type Row = \{[^}]*currencyCode: string/);
  assert.match(library, /invoices'\)\.select\('id,invoice_number,invoice_date,status,total,balance_due,customer_id,currency_code'\)/);
  assert.match(library, /quotations'\)\.select\('id,quotation_number,quotation_date,status,total,customer_id,currency_code'\)/);
  assert.match(library, /receipts'\)\.select\('id,receipt_number,receipt_date,amount,payment_method,customer_id,currency_code'\)/);
  assert.match(library, /currencyCode:String\(x\.currency_code\|\|business\.currency_code\|\|'INR'\)/);
  assert.match(library, /money\(row\.amount,row\.currencyCode\)/);
  assert.match(library, /sortBy==='amount'\?\(a\.currencyCode\.localeCompare\(b\.currencyCode\)\|\|Number\(a\.amount\)-Number\(b\.amount\)\)/);
});

test('operational reports use one explicitly selected transaction currency per run', async () => {
  const [report, definitions] = await Promise.all([
    read('app/next-workspace/reports/ReportViewerControlled.tsx'),
    read('lib/reports/report-definitions.ts'),
  ]);
  assert.match(report, /const\[ctx,setCtx\][\s\S]*?\[currencyCode,setCurrencyCode\]=useState\('INR'\)/);
  assert.match(report, /value=\{currencyCode\} onChange=\{e=>\{setCurrencyCode\(e\.target\.value\);setCollapsed\(\{\}\)\}\}/);
  assert.match(report, /fetchRows\(template,business\.business_id,from,to,currencyCode\)/);
  assert.match(report, /\},\[p\.reportId,from,to,currencyCode\]\)/);
  assert.match(report, /invoices\.filter\(i=>i\.currency_code===currency\)/);
  assert.match(report, /payments\.filter\(x=>x\.currency_code===currency/);
  assert.match(report, /inv\.currency_code!==currency/);
  assert.match(report, /Transaction currency: \{currencyCode\}/);
  assert.match(definitions, /aggregateRows\(template:ReportTemplate,rows:ReportDataRow\[\],_currency:string\)/);
});
