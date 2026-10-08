import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const viewer=readFileSync('app/next-workspace/documents/DocumentViewer.tsx','utf8');
const compliance=readFileSync('components/documents/PrintCompliance.tsx','utf8');
const receiptPdf=readFileSync('lib/server/receipt-pdf.ts','utf8');

test('all seven document classes have explicit print contracts',()=>{
  for (const marker of [
    "type === 'tax_invoice'",
    "type === 'quotation'",
    "type === 'receipt'",
    "type === 'delivery_challan'",
    "type === 'purchase_order'",
    "type === 'credit_note'",
    "type === 'cash_bill'",
  ]) assert.ok(viewer.includes(marker), marker);
  for (const marker of [
    'TAX INVOICE','Original for Recipient','Reverse Charge','IRN',
    'PAYMENT RECEIPT / VOUCHER','Invoice Allocation',
    'Not a Tax Invoice','Receiver Signature',
    'formal procurement order subject to supplier acceptance',
    'Original Invoice Number','Section 34',
    'PAID IN FULL','Thank You — Visit Again',
  ]) assert.ok(compliance.includes(marker) || viewer.includes(marker), marker);
});

test('receipt PDF carries allocation and ledger acknowledgement data',()=>{
  assert.match(receiptPdf,/payment_allocations/);
  assert.match(receiptPdf,/customer_outstanding/);
  assert.match(receiptPdf,/Received with thanks from/);
  assert.match(receiptPdf,/Invoice Allocation/);
});
