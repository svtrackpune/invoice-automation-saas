import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('new invoices receive editable, professional notes and payment terms', async () => {
  const source = await read('app/next-workspace/invoices/InvoiceEditorCore.tsx');

  assert.ok(source.includes("DEFAULT_INVOICE_NOTES='Thank you for your business."));
  assert.ok(source.includes("DEFAULT_INVOICE_TERMS='Payment is due on or before the due date shown on this invoice."));
  assert.ok(source.includes("Please notify us of any discrepancy within 7 days of the invoice date."));
  assert.ok(source.includes("d.invoice_notes?.trim()||(cashBillDocument?'':DEFAULT_INVOICE_NOTES)"));
  assert.ok(source.includes("d.default_payment_terms?.trim()||(cashBillDocument?'':DEFAULT_INVOICE_TERMS)"));
  assert.ok(source.includes('<Field label="Notes" wide><MMFormTextareaControl rows={3} value={notes} onChange={e=>setNotes(e.target.value)}'));
  assert.ok(source.includes('<Field label="Payment terms" wide><MMFormTextareaControl rows={4} value={terms} onChange={e=>setTerms(e.target.value)}'));
  assert.ok(source.includes('notes:notes||null,terms:terms||null'));
  assert.ok(source.includes('p_notes:notes||null,p_terms:terms||null'));
});

test('invoice corrections preserve the existing notes and terms without applying defaults retroactively', async () => {
  const source = await read('app/next-workspace/invoices/InvoiceEditorCore.tsx');

  assert.ok(source.includes("setNotes(ir.data.notes??'');setTerms(ir.data.terms??'');"));
});

test('new quotations receive editable, professional notes and terms', async () => {
  const source = await read('app/next-workspace/quotation/QuotationEditorCore.tsx');

  assert.ok(source.includes("DEFAULT_QUOTATION_NOTES='Thank you for the opportunity to quote."));
  assert.ok(source.includes("DEFAULT_QUOTATION_TERMS='This quotation is valid until the date shown on the document."));
  assert.ok(source.includes('Prices and availability are subject to confirmation when the order is placed.'));
  assert.ok(source.includes("[note,setNote]=useState(DEFAULT_QUOTATION_NOTES),[terms,setTerms]=useState(DEFAULT_QUOTATION_TERMS)"));
  assert.ok(source.includes('<Field label="Notes"><Textarea value={note} onChange={e=>setNote(e.target.value)} placeholder="Optional notes" />'));
  assert.ok(source.includes('<Field label="Terms & conditions"><Textarea value={terms} onChange={e=>setTerms(e.target.value)} />'));
  assert.ok(source.includes('p_notes:note||null,p_terms:terms||null'));
  assert.ok(source.includes('setNote(DEFAULT_QUOTATION_NOTES);setTerms(DEFAULT_QUOTATION_TERMS)'));
});

test('quotation corrections preserve saved text, including intentionally blank fields', async () => {
  const source = await read('app/next-workspace/quotation/QuotationEditorCore.tsx');

  assert.ok(source.includes("setNote(q.data.notes??'');setTerms(q.data.terms??'');"));
});
