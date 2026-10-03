import type { BankStatementParseResult, CanonicalBankTransaction } from './types';

const normalizeHeader = (value: string): string =>
  value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const parseNumber = (value: string): number | null => {
  const cleaned = value.trim().replace(/\s/g, '').replace(/₹/g, '');
  if (!cleaned) return null;
  const negative = /^\(.*\)$/.test(cleaned);
  const bare = cleaned.replace(/^\(|\)$/g, '').replace(/,/g, '');
  const n = Number(bare);
  if (!Number.isFinite(n)) return null;
  return negative ? -Math.abs(n) : n;
};

const parseDate = (value: string): string | null => {
  const input = value.trim();
  if (!input) return null;
  let m = input.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0');
  m = input.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) return m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
  m = input.match(/^(\d{1,2})[- ]([A-Za-z]{3,9})[- ](\d{2,4})$/);
  if (m) {
    const months: Record<string, number> = {jan:1,january:1,feb:2,february:2,mar:3,march:3,apr:4,april:4,may:5,jun:6,june:6,jul:7,july:7,aug:8,august:8,sep:9,sept:9,september:9,oct:10,october:10,nov:11,november:11,dec:12,december:12};
    const year = Number(m[3].length === 2 ? '20' + m[3] : m[3]);
    const month = months[m[2].toLowerCase()];
    if (month && year >= 1900 && year <= 2200) return year + '-' + String(month).padStart(2, '0') + '-' + m[1].padStart(2, '0');
  }
  const parsed = Date.parse(input);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : null;
};

const parseCsvRows = (text: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const current = text[i];
    const next = text[i + 1];
    if (current === '"' && quoted && next === '"') { cell += '"'; i += 1; continue; }
    if (current === '"') { quoted = !quoted; continue; }
    if (current === ',' && !quoted) { row.push(cell.trim()); cell = ''; continue; }
    if ((current === '\n' || current === '\r') && !quoted) {
      if (current === '\r' && next === '\n') i += 1;
      row.push(cell.trim()); cell = '';
      if (row.some(Boolean)) rows.push(row);
      row = [];
      continue;
    }
    cell += current;
  }
  if (cell !== '' || row.length) {
    row.push(cell.trim());
    if (row.some(Boolean)) rows.push(row);
  }
  return rows;
};

const findIndex = (headers: string[], candidates: string[]): number => {
  for (const candidate of candidates) {
    const index = headers.findIndex((header) => header === candidate);
    if (index >= 0) return index;
  }
  return -1;
};

const firstIndexContaining = (headers: string[], terms: string[]): number =>
  headers.findIndex((header) => terms.some((term) => header.includes(term)));

export const parseCsvStatement = (text: string): BankStatementParseResult => {
  const rows = parseCsvRows(text);
  if (rows.length < 2) throw new Error('CSV statement must contain a header and at least one row');

  const headers = rows[0].map(normalizeHeader);
  const dateIndex = findIndex(headers, ['date','transaction date','value date','posted date']);
  const descriptionIndex = findIndex(headers, ['description','narration','details','memo','transaction description']);
  const referenceIndex = findIndex(headers, ['reference','reference number','ref no','transaction reference','utr','rrn','cheque number']);
  const signedAmountIndex = findIndex(headers, ['signed amount','net amount','transaction amount','amount']);
  const debitIndex = firstIndexContaining(headers, ['debit','withdrawal','debit amount']);
  const creditIndex = firstIndexContaining(headers, ['credit','deposit','credit amount']);
  const balanceIndex = findIndex(headers, ['running balance','closing balance','balance','available balance']);

  if (dateIndex < 0) throw new Error('CSV statement date column could not be identified');
  if (signedAmountIndex < 0 && debitIndex < 0 && creditIndex < 0) throw new Error('CSV statement amount columns could not be identified');

  const transactions: CanonicalBankTransaction[] = [];
  for (const source of rows.slice(1)) {
    const date = parseDate(source[dateIndex] ?? '');
    if (!date) throw new Error('CSV statement contains an invalid transaction date');

    const signedAmount = signedAmountIndex >= 0
      ? parseNumber(source[signedAmountIndex] ?? '')
      : (parseNumber(source[creditIndex] ?? '') ?? 0) - (parseNumber(source[debitIndex] ?? '') ?? 0);

    if (signedAmount === null || signedAmount === 0) throw new Error('CSV statement contains an invalid or zero transaction amount');

    const runningBalance = balanceIndex >= 0 ? parseNumber(source[balanceIndex] ?? '') : null;
    const reference = referenceIndex >= 0 ? (source[referenceIndex] ?? '').trim() : '';
    const description = descriptionIndex >= 0 ? (source[descriptionIndex] ?? '').trim() : reference;

    transactions.push({
      transactionDate: date,
      valueDate: date,
      description,
      reference,
      signedAmount,
      runningBalance,
      externalTransactionId: reference || null,
      rawData: Object.fromEntries(headers.map((header, index) => [header || 'column_' + String(index + 1), source[index] ?? ''])),
    });
  }

  const dates = transactions.map((transaction) => transaction.transactionDate).sort();
  const balances = transactions.map((transaction) => transaction.runningBalance).filter((value): value is number => value !== null);

  return {
    sourceFormat: 'csv',
    transactions,
    statementStart: dates[0] ?? null,
    statementEnd: dates.at(-1) ?? null,
    openingBalance: balances.length === transactions.length ? balances[0] - transactions[0].signedAmount : null,
    closingBalance: balances.length === transactions.length ? (balances.at(-1) ?? null) : null,
    currencyCode: null,
  };
};
