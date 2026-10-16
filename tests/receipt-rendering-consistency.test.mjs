import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('workspace receipt print uses the receipt row and allocation-linked invoice items', async () => {
  const viewer = await read('app/next-workspace/documents/DocumentViewer.tsx');

  assert.ok(viewer.includes("if (type === 'receipt' && businessId)"));
  const paperStart = viewer.indexOf('function Paper(');
  const paperEnd = viewer.indexOf('export default function DocumentViewer(', paperStart);
  assert.ok(paperStart >= 0 && paperEnd > paperStart, 'Paper component boundaries must be discoverable');
  const paper = viewer.slice(paperStart, paperEnd);
  assert.match(paper, /payload\.amount_in_words/, 'receipt amount words must come from the canonical payload');
  assert.doesNotMatch(paper, /canonical\.financials/, 'Paper must not reference the parent-only canonical variable');
  assert.ok(viewer.includes(".from('receipts')"));
  assert.ok(viewer.includes("select('receipt_number,receipt_date,amount,currency_code,payment_method,reference_number,payment_id')"));
  assert.ok(viewer.includes("const receivedAmount = Number(receiptSource.data.amount || 0)"));
  assert.ok(viewer.includes("grandTotal: receivedAmount"));
  assert.ok(viewer.includes("amount_received: receivedAmount"));
  assert.ok(viewer.includes("const documentNumber=text(receipt ? (payload.receipt_number||payload.document_number||payload.number)"));
  assert.ok(viewer.includes("const number = type === 'receipt' ? (model.receipt_number || model.document_number || model.number || '')"));
  assert.ok(viewer.includes("const allocationResult = await supabase.from('payment_allocations')"));
  assert.ok(viewer.includes("invoiceId = allocatedInvoiceIds.length === 1 ? allocatedInvoiceIds[0] : null"));
  assert.ok(viewer.includes("from('products_services').select('id,name,sku,item_type,unit,hsn_sac')"));
  assert.ok(viewer.includes("const items = type === 'receipt' ? receiptItems : model.items || []"));
  assert.ok(!viewer.includes("type === 'receipt' ? (receiptItems.length ? receiptItems : model.items || [])"));
  assert.ok(viewer.includes("const receiptAmount=Number(payload.amount ?? payload.amount_received ?? payload.amount_paid ?? 0)"));
  assert.ok(viewer.includes("<div className='receipt-total'><span>Amount Received</span>"));
  assert.ok(viewer.includes("<div className='receipt-ledger-balance'><span>Current customer ledger balance</span>"));
  assert.ok(!viewer.includes("<section className='receipt-status'>"));
  assert.ok(!viewer.includes("'Received with thanks from"));
  assert.ok(viewer.includes("const phone=text(customer.phone||customer.mobile||'').trim()"));
  assert.ok(viewer.includes("const customerName=text(customer.legal_name||customer.display_name||'Cash Customer')"));
  assert.ok(viewer.includes('receipt-amount-words'));  assert.ok(viewer.includes('className=\'receipt-customer-contact\'><strong>{customerName}</strong>{phone&&<span>{phone}</span>'));
  assert.ok(viewer.includes('.receipt-customer-contact{display:flex;flex-wrap:wrap;align-items:baseline;'));
});

test('official receipt PDF follows allocation source, keeps source invoice descriptions, and removes duplicate totals', async () => {
  const renderer = await read('lib/server/receipt-pdf.ts');

  assert.ok(renderer.includes('const paymentInvoiceId = paymentResult.data?.invoice_id || null;'));
  assert.ok(renderer.includes('const receiptInvoiceId = allocationInvoiceIds.length === 1'));
  assert.ok(renderer.includes('? String(allocationInvoiceIds[0])'));
  assert.ok(renderer.includes('allocationInvoiceIds.length === 0 ? paymentInvoiceId : null'));
  assert.ok(renderer.includes(".from('invoice_items').select('quantity,unit_price,line_total,description,product_service_id')"));
  assert.ok(renderer.includes("description: (() => {"));
  assert.ok(renderer.includes("const productDescription = plain(product?.description || '')"));
  assert.ok(renderer.includes("const textLine = (target: string[], x: number, y: number, value: string, size = 10, bold = false, fill = '0 0 0')"));
  assert.ok(renderer.includes('target.push(`${fill} rg BT ${font} ${size} Tf'));
  assert.ok(renderer.includes("name: plain(product?.name || item.description || 'Item')"));
  assert.ok(renderer.includes('const quantityLabel ='));
  assert.ok(renderer.includes('INVOICE ITEMS'));
  assert.ok(renderer.includes('(REFERENCE ONLY)'));
  assert.ok(renderer.includes('AMOUNT RECEIVED'));
  assert.equal((renderer.match(/Current customer ledger balance/g) || []).length, 1);
  assert.doesNotMatch(renderer, /Linked invoice balance/);
  assert.doesNotMatch(renderer, /Received with thanks from/);
  assert.doesNotMatch(renderer, /textLine\(page, pageWidth - right - 205, y, 'Total'/);
});

test('internal and public receipt downloads share the same receipt PDF renderer', async () => {
  const internalRoute = await read('app/api/receipts/pdf/route.ts');
  const publicRoute = await read('app/api/public-documents/pdf/route.ts');
  const resolver = await read('lib/server/documents/public-tokens.ts');

  assert.ok(internalRoute.includes('const pdf = buildReceiptPdf(data)'));
  assert.ok(publicRoute.includes('renderDocumentToBuffer(type, document.id, document.businessId)'));
  assert.ok(resolver.includes('if (type === \'receipt\')'));
  assert.ok(resolver.includes('return buildReceiptPdf(data)'));
});

test('public receipt presents customer phone beside the name when space permits and avoids repeated receipt metadata', async () => {
  const page = await read('app/receipt/[token]/page.tsx');

  assert.ok(page.includes('flex flex-wrap items-baseline gap-x-3 gap-y-1'));
  assert.ok(page.includes('whitespace-nowrap text-sm text-slate-600'));
  assert.ok(page.includes('Payment Date: {dateLabel(canonical.document.date)}'));
  assert.ok(!page.includes('Receipt {canonical.document.number}'));
  assert.ok(!page.includes('>Payment Date</p>'));
  assert.ok(page.includes('Customer Ledger Balance'));
  assert.ok(page.includes('Download Official PDF'));
  assert.ok(page.includes('flex-wrap items-center justify-center gap-x-2 gap-y-1'));
  assert.ok(page.includes('Powered by Moneymatters FinOps'));
  assert.ok(page.includes('whitespace-nowrap break-normal text-center text-violet-600'));
  assert.ok(page.includes('mm.nilanga.in'));
});

test('customer-linked receipt shows the same source invoice items and preserves their descriptions and units', async () => {
  const page = await read('app/receipt/[token]/page.tsx');
  const tokens = await read('lib/server/documents/public-tokens.ts');
  const renderer = await read('lib/server/receipt-pdf.ts');

  assert.ok(page.includes('{doc.items.length>0&&<section'));
  assert.ok(page.includes('Reference only — amount received is shown separately'));
  assert.ok(page.includes('item.name||item.description||\'Item\''));
  assert.ok(page.includes('item.description&&item.description!==item.name'));
  assert.ok(page.includes('item.quantity}{item.unit?'));
  assert.ok(tokens.includes('name: text(item.name) || text(item.description) || \'Item\''));
  assert.ok(tokens.includes("description: text(item.description || '')"));
  assert.ok(tokens.includes('unit: nullable(item.unit)'));
  assert.ok(renderer.includes('unit: product?.unit ? plain(product.unit) : null'));
  assert.ok(renderer.includes("description: (() => {"));
  assert.ok(renderer.includes("const productDescription = plain(product?.description || '')"));
});



test('invoice and quotation print footers center disclaimers and print names use company-document-number order', async () => {
  const viewer = await read('app/next-workspace/documents/DocumentViewer.tsx');

  assert.ok(viewer.includes("<footer className='document-footer'>"));
  assert.ok(viewer.includes("className='document-footer-disclaimer'"));
  assert.ok(viewer.includes('.paper>footer.document-footer{display:flex!important;flex-direction:column;align-items:center;justify-content:center;gap:4px;text-align:center}'));
  assert.ok(viewer.includes('buildDocumentFilenameBase('));
  assert.ok(viewer.includes("String(mergedBusiness?.name || mergedBusiness?.legal_name || 'Business')"));
  assert.ok(viewer.includes("String(documentFilenameLabel(type))"));
  assert.ok(viewer.includes("String(number || 'Document')"));
});


test('workspace receipt branding cannot split the Moneymatters name across lines', async () => {
  const viewer = await read('app/next-workspace/documents/DocumentViewer.tsx');

  assert.ok(viewer.includes("<div className='platform receipt-platform'><span className='platform-mark' aria-hidden='true'>M</span><span className='receipt-brand-label'>Powered by <strong className='receipt-brand-name'>Moneymatters</strong></span></div>"));
  assert.ok(viewer.includes('flex-flow:row nowrap!important'));
  assert.ok(viewer.includes('white-space:nowrap!important;word-break:keep-all!important;overflow-wrap:normal!important'));
  assert.ok(viewer.includes('.receipt-footer .receipt-brand-name{color:var(--accent);font-size:9px}'));
});

test('invoice form persists selected inventory location before review',async()=>{
  const editor=await read('app/next-workspace/invoices/InvoiceEditorCore.tsx');
  const migration=await read('supabase/migrations/20261015120000_document_inventory_preflight.sql');
  assert.match(editor,/rpc\('get_active_inventory_locations'/);
  assert.match(editor,/rpc\('set_invoice_operational_details'/);
  assert.match(migration,/CREATE OR REPLACE FUNCTION public\.get_active_inventory_locations/);
  assert.match(migration,/CREATE OR REPLACE FUNCTION public\.get_invoice_inventory_preflight/);
});
test('finalizing an invoice preflights stock and explains shortfall without bypassing the ledger guard',async()=>{
  const review=await read('app/next-workspace/documents/DocumentReviewCenter.tsx');
  const migration=await read('supabase/migrations/20261015120000_document_inventory_preflight.sql');
  assert.match(review,/rpc\('get_invoice_inventory_preflight'/);
  assert.match(review,/Cannot finalize this invoice/);
  assert.match(review,/Review inventory \/ correct stock/);
  assert.match(migration,/IF v_invoice\.source_challan_id IS NOT NULL THEN\s+RETURN;/);
  assert.match(migration,/quantity_on_hand/);
});

test('receipt PDF text sanitizer preserves r, n, spaces and punctuation in product labels', async () => {
  const renderer = await read('lib/server/receipt-pdf.ts');
  const publicTokens = await read('lib/server/documents/public-tokens.ts');
  assert.ok(renderer.includes(String.raw`const plain = (value: unknown) => String(value ?? '').replace(/[\r\n]/g, ' ').trim();`));
  assert.ok(renderer.includes(String.raw`}).replace(/[^\x20-\x7E]/g, '');`));
  assert.ok(renderer.includes(".select('id,name,description,sku,unit')"));
  assert.ok(renderer.includes("const productDescription = plain(product?.description || '')"));
  assert.ok(renderer.includes("return lineDescription && lineDescription !== itemName"));
  assert.ok(renderer.includes('return productDescription && productDescription !== itemName'));
  assert.ok(publicTokens.includes("const productDescription = text(product?.description)"));
  assert.ok(publicTokens.includes("description: lineDescription && lineDescription !== itemName ? lineDescription : productDescription && productDescription !== itemName ? productDescription : ''"));
  // The PDF's line-level description may equal the item name; in that case,
  // prefer the catalog description while never substituting the name itself.
});
