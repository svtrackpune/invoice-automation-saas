import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (p) => readFile(new URL(p, root), 'utf8');

test('customer payment journal is draft until tender lines are inserted and validated', async () => {
  const migration = await read('supabase/migrations/20261017180000_fix_customer_payment_journal_posting_order.sql');
  const header = migration.indexOf("'payment',v_payment,'draft',NULL,NULL");
  const firstLine = migration.indexOf("INSERT INTO public.journal_lines");
  const balance = migration.indexOf("PERFORM public.validate_journal_entry_balance(v_entry);", firstLine);
  const posting = migration.indexOf("UPDATE public.journal_entries SET status='posted', posted_at=now(), posted_by=auth.uid() WHERE id=v_entry AND status='draft'");
  const paymentLink = migration.indexOf("UPDATE public.payments SET journal_entry_id=v_entry WHERE id=v_payment");

  assert.ok(header >= 0);
  assert.ok(firstLine > header);
  assert.ok(balance > firstLine);
  assert.ok(posting > balance);
  assert.ok(paymentLink > posting);
  assert.match(migration, /LED-001: journal lines can only be attached while the header is draft/);
  assert.match(migration, /IF NOT FOUND THEN RAISE EXCEPTION 'Payment posting refused/);
});

test('cash bill tender remains one transaction through invoice posting, payment journal and receipt creation', async () => {
  const cashBill = await read('app/next-workspace/cash-bill/page.tsx');
  const databaseMigration = await read('supabase/migrations/20261017180000_fix_customer_payment_journal_posting_order.sql');

  assert.match(cashBill, /supabase\.rpc\('create_cash_bill'/);
  assert.match(databaseMigration, /INSERT INTO public\.payments/);
  assert.match(databaseMigration, /INSERT INTO public\.receipts/);
  assert.match(databaseMigration, /UPDATE public\.invoices SET amount_paid=v_total/);
});
