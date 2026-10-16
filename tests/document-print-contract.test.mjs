import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const viewer=readFileSync('app/next-workspace/documents/DocumentViewer.tsx','utf8');
const layout=readFileSync('app/layout.tsx','utf8');
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

test('receipt PDF carries allocation and ledger data without duplicate acknowledgement blocks',()=>{
  assert.match(receiptPdf,/payment_allocations/);
  assert.match(receiptPdf,/This is a computer-generated payment receipt and does not require signature\./);
  assert.match(viewer,/This is a computer-generated payment receipt and does not require signature\./);
  assert.match(viewer,/This is a computer-generated invoice and does not require signature\./);
  assert.match(viewer,/This is a computer-generated quotation and does not require signature\./);
  assert.match(viewer,/document-footer-disclaimer/);
  assert.match(viewer,/text-align:center/);
  assert.match(receiptPdf,/customer_outstanding/);
  assert.doesNotMatch(receiptPdf,/Received with thanks from/);
  assert.match(receiptPdf,/INVOICE ALLOCATION/);
  assert.match(receiptPdf,/Please retain this receipt for your records\./);
  assert.match(receiptPdf,/Current customer ledger balance/);
});


test('receipt and POS print helpers use a consistent 80mm width',()=>{
  assert.match(viewer,/receipt \? '80mm'/);
  assert.match(viewer,/\.receipt-paper\{width:80mm/);
  assert.match(viewer,/\.receipt-paper\{width:80mm!important;min-width:80mm!important;max-width:80mm!important/);
  assert.match(layout,/@page receipt \{ size: 80mm auto; margin: 0; \}/);
  assert.match(layout,/\.receipt-paper \{ width:80mm!important; max-width:80mm!important/);
  assert.doesNotMatch(viewer,/2\.5in|79mm/);
  assert.doesNotMatch(layout,/2\.5in/);
});

test('workspace invoice blueprint puts payment before terms and always renders ship-to fallback',()=>{
  const standardHeader=viewer.indexOf("<header className='document-header'>");
  const gridStart=viewer.indexOf("<div className='post-table-grid'>",standardHeader);
  const gridEnd=viewer.indexOf('{showSignature&&',gridStart);
  const grid=viewer.slice(gridStart,gridEnd);
  assert.ok(grid.indexOf('<PaymentSection')>=0 && grid.indexOf('<PaymentSection')<grid.indexOf('document-terms'));
  assert.ok(grid.indexOf('document-terms')<grid.indexOf('document-notes'));
  assert.match(viewer,/const showShipTo=type==='invoice'\|\|taxInvoice\|\|type==='quotation'/);
  assert.match(viewer,/Same as billing address/);
  assert.match(viewer,/color:"#ea580c"/);
  assert.match(viewer,/sales-document-standard/);
  assert.match(viewer,/\.sales-document-standard \.items thead,.sales-document-standard \.items th\{background:var\(--table\);color:#fff\}/);
  assert.match(viewer,/\.sales-document-standard \.items td\{border-bottom-color:var\(--line\)\}/);
});


test('saved invoice and quotation terms are reloaded for the viewer and public PDFs never truncate them',()=>{
  const viewer=readFileSync('app/next-workspace/documents/DocumentViewer.tsx','utf8');
  const pdf=readFileSync('lib/server/documents/public-pdf.ts','utf8');

  assert.match(viewer,/from\('invoices'\)[\s\S]*?select\('invoice_number,status,notes,terms,inventory_location_id,delivery_date,document_kind'\)/);
  assert.match(viewer,/source\.data\.terms \?\? ''/);
  assert.match(viewer,/from\('quotations'\)[\s\S]*?select\('quotation_number,status,notes,terms,valid_until'\)/);
  assert.match(viewer,/const shareActionsVisible = canSharePublicDocument\(type\)/);
  assert.match(viewer,/documentFilenameLabel\(type\)/);
  assert.match(pdf,/drawInvoiceInfoSection\('TERMS & CONDITIONS'/);
  assert.doesNotMatch(pdf,/wrap\(doc\.terms, 47\)\.slice/);
  assert.doesNotMatch(pdf,/lines\.slice\(0,6\)/);
});

test('saved invoice and quotation terms remain visible in document preview and official PDFs',()=>{
  const viewer=readFileSync('app/next-workspace/documents/DocumentViewer.tsx','utf8');
  const pdf=readFileSync('lib/server/documents/public-pdf.ts','utf8');
  assert.match(viewer,/source\.data\.terms \?\? ''/);
  assert.match(viewer,/documentFilenameLabel\(type\)/);
  assert.match(pdf,/drawInvoiceInfoSection\('TERMS & CONDITIONS'/);
  assert.doesNotMatch(pdf,/wrap\(doc\.terms, 47\)\.slice/);
  assert.doesNotMatch(pdf,/lines\.slice\(0,6\)/);
});
