import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const read = (file) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

test('public invoice and quotation use readable card layouts on narrow screens and retain desktop tables', () => {
  const invoice = read('app/invoice/[token]/page.tsx');
  const quote = read('app/quote/[token]/page.tsx');

  for (const [name, source, section] of [
    ['invoice', invoice, 'Invoice items'],
    ['quotation', quote, 'Quotation items'],
  ]) {
    assert.match(source, /overflow-x-hidden/, name + ' page should prevent body-level horizontal overflow');
    assert.match(source, /mx-auto w-full max-w-4xl min-w-0/, name + ' document shell must shrink to the viewport');
    assert.match(source, /hidden overflow-x-auto[^\n]*lg:block/, name + ' wide table must only return when there is enough desktop width');
    assert.match(source, new RegExp('aria-label="' + section + '"'), name + ' must expose a dedicated mobile item list');
    assert.match(source, /lg:hidden/, name + ' mobile cards must remain available on phones and small tablets');
    assert.match(source, /print:block print:overflow-visible/, name + ' full table must remain printable on a narrow device');
    assert.match(source, /print:hidden/, name + ' mobile cards should not duplicate the print table');
    for (const label of ['Quantity', 'Rate', 'Amount']) {
      assert.ok(source.includes('>' + label + '</'), name + ' mobile card missing label: ' + label);
    }
    assert.match(source, /Download Official PDF/, name + ' PDF download action must remain available');
  }
  assert.match(invoice, /Copy Invoice Link/);
  assert.match(quote, /Copy customer link/);
  assert.match(quote, /Accept Quotation & Request Invoice/);
  assert.match(quote, /flex flex-col gap-3 lg:flex-row lg:items-center/, 'quotation action buttons must stack until desktop width');
});

test('public receipt items and invoice allocations are readable without horizontal table scrolling on phones', () => {
  const receipt = read('app/receipt/[token]/page.tsx');
  assert.match(receipt, /overflow-x-hidden/);
  assert.match(receipt, /min-w-0 rounded-xl/);
  assert.equal((receipt.match(/hidden overflow-x-auto[^\n]*md:block/g) || []).length, 2, 'both receipt tables should remain hidden below tablet width');
  assert.equal((receipt.match(/md:hidden/g) || []).length >= 2, true, 'receipt item and allocation cards should be present on phones');
  assert.equal((receipt.match(/print:block print:overflow-visible/g) || []).length, 2, 'receipt tables must remain printable');
  assert.equal((receipt.match(/print:hidden/g) || []).length >= 2, true, 'receipt mobile cards should not duplicate print tables');
  for (const label of ['Quantity', 'Amount', 'Invoice Date:', 'Original Amount', 'Amount Applied']) {
    assert.ok(receipt.includes(label), 'receipt mobile content missing: ' + label);
  }
  assert.match(receipt, /Download Official PDF/);
});

test('both public delivery-challan URLs render responsive item cards while retaining the PDF action', () => {
  const challan = read('app/challan/[token]/page.tsx');
  const alternate = read('app/delivery-challan/[token]/page.tsx');
  for (const [name, source] of [['challan', challan], ['alternate challan', alternate]]) {
    assert.match(source, /overflow-x-hidden/);
    assert.match(source, /hidden overflow-x-auto[^\n]*sm:block/);
    assert.match(source, /aria-label="Delivery challan items"/);
    assert.match(source, /sm:hidden/);
    assert.match(source, /print:block print:overflow-visible/);
    assert.match(source, /print:hidden/);
    for (const label of ['Quantity', 'Rate', 'Amount']) {
      assert.ok(source.includes('>' + label + '</'), name + ' mobile card missing label: ' + label);
    }
    assert.match(source, /Download Official PDF/);
  }
  assert.equal(challan, alternate, 'canonical and alternate challan routes must not drift apart');
});
