import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanonicalDocumentViewModel, amountInWords, canonicalAddress } from '../lib/shared/document-view-model.ts';

test('canonical view model normalizes GST invoice data and produces a payable UPI intent', () => {
  const model = createCanonicalDocumentViewModel({
    invoice_number: 'INV-000018',
    invoice_date: '2026-10-12',
    due_date: '2026-10-19',
    status: 'partially_paid',
    currency_code: 'INR',
    subtotal: 200,
    discount_total: 10,
    tax_total: 34.2,
    cgst_amount: 17.1,
    sgst_amount: 17.1,
    total: 224.2,
    amount_paid: 98.8,
    balance_due: 125.4,
    business: {
      name: 'Sample Trade',
      legal_name: 'Sample Industries Private Limited',
      logo_storage_path: 'brand/logo.png',
      address: { line1: 'Main Road', city: 'Nilanga', state: 'Maharashtra', postal_code: '413521' },
      phone: '9999999999',
      email: 'billing@example.test',
      tax_registration_number: '27ABCDE1234F1Z5',
      pan: 'ABCDE1234F',
    },
    customer: {
      display_name: 'Buyer',
      legal_name: 'Buyer LLP',
      billing_address: { line1: 'Market Road', city: 'Latur', state: 'Maharashtra', postal_code: '413512' },
      shipping_address: { line1: 'Industrial Estate', city: 'Latur' },
      phone: '8888888888',
      email: 'buyer@example.test',
      tax_id: '27AACCE1234A1Z7',
    },
    bank: { institution_name: 'Sample Bank', account_number: '1234567890', ifsc_code: 'SBIN0001234', branch_name: 'Nilanga', upi_id: 'sample@upi' },
    items: [
      { description: 'Industrial Equipment', hsn_sac: '8479', quantity: 2, unit_price: 100, discount: 10, tax_rate: 18, tax_amount: 34.2, line_total: 224.2 },
    ],
  }, { type: 'invoice', publicUrl: 'https://mm.nilanga.in/invoice/token', upiId: 'sample@upi' });

  assert.equal(model.document.type, 'invoice');
  assert.equal(model.document.number, 'INV-000018');
  assert.equal(model.document.publicUrl, 'https://mm.nilanga.in/invoice/token');
  assert.equal(model.business.legalName, 'Sample Industries Private Limited');
  assert.equal(model.business.tradeName, 'Sample Trade');
  assert.equal(model.business.gstin, '27ABCDE1234F1Z5');
  assert.equal(model.customer.name, 'Buyer LLP');
  assert.equal(model.customer.shippingAddress, 'Industrial Estate, Latur');
  assert.equal(model.items[0].hsn, '8479');
  assert.equal(model.items[0].amount, 224.2);
  assert.deepEqual(model.financials.taxBreakdown.map(x => x.name), ['CGST', 'SGST']);
  assert.equal(model.financials.balanceDue, 125.4);
  assert.equal(model.financials.amountInWords, 'Two Hundred Twenty Four Indian Rupees and Twenty Paise Only');
  const qr = new URLSearchParams(model.financials.upiQrString.split('?')[1]);
  assert.equal(model.financials.upiQrString.startsWith('upi://pay?'), true);
  assert.equal(qr.get('pa'), 'sample@upi');
  assert.equal(qr.get('pn'), 'Sample Industries Private Limited');
  assert.equal(qr.get('am'), '125.40');
  assert.equal(qr.get('cu'), 'INR');
  assert.equal(qr.get('tn'), 'INV-000018');
});

test('canonical UPI intent is balance-aware for invoices and quotations and INR-only', () => {
  const base = {
    type: 'invoice', invoice_number: 'INV-1', currency_code: 'INR', total: 100, amount_paid: 100, balance_due: 0,
    business: { name: 'Sample', address: 'Main Road' }, customer: { display_name: 'Buyer' },
  };
  assert.equal(createCanonicalDocumentViewModel(base, { upiId: 'sample@upi' }).financials.upiQrString, undefined);
  const quote = createCanonicalDocumentViewModel({ ...base, type: 'quotation', quotation_number: 'EST-1', amount_paid: 0, balance_due: 100 }, { upiId: 'sample@upi' });
  assert.ok(quote.financials.upiQrString?.startsWith('upi://pay?'));
  assert.equal(new URLSearchParams(quote.financials.upiQrString.split('?')[1]).get('am'), '100.00');
  assert.equal(new URLSearchParams(quote.financials.upiQrString.split('?')[1]).get('tn'), 'EST-1');
  assert.equal(createCanonicalDocumentViewModel({ ...base, currency_code: 'USD', balance_due: 100 }, { upiId: 'sample@upi' }).financials.upiQrString, undefined);
});

test('canonical address and Indian currency words are deterministic', () => {
  assert.equal(canonicalAddress({ line1: 'Main Road', city: 'Nilanga', state: 'Maharashtra', postal_code: '413521' }), 'Main Road, Nilanga Maharashtra 413521');
  assert.equal(amountInWords(100000.5), 'One Lakh Indian Rupees and Fifty Paise Only');
});
