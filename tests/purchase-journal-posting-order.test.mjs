import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (p) => readFile(new URL(p, root), 'utf8');

test('purchase bill posting adds journal lines while draft and posts only after balance validation', async () => {
  const migration = await read('supabase/migrations/20261017170000_fix_purchase_journal_posting_order.sql');
  const headerInsert = migration.indexOf("values(b.business_id,v_entry_number,b.bill_date,'Bill '||b.bill_number");
  const firstJournalLine = migration.indexOf('insert into public.journal_lines');
  const balanceCheck = migration.indexOf('perform public.validate_journal_entry_balance(v_entry);');
  const postUpdate = migration.indexOf("set status='posted', posted_at=now(), posted_by=auth.uid()");
  const billLink = migration.indexOf('update public.bills set journal_entry_id=v_entry');

  assert.ok(headerInsert >= 0);
  assert.ok(firstJournalLine > headerInsert);
  assert.match(migration, /'bill',b\.id,'draft',NULL,NULL/);
  assert.ok(balanceCheck > firstJournalLine);
  assert.ok(postUpdate > balanceCheck);
  assert.ok(billLink > postUpdate);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.post_bill_legacy\(uuid\) FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.post_bill_legacy\(uuid\) TO service_role/);
});
