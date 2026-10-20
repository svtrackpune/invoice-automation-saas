import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const root=new URL('../',import.meta.url);
const read=p=>readFile(new URL(p,root),'utf8');

test('public token resolver preserves invoice/quotation tokens and hash-checks receipts',async()=>{
 const helper=await read('lib/server/documents/public-tokens.ts');
 assert.match(helper,/public_share_token/);
 assert.match(helper,/public_accept_token/);
 assert.match(helper,/sha256Hex\(token\)/);
 assert.match(helper,/revoked_at/);
 assert.match(helper,/expires_at/);
 assert.match(helper,/statusAllowed/);
});

test('public PDF endpoint accepts only a known type and bearer token, disables cache, and returns attachment',async()=>{
 const route=await read('app/api/public-documents/pdf/route.ts');
 assert.match(route,/allowed = new Set/);
 assert.match(route,/resolvePublicDocumentByToken/);
 assert.match(route,/Content-Type':'application\/pdf'/);
 assert.match(route,/Content-Disposition/);
 assert.match(route,/private, no-store/);
 assert.match(route,/X-Robots-Tag/);
});

test('public customer pages expose an official PDF action without workspace authentication',async()=>{
 const invoice=await read('app/invoice/[token]/page.tsx');
 const quote=await read('app/quote/[token]/page.tsx');
 const challan=await read('app/challan/[token]/page.tsx');
 const receipt=await read('app/receipt/[token]/page.tsx');
 for(const source of [invoice,quote,challan,receipt]) assert.match(source,/Download Official PDF/);
 assert.match(invoice,/payment_qr_payload/);
 assert.match(challan,/Not for Sale \/ Not a Tax Invoice/);
 assert.match(receipt,/receipt_access_tokens|resolvePublicDocumentByToken/);
});

test('dispatch function resolves public token paths server-side rather than trusting payment/internal URLs',async()=>{
 const migration=await read('supabase/migrations/20261011150000_public_document_dispatch_links.sql');
 assert.match(migration,/resolve_public_document_dispatch/);
 assert.match(migration,/\/invoice\//);
 assert.match(migration,/\/quote\//);
 assert.match(migration,/\/challan\//);
 assert.match(migration,/\/receipt\//);
 assert.match(migration,/FROM PUBLIC, anon, authenticated/);
 assert.match(migration,/TO service_role/);
});

test('multi-channel worker sends real PDFs for SMTP/WAPI/Telegram and keeps test dispatch text-only',async()=>{
 const worker=await read('supabase/functions/process-notifications/index.ts');
 assert.match(worker,/resolve_public_document_dispatch/);
 assert.match(worker,/\/message\/sendMedia\//);
 assert.match(worker,/mediatype:"document"/);
 assert.match(worker,/\/sendDocument/);
 assert.match(worker,/contentType:"application\/pdf"/);
 assert.match(worker,/attachments/);
 assert.match(worker,/documentSmsText/);
 assert.match(worker,/Wapi document delivery requires the configured instance ID/);
 assert.match(worker,/bytesToBase64\(pdfBytes!\)/);
 assert.match(worker,/multipart\.set\("document", new Blob/);
 assert.match(worker,/Join Moneymatters for free/);
 assert.match(worker,/job\.notification_type === "manual_test"/);
});

test('trusted link resolver defaults to the production HTTPS domain and blocks external origins',async()=>{
 const shared=await read('supabase/functions/_shared/tenant-notifications.ts');
 assert.match(shared,/https:\/\/mm\.nilanga\.in/);
 assert.match(shared,/url\.origin !== base\.origin/);
});

test('manual quotation dispatch advances draft to sent before exposing the public token',async()=>{
 const migration=await read('supabase/migrations/20261011160000_public_quotation_dispatch_promote.sql');
 assert.match(migration,/UPDATE public\.quotations SET status='sent',updated_at=now\(\)[\s\S]*?status='draft'/);
 assert.match(migration,/v_public_path := '\/quote\/'\|\|v_token/);
});

test('receipt copy/share actions use short-lived public receipt links, not workspace IDs',async()=>{
 const ui=await read('app/next-workspace/receipts/page.tsx');
 const helper=await read('lib/client/share-document.ts');
 const sql=await read('supabase/migrations/20261011170000_public_receipt_link_rpc.sql');
 assert.ok(ui.includes("getPublicDocumentUrl('receipt',id)"));
 assert.ok(helper.includes("supabase.rpc('get_public_document_link'"));
 assert.ok(helper.includes("'path' in data"));
 assert.ok(helper.includes('[A-Fa-f0-9]{48,128}'));
 assert.ok(ui.includes('<CopyButton getValue={()=>getPublicReceiptUrl(r.id)} label={t(\'Copy link\')}'));
 assert.ok(ui.includes('const shareReceipt=async(id:string)=>{'));
 assert.ok(sql.includes("public._issue_receipt_access_token(p_receipt_id, 'customer_download')"));
 assert.ok(sql.includes('REVOKE ALL ON FUNCTION public.create_public_receipt_link(uuid) FROM PUBLIC, anon'));
 assert.ok(sql.includes('GRANT EXECUTE ON FUNCTION public.create_public_receipt_link(uuid) TO authenticated'));
});

test('receipt table sends through the selected tenant channel and offers the public link fallback',async()=>{
 const ui=await read('app/next-workspace/receipts/page.tsx');
 assert.ok(ui.includes("p_document_type:'receipt'"));
 assert.ok(ui.includes('p_business_id:businessId'));
 assert.ok(ui.includes('Send PDF'));
 assert.ok(ui.includes("getPublicDocumentUrl('receipt',id)"));
});

test('receipt list consolidates row actions into one accessible menu',async()=>{
 const ui=await read('app/next-workspace/receipts/page.tsx');
 assert.ok(ui.includes("aria-label={'Actions for receipt '+r.receipt_number}"));
 assert.ok(ui.includes("role=\"menu\" aria-label={'Receipt actions for '+r.receipt_number}"));
 for(const action of ['View receipt','Send PDF','Share receipt','Copy link','Transaction 360']) assert.ok(ui.includes(action),'missing receipt action '+action);
 assert.ok(!ui.includes('flex flex-wrap justify-end gap-1.5'));
 assert.ok(ui.includes('closeEscape'));
 assert.ok(ui.includes('openActionsId===r.id&&<div role=\"menu\"'));
});


test('SendGrid and Resend attach generated PDFs and use branded shared HTML',async()=>{
 const worker=await read('supabase/functions/process-notifications/index.ts');
 assert.match(worker,/function buildDocumentEmailHtml\(input:/);
 const sg=worker.slice(worker.indexOf('if (connection.provider === "sendgrid")'),worker.indexOf('throw new Error("Notification provider is not supported by this worker.")'));
 const re=worker.slice(worker.indexOf('if (connection.provider === "resend")'),worker.indexOf('if (connection.provider === "twilio")'));
 assert.match(sg,/Buffer\.from\(await fetchDocumentPdf\(dispatch\)\)\.toString\("base64"\)/);
 assert.match(sg,/type: "application\/pdf"/); assert.match(sg,/type: "text\/html"/);
 assert.match(re,/content: bytesToBase64\(await fetchDocumentPdf\(dispatch\)\)/);
 assert.match(re,/content_type: "application\/pdf"/); assert.match(re,/html: htmlBody/);
 assert.match(worker,/automate invoicing, inventory &amp; GST/);
});
test('middleware explicitly recognizes public document routes',async()=>{
 const source=await read('middleware.ts');
 assert.match(source,/PUBLIC_RECIPIENT_ROUTES/);
 assert.match(source,/delivery-challan/); assert.match(source,/api.*public-documents/);
 assert.match(source,/PUBLIC_RECIPIENT_ROUTES\.some\(\(route\) => route\.test\(pathname\)\)/);
 assert.match(source,/if \(PUBLIC_RECIPIENT_ROUTES\.some/);
 assert.match(source,/Public recipient links are bearer-token routes/);
 assert.match(source,/return response;/);
});


test('customer-facing shares use canonical token URLs instead of merchant workspace routes',async()=>{
 const helper=await read('lib/client/share-document.ts');
 const serverTokens=await read('lib/server/documents/public-tokens.ts');
 const viewer=await read('app/next-workspace/documents/DocumentViewer.tsx');
 const invoices=await read('app/next-workspace/invoices/page.tsx');
 const receipts=await read('app/next-workspace/receipts/page.tsx');
 const quotations=await read('app/next-workspace/quotation/QuotationEditorCore.tsx');
 const review=await read('app/next-workspace/documents/DocumentReviewCenter.tsx');
 const challengedRoute=await read('app/delivery-challan/[token]/page.tsx');
 const linkRpc=await read('supabase/migrations/20261011132212_public_document_link_rpc_and_challan_route.sql');
 assert.ok(helper.includes('getPublicDocumentUrl'));
 assert.ok(helper.includes('get_public_document_link'));
 assert.ok(helper.includes("const PUBLIC_ORIGIN = 'https://mm.nilanga.in'"));
 assert.ok(helper.includes("path.includes('/next-workspace/')"));
 assert.ok(serverTokens.includes('getPublicDocumentPath'));
 const viewerShare=viewer.slice(viewer.indexOf('const copyLink = async'),viewer.indexOf('const print = () =>'));
 assert.ok(viewerShare.includes('getPublicDocumentUrl'));
 assert.ok(!viewerShare.includes('window.location.href'));
 const shareStart=invoices.indexOf('const share = async');
 const shareEnd=invoices.indexOf('}; return <div',shareStart);
 const invoiceShare=invoices.slice(shareStart,shareEnd);
 assert.ok(invoiceShare.includes("getPublicDocumentUrl('invoice'"));
 assert.ok(!invoiceShare.includes('/next-workspace/documents?type=invoice&id='));
 assert.ok(receipts.includes("getPublicDocumentUrl('receipt',id)"));
 assert.ok(quotations.includes("publicDocumentUrlFromToken('quotation',current.public_accept_token)"));
  assert.ok(quotations.includes('CopyButton getValue={() => getPublicDocumentUrlForQuotation(quote.id)}'));
 assert.ok(review.includes('getPublicDocumentUrl(canonicalType, id)'));
 assert.ok(review.includes('p_action_url: null'));
 assert.ok(challengedRoute.includes('Download Official PDF'));
 assert.ok(linkRpc.includes("v_path := '/delivery-challan/' || v_token"));
 assert.ok(linkRpc.includes("has_business_permission(v_business_id, 'sales.create', auth.uid())"));
 assert.ok(linkRpc.includes('REVOKE ALL ON FUNCTION public.get_public_document_link(text, uuid) FROM PUBLIC, anon'));
});

test('SMS fallback uses a concise branded template with the canonical public link',async()=>{
 const helper=await read('lib/client/share-document.ts');
 const review=await read('app/next-workspace/documents/DocumentReviewCenter.tsx');
 assert.ok(helper.includes('export function buildPublicDocumentSmsMessage'));
 assert.ok(helper.includes('Moneymatters FinOps'));
 assert.ok(review.includes('buildPublicDocumentSmsMessage({ ...shareDetails, publicUrl })'));
 assert.ok(review.includes("'sms:' + data.recipient + '?body=' + encodeURIComponent(smsBody)"));
 assert.ok(helper.includes("const PUBLIC_ORIGIN = 'https://mm.nilanga.in'"));
});

test('webhook claim processing state is legal and notification outbox stays idempotent',async()=>{
 const migration=await read('supabase/migrations/20261011135517_webhook_idempotency_and_outbox.sql');
 const connections=await read('supabase/migrations/20261003180000_gate1_tenant_notification_connections.sql');
 assert.match(migration,/payment_webhook_events_status_check/);
 assert.match(migration,/'processing'::text/);
 assert.match(migration,/VALIDATE CONSTRAINT payment_webhook_events_status_check/);
 assert.match(migration,/REVOKE ALL ON TABLE public\.payment_webhook_events FROM PUBLIC, anon, authenticated/);
 assert.match(migration,/notification_jobs\.delivery_idempotency_key/);
 assert.match(connections,/notification_jobs_delivery_idempotency_uidx/);
});

test('public token RPC grants cover anon and authenticated sessions without widening function scope',async()=>{
 const migration=await read('supabase/migrations/20261011143043_grant_public_document_rpc_permissions.sql');
 const invoice=await read('app/invoice/[token]/page.tsx');
 const quotation=await read('app/quote/[token]/page.tsx');
 for(const name of ['get_public_invoice','get_public_quote','get_public_quotation','get_public_receipt','get_public_delivery_challan','get_public_document']){
  assert.ok(migration.includes("'" + name + "'"), 'missing public RPC: ' + name);
 }
 assert.match(migration,/p\.pronamespace = 'public'::regnamespace/);
 assert.match(migration,/GRANT EXECUTE ON FUNCTION %s TO anon, authenticated/);
 assert.match(invoice,/supabase\.rpc\('get_public_invoice'/);
 assert.match(quotation,/supabase\.rpc\('get_public_quotation'/);
});

test('public invoice renderer creates a vector-rendered A4 GST PDF with QR and binary xref',async()=>{
 const { buildPublicDocumentPdf }=await import('../lib/server/documents/public-pdf.ts');
 const doc={
  type:'invoice',id:'invoice-id',businessId:'business-id',number:'INV-000018',date:'2026-10-11',dueDate:'2026-10-25',validUntil:null,status:'sent',currencyCode:'INR',templateName:'Premium',
  subtotal:200,discountTotal:10,taxTotal:34.2,total:224.2,amountPaid:50,balanceDue:174.2,notes:'Payment due within agreed terms.',terms:'Subject to jurisdiction.',paymentLink:null,paymentQrPayload:null,
  vehicleNumber:null,transporterName:null,ewayBillNumber:null,placeOfSupplyStateCode:'27',supplyType:'intra_state',cgstAmount:17.1,sgstAmount:17.1,igstAmount:0,
  bankDetails:{name:'Primary Account',institutionName:'Sample Bank',accountHolderName:'Sample Industries',accountNumber:'1234567890',accountLast4:'7890',ifscCode:'SBIN0001234',branchName:'Nilanga'},upiId:'sample@upi',
  business:{name:'Sample Industries',legalName:'Sample Industries Private Limited',email:'billing@example.test',phone:'9999999999',website:'https://example.test',address:{line1:'Main Road',city:'Nilanga',state:'Maharashtra',postal_code:'413521',country:'India'},taxRegistrationNumber:'27ABCDE1234F1Z5',gstRegistrationType:'REGULAR',taxRegime:'GST',countryCode:'IN',taxId:null,logoStoragePath:null,pan:'ABCDE1234F'},
  customer:{name:'Example Customer',legalName:'Example Customer LLP',email:'customer@example.test',phone:'8888888888',address:{line1:'Market Road',city:'Latur',state:'Maharashtra',postal_code:'413512'},billingAddress:{line1:'Market Road',city:'Latur',state:'Maharashtra',postal_code:'413512'},shippingAddress:{line1:'Industrial Estate',city:'Latur',state:'Maharashtra',postal_code:'413512'},taxId:'27AACCE1234A1Z7'},
  items:[{description:'Industrial Equipment',quantity:2,unit:'pcs',unitPrice:100,discount:10,taxAmount:34.2,lineTotal:224.2,hsnSac:'8479'}]
 };
 const pdf=await buildPublicDocumentPdf(doc);
 assert.ok(Buffer.isBuffer(pdf));
 const unicodePdf = await buildPublicDocumentPdf({
   ...doc,
   business: { ...doc.business, name: 'महाराष्ट्र उद्योग' },
   customer: { ...doc.customer, name: 'ग्राहक सेवा' },
   items: [{ ...doc.items[0], name: 'मराठी वस्तू', description: 'मराठी वस्तू' }],
 });
 const unicodeRaw = unicodePdf.toString('latin1');
 assert.match(unicodeRaw, /\\/FontFile2/, 'Devanagari text should embed a Unicode TrueType font');
 assert.match(unicodeRaw, /\\/ToUnicode/, 'Devanagari font must have Unicode character mappings');
 assert.equal(pdf.subarray(0,8).toString('ascii'),'%PDF-1.4');
 const raw=pdf.toString('latin1');
 assert.match(raw,/\/MediaBox \[0 0 595\.28 841\.89\]/);
 for(const text of ['TAX INVOICE','INV-000018','BILL TO','SHIP TO','Template: Premium','#','ITEM / DESCRIPTION','CGST','SGST','Net Payable','Balance due','AMOUNT IN WORDS:','Authorized Signatory','SCAN & PAY VIA UPI','Pay Now via UPI','Scan to pay the invoice amount.','This is a computer-generated invoice and does not require signature.','Powered by Moneymatters FinOps | mm.nilanga.in']) assert.ok(raw.includes(text),'PDF is missing '+text);
 assert.doesNotMatch(raw,/Rs\./);
 assert.ok(raw.indexOf('Pay Now via UPI') < raw.indexOf('TERMS & CONDITIONS'),'payment settlement must be rendered before invoice terms');
 assert.doesNotMatch(raw,/INVOICE SUMMARY/);
 assert.match(raw,/Same as billing address|Industrial Estate/,'ship-to card has a shipping or billing fallback');
 assert.doesNotMatch(raw,/This is a customer-facing invoice shared by/);
 assert.match(raw,/0\.486 0\.227 0\.929 rg[^\n]* m [^\n]* l/,'PDF must include a filled purple vector accent');
 assert.match(raw,/0\.908 0\.861 0\.987 rg/,'PDF must include the selected-theme soft corner vector');
 assert.match(raw,/0\.486 0\.227 0\.929 RG 1\.50 w/,'PDF must include the purple footer accent line');
 assert.match(raw,/0\.918 0\.345 0\.047 rg/,'financial totals use the standardized orange accent');
 const match=raw.match(/startxref\n(\d+)\n%%EOF/);
 assert.ok(match,'PDF cross-reference offset is missing');
 assert.equal(raw.slice(Number(match[1]),Number(match[1])+4),'xref');
 const qr=QRCodePlaceholderForTest(pdf);
 assert.ok(qr);
 assert.match(raw,/\/URI \(upi:\/\/pay\?/);
 const annotationRect=raw.match(/\/Subtype \/Link \/Rect \[([0-9.]+) ([0-9.]+)/);
 assert.ok(annotationRect,'UPI action must have a clickable PDF annotation');
 assert.ok(Number(annotationRect[1])>40 && Number(annotationRect[1])<220,'UPI action must be positioned in the compact left settlement card');
 assert.ok(Number(annotationRect[2])>100,'UPI action must be positioned in the document body, not the top margin');
 assert.doesNotMatch(raw,/Sample Bank/,'UPI-only default must not expose bank account strings');
 const bankOnlyPdf=await buildPublicDocumentPdf({...doc,settlementDisplayMode:'bank_transfer'});
 const bankOnlyText=bankOnlyPdf.toString('latin1');
 assert.match(bankOnlyText,/Sample Bank/,'bank_transfer mode must show bank settlement details');
 assert.match(bankOnlyText,/BANK DETAILS/,'bank-only card must have a clear heading');
 assert.doesNotMatch(bankOnlyText,/Pay Now via UPI|Scan to pay the invoice amount\./,'bank_transfer mode must not show a UPI QR panel');
 const bothPdf=await buildPublicDocumentPdf({...doc,settlementDisplayMode:'both'});
 const bothText=bothPdf.toString('latin1');
 assert.match(bothText,/Sample Bank/,'explicit both mode must show bank details');
 assert.match(bothText,/Pay Now via UPI/,'explicit both mode must show the UPI payment action');
 const bankFallback=await buildPublicDocumentPdf({...doc,upiId:null,settlementDisplayMode:undefined});
 assert.match(bankFallback.toString('latin1'),/Sample Bank/,'when UPI is absent the renderer should default to bank transfer');

  const unregisteredPdf=await buildPublicDocumentPdf({...doc,total:190,taxTotal:0,cgstAmount:0,sgstAmount:0,igstAmount:0,business:{...doc.business,taxRegistrationNumber:null,gstRegistrationType:'NONE'},items:[{...doc.items[0],taxAmount:0,lineTotal:190}]});
  const unregisteredText=unregisteredPdf.toString('latin1');
  assert.ok(unregisteredText.includes('(INVOICE)'),'unregistered supplier must receive an ordinary invoice title');
  assert.doesNotMatch(unregisteredText,/TAX INVOICE|CGST|SGST|IGST|Tax \/ GST/,'unregistered invoice must not claim tax-invoice status or expose GST rows');

  const vatPdf=await buildPublicDocumentPdf({...doc,type:'invoice',total:220,taxTotal:20,cgstAmount:0,sgstAmount:0,igstAmount:0,business:{...doc.business,countryCode:'AE',taxRegime:'VAT',gstRegistrationType:'NONE',taxRegistrationNumber:'TRN123456789',taxId:'TRN123456789'},items:[{...doc.items[0],taxAmount:20,lineTotal:220}]});
  const vatText=vatPdf.toString('latin1');
  assert.ok(vatText.includes('(TAX INVOICE)'),'registered non-Indian VAT business with a tax ID should use the tax-invoice title');
  assert.ok(vatText.includes('Tax ID: TRN123456789'),'non-Indian tax registration should be labeled as Tax ID');
  assert.doesNotMatch(vatText,/CGST|SGST|IGST|GSTIN:/,'VAT documents must not display Indian GST labels');

  const compositionPdf=await buildPublicDocumentPdf({...doc,total:190,taxTotal:0,cgstAmount:0,sgstAmount:0,igstAmount:0,business:{...doc.business,gstRegistrationType:'COMPOSITION'},items:[{...doc.items[0],taxAmount:0,lineTotal:190}]});
  const compositionText=compositionPdf.toString('latin1');
  assert.ok(compositionText.includes('BILL OF SUPPLY'),'composition-scheme supplier with GSTIN should use Bill of Supply');
  assert.doesNotMatch(compositionText,/TAX INVOICE|CGST|SGST|IGST|Tax \/ GST/,'composition-scheme documents must not show tax-invoice status or GST rows');

 const challan={...doc,type:'challan',number:'DC-0004',status:'dispatched',dueDate:null,validUntil:null,amountPaid:0,balanceDue:0,
  placeOfSupplyStateCode:null,supplyType:null,cgstAmount:0,sgstAmount:0,igstAmount:0,bankDetails:null,upiId:null,
  vehicleNumber:'MH24AB1234',transporterName:'Sample Transport',ewayBillNumber:'EWB-12345'};
 const challanPdf=await buildPublicDocumentPdf(challan);
 const challanText=challanPdf.toString('latin1');
 for(const value of ['DELIVERY CHALLAN','Vehicle No: MH24AB1234','Transporter: Sample Transport','E-Way Bill: EWB-12345','NOT FOR SALE / NOT A TAX INVOICE']) assert.ok(challanText.includes(value),'Challan PDF is missing '+value);
 const quotationPdf=await buildPublicDocumentPdf({...doc,type:'quotation',number:'EST-0007',status:'sent',dueDate:null,validUntil:'2026-10-31',amountPaid:0,balanceDue:0,settlementDisplayMode:'none'});
 const quotationText=quotationPdf.toString('latin1');
 for(const value of ['QUOTATION','EST-0007','BILL TO','SHIP TO','#','ITEM / DESCRIPTION','AMOUNT IN WORDS:','Authorized Signatory','This is a computer-generated quotation and does not require signature.']) assert.ok(quotationText.includes(value),'Quotation PDF is missing '+value);
 assert.doesNotMatch(quotationText,/INVOICE SUMMARY/);
 assert.doesNotMatch(quotationText,/Sample Bank|Pay Now via UPI/,'settlement mode none must not render bank or UPI details');

});
function QRCodePlaceholderForTest(pdf){const raw=pdf.toString('latin1');return raw.includes('/Subtype /Link')&&raw.includes('Pay Now via UPI')&&raw.includes('/Annots [');}

test('all official and print PDF filenames follow company-document-number order',async()=>{
 const route=await read('app/api/public-documents/pdf/route.ts');
 const receiptRoute=await read('app/api/receipts/pdf/route.ts');
 const viewer=await read('app/next-workspace/documents/DocumentViewer.tsx');
 const helper=await read('lib/shared/document-filename.ts');

 assert.match(helper,/buildDocumentFilenameBase\(companyName: string, documentName: string, documentNumber: string\)/);
 assert.match(helper,/filenamePart\(companyName, 'Business'\)[\s\S]*?filenamePart\(documentName, 'Document'\)[\s\S]*?filenamePart\(documentNumber, 'Document'\)/);
 assert.match(helper,/buildDocumentFilenameBase\(companyName, documentName, documentNumber\) \+ '\.pdf'/);
 assert.match(route,/return buildDocumentDownloadFilename\(entityName, documentFilenameLabel\(type\), docNumber\)/);
 assert.match(route,/buildDownloadFilename\(type, document\.business\.name \|\| document\.customer\.name/);
 assert.match(route,/Content-Disposition.*attachment; filename=/);
 assert.doesNotMatch(route,/inline; filename=/);
 assert.match(receiptRoute,/buildDocumentDownloadFilename\(/);
 assert.match(receiptRoute,/String\(data\.receipt\.receipt_number \|\| data\.receipt\.id\)/);
 assert.doesNotMatch(receiptRoute,/replace\(\/\^\(\?:REC/);
 assert.match(viewer,/buildDocumentFilenameBase\(/);
 assert.match(viewer,/const printFilename = buildDocumentFilenameBase\([\s\S]*?mergedBusiness\?\.name[\s\S]*?title[\s\S]*?number/);
 assert.match(viewer,/document\.title = printFilename/);
 assert.match(viewer,/doc\.title = printFilename/);
 assert.match(viewer,/frame\.contentWindow\?\.addEventListener\('afterprint', restorePageTitle/);
 assert.match(viewer,/window\.addEventListener\('afterprint', restorePageTitle/);
 assert.match(receiptRoute,/Content-Disposition.*filename=/);
 assert.match(route,/Content-Disposition.*filename=/);
 assert.match(await read('app/invoice/[token]/page.tsx'),/api\/public-documents\/pdf\?type=invoice/);
 assert.match(await read('app/quote/[token]/page.tsx'),/api\/public-documents\/pdf\?type=quotation/);
 assert.match(await read('app/receipt/[token]/page.tsx'),/api\/receipts\/pdf\?token=/);
});

test('public invoice view gates bank and UPI payment cards by the configured settlement mode',async()=>{
 const page=await read('app/invoice/[token]/page.tsx');
 assert.equal((page.match(/<table className=/g)||[]).length,1,'Public invoice must render only one line-item table');
 assert.match(page,/settlementDisplayMode:invoice\.settlement_display_mode/);
 assert.match(page,/showBankSettlement&&invoice\.bank/);
 assert.match(page,/showUpiSettlement&&/);
 assert.doesNotMatch(page,/Pay Now Online/);
 assert.match(page,/showUpiSettlement&&!showBankSettlement\?'SCAN & PAY VIA UPI':showBankSettlement&&!showUpiSettlement\?'BANK DETAILS':'PAYMENT SETTLEMENT'/);
});

test('public invoice page follows the print blueprint for parties, purple table, settlement, statutory fields, and footer',async()=>{
 const page=await read('app/invoice/[token]/page.tsx');
 for(const value of ['invoiceHeading','taxRegistered','showGstBreakdown','BILL TO','SHIP TO','ITEM / DESCRIPTION','QTY','RATE','AMOUNT','bg-[#7c3aed]','text-orange-700','AMOUNT IN WORDS','Authorized Signatory','This is a computer-generated invoice and does not require signature.']) assert.ok(page.includes(value),'Public invoice is missing '+value);
 assert.doesNotMatch(page,/This is a customer-facing invoice shared by/);
 const settlement=page.indexOf('PAYMENT SETTLEMENT');
 const notes=page.indexOf('>NOTES</h3>');
 const totals=page.indexOf('Subtotal');
 assert.ok(settlement>=0&&notes>settlement&&totals>notes,'Expected payment block, notes/terms, then financial totals in the shared layout');
});
test('document toolbar exposes styled actions, copied feedback, and print iframe copies component styles',async()=>{
 const viewer=await read('app/next-workspace/documents/DocumentViewer.tsx');
 assert.match(viewer,/rounded-full bg-purple-600/);
 assert.match(viewer,/Copy customer link/);
 assert.match(viewer,/isCopied \? 'Copied!'/);
 assert.match(viewer,/Customer link copied to clipboard!/);
 assert.match(viewer,/role="status" aria-live="polite"/);
 assert.match(viewer,/document\.querySelectorAll\('style'\)/);
 assert.match(viewer,/stylesheetReady/);
 assert.match(viewer,/settlementDisplayMode=\{canonical\.settlementDisplayMode\}/);
 assert.match(viewer,/aria-haspopup="dialog"/);
 assert.match(viewer,/https:\/\/wa\.me\//);
 assert.match(viewer,/mailto:\?subject=/);
 assert.match(viewer,/copyShareMessage/);
 assert.match(viewer,/Share public link/);
});

test('public quotation uses the standard status, table, statutory blocks, CTA, and disclaimer',async()=>{
 const page=await read('app/quote/[token]/page.tsx');
 const pdf=await read('lib/server/documents/public-pdf.ts');
 for(const value of ['BILL TO','SHIP TO','bg-[#7c3aed]','publicStatus','AMOUNT IN WORDS','Authorized Signatory','Accept Quotation & Request Invoice','This is a computer-generated quotation and does not require signature.']) assert.ok(page.includes(value),'Public quotation is missing '+value);
 assert.match(page,/rpc\('rpc_accept_public_quotation'/);
 assert.match(pdf,/doc\.type === 'invoice' \|\| doc\.type === 'quotation'/);
 assert.match(pdf,/This is a computer-generated quotation and does not require signature\./);
});
test('public receipt page exposes allocations, payment acknowledgement, ledger balance, and disclaimer',async()=>{
 const page=await read('app/receipt/[token]/page.tsx');
 for(const value of ['Invoice Allocation','Invoice No.','Invoice Date','Original Amount','Amount Applied','Payment Mode','UTR / Transaction Ref','Payment Date','Customer Ledger Balance','This is a computer-generated payment receipt and does not require signature.']) assert.ok(page.includes(value),'Public receipt is missing '+value);
 const resolver=await read('lib/server/documents/public-tokens.ts');
 assert.match(resolver,/receiptDetails:/);
 assert.match(resolver,/customerOutstanding/);
});
test('canonical view model powers invoice, quotation, receipt, challan, print and PDF surfaces',async()=>{
 const viewModel=await read('lib/shared/document-view-model.ts');
 const viewer=await read('app/next-workspace/documents/DocumentViewer.tsx');
 const invoice=await read('app/invoice/[token]/page.tsx');
 const quote=await read('app/quote/[token]/page.tsx');
 const receipt=await read('app/receipt/[token]/page.tsx');
 const challan=await read('app/delivery-challan/[token]/page.tsx');
 const publicPdf=await read('lib/server/documents/public-pdf.ts');
 const receiptPdf=await read('lib/server/receipt-pdf.ts');
 assert.match(viewModel,/export interface CanonicalDocumentViewModel/);
 assert.match(viewModel,/taxBreakdown/);
 assert.match(viewModel,/amountInWords/);
 assert.match(viewModel,/upiQrString/);
 for(const source of [viewer,invoice,quote,receipt,challan,publicPdf,receiptPdf]) {
   assert.match(source,/createCanonicalDocumentViewModel/);
 }
 assert.match(invoice,/Pay Now via UPI/);
 assert.match(viewer,/customer_outstanding: type === 'receipt' \? customerBalance/);
 assert.match(publicPdf,/canonical\.financials\.upiQrString/);
});

test('public quotation acceptance is token-authorized, idempotent, and never bypasses invoice posting',async()=>{
 const migration=await read('supabase/migrations/20261011193409_public_quotation_acceptance_and_invoice_dispatch.sql');
 const conversionFix=await read('supabase/migrations/20261011194327_fix_quotation_conversion_call_signature.sql');
 const convertedPreview=await read('supabase/migrations/20261011193431_public_quotation_converted_preview.sql');
 const page=await read('app/quote/[token]/page.tsx');
 assert.match(migration,/CREATE OR REPLACE FUNCTION public\.accept_public_quotation/);
 assert.match(migration,/public_accept_token = btrim\(p_public_accept_token\)/);
 assert.match(migration,/q\.created_by IS NULL/);
 assert.match(migration,/mm_private\.has_business_permission\(q\.business_id,'sales\.create',q\.created_by\)/);
 assert.match(migration,/public\.convert_quotation_to_invoice/);
 assert.match(conversionFix,/v_items,[\s\S]*?NULL,[\s\S]*?0,[\s\S]*?q\.notes,[\s\S]*?q\.terms/);
 assert.match(conversionFix,/public\.create_invoice_from_items/);
 assert.match(migration,/delivery_pending_posting/);
 assert.match(migration,/NEW\.journal_entry_id IS NULL/);
 assert.match(migration,/DEFERRABLE INITIALLY DEFERRED/);
 assert.match(migration,/delivery_idempotency_key/);
 assert.match(convertedPreview,/q\.status NOT IN \('sent', 'accepted', 'converted'\)/);
 assert.match(convertedPreview,/invoice_number/);
 assert.match(page,/supabase\.rpc\('rpc_accept_public_quotation'/);
 assert.doesNotMatch(page,/mailto:/);
 assert.match(page,/must post the invoice before its secure customer invoice link becomes available/);
});

test('notification dispatch shares only balance-aware INR UPI intent and configured payment link',async()=>{
 const migration=await read('supabase/migrations/20261011193404_public_invoice_upi_dispatch.sql');
 const viewMigration=await read('supabase/migrations/20261011193856_public_invoice_upi_view.sql');
 const settingsGuard=await read('supabase/migrations/20261011194022_public_invoice_upi_settings_guard.sql');
 const worker=await read('supabase/functions/process-notifications/index.ts');
 assert.match(migration,/resolve_public_document_dispatch_base/);
 assert.match(migration,/dps\.upi_id/);
 assert.match(migration,/REVOKE ALL ON FUNCTION public\.resolve_public_document_dispatch\(uuid,text,uuid,text\)[\s\S]*?FROM PUBLIC, anon, authenticated/);
 assert.match(viewMigration,/LEFT JOIN public\.document_payment_settings dps/);
 assert.match(viewMigration,/'upi_id', CASE/);
 assert.match(viewMigration,/'payment_qr_enabled'/);
 assert.match(settingsGuard,/coalesce\(dps\.payment_qr_enabled, true\)/);
 assert.match(settingsGuard,/ELSE NULL END/);
 assert.match(worker,/documentType === "invoice" && currencyCode === "INR" && balanceDue > 0 && upiId/);
 assert.match(worker,/upi_qr_string: upiQrString/);
 assert.match(worker,/Pay Now via UPI/);
 assert.match(worker,/sendDocument/);
 assert.match(worker,/attachments/);
});

test('notification worker requires a Vault cron token or a permission-checked manual-test session',async()=>{
 const worker=await read('supabase/functions/process-notifications/index.ts');
 const migration=await read('supabase/migrations/20261012070315_protect_notification_worker_endpoint.sql');
 assert.match(worker,/x-moneymatters-worker-token/);
 assert.match(worker,/is_notification_worker_token_valid/);
 assert.match(worker,/admin\.auth\.getUser\(bearer\)/);
 assert.match(worker,/authorize_notification_test_dispatch/);
 assert.match(worker,/return json\(\{ error: "Unauthorized" \}, 401\)/);
 assert.match(migration,/vault\.create_secret/);
 assert.match(migration,/cron\.alter_job/);
 assert.match(migration,/notification_worker_token/);
 assert.match(migration,/j\.notification_type = 'manual_test'/);
 assert.match(migration,/mm_private\.has_business_permission/);
 assert.match(migration,/GRANT EXECUTE ON FUNCTION public\.is_notification_worker_token_valid\(text\)\s+TO service_role/);
 assert.match(migration,/GRANT EXECUTE ON FUNCTION public\.authorize_notification_test_dispatch\(uuid,uuid\)\s+TO service_role/);
});

test('public customer PDF links request company-document-number filenames',async()=>{
 const invoice=await read('app/invoice/[token]/page.tsx');
 const quote=await read('app/quote/[token]/page.tsx');
 const receipt=await read('app/receipt/[token]/page.tsx');
 const helper=await read('lib/shared/document-filename.ts');
 for(const source of [invoice,quote,receipt]) assert.match(source,/download=\{buildDocumentDownloadFilename/);
 assert.match(invoice,/documentFilenameLabel\('invoice'\)/);
 assert.match(quote,/documentFilenameLabel\('quotation'\)/);
 assert.match(receipt,/documentFilenameLabel\('receipt'\)/);
 assert.match(helper,/buildDocumentDownloadFilename/);
});
