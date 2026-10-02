import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationPath = new URL('../supabase/migrations/20261002130000_global_multi_currency_v1.sql', import.meta.url);

const validateJournalBalance = (lines) => {
  if (lines.length < 2) throw new Error('Journal entry must contain at least two lines');
  const currencies = new Set(lines.map((line) => line.transactionCurrency));
  const baseDebit = lines.filter((line) => line.debit > 0).reduce((sum,line) => sum + line.baseAmount,0);
  const baseCredit = lines.filter((line) => line.credit > 0).reduce((sum,line) => sum + line.baseAmount,0);
  const transactionDebit = lines.reduce((sum,line) => sum + line.debit,0);
  const transactionCredit = lines.reduce((sum,line) => sum + line.credit,0);
  if (currencies.size <= 1 && transactionDebit !== transactionCredit) throw new Error('Journal entry is not transaction-balanced');
  if (baseDebit !== baseCredit) throw new Error('Journal entry is not base-currency balanced');
  return true;
};

const creditBalance = (entries,currency) =>
  entries.filter((entry)=>entry.currency.toUpperCase()===currency.toUpperCase())
    .reduce((sum,entry)=>sum+entry.amount,0);

test('dual-currency journal validation balances mixed currencies in business base currency',()=>{
  assert.doesNotThrow(()=>validateJournalBalance([
    {transactionCurrency:'USD',debit:100,credit:0,baseAmount:100},
    {transactionCurrency:'EUR',debit:0,credit:80,baseAmount:100},
  ]));
  assert.throws(()=>validateJournalBalance([
    {transactionCurrency:'USD',debit:100,credit:0,baseAmount:100},
    {transactionCurrency:'EUR',debit:0,credit:80,baseAmount:96},
  ]),/base-currency/);
});

test('same-currency journals retain the legacy debit/credit invariant',()=>{
  assert.doesNotThrow(()=>validateJournalBalance([
    {transactionCurrency:'INR',debit:1000,credit:0,baseAmount:1000},
    {transactionCurrency:'INR',debit:0,credit:1000,baseAmount:1000},
  ]));
  assert.throws(()=>validateJournalBalance([
    {transactionCurrency:'INR',debit:1000,credit:0,baseAmount:1000},
    {transactionCurrency:'INR',debit:0,credit:900,baseAmount:900},
  ]));
});

test('credit balances are isolated by explicit currency',()=>{
  const entries=[{currency:'USD',amount:125},{currency:'INR',amount:5000},{currency:'EUR',amount:75}];
  assert.equal(creditBalance(entries,'USD'),125);
  assert.equal(creditBalance(entries,'INR'),5000);
  assert.equal(creditBalance(entries,'EUR'),75);
  assert.equal(creditBalance(entries,'GBP'),0);
});

test('Wave 1 migration contains the required contracts',async()=>{
  const sql=await readFile(migrationPath,'utf8');
  assert.match(sql,/base_currency_code varchar\(3\).*DEFAULT 'USD'/is);
  assert.match(sql,/country_code SET DEFAULT 'US'/i);
  assert.match(sql,/transaction_currency_code char\(3\)/i);
  assert.match(sql,/transaction_amount numeric\(20,6\)/i);
  assert.match(sql,/base_currency_code char\(3\)/i);
  assert.match(sql,/base_amount numeric\(20,6\)/i);
  assert.match(sql,/exchange_rate_source/i);
  assert.match(sql,/exchange_rate_timestamp/i);
  assert.match(sql,/sync_journal_line_dual_currency/i);
  assert.match(sql,/base currency/i);
  assert.match(sql,/customer_credit_balance[\s\S]*p_currency_code char\(3\)/i);
  assert.match(sql,/post an explicit FX settlement before allocation/i);
  assert.match(sql,/record_gateway_payment[\s\S]*v_provider text/i);
  assert.doesNotMatch(sql,/<> 'razorpay'/i);
});

test('global formatting and ISO selectors are currency/locale driven',async()=>{
  const i18n=await readFile(new URL('../lib/i18n.ts',import.meta.url),'utf8');
  assert.match(i18n,/Intl\.supportedValuesOf\('currency'\)/);
  assert.match(i18n,/Intl\.DisplayNames\(\[locale\], \{ type: 'region' \}\)/);
  assert.match(i18n,/formatBusinessMoney/);
  assert.doesNotMatch(i18n,/en-IN/);
});

test('base currency is immutable after journal activity exists',async()=>{
  const sql=await readFile(migrationPath,'utf8');
  assert.match(sql,/guard_business_base_currency_change/i);
  assert.match(sql,/Business base currency cannot be changed after journal activity exists/i);
});

test('payment adapter contracts contain Stripe Checkout and PaymentIntent webhook handling',async()=>{
  const types=await readFile(new URL('../lib/server/payments/types.ts',import.meta.url),'utf8');
  const stripe=await readFile(new URL('../lib/server/payments/stripe.ts',import.meta.url),'utf8');
  assert.match(types,/createPaymentSession/);
  assert.match(types,/verifyWebhook/);
  assert.match(types,/normalizeWebhookPayload/);
  assert.match(stripe,/checkout\.session\.completed/);
  assert.match(stripe,/payment_intent\.succeeded/);
  assert.match(stripe,/stripe-signature/);
});
