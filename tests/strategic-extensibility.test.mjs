import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root=new URL('../',import.meta.url);
const migration=await readFile(new URL('supabase/migrations/20261003120000_strategic_gap_extensibility_v1.sql',root),'utf8');
const auth=await readFile(new URL('lib/server/api-key-auth.ts',root),'utf8');
const invoices=await readFile(new URL('app/api/v1/invoices/route.ts',root),'utf8');
const customers=await readFile(new URL('app/api/v1/customers/route.ts',root),'utf8');
const items=await readFile(new URL('app/api/v1/items/route.ts',root),'utf8');
const balances=await readFile(new URL('app/api/v1/inventory/balances/route.ts',root),'utf8');
const worker=await readFile(new URL('supabase/functions/process-webhooks/index.ts',root),'utf8');

test('API key database boundary is hashed, scoped and revocable',()=>{
  assert.match(migration,/CREATE TABLE IF NOT EXISTS public\.api_keys/i);
  assert.match(migration,/key_hash char\(64\)/i);
  assert.match(migration,/revoked_at timestamptz/i);
  assert.match(migration,/invoices:read/i);
  assert.match(auth,/createHash\('sha256'\)/);
  assert.match(auth,/^.*mm_live_/m);
});

test('public API endpoints use bearer key authentication and tenant scoping',()=>{
  for(const source of [invoices,customers,items,balances]) {
    assert.match(source,/authenticatePublicApi/);
    assert.match(source,/businessId/);
  }
});

test('invoice mutation delegates to existing financial RPCs',()=>{
  assert.match(migration,/api_create_invoice_from_items/);
  assert.match(migration,/public\.create_invoice_from_items/);
  assert.match(migration,/public\.post_invoice/);
  assert.match(migration,/validate_journal_entry_balance/);
});

test('webhooks have HMAC signatures and bounded exponential retries',()=>{
  assert.match(migration,/webhook_subscriptions/);
  assert.match(migration,/webhook_delivery_logs/);
  assert.match(worker,/HMAC/);
  assert.match(worker,/X-Moneymatters-Signature/);
  assert.match(worker,/attempt\)>=5/);
  assert.match(worker,/2\*\*/);
});

test('financial webhook hooks swallow subsystem failures',()=>{
  assert.match(migration,/Webhook invoice\.posted enqueue failed/);
  assert.match(migration,/Webhook payment\.received enqueue failed/);
  assert.match(migration,/Webhook stock\.threshold_breached enqueue failed/);
});