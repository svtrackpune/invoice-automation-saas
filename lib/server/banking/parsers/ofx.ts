import type { BankStatementParseResult, CanonicalBankTransaction, BankSourceFormat } from './types';

const clean = (value: string | undefined): string =>
  (value ?? '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();

const tagValue = (block: string, tag: string): string => {
  const xml = new RegExp('<' + tag + '>([\s\S]*?)</' + tag + '>', 'i').exec(block)?.[1];
  if (xml !== undefined) return clean(xml.replace(/<[^>]+>/g, ''));

  const sgml = new RegExp('<' + tag + '>([^<\r\n]*)', 'i').exec(block)?.[1];
  return clean(sgml);
};

const dateOnly = (value: string): string | null => {
  const match = value.match(/^(\d{4})(\d{2})(\d{2})/);
  return match
    ? match[1] + '-' + match[2] + '-' + match[3]
    : null;
};

const numberValue = (value: string): number | null => {
  const parsed = Number(value.replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? parsed : null;
};

export const parseOfxStatement = (
  text: string,
  format: BankSourceFormat = 'ofx',
): BankStatementParseResult => {
  const transactionBlocks = Array.from(
    text.matchAll(/<STMTTRN>([\s\S]*?)(?:<\/STMTTRN>|(?=<STMTTRN>|<\/BANKTRANLIST>))/gi),
    (match) => match[1],
  );

  if (!transactionBlocks.length) {
    throw new Error('OFX/QBO statement does not contain STMTTRN entries');
  }

  const transactions: CanonicalBankTransaction[] = transactionBlocks.map((block, index) => {
    const date = dateOnly(tagValue(block, 'DTPOSTED'));
    const amount = numberValue(tagValue(block, 'TRNAMT'));

    if (!date || amount === null || amount === 0) {
      throw new Error('OFX/QBO transaction ' + String(index + 1) + ' has an invalid date or amount');
    }

    const name = tagValue(block, 'NAME');
    const memo = tagValue(block, 'MEMO');
    const reference =
      tagValue(block, 'REFNUM') ||
      tagValue(block, 'CHECKNUM') ||
      tagValue(block, 'FITID');

    return {
      transactionDate: date,
      valueDate: date,
      description: [name, memo].filter(Boolean).join(' | ') || reference,
      reference,
      signedAmount: amount,
      runningBalance: null,
      externalTransactionId: tagValue(block, 'FITID') || null,
      rawData: {
        trntype: tagValue(block, 'TRNTYPE'),
        fitid: tagValue(block, 'FITID'),
        refnum: tagValue(block, 'REFNUM'),
        checknum: tagValue(block, 'CHECKNUM'),
        name,
        memo,
      },
    };
  });

  const statementStart = dateOnly(tagValue(text, 'DTSTART'));
  const statementEnd = dateOnly(tagValue(text, 'DTEND'));
  const closingBalance = numberValue(tagValue(text, 'BALAMT'));
  const currencyCode = tagValue(text, 'CURDEF') || null;
  const dates = transactions.map((transaction) => transaction.transactionDate).sort();

  return {
    sourceFormat: format,
    transactions,
    statementStart: statementStart ?? dates[0] ?? null,
    statementEnd: statementEnd ?? dates.at(-1) ?? null,
    openingBalance: null,
    closingBalance,
    currencyCode,
  };
};
