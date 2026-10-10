import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const migration=readFileSync('supabase/migrations/20261010120000_harden_journal_ledger_invariants.sql','utf8');
test('cross-row parity checks are deferred to transaction completion',()=>{
 assert.match(migration,/CREATE CONSTRAINT TRIGGER trg_journal_entries_balance_guard[\s\S]*?AFTER INSERT OR UPDATE[\s\S]*?DEFERRABLE INITIALLY DEFERRED/i);
 assert.match(migration,/CREATE CONSTRAINT TRIGGER trg_journal_lines_balance_guard[\s\S]*?AFTER INSERT OR UPDATE OR DELETE[\s\S]*?DEFERRABLE INITIALLY DEFERRED/i);
});
test('posted/locked entries require at least two balanced lines at cent precision',()=>{
 assert.match(migration,/v_status IN \('posted','locked'\)/);
 assert.match(migration,/v_count < 2 OR v_debit <> v_credit/);
 assert.match(migration,/round\(coalesce\(sum\(debit\),0\),2\)/i);
 assert.match(migration,/round\(coalesce\(sum\(credit\),0\),2\)/i);
 assert.match(migration,/USING ERRCODE='23514'/i);
 assert.match(migration,/LED-001 VIOLATION/);
});
test('posted journal lines cannot be appended and posted entries cannot be deleted',()=>{
 assert.match(migration,/BEFORE INSERT ON public\.journal_lines[\s\S]*?fn_guard_posted_journal_line_insert/i);
 assert.match(migration,/BEFORE DELETE ON public\.journal_entries[\s\S]*?fn_prevent_posted_journal_entry_delete/i);
});
test('migration does not rewrite or delete historical journal rows',()=>{
 assert.match(migration,/NOT VALID/);
 assert.doesNotMatch(migration,/UPDATE public\.journal_entries[\s\S]{0,120}status\s*=\s*'draft'/i);
 assert.doesNotMatch(migration,/DELETE FROM public\.journal_(entries|lines)/i);
});

test('pre-post totals trigger returns the same LED-001 constraint error',()=>{
 assert.match(migration,/CREATE OR REPLACE FUNCTION mm_private\.set_journal_totals\(\)[\s\S]*?v_line_count < 2[\s\S]*?LED-001 VIOLATION[\s\S]*?USING ERRCODE = '23514'/i);
});


// Opt-in database integration coverage. Point LEDGER_TEST_DATABASE_URL at a
// disposable migrated PostgreSQL database with a seeded business and two
// active accounts. The entire exercise is transactionally rolled back.
import { spawnSync } from 'node:child_process';

const ledgerTestDatabaseUrl = process.env.LEDGER_TEST_DATABASE_URL;

test('PostgreSQL integration rejects an unbalanced post and accepts a balanced post', {
  skip: ledgerTestDatabaseUrl ? false : 'set LEDGER_TEST_DATABASE_URL to a disposable migrated test database',
}, () => {
  const sql = `BEGIN;
DO $ledger_integration_test$
DECLARE
  v_business uuid;
  v_accounts uuid[];
  v_entry_id uuid;
  v_entry_number bigint;
  v_entry_date date;
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);
  SELECT a.business_id, array_agg(a.id ORDER BY a.code NULLS LAST, a.id)
    INTO v_business, v_accounts
    FROM public.accounts a
   WHERE a.is_active
   GROUP BY a.business_id
  HAVING count(*) >= 2
   ORDER BY a.business_id
   LIMIT 1;

  IF v_business IS NULL OR array_length(v_accounts, 1) < 2 THEN
    RAISE EXCEPTION 'LEDGER_TEST_FIXTURE_REQUIRED: seed one business with two active accounts';
  END IF;

  SELECT greatest(current_date, coalesce(max(period_end) + 1, current_date))
    INTO v_entry_date
    FROM public.accounting_periods
   WHERE business_id = v_business
     AND status IN ('closed', 'locked');

  PERFORM pg_advisory_xact_lock(hashtext('LED-001-integration:' || v_business::text));
  SELECT coalesce(max(entry_number), 0) + 1000000
    INTO v_entry_number
    FROM public.journal_entries
   WHERE business_id = v_business;

  -- Force deferred constraint triggers to run at each posting transition.
  SET CONSTRAINTS trg_journal_entries_balance_guard, trg_journal_lines_balance_guard IMMEDIATE;

  BEGIN
    INSERT INTO public.journal_entries(business_id, entry_number, entry_date, description, source_type, status)
    VALUES (v_business, v_entry_number, v_entry_date, 'LED-001 integration unbalanced rollback', 'test', 'draft')
    RETURNING id INTO v_entry_id;

    INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit, description)
    VALUES
      (v_entry_id, v_accounts[1], 100, 0, 'integration debit'),
      (v_entry_id, v_accounts[2], 0, 1, 'integration mismatched credit');

    UPDATE public.journal_entries
       SET status = 'posted', posted_at = clock_timestamp()
     WHERE id = v_entry_id;

    RAISE EXCEPTION 'LEDGER_TEST_ASSERTION_FAILED: unbalanced posting unexpectedly succeeded'
      USING ERRCODE = 'P0001';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE 'LED-001 VIOLATION:%' THEN
      RAISE;
    END IF;
  END;

  INSERT INTO public.journal_entries(business_id, entry_number, entry_date, description, source_type, status)
  VALUES (v_business, v_entry_number + 1, v_entry_date, 'LED-001 integration balanced rollback', 'test', 'draft')
  RETURNING id INTO v_entry_id;

  INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit, description)
  VALUES
    (v_entry_id, v_accounts[1], 100, 0, 'integration balanced debit'),
    (v_entry_id, v_accounts[2], 0, 100, 'integration balanced credit');

  UPDATE public.journal_entries
     SET status = 'posted', posted_at = clock_timestamp()
   WHERE id = v_entry_id;

  IF NOT EXISTS (
    SELECT 1 FROM public.journal_entries
     WHERE id = v_entry_id AND status::text = 'posted'
       AND round(total_debit, 2) = 100 AND round(total_credit, 2) = 100
  ) THEN
    RAISE EXCEPTION 'LEDGER_TEST_ASSERTION_FAILED: balanced journal did not post with balanced totals';
  END IF;
END;
$ledger_integration_test$;
ROLLBACK;`;

  const result = spawnSync('psql', [
    '--no-psqlrc',
    '--set=ON_ERROR_STOP=1',
    ledgerTestDatabaseUrl,
    '--command',
    sql,
  ], {
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, PGCONNECT_TIMEOUT: '10' },
  });

  assert.equal(
    result.error,
    undefined,
    'Could not start psql; install the PostgreSQL client in the integration-test environment',
  );
  assert.equal(
    result.status,
    0,
    `Ledger integration test failed. stderr: ${result.stderr || '(empty)'}`,
  );
});
