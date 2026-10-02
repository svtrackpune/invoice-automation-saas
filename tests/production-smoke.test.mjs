import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';

const url = process.env.E2E_SUPABASE_URL;
const anonKey = process.env.E2E_SUPABASE_ANON_KEY;
const email = process.env.E2E_USER_EMAIL;
const password = process.env.E2E_USER_PASSWORD;
const businessId = process.env.E2E_BUSINESS_ID;
const productId = process.env.E2E_PRODUCT_ID;
const cashAccountId = process.env.E2E_CASH_ACCOUNT_ID;
const secondEmail = process.env.E2E_SECOND_USER_EMAIL;
const secondPassword = process.env.E2E_SECOND_USER_PASSWORD;
const secondBusinessId = process.env.E2E_SECOND_BUSINESS_ID;

const configured = Boolean(
  url && anonKey && email && password && businessId && productId && cashAccountId
);

function requireConfigured() {
  assert.ok(configured, 'E2E staging secrets/fixture IDs are not configured');
}

async function signIn(client, userEmail, userPassword) {
  const { data, error } = await client.auth.signInWithPassword({
    email: userEmail,
    password: userPassword,
  });
  assert.ifError(error);
  assert.ok(data.session, 'authenticated E2E user must receive a session');
  return data.session;
}

test('authenticated user resolves exactly the configured business context', async () => {
  requireConfigured();
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  await signIn(client, email, password);
  const { data, error } = await client.rpc('get_my_business_context');
  assert.ifError(error);
  assert.ok((data ?? []).some((row) => row.business_id === businessId),
    'configured business must belong to the authenticated user');
});

test('authenticated Cash Bill creation is atomic and produces one paid payment and receipt', async () => {
  requireConfigured();
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  await signIn(client, email, password);

  const { data: product, error: productError } = await client
    .from('products_services')
    .select('id,name,sales_price,default_tax_rate_id,inventory_tracked')
    .eq('business_id', businessId)
    .eq('id', productId)
    .eq('is_active', true)
    .single();
  assert.ifError(productError);
  assert.equal(product.id, productId);
  assert.equal(product.inventory_tracked, false,
    'production smoke fixture must use a non-inventory product/service');

  const billDate = new Date().toISOString().slice(0, 10);
  const unitPrice = Math.max(Number(product.sales_price || 0), 1);

  const { data: invoiceId, error } = await client.rpc('create_cash_bill', {
    p_business_id: businessId,
    p_phone: '',
    p_invoice_date: billDate,
    p_items: [{
      product_service_id: product.id,
      quantity: 1,
      unit_price: unitPrice,
      tax_rate_id: '',
    }],
    p_payment_method: 'cash',
    p_account_id: cashAccountId,
    p_invoice_discount_type: null,
    p_invoice_discount_value: 0,
    p_notes: 'PRODUCTION E2E — disposable staging transaction',
    p_terms: 'Paid in full at counter.',
  });
  assert.ifError(error);
  assert.ok(invoiceId);

  const { data: invoice, error: invoiceError } = await client
    .from('invoices')
    .select('id,business_id,document_kind,total,amount_paid,balance_due,status,customer_id,invoice_date,due_date')
    .eq('business_id', businessId)
    .eq('id', invoiceId)
    .single();
  assert.ifError(invoiceError);
  assert.equal(invoice.document_kind, 'cash_bill');
  assert.equal(Number(invoice.amount_paid), Number(invoice.total));
  assert.equal(Number(invoice.balance_due), 0);
  assert.equal(invoice.status, 'paid');

  const { data: payments, error: paymentError } = await client
    .from('payments')
    .select('id,amount,method,account_id,direction')
    .eq('business_id', businessId)
    .eq('invoice_id', invoiceId)
    .eq('direction', 'inbound');
  assert.ifError(paymentError);
  assert.equal(payments?.length, 1);
  assert.equal(Number(payments[0].amount), Number(invoice.total));
  assert.equal(payments[0].account_id, cashAccountId);

  const { data: receipts, error: receiptError } = await client
    .from('receipts')
    .select('id,payment_id,amount')
    .eq('business_id', businessId)
    .eq('payment_id', payments[0].id);
  assert.ifError(receiptError);
  assert.equal(receipts?.length, 1);
  assert.equal(Number(receipts[0].amount), Number(invoice.total));

  // Correction path: change only the unit price by ₹1 and require the authoritative
  // Cash Bill workflow to update the document and its single settlement together.
  const correctedPrice = unitPrice + 1;
  const { error: correctionError } = await client.rpc('update_cash_bill_any_state', {
    p_invoice_id: invoice.id,
    p_customer_id: invoice.customer_id,
    p_invoice_date: invoice.invoice_date,
    p_due_date: invoice.due_date,
    p_items: [{
      product_service_id: product.id,
      quantity: 1,
      unit_price: correctedPrice,
      tax_rate_id: '',
    }],
    p_invoice_discount_type: null,
    p_invoice_discount_value: 0,
    p_notes: 'PRODUCTION E2E — corrected staging transaction',
    p_terms: 'Paid in full at counter.',
    p_template_id: null,
    p_delivery_date: null,
    p_location_id: null,
    p_payment_method: 'cash',
    p_payment_account_id: cashAccountId,
    p_payment_amount: correctedPrice,
    p_payment_reference: null,
    p_payment_date: billDate,
  });
  assert.ifError(correctionError);

  const { data: corrected, error: correctedError } = await client
    .from('invoices')
    .select('total,amount_paid,balance_due,status,document_kind')
    .eq('business_id', businessId)
    .eq('id', invoice.id)
    .single();
  assert.ifError(correctedError);
  assert.equal(corrected.document_kind, 'cash_bill');
  assert.equal(Number(corrected.total), correctedPrice);
  assert.equal(Number(corrected.amount_paid), correctedPrice);
  assert.equal(Number(corrected.balance_due), 0);
  assert.equal(corrected.status, 'paid');

  const { data: correctedPayments, error: correctedPaymentsError } = await client
    .from('payments')
    .select('id,amount,account_id')
    .eq('business_id', businessId)
    .eq('invoice_id', invoice.id)
    .eq('direction', 'inbound');
  assert.ifError(correctedPaymentsError);
  assert.equal(correctedPayments?.length, 1);
  assert.equal(Number(correctedPayments[0].amount), correctedPrice);
  assert.equal(correctedPayments[0].account_id, cashAccountId);
});

test('cross-business access is denied when a second authenticated tenant is configured', { skip: !(configured && secondEmail && secondPassword && secondBusinessId) }, async () => {
  requireConfigured();
  const ownerClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  await signIn(ownerClient, email, password);
  const { data: ownerInvoices, error: ownerError } = await ownerClient
    .from('invoices')
    .select('id')
    .eq('business_id', businessId)
    .limit(1);
  assert.ifError(ownerError);
  assert.ok(ownerInvoices?.length, 'owner fixture must contain at least one invoice');

  const otherClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  await signIn(otherClient, secondEmail, secondPassword);
  const { data: crossRows, error } = await otherClient
    .from('invoices')
    .select('id,business_id')
    .eq('id', ownerInvoices[0].id);
  assert.ifError(error);
  assert.equal(crossRows?.length, 0, 'RLS must hide another business invoice');
});
