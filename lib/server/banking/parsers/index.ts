import type { BankStatementParseResult } from './types';
import { parseCsvStatement } from './csv';
import { parseCamt053Statement } from './camt053';
import { parseMt940Statement } from './mt940';
import { parseOfxStatement } from './ofx';

export const parseBankStatement = (
  source: string,
  filename: string,
): BankStatementParseResult => {
  const lower = filename.toLowerCase();

  if (lower.endsWith('.csv')) return parseCsvStatement(source);
  if (lower.endsWith('.940') || lower.endsWith('.mt940')) return parseMt940Statement(source);
  if (lower.endsWith('.ofx')) return parseOfxStatement(source, 'ofx');
  if (lower.endsWith('.qbo')) return parseOfxStatement(source, 'qbo');

  if (/<(?:[A-Za-z_][\w.-]*:)?Stmt[\s>]/i.test(source) && /<Ntry[\s>]/i.test(source)) {
    return parseCamt053Statement(source);
  }

  if (/<STMTTRN[\s>]/i.test(source)) {
    return parseOfxStatement(source, 'ofx');
  }

  throw new Error('Unsupported bank statement format. Use CSV, CAMT.053 XML, MT940, OFX, or QBO.');
};

export type { BankStatementParseResult, CanonicalBankTransaction, BankSourceFormat } from './types';
