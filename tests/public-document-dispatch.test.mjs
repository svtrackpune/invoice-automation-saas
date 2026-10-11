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
 const sql=await read('supabase/migrations/20261011170000_public_receipt_link_rpc.sql');
 assert.match(ui,/create_public_receipt_link/);
 assert.match(ui,/\/receipt\/\[A-Fa-f0-9\]\{48,128\}/);
 assert.doesNotMatch(ui,/window\.location\.origin\}\/next-workspace\/documents\?type=receipt&id=/);
 assert.match(sql,/public\._issue_receipt_access_token\(p_receipt_id, 'customer_download'\)/);
 assert.match(sql,/REVOKE ALL ON FUNCTION public\.create_public_receipt_link\(uuid\) FROM PUBLIC, anon/);
 assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.create_public_receipt_link\(uuid\) TO authenticated/);
});
