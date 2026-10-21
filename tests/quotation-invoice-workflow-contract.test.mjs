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
const businessSettings = read('app/next-workspace/business-settings/page.tsx');
const dynamicTaxApplication = read('lib/server/tax/apply-dynamic.ts');
const itemServiceModal = read('app/next-workspace/invoices/new/ItemServiceModal.tsx');
const publicTokens = read('lib/server/documents/public-tokens.ts');
const gstBoundaryMigration = read('supabase/migrations/20261013234500_harden_gst_registration_rpc_boundary.sql');
const publicTaxMetadataMigration = read('supabase/migrations/20261013235000_public_document_tax_regime_metadata.sql');
const publicTaxIdMigration = read('supabase/migrations/20261013235800_public_tax_id_requires_profile_registration.sql');

test('invoice and quotation web/PDF item grids use six separate columns', () => {
  assert.ok(pdf.includes("['#', 'ITEM / DESCRIPTION', 'QTY', 'UNIT', 'RATE', 'AMOUNT']"));
  assert.match(pdf,/\[25, 225, 50, 55, 70, 90\]/);
  assert.match(pdf,/pdfText\(it\.quantity\).*'center'/s);
  assert.match(pdf,/pdfText\(originalItem\?\.unit \|\| it\.unit \|\| 'pcs'\)\.toUpperCase\(\)/);
  assert.match(pdf,/detailLines\.forEach\(\(line, j\) => c\.text\(xs\[1\].*7\.5, false, palette\.muted/s);
  assert.doesNotMatch(pdf,/pdfText\(it\.quantity\) \+ \(originalItem\?\.unit/);
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

test('public PDF download is an attachment with company-document-number filename', () => {
  const filenameHelper = readFileSync('lib/shared/document-filename.ts','utf8');
  assert.match(downloadRoute,/export function buildDownloadFilename/);
  assert.match(downloadRoute,/return buildDocumentDownloadFilename\(entityName, documentFilenameLabel\(type\), docNumber\)/);
  assert.match(downloadRoute,/buildDownloadFilename\(type, document\.business\.name/);
  assert.match(filenameHelper,/filenamePart\(companyName, 'Business'\)[\s\S]*?filenamePart\(documentName, 'Document'\)[\s\S]*?filenamePart\(documentNumber, 'Document'\)/);
  assert.match(downloadRoute,/inline; filename=/);
  assert.doesNotMatch(downloadRoute,/attachment; filename=/);
});

test('quotation actions are visible before acceptance and footer is standardized', () => {
  const actions=quote.indexOf('Download Official PDF');
  const billTo=quote.indexOf('BILL TO');
  assert.ok(actions>0 && actions<billTo,'download/copy/accept action bar should appear before the itemized document');
  assert.match(quote,/CopyButton getValue=\{\(\) => publicDocumentUrlFromToken\('quotation',token\)\} label="Copy customer link"/);
  assert.match(quote,/Accept Quotation & Request Invoice/);
  assert.match(quote,/This is a computer-generated quotation and does not require signature\./);
  assert.match(quote,/Powered by Money Matters FinOps \| mm\.nilanga\.in/);
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
  assert.ok(quotationList.includes("p_status: 'accepted'"));
  assert.ok(quotationList.includes("p_status: 'sent'"));
  assert.ok(quotationList.includes("supabase.rpc('convert_quotation_to_invoice'"));
  assert.ok(quotationList.includes('Mark as accepted'));
  assert.ok(quotationList.includes('Extend validity before accepting this expired quotation.'));
  assert.ok(quotationList.includes("row.status === 'accepted' && !row.invoice_id"));
  assert.ok(quotationList.includes("const [pageSize, setPageSize] = useState('20')"));
  for (const pageSize of ['20','50','100','all']) assert.ok(quotationList.includes('<option value="' + pageSize + '">'));
  assert.ok(quotationList.includes('Rows per page'));
  assert.ok(quotationList.includes("const [sortBy, setSortBy] = useState<SortKey>('date')"));
  assert.ok(quotationList.includes("const [sortDirection, setSortDirection] = useState<SortDirection>('desc')"));
  for (const column of ["['quotation','Quotation No.']","['customer','Customer']","['date','Date']","['amount','Total Amount']","['status','Status']"]) assert.ok(quotationList.includes(column),'missing sortable quotation column '+column);
  assert.ok(quotationList.includes('aria-sort='));
  assert.ok(quotationList.includes('sortIndicator(key)'));
  assert.ok(quotationList.includes('const visible = pageSize === \'all\' ? sorted : sorted.slice('));
  assert.ok(quotationList.includes('Showing {(page - 1)'));
  assert.ok(quotationList.includes('Page {page} / {pages}'));
  assert.ok(quotationList.includes('onClick={() => setPage(current => Math.max(1, current - 1))}'));
  assert.ok(quotationList.includes('onClick={() => setPage(current => Math.min(pages, current + 1))}'));
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
  assert.ok(quotationEditor.includes("const otherTaxEnabled=countryCode!=='IN'&&['VAT','SALES_TAX','OTHER'].includes(taxRegime)&&Boolean(String(profile.tax_id||'').trim())"));
  assert.ok(quotationEditor.includes('const taxEnabled=gstEnabled||otherTaxEnabled'));
  assert.ok(quotationEditor.includes('},[lines,taxes,taxEnabled]);'));
  assert.ok(quotationEditor.includes("const money=(n:number,currencyCode:string|null='INR',locale='en-IN')=>formatMoney"));
  assert.ok(quotationEditor.includes('money(totals.total,quoteCurrency,locale)'));
  assert.ok(quotationEditor.includes("tax_rate_id:taxEnabled?(np.default_tax_rate_id||''):''"));
  assert.ok(quotationEditor.includes("taxRegime==='GST'?'GST rate':'Tax rate'"));
  assert.ok(quotationEditor.includes("{taxEnabled&&<div className=\"flex justify-between\"><span>{taxRegime==='GST'?'GST':'Tax'}</span>"));
  assert.ok(viewer.includes('showTaxDetails={documentShowTaxDetails}'));
  assert.ok(viewer.includes("const registrationBoundTaxDocument=['invoice','tax_invoice','cash_bill','quotation','credit_note','debit_note'].includes(type)||taxInvoice"));
  assert.ok(viewer.includes("isGstDocument=isRegisteredTaxDocument&&regime==='GST'&&country==='IN'"));
  assert.ok(viewer.includes("function DocumentTotals({ payload, currency='INR', receipt=false, showTaxDetails=true, taxLabel='GST' }"));
  assert.ok(viewer.includes('<span>{taxLabel}</span><strong>{money(tax,currency)}</strong>'));
  assert.ok(viewer.includes("const showComponents = showTaxDetails && taxLabel === 'GST' && (cgst !== 0 || sgst !== 0 || igst !== 0)"));
  assert.ok(viewer.includes('showTaxDetails={documentShowTaxDetails} taxLabel={taxLabel}'));
  assert.ok(viewer.includes('show_customer_balance === true'));
  assert.ok(invoice.includes("const invoiceHeading=compositionSupply?'BILL OF SUPPLY':taxRegistered?'TAX INVOICE':'INVOICE'"));
  assert.ok(invoice.includes('showGstBreakdown=gstRegistered&&!compositionSupply'));
  assert.ok(pdf.includes("const docTitle = (type: string, business?: PublicDocument['business'])"));
  assert.ok(pdf.includes("if (type === 'invoice') return taxPresentation(business).title"));
  assert.ok(pdf.includes("taxBreakdownAllowed: (gstRegistration && !composition) || otherTaxRegistration"));
  assert.ok(!pdf.includes('No line items supplied'));
});

test('GST registration is validated at RPC and public document boundaries', () => {
  assert.ok(gstBoundaryMigration.includes('mm_private.has_valid_gst_registration(p_business_id)'));
  assert.ok(gstBoundaryMigration.includes("upper(coalesce(tp.tax_regime, 'NONE')) = 'GST'"));
  assert.ok(gstBoundaryMigration.includes("upper(coalesce(tp.gst_registration_type, 'NONE'))"));
  assert.ok(gstBoundaryMigration.includes('public.create_invoice_from_items(uuid,uuid,date,date,jsonb,text,numeric,text,text)'));
  assert.ok(gstBoundaryMigration.includes('public.update_invoice_any_state(uuid,uuid,date,date,jsonb,text,numeric,text,text,uuid,date,uuid,text,uuid)'));
  assert.ok(gstBoundaryMigration.includes('public.create_invoice_with_dynamic_tax(uuid,uuid,date,date,jsonb,text,text,text,boolean)'));
  assert.ok(gstBoundaryMigration.includes('public.api_create_invoice_with_dynamic_tax(text,uuid,uuid,date,date,jsonb,text,text,text,boolean)'));
  assert.ok(publicTokens.includes("select('id,name,legal_name,email,phone,website,address,country_code,tax_registration_number,logo_storage_path')"));
  assert.ok(publicTokens.includes("select('gstin,pan,gst_registration_type,tax_regime,tax_id')"));
  assert.ok(publicTokens.includes("const registeredGstin = taxRegime === 'GST' && gstRegistrationMode && hasValidGstin ? gstin : null"));
  assert.ok(publicTokens.includes("const nonIndianTaxId = countryCode !== 'IN' && ['VAT', 'SALES_TAX', 'OTHER'].includes(taxRegime)"));
  assert.ok(publicTokens.includes('? nullable(taxProfile.tax_id)\n    : null;'));
  assert.ok(publicTaxIdMigration.includes("THEN nullif(btrim(tp.tax_id), '')"));
  assert.ok(publicTaxMetadataMigration.includes("'tax_regime'"));
  assert.ok(publicTaxMetadataMigration.includes("'country_code'"));
  assert.ok(publicTaxMetadataMigration.includes("IN ('REGULAR', 'CASUAL', 'NON_RESIDENT', 'SEZ', 'COMPOSITION')"));
  assert.ok(publicTaxMetadataMigration.includes("'tax_id'"));
  assert.ok(publicTaxMetadataMigration.includes("THEN nullif(btrim((SELECT tp.tax_id FROM public.business_tax_profiles tp WHERE tp.business_id = i.business_id)), '')"));
  assert.ok(publicTaxMetadataMigration.includes("THEN nullif(btrim(tp.tax_id), '')"));
  assert.ok(!publicTaxMetadataMigration.includes("THEN nullif(btrim(coalesce(tp.tax_id, b.tax_registration_number)), '')"));
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

test('business settings require registration details before tax is enabled', () => {
  assert.ok(businessSettings.includes("select('tax_regime,gst_registration_type,gstin,tax_id,pan,tax_state,accounting_basis,books_mode,presumptive_section')"));
  assert.ok(businessSettings.includes("label=\"Tax registration ID\""));
  assert.ok(businessSettings.includes("Boolean(String(tax.tax_id||'').trim())"));
  assert.ok(businessSettings.includes("['REGULAR','CASUAL','NON_RESIDENT','SEZ'].includes(registration)&&validGstin"));
  assert.ok(invoiceEditor.includes("Boolean(String(profile.tax_id||'').trim())"));
  assert.ok(dynamicTaxApplication.includes("source_provider:'registration-gated-no-tax'"));
});
