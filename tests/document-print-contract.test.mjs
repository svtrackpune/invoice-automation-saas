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
    'PAID IN FULL','Thank You — Visit Again','Number of Packages',
  ]) assert.ok(compliance.includes(marker) || viewer.includes(marker), marker);
});

test('receipt PDF carries allocation and ledger acknowledgement data',()=>{
  assert.match(receiptPdf,/payment_allocations/);
  assert.match(receiptPdf,/This is a computer-generated payment receipt and does not require signature\./);
  assert.match(receiptPdf,/customer_outstanding/);
  assert.match(receiptPdf,/Received with thanks from/);
  assert.match(receiptPdf,/Invoice Allocation/);
});


test('receipt and POS print helpers use a consistent 80mm width',()=>{
  assert.match(viewer,/receipt \? '80mm'/);
  assert.match(viewer,/\.receipt-paper\{width:80mm/);
  assert.match(viewer,/\.receipt-paper\{width:80mm!important;min-width:80mm!important;max-width:80mm!important/);
  assert.doesNotMatch(viewer,/2\.5in|79mm/);
});

test('workspace invoice blueprint puts payment before terms and always renders ship-to fallback',()=>{
  const gridStart=viewer.indexOf("<div className='post-table-grid'>");
  const gridEnd=viewer.indexOf('{showSignature&&',gridStart);
  const grid=viewer.slice(gridStart,gridEnd);
  assert.ok(grid.indexOf('<PaymentSection')>=0 && grid.indexOf('<PaymentSection')<grid.indexOf('document-terms'));
  assert.ok(grid.indexOf('document-terms')<grid.indexOf('document-notes'));
  assert.match(viewer,/const showShipTo=type==='invoice'\|\|taxInvoice\|\|type==='quotation'/);
  assert.match(viewer,/Same as billing address/);
  assert.match(viewer,/color:"#ea580c"/);
});
