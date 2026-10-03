import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root=new URL('../',import.meta.url);
const migration=await readFile(new URL('supabase/migrations/20261003140000_strategic_gap_offline_pos_v1.sql',root),'utf8');
const entitlement=await readFile(new URL('supabase/migrations/20261003143500_strategic_gap_entitlement_enforcement_v1.sql',root),'utf8');
const queue=await readFile(new URL('lib/client/offline-cash-bills.ts',root),'utf8');
const sync=await readFile(new URL('components/OfflineCashBillSync.tsx',root),'utf8');
const sw=await readFile(new URL('public/pos-sw.js',root),'utf8');

test('offline queue uses IndexedDB, cryptographic UUIDs and sequential device tickets',()=>{
  assert.match(queue,/indexedDB\.open/);
  assert.match(queue,/offline_cash_bills/);
  assert.match(queue,/crypto\.randomUUID\(\)/);
  assert.match(queue,/deviceToken/);
  assert.match(queue,/POS-/); assert.match(queue,/deviceToken/);
  assert.match(queue,/padStart\(6,'0'\)/);
});

test('server deduplicates packet retries before financial posting',()=>{
  assert.match(migration,/UNIQUE\(business_id,temp_pos_uuid\)/);
  assert.match(migration,/pg_advisory_xact_lock/);
  assert.match(migration,/request_hash char\(64\)/);
  assert.match(migration,/Offline POS idempotency conflict/);
  assert.match(migration,/public\.create_cash_bill\(/);
});

test('replay goes through the entitlement-aware sync RPC',()=>{
  assert.match(sync,/sync_offline_cash_bill/);
  assert.match(entitlement,/offline_pos_enabled/);
  assert.doesNotMatch(sync,/rpc\('create_cash_bill'/);
});

test('service worker uses Background Sync and broadcasts reconnect requests',()=>{
  assert.match(sw,/addEventListener\('sync'/);
  assert.match(sw,/moneymatters-pos-sync/);
  assert.match(sw,/POS_SYNC_REQUESTED/);
  assert.doesNotMatch(sw,/addEventListener\('online'/);
});