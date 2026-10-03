import { createHash } from 'node:crypto';
import type { CanonicalBankTransaction } from './parsers/types';

export const normalizeBankReference = (value: string | null | undefined): string =>
  (value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');

export const sha256Hex = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex');

export const signedAmountForFingerprint = (transaction: CanonicalBankTransaction): string => {
  const amount = Object.is(transaction.signedAmount, -0) ? 0 : transaction.signedAmount;
  return amount.toFixed(2);
};

export const bankTransactionFingerprint = (
  businessId: string,
  bankAccountId: string,
  transaction: CanonicalBankTransaction,
): string => {
  const normalizedReferenceHash = sha256Hex(normalizeBankReference(transaction.reference));
  const input =
    businessId +
    bankAccountId +
    transaction.transactionDate +
    signedAmountForFingerprint(transaction) +
    normalizedReferenceHash;

  return sha256Hex(input);
};

export const statementContentHash = (content: string | Uint8Array): string =>
  createHash('sha256').update(content).digest('hex');
