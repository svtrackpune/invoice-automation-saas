import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL('../' + path, import.meta.url), 'utf8');
const migrationPath = 'supabase/migrations/20261018140000_fx_rate_driven_document_posting.sql';

test('FX resolver is dated, business scoped, directional and fails closed', async () => {
  const sql = await read(migrationPath);
  const resolver = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION mm_private.resolve_business_fx_rate'), sql.indexOf('-- Rate rows become immutable'));
  assert.match(sql, /Rate convention: 1 unit of transaction currency = rate units of the business base currency/);
  assert.match(resolver, /IF v_currency=v_base THEN[\s\S]*?SELECT 1::numeric,'BASE_DOMESTIC'/);
  assert.match(resolver, /fr\.business_id=p_business_id/);
  assert.match(resolver, /upper\(fr\.currency_code\)=v_currency/);
  assert.match(resolver, /upper\(fr\.base_currency_code\)=v_base/);
  assert.match(resolver, /fr\.rate_date<=p_rate_date/);
  assert.match(resolver, /ORDER BY fr\.rate_date DESC,fr\.created_at DESC,fr\.id DESC/);
  assert.match(resolver, /IF NOT FOUND THEN[\s\S]*?No FX rate is configured/);
  assert.match(resolver, /REVOKE ALL ON FUNCTION mm_private\.resolve_business_fx_rate\(uuid,text,text,date\) FROM PUBLIC,anon,authenticated/);
});

test('invoice and supplier-bill posting snapshot FX metadata and base-currency amounts', async () => {
  const sql = await read(migrationPath);
  const invoice = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.post_invoice'), sql.indexOf('CREATE OR REPLACE FUNCTION public.post_bill_legacy'));
  const bill = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.post_bill_legacy'), sql.indexOf('CREATE OR REPLACE FUNCTION public.record_customer_payment'));
  for (const [name, fn] of [['invoice', invoice], ['bill', bill]]) {
    assert.ok(fn.includes('mm_private.resolve_business_fx_rate'), name + ' resolves a dated rate');
    assert.ok(fn.includes('exchange_rate_source'), name + ' stores the rate source');
    assert.ok(fn.includes('exchange_rate_timestamp'), name + ' stores the rate effective date');
    assert.ok(fn.includes('transaction_currency_code'), name + ' stores transaction currency');
    assert.ok(fn.includes('base_currency_code,base_amount'), name + ' stores base amounts');
    assert.match(fn, /total_debit\s*=\s*\(select coalesce\(sum\(base_amount\),0\)/i, name + ' stores base-currency debit total');
    assert.match(fn, /total_credit\s*=\s*\(select coalesce\(sum\(base_amount\),0\)/i, name + ' stores base-currency credit total');
  }
  assert.match(bill, /coalesce\(\(v_base\*v_fx_rate\)\/nullif\(v_line\.quantity,0\),v_line\.purchase_price,0\)/);
  assert.match(invoice, /v_entry,v_cogs,'Cost of goods sold',v_cogs_total,0,v_base_currency/);
  assert.match(invoice, /v_entry,v_inventory,'Inventory asset reduction',0,v_cogs_total,v_base_currency/);
});

test('customer settlement uses invoice booking rate and balances realized FX in base currency', async () => {
  const sql = await read(migrationPath);
  const customer = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.record_customer_payment'), sql.indexOf('CREATE OR REPLACE FUNCTION public.record_vendor_payment'));
  assert.match(customer, /Payment currency % must match invoice currency %/);
  assert.match(customer, /resolve_business_fx_rate\(p_business_id,v_transaction_currency,v_business_currency,p_payment_date\)/);
  assert.match(customer, /Original invoice FX booking rate is missing/);
  assert.match(customer, /exchange_rate_timestamp[\s\S]*?transaction_amount,base_currency_code,base_amount/);
  assert.match(customer, /Realized FX gain on customer settlement/);
  assert.match(customer, /Realized FX loss on customer settlement/);
  assert.match(customer, /Foreign-currency overpayments are disabled/);
  assert.match(customer, /round\(round\(v_allocated\*v_fx_rate,6\)-round\(v_allocated\*v_invoice_rate,6\),6\)/);
  assert.ok(customer.indexOf('Realized FX gain on customer settlement') < customer.indexOf("SET status='posted'"), 'FX gain line inserted before posting');
  assert.ok(customer.indexOf('Realized FX loss on customer settlement') < customer.indexOf("SET status='posted'"), 'FX loss line inserted before posting');
});

test('vendor settlement inserts all FX lines before posting and retains fail-closed overpayment guard', async () => {
  const sql = await read(migrationPath);
  const vendor = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.record_vendor_payment'), sql.lastIndexOf('COMMIT;'));
  assert.match(vendor, /Payment currency % must match bill currency %/);
  assert.match(vendor, /resolve_business_fx_rate\(p_business_id,v_transaction_currency,v_business_currency,p_payment_date\)/);
  assert.match(vendor, /Original purchase-bill FX booking rate is missing/);
  assert.match(vendor, /Foreign-currency overpayments are disabled/);
  assert.match(vendor, /round\(round\(least\(p_amount,v_remaining\)\*v_fx_rate,6\)-round\(least\(p_amount,v_remaining\)\*v_bill_rate,6\),6\)/);
  const fxLoss = vendor.indexOf('Realized FX loss on supplier settlement');
  const fxGain = vendor.indexOf('Realized FX gain on supplier settlement');
  const post = vendor.indexOf("SET status='posted',posted_at=now(),posted_by=auth.uid()");
  assert.ok(fxLoss >= 0 && fxLoss < post, 'supplier FX loss line inserted while journal is draft');
  assert.ok(fxGain >= 0 && fxGain < post, 'supplier FX gain line inserted while journal is draft');
  assert.ok(vendor.indexOf('UPDATE public.journal_entries\n SET total_debit=') < post, 'journal header totals set before posting');
  assert.ok(vendor.lastIndexOf('PERFORM public.validate_journal_entry_balance(v_entry)') > post, 'journal balanced after posting');
});

test('used rate rows are immutable after their effective-date snapshot appears in a journal', async () => {
  const sql = await read(migrationPath);
  const guard = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION mm_private.guard_used_fx_rate_mutation'), sql.indexOf('-- Seed realized FX gain/loss accounts'));
  assert.match(guard, /SECURITY DEFINER/);
  assert.match(guard, /SET search_path TO 'public','mm_private','pg_temp'/);
  assert.match(guard, /je\.business_id=OLD\.business_id/);
  assert.match(guard, /jl\.exchange_rate_timestamp=\(OLD\.rate_date::timestamp AT TIME ZONE 'UTC'\)/);
  assert.match(guard, /cannot be deleted/);
  assert.match(guard, /is immutable/);
  assert.match(guard, /BEFORE UPDATE OR DELETE ON public\.fx_rates/);
  assert.match(guard, /REVOKE ALL ON FUNCTION mm_private\.guard_used_fx_rate_mutation\(\) FROM PUBLIC,anon,authenticated/);
});

test('FX rate management is business scoped, requires a source and saves against the date/currency unique key', async () => {
  const page = await read('app/next-workspace/business-settings/page.tsx');
  assert.match(page, /from\('fx_rates'\)\.select\('id,rate_date,currency_code,base_currency_code,rate,source,created_at'\)\.eq\('business_id',active\.business_id\)/);
  assert.match(page, /from\('fx_rates'\)\.upsert/);
  assert.match(page, /onConflict:'business_id,rate_date,currency_code,base_currency_code'/);
  assert.match(page, /if\(!\/\^\[A-Z\]\{3\}\$\/\.test\(currency\)\)/);
  assert.match(page, /if\(!fxSource\.trim\(\)\)/);
  assert.match(page, /if\(!fxRateDate\|\|!Number\.isFinite\(rate\)\|\|rate<=0\)/);
  assert.match(page, /A missing rate blocks foreign-currency posting/);
  assert.match(page, /formatDate\(row\.rate_date,locale\)/);
});

test('used FX gain and loss accounts are seeded without modifying existing journal history', async () => {
  const sql = await read(migrationPath);
  assert.match(sql, /SELECT b\.id,'4050','Realized FX Gain','income','credit'/);
  assert.match(sql, /SELECT b\.id,'6050','Realized FX Loss','expense','debit'/);
  assert.match(sql, /ON CONFLICT \(business_id,code\) DO NOTHING/);
  const dataChangeSection = sql.slice(sql.indexOf('-- Seed realized FX gain/loss accounts'));
  assert.doesNotMatch(dataChangeSection, /UPDATE public\.journal_lines SET|DELETE FROM public\.journal_lines/);
});
test('LED-001 and the accounting reports compare/summarize multi-currency journals in base currency', async () => {
  const sql = await read(migrationPath);
  const balanceCheck = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.validate_journal_entry_balance'), sql.indexOf('CREATE OR REPLACE FUNCTION public.fn_validate_journal_entry_balance'));
  const deferredGuard = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.fn_validate_journal_entry_balance'), sql.indexOf('-- Seed realized FX gain/loss accounts'));
  assert.match(balanceCheck, /count\(DISTINCT transaction_currency_code\)/);
  assert.match(balanceCheck, /v_currency_count<=1 AND round\(v_transaction_debit,2\)<>round\(v_transaction_credit,2\)/);
  assert.match(balanceCheck, /round\(v_base_debit,2\)<>round\(v_base_credit,2\)/);
  assert.match(deferredGuard, /count\(DISTINCT transaction_currency_code\)/);
  assert.match(deferredGuard, /v_base_debit<>v_base_credit/);
  for (const fn of ['get_general_ledger','get_trial_balance','get_balance_sheet','get_profit_loss']) {
    const start = sql.indexOf('CREATE OR REPLACE FUNCTION public.' + fn + '(');
    assert.ok(start >= 0, fn + ' replacement is included');
    const next = sql.indexOf('CREATE OR REPLACE FUNCTION public.', start + 20);
    const body = sql.slice(start, next < 0 ? sql.length : next);
    assert.match(body, /jl\.base_amount/, fn + ' summarizes base-currency amounts');
    assert.match(body, /has_business_permission\(p_business_id,'accounting\.view'\)/, fn + ' keeps the accounting permission check');
  }
});

function migrationFunction(sql, name) {
  const start = sql.indexOf('CREATE OR REPLACE FUNCTION public.' + name + '(');
  assert.ok(start >= 0, name + ' definition exists in migration');
  const candidates = [
    sql.indexOf('CREATE OR REPLACE FUNCTION public.', start + 32),
    sql.indexOf('CREATE OR REPLACE FUNCTION mm_private.', start + 32),
  ].filter((index) => index >= 0);
  const end = candidates.length ? Math.min(...candidates) : sql.length;
  return sql.slice(start, end);
}

test('FX credit notes and supplier credits reverse source-booking rates and post draft-first', async () => {
  const sql = await read(migrationPath);
  const creditNote = migrationFunction(sql, 'post_credit_note');
  const vendorCredit = migrationFunction(sql, 'post_vendor_credit');
  assert.match(creditNote, /Source invoice booking FX rate is missing/);
  assert.match(creditNote, /exchange_rate_source[\s\S]*?transaction_currency_code/);
  const creditHeaderStart = creditNote.indexOf('INSERT INTO public.journal_entries');
  const creditHeaderEnd = creditNote.indexOf('RETURNING id INTO e', creditHeaderStart);
  assert.ok(creditHeaderStart >= 0 && creditHeaderEnd > creditHeaderStart);
  assert.match(creditNote.slice(creditHeaderStart, creditHeaderEnd), /'draft'/);
  assert.ok(creditNote.indexOf('INSERT INTO public.journal_lines') < creditNote.indexOf("SET status='posted'"));
  assert.match(creditNote, /total_debit=\(SELECT coalesce\(sum\(base_amount\),0\)/);
  assert.match(creditNote, /Inventory returned/);
  assert.match(creditNote, /v_base_currency,v_base_currency/);

  assert.match(vendorCredit, /Source purchase-bill booking FX rate is missing/);
  assert.match(vendorCredit, /Unlinked foreign-currency supplier credits are disabled/);
  assert.match(vendorCredit, /Foreign-currency supplier credits must not exceed the outstanding source bill/);
  assert.match(vendorCredit, /exchange_rate_source[\s\S]*?transaction_currency_code/);
  assert.match(vendorCredit, /'vendor_credit',n\.id,'draft'/);
  assert.ok(vendorCredit.indexOf('INSERT INTO public.journal_lines') < vendorCredit.indexOf("SET status='posted'"));
  assert.match(vendorCredit, /total_credit=\(SELECT coalesce\(sum\(base_amount\),0\)/);
});

test('draft currency setters validate state and quotation conversion preserves the selected currency', async () => {
  const sql = await read(migrationPath);
  const invoiceSetter = migrationFunction(sql, 'set_draft_invoice_currency');
  const quotationSetter = migrationFunction(sql, 'set_draft_quotation_currency');
  const conversion = migrationFunction(sql, 'convert_quotation_to_invoice');
  assert.match(invoiceSetter, /inv\.status<>'draft' OR inv\.journal_entry_id IS NOT NULL/);
  assert.match(invoiceSetter, /has_business_permission\(inv\.business_id,'sales\.create'\)/);
  assert.match(quotationSetter, /q\.status<>'draft' OR q\.invoice_id IS NOT NULL/);
  assert.match(quotationSetter, /has_business_permission\(q\.business_id,'sales\.create'\)/);
  assert.ok(invoiceSetter.includes("v_currency !~ '^[A-Z]{3}$'"));
  assert.ok(quotationSetter.includes("v_currency !~ '^[A-Z]{3}$'"));
  assert.match(conversion, /SET currency_code=upper\(q\.currency_code\)/);
});

test('financial corrections to posted foreign-currency invoices and bills fail closed', async () => {
  const sql = await read(migrationPath);
  const invoiceUpdate = migrationFunction(sql, 'update_invoice_any_state');
  const billUpdate = migrationFunction(sql, 'update_bill_any_state');
  assert.match(invoiceUpdate, /v_financial_change AND upper\(inv\.currency_code\) IS DISTINCT FROM upper\(/);
  assert.match(invoiceUpdate, /Financial corrections to foreign-currency invoices are disabled/);
  assert.ok(invoiceUpdate.indexOf('Financial corrections to foreign-currency invoices are disabled') < invoiceUpdate.indexOf('PERFORM public.reverse_journal_entry'));
  assert.match(billUpdate, /b\.journal_entry_id IS NOT NULL AND upper\(b\.currency_code\) IS DISTINCT FROM upper\(/);
  assert.match(billUpdate, /Corrections to posted foreign-currency purchase bills are disabled/);
  assert.ok(billUpdate.indexOf('Corrections to posted foreign-currency purchase bills are disabled') < billUpdate.indexOf('PERFORM public.reverse_journal_entry'));
});

test('invoice voids copy FX carrying values into a draft reversal and block unsettled chains', async () => {
  const sql = await read(migrationPath);
  const voidInvoice = migrationFunction(sql, 'void_invoice');
  assert.match(voidInvoice, /'invoice_void',inv\.id,'draft',NULL,NULL/);
  assert.match(voidInvoice, /transaction_currency_code,transaction_amount,base_currency_code,base_amount/);
  assert.match(voidInvoice, /exchange_rate,exchange_rate_source,exchange_rate_timestamp/);
  assert.match(voidInvoice, /SET total_debit=\(SELECT coalesce\(sum\(base_amount\),0\)/);
  assert.ok(voidInvoice.indexOf('INSERT INTO public.journal_lines') < voidInvoice.indexOf("SET status='posted'"));
  assert.match(voidInvoice, /An invoice with recorded customer payments cannot be voided directly/);
  assert.match(voidInvoice, /An invoice with posted credit notes cannot be voided directly/);
  assert.match(voidInvoice, /sale_reversal/);
});

test('FX-aware credit/refund/allocation/correction routes stay blocked where source carrying values are not tracked', async () => {
  const sql = await read(migrationPath);
  const customerApply = migrationFunction(sql, 'apply_customer_credit_to_invoice');
  const vendorApply = migrationFunction(sql, 'apply_vendor_credit_to_bill');
  const vendorAllocate = migrationFunction(sql, 'allocate_vendor_payment');
  const customerRefund = migrationFunction(sql, 'refund_customer_credit');
  const vendorRefund = migrationFunction(sql, 'receive_vendor_refund');
  const customerPaymentEdit = migrationFunction(sql, 'update_customer_payment');
  const vendorPaymentEdit = migrationFunction(sql, 'update_vendor_payment');
  assert.match(customerApply, /Applying foreign-currency customer credits is disabled/);
  assert.match(vendorApply, /Applying foreign-currency supplier credits is disabled/);
  assert.match(vendorAllocate, /Reallocating a foreign-currency supplier payment is disabled/);
  assert.match(customerRefund, /Foreign-currency customer-credit refunds are disabled/);
  assert.match(vendorRefund, /Foreign-currency supplier refunds are disabled/);
  assert.match(customerPaymentEdit, /Foreign-currency customer payment corrections are disabled/);
  assert.match(vendorPaymentEdit, /Foreign-currency supplier payment corrections are disabled/);
  assert.match(vendorRefund, /has_business_permission\(p_business_id,'payments\.receive'\)/);
  assert.match(customerRefund, /has_business_permission\(p_business_id,'payments\.receive'\)/);
});
