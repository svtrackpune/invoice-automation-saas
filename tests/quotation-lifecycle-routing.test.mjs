import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('quotation navigation opens the business-scoped list, not the create form', async () => {
  const layout = await read('app/next-workspace/layout.tsx');
  const sales = await read('app/next-workspace/sales/page.tsx');
  const list = await read('app/next-workspace/quotations/page.tsx');
  const creator = await read('app/next-workspace/quotation/page.tsx');
  const globalSearch = await read('app/next-workspace/GlobalSearch.tsx');
  const businessAdapter = await read('lib/business-adaptation.ts');
  assert.ok(layout.includes("label: 'Quotations', href: '/next-workspace/quotations'"));
  assert.ok(sales.includes("href: '/next-workspace/quotations'"));
  assert.ok(globalSearch.includes("title: 'Estimates', subtitle: 'Search and manage quotations', kind: 'navigation', href: '/next-workspace/quotations'"));
  assert.ok(businessAdapter.includes("estimates: { module: 'estimates', label: 'Estimates', href: '/next-workspace/quotations' }"));
  assert.ok(list.includes(".from('quotations')"));
  assert.ok(list.includes(".eq('business_id', context.business_id)"));
  for (const column of ['Quotation No.', 'Customer', 'Date', 'Total Amount', 'Status', 'Download PDF', 'Share']) {
    assert.ok(list.includes(column), 'quotation list is missing ' + column);
  }
  assert.ok(list.includes("+ New Quotation"));
  assert.ok(creator.includes('<QuotationEditorCore />'));
});

test('quotation public PDFs accept quote alias and converted quotes while sent quotes still expire', async () => {
  const route = await read('app/api/public-documents/pdf/route.ts');
  const tokens = await read('lib/server/documents/public-tokens.ts');
  const pdf = await read('lib/server/documents/public-pdf.ts');
  assert.ok(route.includes("requestedType === 'quote' ? 'quotation' : requestedType"));
  assert.ok(tokens.includes("return ['sent', 'accepted', 'converted'].includes(s);"));
  assert.ok(tokens.includes('Expiry blocks acceptance, not access to the already-shared quotation document.'));
  assert.ok(pdf.includes("if (doc.bankDetails || qrData)"), 'non-invoice PDFs should only draw a settlement block when a bank or QR rail exists');
  assert.ok(pdf.includes('QRCode.create(qrData'));
});

test('quotation correction modal renders editor core and calls back on successful save', async () => {
  const modal = await read('app/next-workspace/quotation/QuotationEditModal.tsx');
  const core = await read('app/next-workspace/quotation/QuotationEditorCore.tsx');
  assert.ok(modal.includes("import QuotationEditorCore from './QuotationEditorCore'"));
  assert.ok(modal.includes('window.location.assign(`/next-workspace/documents?type=quotation&id=${encodeURIComponent(quotationId)}`)'));
  assert.ok(!modal.includes('<iframe'));
  assert.ok(core.includes('onSaved?: () => void'));
  assert.ok(core.includes('if(onSaved)onSaved()'));
});

test('public quotation acceptance goes through the atomic RPC and retains expiry guard', async () => {
  const page = await read('app/quote/[token]/page.tsx');
  const migration = await read('supabase/migrations/20261012165000_quotation_public_acceptance_and_payment_remediation.sql');
  const live = await read('supabase/migrations/20261011193409_public_quotation_acceptance_and_invoice_dispatch.sql');
  assert.ok(page.includes("rpc('rpc_accept_public_quotation'"));
  assert.ok(page.includes('Please contact the business to extend its validity'));
  assert.ok(migration.includes('public.accept_public_quotation(btrim(p_token))'));
  assert.ok(live.includes("IF q.status = 'sent' AND q.valid_until IS NOT NULL AND q.valid_until < current_date THEN"));
});

test('public and PDF quotation payment parity sources include configured bank and UPI settings', async () => {
  const migration = await read('supabase/migrations/20261012165000_quotation_public_acceptance_and_payment_remediation.sql');
  const page = await read('app/quote/[token]/page.tsx');
  const tokens = await read('lib/server/documents/public-tokens.ts');
  const viewModel = await read('lib/shared/document-view-model.ts');
  assert.ok(migration.includes("'payment_qr_enabled', coalesce(dps.payment_qr_enabled, true)"));
  assert.ok(migration.includes("'account_number', quote_bank.account_number"));
  assert.ok(page.includes('QRCode.toDataURL'));
  assert.ok(page.includes('canonical.business.bankDetails.bankName'));
  assert.ok(tokens.includes("type === 'invoice' || type === 'quotation'"));
  assert.ok(tokens.includes("from('business_document_bank_accounts')"));
  assert.ok(viewModel.includes("['invoice', 'quotation'].includes(documentType)"));
});
