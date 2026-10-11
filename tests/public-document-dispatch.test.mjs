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
 assert.ok(ui.includes('const copyLink=async(id:string)=>{'));
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
 const quotations=await read('app/next-workspace/quotation/QuotationWorkspaceControlled.tsx');
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
 assert.ok(quotations.includes("getPublicDocumentUrl('quotation',quote.id)"));
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
