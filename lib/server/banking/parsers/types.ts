export type BankSourceFormat = 'csv' | 'camt053' | 'mt940' | 'ofx' | 'qbo';

export interface CanonicalBankTransaction {
  transactionDate: string;
  valueDate: string | null;
  description: string;
  reference: string;
  signedAmount: number;
  runningBalance: number | null;
  externalTransactionId: string | null;
  rawData: Record<string, string>;
}

export interface BankStatementParseResult {
  sourceFormat: BankSourceFormat;
  transactions: CanonicalBankTransaction[];
  statementStart: string | null;
  statementEnd: string | null;
  openingBalance: number | null;
  closingBalance: number | null;
  currencyCode: string | null;
}

export class BankStatementParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BankStatementParseError';
  }
}
