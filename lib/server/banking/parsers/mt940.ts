import type { BankStatementParseResult, CanonicalBankTransaction } from './types';

const parseAmount = (value: string): number => {
  const parsed = Number(value.replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(parsed) || parsed === 0) throw new Error('MT940 contains an invalid transaction amount');
  return parsed;
};

const fieldLines = (text: string): string[] =>
  text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

const parseBalanceField = (value: string): { date: string; amount: number; currency: string } => {
  const match = value.match(/^([CD])(\d{6})([A-Z]{3})([\d,]+)$/);
  if (!match) throw new Error('MT940 balance field is invalid');

  return {
    date: '20' + match[2].slice(0, 2) + '-' + match[2].slice(2, 4) + '-' + match[2].slice(4, 6),
    amount: (match[1] === 'D' ? -1 : 1) * parseAmount(match[4]),
    currency: match[3],
  };
};

export const parseMt940Statement = (text: string): BankStatementParseResult => {
  const lines = fieldLines(text);
  const transactions: CanonicalBankTransaction[] = [];
  let currentTransaction: CanonicalBankTransaction | null = null;
  let openingBalance: number | null = null;
  let openingDate: string | null = null;
  let closingBalance: number | null = null;
  let closingDate: string | null = null;
  let currencyCode: string | null = null;

  for (const line of lines) {
    if (line.startsWith(':60F:') || line.startsWith(':60M:')) {
      const balance = parseBalanceField(line.slice(5).trim());
      openingDate = balance.date;
      openingBalance = balance.amount;
      currencyCode = balance.currency;
      continue;
    }

    if (line.startsWith(':62F:') || line.startsWith(':62M:')) {
      const balance = parseBalanceField(line.slice(5).trim());
      closingDate = balance.date;
      closingBalance = balance.amount;
      currencyCode = balance.currency;
      continue;
    }

    if (line.startsWith(':61:')) {
      const value = line.slice(4).trim();
      const head = value.match(/^(\d{6})(\d{4})?([CD])/);
      if (!head) throw new Error('MT940 transaction line is invalid');

      const transactionDate =
        '20' + head[1].slice(0, 2) + '-' + head[1].slice(2, 4) + '-' + head[1].slice(4, 6);

      let remainder = value.slice(head[0].length);
      remainder = remainder.replace(/^[A-Z]{1,2}/, '');

      const amountMatch = remainder.match(/^([0-9][0-9,.]*)/);
      if (!amountMatch) throw new Error('MT940 transaction amount is invalid');

      const amount = parseAmount(amountMatch[1]);
      const suffix = remainder.slice(amountMatch[1].length);
      const reference =
        (suffix.match(/\/\/(.+)$/)?.[1] ?? suffix.replace(/^N[A-Z0-9]*/, '')).trim();

      currentTransaction = {
        transactionDate,
        valueDate: transactionDate,
        description: '',
        reference,
        signedAmount: head[3] === 'C' ? amount : -amount,
        runningBalance: null,
        externalTransactionId: reference || null,
        rawData: { tag61: value },
      };

      transactions.push(currentTransaction);
      continue;
    }

    if (line.startsWith(':86:') && currentTransaction) {
      const info = line.slice(4).trim();
      currentTransaction.description = info;
      currentTransaction.rawData.tag86 = info;
    }
  }

  if (!transactions.length) throw new Error('MT940 statement does not contain :61: transactions');

  const dates = transactions.map((transaction) => transaction.transactionDate).sort();

  return {
    sourceFormat: 'mt940',
    transactions,
    statementStart: openingDate ?? dates[0] ?? null,
    statementEnd: closingDate ?? dates.at(-1) ?? null,
    openingBalance,
    closingBalance,
    currencyCode,
  };
};
