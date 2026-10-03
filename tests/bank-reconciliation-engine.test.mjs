import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as ts from 'typescript';

const root = new URL('../', import.meta.url);
const read = (p) => readFile(new URL(p, root), 'utf8');

const loadTsModule = async (path) => {
  const source = await read(path);
  const sanitized = source
    .replace(/^import type[^;]+;\s*$/gm, '')
    .replace(/^import ['"][^'"]+['"];\s*$/gm, '');
  const compiled = ts.transpileModule(sanitized, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
    fileName: path,
  }).outputText;
  const url = 'data:text/javascript;base64,' + Buffer.from(compiled, 'utf8').toString('base64');
  return import(url);
};

const loadBankMatching = async () => {
  const rules = (await read('lib/server/banking/rules.ts'))
    .replace(/^import type[^;]+;\s*$/gm, '');
  const matching = (await read('lib/server/banking/matching.ts'))
    .replace(/^import type[^;]+;\s*$/gm, '')
    .replace(/^import \{ applyBankReconciliationRules \} from ['"]\.\/rules['"];\s*$/gm, '');
  const compiled = ts.transpileModule(rules + '\n' + matching, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
    fileName: 'bank-matching.ts',
  }).outputText;
  const url = 'data:text/javascript;base64,' + Buffer.from(compiled, 'utf8').toString('base64');
  return import(url);
};

test('CSV parser dynamically maps debit and credit columns', async () => {
  const csv = await read('tests/fixtures/bank-statement.csv');
  const { parseCsvStatement } = await loadTsModule('lib/server/banking/parsers/csv.ts');
  const result = parseCsvStatement(csv);

  assert.equal(result.sourceFormat, 'csv');
  assert.equal(result.transactions.length, 3);
  assert.equal(result.transactions[0].signedAmount, 2500);
  assert.equal(result.transactions[1].signedAmount, -350.5);
  assert.equal(result.transactions[2].reference, 'INV2026002');
  assert.equal(result.openingBalance, 10000);
  assert.equal(result.closingBalance, 13049.5);
});

test('CAMT.053 parser extracts Stmt, Ntry, Amt, CdtDbtInd and RmtInf references', async () => {
  const xml = await read('tests/fixtures/bank-statement.camt053.xml');
  const { parseCamt053Statement } = await loadTsModule('lib/server/banking/parsers/camt053.ts');
  const result = parseCamt053Statement(xml);

  assert.equal(result.sourceFormat, 'camt053');
  assert.equal(result.transactions.length, 2);
  assert.equal(result.transactions[0].signedAmount, 2500);
  assert.equal(result.transactions[0].reference.includes('INV-2026-001'), true);
  assert.equal(result.transactions[1].signedAmount, -100);
  assert.equal(result.openingBalance, 10000);
  assert.equal(result.closingBalance, 12400);
});

test('MT940 parser extracts :60F:, :61: and :86:', async () => {
  const statement = await read('tests/fixtures/bank-statement.mt940');
  const { parseMt940Statement } = await loadTsModule('lib/server/banking/parsers/mt940.ts');
  const result = parseMt940Statement(statement);

  assert.equal(result.sourceFormat, 'mt940');
  assert.equal(result.transactions.length, 2);
  assert.equal(result.transactions[0].signedAmount, 2500);
  assert.equal(result.transactions[0].description.includes('INV-2026-001'), true);
  assert.equal(result.transactions[1].signedAmount, -100);
  assert.equal(result.openingBalance, 10000);
  assert.equal(result.closingBalance, 12400);
  assert.equal(result.currencyCode, 'INR');
});

test('OFX and QBO parser extracts STMTTRN records', async () => {
  const ofx = await read('tests/fixtures/bank-statement.ofx');
  const { parseOfxStatement } = await loadTsModule('lib/server/banking/parsers/ofx.ts');

  const ofxResult = parseOfxStatement(ofx, 'ofx');
  assert.equal(ofxResult.sourceFormat, 'ofx');
  assert.equal(ofxResult.transactions.length, 2);
  assert.equal(ofxResult.transactions[0].signedAmount, 2500);
  assert.equal(ofxResult.transactions[0].externalTransactionId, 'FIT-001');
  assert.equal(ofxResult.closingBalance, 12400);

  const qboResult = parseOfxStatement(ofx, 'qbo');
  assert.equal(qboResult.sourceFormat, 'qbo');
  assert.equal(qboResult.transactions.length, 2);
});

test('fingerprint is deterministic and changes when reference or signed amount changes', async () => {
  const fixture = {
    transactionDate: '2026-10-01',
    valueDate: '2026-10-01',
    description: 'Invoice INV-2026-001',
    reference: 'INV-2026-001',
    signedAmount: 2500,
    runningBalance: 12500,
    externalTransactionId: 'FIT-001',
    rawData: {},
  };
  const { bankTransactionFingerprint, normalizeBankReference } =
    await loadTsModule('lib/server/banking/fingerprint.ts');

  const first = bankTransactionFingerprint('business-a', 'bank-a', fixture);
  const second = bankTransactionFingerprint('business-a', 'bank-a', { ...fixture });
  const changedReference = bankTransactionFingerprint('business-a', 'bank-a', { ...fixture, reference: 'OTHER' });
  const changedAmount = bankTransactionFingerprint('business-a', 'bank-a', { ...fixture, signedAmount: -2500 });

  assert.match(first, /^[0-9a-f]{64}$/);
  assert.equal(first, second);
  assert.notEqual(first, changedReference);
  assert.notEqual(first, changedAmount);
  assert.equal(normalizeBankReference('INV-2026/001'), 'inv2026001');
});

test('heuristic matching distinguishes exact invoice matches and gateway-fee differences', async () => {
  const { matchInvoiceReference, matchGatewayFee } = await loadBankMatching();
  const transaction = {
    transactionDate: '2026-10-01',
    valueDate: '2026-10-01',
    description: 'PAYABLE settlement INV-2026-001',
    reference: 'INV2026001',
    signedAmount: 975,
    runningBalance: 10975,
    externalTransactionId: 'P-1',
    rawData: {},
  };
  const invoice = {
    id: 'invoice-1',
    invoiceNumber: 'INV-2026-001',
    balanceDue: 1000,
    currencyCode: 'INR',
  };

  assert.equal(matchInvoiceReference({ ...transaction, signedAmount: 1000 }, invoice)?.type, 'invoice');
  const feeMatch = matchGatewayFee(transaction, invoice, {
    gatewayFeeTolerancePct: 0.03,
    gatewayFeeToleranceAmount: 50,
  });
  assert.equal(feeMatch?.type, 'gateway_fee');
  assert.equal(feeMatch?.differenceAmount, 25);
});

test('recurring rules score matching transactions and expose explicit auto-apply state', async () => {
  const { applyBankReconciliationRules } = await loadTsModule('lib/server/banking/rules.ts');
  const suggestion = applyBankReconciliationRules({
    transactionDate: '2026-10-01',
    valueDate: '2026-10-01',
    description: 'Electricity Provider Monthly Bill',
    reference: 'ELEC-100',
    signedAmount: -2500,
    runningBalance: 7500,
    externalTransactionId: null,
    rawData: {},
  }, [{
    id: 'rule-1',
    name: 'Electricity Provider',
    priority: 10,
    enabled: true,
    direction: 'outbound',
    referencePattern: '^ELEC',
    descriptionPattern: 'electricity',
    counterpartyPattern: null,
    amountMin: 1000,
    amountMax: 5000,
    targetAccountId: 'account-utility',
    autoApply: true,
    confidenceThreshold: 0.90,
  }]);

  assert.equal(suggestion?.ruleId, 'rule-1');
  assert.equal(suggestion?.targetAccountId, 'account-utility');
  assert.equal(suggestion?.autoApply, true);
});

test('Gate 3 SQL enforces unique fingerprints, accounting period authority, and immutable locks', async () => {
  const sql = await read('supabase/migrations/20261003190000_gate3_bank_reconciliation_engine.sql');
  assert.match(sql, /UNIQUE \(business_id, bank_account_id, fingerprint\)/);
  assert.match(sql, /status IN \('closed','locked'\)/);
  assert.match(sql, /trg_prevent_locked_reconciliation_mutation/);
  assert.match(sql, /Bank transaction belongs to a locked reconciliation/);
  assert.match(sql, /Bank reconciliation item belongs to a locked reconciliation/);
  assert.match(sql, /reverse_locked_bank_reconciliation/);
  assert.match(sql, /mm_private\.bank_reversal_context/);
  assert.match(sql, /bank_reconciliation_reversal/);
  assert.match(sql, /PERFORM public\.assert_accounting_period_open\(r\.business_id, r\.period_start\)/);
});

test('statement import API parses, fingerprints, matches, and hands rows to one database transaction RPC', async () => {
  const route = await read('app/api/banking/statements/import/route.ts');
  assert.match(route, /multipart|formData/);
  assert.match(route, /parseBankStatement/);
  assert.match(route, /bankTransactionFingerprint/);
  assert.match(route, /import_bank_statement_rows/);
  assert.match(route, /total_rows/);
  assert.match(route, /duplicate_skipped_rows/);
  assert.match(route, /balance_verified/);
});
