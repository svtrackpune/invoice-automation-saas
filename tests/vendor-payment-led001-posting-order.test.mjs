import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  'supabase/migrations/20261017150633_fix_vendor_payment_led001_posting_order.sql',
  'utf8',
);
const purchasePage = readFileSync('app/next-workspace/purchases/[id]/page.tsx', 'utf8');

test('inline purchase payment keeps its existing RPC and sends the required scoped arguments', () => {
  assert.match(purchasePage, /supabase\.rpc\('record_vendor_payment'/);
  for (const arg of [
    'p_business_id:ctx.business_id',
    'p_vendor_id:bill.vendor_id',
    'p_bill_id:bill.id',
    'p_amount:amount',
    'p_method:payMethod',
    'p_account_id:payAccount',
    'p_payment_date:payDate',
    'p_currency_code:ctx.currency_code||\'INR\'',
  ]) assert.ok(purchasePage.includes(arg), 'missing inline RPC argument: ' + arg);
  assert.match(purchasePage, /amount>Number\(bill\.balance_due\)\+0\.005/);
});

test('allocated vendor payments create journal entries as drafts before inserting lines', () => {
  const start = migration.indexOf('CREATE OR REPLACE FUNCTION public.record_vendor_payment(');
  const end = migration.indexOf('CREATE OR REPLACE FUNCTION public.record_vendor_payment_unapplied(');
  const fn = migration.slice(start, end);
  const createEntry = fn.indexOf("'vendor_payment',v_payment,'draft'");
  const addLines = fn.indexOf('INSERT INTO public.journal_lines');
  const postEntry = fn.indexOf("SET status='posted',posted_at=now(),posted_by=auth.uid()");
  assert.ok(start >= 0 && end > start);
  assert.ok(createEntry >= 0 && addLines > createEntry);
  assert.ok(postEntry > addLines);
  assert.match(fn, /account_subtype IN \('cash','bank'\)/);
  assert.match(fn, /IF v_remaining>0 THEN\s+INSERT INTO public\.journal_lines/);
  assert.match(fn, /PERFORM public\.validate_journal_entry_balance\(v_entry\)/);
});

test('unapplied vendor advances follow the same draft-lines-post sequence', () => {
  const start = migration.indexOf('CREATE OR REPLACE FUNCTION public.record_vendor_payment_unapplied(');
  const fn = migration.slice(start);
  const createEntry = fn.indexOf("'vendor_payment',v_payment,'draft'");
  const addLines = fn.indexOf('INSERT INTO public.journal_lines');
  const postEntry = fn.indexOf("SET status='posted',posted_at=now(),posted_by=auth.uid()");
  assert.ok(start >= 0);
  assert.ok(createEntry >= 0 && addLines > createEntry);
  assert.ok(postEntry > addLines);
  assert.match(fn, /account_subtype IN \('cash','bank'\)/);
});

test('security boundary retains authenticated-only execute grants and posted-entry guard', () => {
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.record_vendor_payment\(uuid,uuid,uuid,numeric,text,uuid,text,date,text,text\) FROM PUBLIC,anon/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.record_vendor_payment\(uuid,uuid,uuid,numeric,text,uuid,text,date,text,text\) TO authenticated/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.record_vendor_payment_unapplied\(uuid,uuid,numeric,text,uuid,date,text,text,text\) FROM PUBLIC,anon/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.record_vendor_payment_unapplied\(uuid,uuid,numeric,text,uuid,date,text,text,text\) TO authenticated/);
});
