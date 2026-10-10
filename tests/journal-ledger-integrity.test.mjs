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
