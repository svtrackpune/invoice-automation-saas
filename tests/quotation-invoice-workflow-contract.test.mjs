import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');
const pdf = read('lib/server/documents/public-pdf.ts');
const viewer = read('app/next-workspace/documents/DocumentViewer.tsx');
const invoice = read('app/invoice/[token]/page.tsx');
const quote = read('app/quote/[token]/page.tsx');
const downloadRoute = read('app/api/public-documents/pdf/route.ts');
const copyButton = read('components/ui/copy-button.tsx');
const quotationEditor = read('app/next-workspace/quotation/QuotationEditorCore.tsx');
const cashBillPage = read('app/next-workspace/cash-bill/page.tsx');
const cashBillViewer = read('app/next-workspace/cash-bill/CashBillControlled.tsx');
const notificationComponent = read('components/layout/HeaderNotifications.tsx');
const workspaceLayout = read('app/next-workspace/layout.tsx');
const acceptanceMigration = read('supabase/migrations/20261013190000_quotation_acceptance_notification.sql');
const notificationGrantMigration = read('supabase/migrations/20261013191500_notifications_read_column_grant.sql');
const securityMigration = read('supabase/migrations/20261013200000_internalize_public_token_definers.sql');
const shareHelper = read('lib/client/share-document.ts');
const quotationList = read('app/next-workspace/quotations/page.tsx');
const itemCatalogue = read('app/next-workspace/items/page.tsx');
const invoiceEditor = read('app/next-workspace/invoices/InvoiceEditorCore.tsx');
const itemServiceModal = read('app/next-workspace/invoices/new/ItemServiceModal.tsx');

test('invoice and quotation web/PDF item grids use six separate columns', () => {
  assert.ok(pdf.includes("['#', 'ITEM / DESCRIPTION', 'QTY', 'UNIT', 'RATE', 'AMOUNT']"));
  assert.match(pdf,/\[25, 225, 50, 55, 70, 90\]/);
  assert.match(pdf,/ascii\(it\.quantity\).*'center'/s);
  assert.match(pdf,/ascii\(originalItem\?\.unit \|\| it\.unit \|\| 'pcs'\)\.toUpperCase\(\)/);
  assert.match(pdf,/detailLines\.forEach\(\(line, j\) => c\.text\(xs\[1\].*7\.5, false, C\.muted/s);
  assert.doesNotMatch(pdf,/ascii\(it\.quantity\) \+ \(originalItem\?\.unit/);
  for (const source of [invoice, quote]) {
    assert.match(source,/>UNIT<\/th>/);
    assert.match(source,/>RATE<\/th>/);
    assert.match(source,/>AMOUNT<\/th>/);
    assert.match(source,/\{item\.quantity\}<\/td>/);
    assert.match(source,/item\.unit\|\|'pcs'/);
    assert.match(source,/font-semibold text-slate-900/);
    assert.match(source,/whitespace-pre-line text-xs text-slate-500/);
  }
  assert.match(viewer,/standardSales = false/);
  assert.match(viewer,/<th className="col-unit">UNIT<\/th>/);
  assert.match(viewer,/\.sales-six-column \.sales-item-copy strong/);
});

test('public PDF download is an attachment with type-business-document filename', () => {
  assert.match(downloadRoute,/export function buildDownloadFilename/);
  assert.match(downloadRoute,/return `\$\{cleanType\}-\$\{cleanEntity\}-\$\{cleanNum\}\.pdf`/);
  assert.match(downloadRoute,/buildDownloadFilename\(type, document\.business\.name/);
  assert.match(downloadRoute,/attachment; filename=/);
  assert.doesNotMatch(downloadRoute,/inline; filename=/);
});

test('quotation actions are visible before acceptance and footer is standardized', () => {
  const actions=quote.indexOf('Download Official PDF');
  const billTo=quote.indexOf('BILL TO');
  assert.ok(actions>0 && actions<billTo,'download/copy/accept action bar should appear before the itemized document');
  assert.match(quote,/CopyButton getValue=\{\(\) => publicDocumentUrlFromToken\('quotation',token\)\} label="Copy customer link"/);
  assert.match(quote,/Accept Quotation & Request Invoice/);
  assert.match(quote,/This is a computer-generated quotation and does not require signature\./);
  assert.match(quote,/Powered by Moneymatters FinOps \| mm\.nilanga\.in/);
  assert.doesNotMatch(quote,/Customer ledger balance|merchant outstanding balance/i);
  assert.match(quote,/money\(item\.unitPrice\)/);
  assert.doesNotMatch(quote,/money\(item\.unit_price\)/);
  assert.match(quote,/router\.push\(outcome\.redirect_url as string\)/);
  assert.match(quote,/catch \(cause\)/);
  assert.match(quote,/Failed to accept quotation\./);
  assert.match(quote,/Quotation accepted! Redirecting to your Tax Invoice\.\.\./);
});

test('accepted quotation returns a safe invoice URL and writes a tenant notification', () => {
  assert.match(acceptanceMigration,/public_token/);
  assert.match(acceptanceMigration,/redirect_url/);
  assert.match(acceptanceMigration,/v_invoice_status IN \('sent','partially_paid','paid'\)/);
  assert.match(acceptanceMigration,/INSERT INTO public\.notifications/);
  assert.match(acceptanceMigration,/'quotation_accepted'/);
  assert.match(acceptanceMigration,/jsonb_build_object\('quotation_id', v_quotation_id, 'invoice_id', v_invoice_id\)/);
  assert.match(acceptanceMigration,/NOT coalesce\(\(v_result->>'already_processed'\)::boolean, false\)/);
  assert.match(notificationComponent,/from\('notifications'\)/);
  assert.match(notificationComponent,/postgres_changes/);
  assert.match(notificationComponent,/filter: 'business_id=eq\.' \+ businessId/);
  assert.match(notificationComponent,/setInterval\(\(\) => \{ void refresh\(\); \}, 30000\)/);
  assert.match(workspaceLayout,/<HeaderNotifications businessId=\{activeBusinessId\} \/>/);
  assert.match(notificationGrantMigration,/GRANT UPDATE \(is_read\)/);
});


test('public token RPC wrappers delegate to private validated implementations', () => {
  assert.match(securityMigration,/CREATE SCHEMA IF NOT EXISTS mm_private/);
  assert.match(securityMigration,/FUNCTION mm_private\.accept_public_quotation_by_token/);
  assert.match(securityMigration,/FUNCTION mm_private\.get_public_invoice_by_token/);
  assert.match(securityMigration,/FUNCTION mm_private\.get_public_quotation_by_token/);
  assert.match(securityMigration,/FUNCTION mm_private\.rpc_accept_public_quotation_by_token/);
  assert.match(securityMigration,/CREATE OR REPLACE FUNCTION public\.get_public_invoice\(p_public_share_token text\)[\s\S]*?SECURITY INVOKER/);
  assert.match(securityMigration,/CREATE OR REPLACE FUNCTION public\.get_public_quotation\(p_public_accept_token text\)[\s\S]*?SECURITY INVOKER/);
  assert.match(securityMigration,/CREATE OR REPLACE FUNCTION public\.rpc_accept_public_quotation\(p_token text\)[\s\S]*?SECURITY INVOKER/);
  assert.ok(securityMigration.includes("OR btrim(p_public_share_token) !~ '^[A-Fa-f0-9]{48,128}$'"));
  assert.match(securityMigration,/REVOKE ALL ON FUNCTION public\.accept_public_quotation\(text\)\s+FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(securityMigration,/REVOKE CREATE ON SCHEMA mm_private FROM PUBLIC, anon, authenticated/);
});

test('quotation list menu routes each action through the public quotation workflow', () => {
  assert.ok(quotationList.includes('Actions for quotation'));
  assert.ok(quotationList.includes('View quotation'));
  assert.ok(quotationList.includes("'/next-workspace/quotation?edit=' + encodeURIComponent(row.id)"));
  assert.ok(quotationList.includes('onClick={() => void downloadPdf(row)}'));
  assert.ok(quotationList.includes("getPublicDocumentUrl('quotation', row.id)"));
  assert.ok(quotationList.includes('onClick={() => void shareQuotation(row)}'));
  assert.ok(quotationList.includes('publicShareAvailable(row)'));
  assert.ok(quotationList.includes('closeOnOutsideClick'));
  assert.ok(quotationList.includes("event.key === 'Escape'"));
  assert.ok(quotationEditor.includes("supabase.rpc('update_quotation_from_items',{p_quotation_id:editId"));
  assert.ok(quotationEditor.includes('setQuote(q.data)'));
});

test('invoice title and tax presentation follow explicit GST registration mode', () => {
  assert.ok(viewer.includes("business_tax_profiles').select('gstin,pan,tax_id,tax_regime,gst_registration_type')"));
  assert.ok(viewer.includes('const invoiceDocumentTitle = (party: any) =>'));
  assert.ok(viewer.includes("['REGULAR', 'CASUAL', 'NON_RESIDENT', 'SEZ'].includes(registration) && hasValidGstin(party)"));
  assert.ok(viewer.includes("['VAT', 'SALES_TAX', 'OTHER'].includes(regime)"));
  assert.ok(viewer.includes("if (isCompositionRegistration(party)) return 'BILL OF SUPPLY'"));
  assert.ok(viewer.includes("return isTaxRegistered(party) ? 'TAX INVOICE' : 'INVOICE'"));
  assert.ok(quote.includes("const quotationTaxEnabled=quotationGstRegistered||quotationOtherTaxRegistered"));
  assert.ok(quote.includes('quotationTaxEnabled&&canonical?.financials.taxBreakdown.map'));
  assert.ok(viewer.includes('showTaxDetails={documentShowTaxDetails}'));
  assert.ok(viewer.includes('show_customer_balance === true'));
  assert.ok(invoice.includes("const invoiceHeading=compositionSupply?'BILL OF SUPPLY':taxRegistered?'TAX INVOICE':'INVOICE'"));
  assert.ok(invoice.includes('showGstBreakdown=gstRegistered&&!compositionSupply'));
  assert.ok(pdf.includes("const docTitle = (type: string, business?: PublicDocument['business'])"));
  assert.ok(pdf.includes("if (type === 'invoice') return taxPresentation(business).title"));
  assert.ok(pdf.includes("taxBreakdownAllowed: (gstRegistration && !composition) || otherTaxRegistration"));
  assert.ok(!pdf.includes('No line items supplied'));
});

test('product and service selectors dismiss after selection, outside click, and Escape', () => {
  assert.ok(itemCatalogue.includes('const rootRef=useRef<HTMLDivElement|null>(null)'));
  assert.ok(itemCatalogue.includes("document.addEventListener('mousedown',closeOutside)"));
  assert.ok(itemCatalogue.includes("document.addEventListener('keydown',closeOnEscape)"));
  assert.ok(itemCatalogue.includes("if(event.key==='Escape')"));
  assert.ok(invoiceEditor.includes('e.currentTarget.blur()'));
  assert.ok(itemServiceModal.includes('event.currentTarget.blur()'));
  assert.ok(quotationEditor.includes('e.currentTarget.blur()'));
});

test('copy button shows copied state, checkmark, and transient success/failure feedback', () => {
  assert.match(copyButton,/copyTextToClipboard\(text\)/);
  assert.match(shareHelper,/await copyTextToClipboard\(message\)/);
  assert.match(shareHelper,/navigator\.clipboard\.writeText\(text\)/);
  assert.match(shareHelper,/document\.execCommand\('copy'\)/);
  assert.match(shareHelper,/export async function sharePublicDocument/);
  assert.match(shareHelper,/await copyTextToClipboard\(message\)/);
  assert.match(copyButton,/copiedLabel = 'Copied!'/);
  assert.match(copyButton,/setTimeout\(\(\) => \{/);
  assert.match(copyButton,/Link copied to clipboard!/);
  assert.match(copyButton,/Failed to copy link\./);
  assert.match(copyButton,/mr-2 inline-block h-4 w-4 text-emerald-600/);
  assert.match(invoice,/CopyButton getValue=\{\(\) => window\.location\.href\}/);
  assert.match(quote,/CopyButton getValue=\{\(\) => publicDocumentUrlFromToken\('quotation',token\)\} label="Copy customer link"/);
  assert.match(quotationEditor,/CopyButton getValue=\{\(\) => getPublicDocumentUrlForQuotation\(quote\.id\)\}/);
  assert.match(cashBillPage,/const copyUpiLink=\(\)=>\{/);
  assert.doesNotMatch(cashBillPage,/navigator\.clipboard\.writeText\(link\)/);
  assert.match(cashBillViewer,/CopyButton getValue=\{p\.copyUpiLink\}/);
});
