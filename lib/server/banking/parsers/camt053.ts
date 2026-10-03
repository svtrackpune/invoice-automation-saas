import type { BankStatementParseResult, CanonicalBankTransaction } from './types';

const decodeXml = (value: string): string =>
  value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");

const blocks = (xml: string, tag: string): string[] => {
  const pattern = new RegExp(String.raw`<${tag}(?:\s[^>]*)?>([\s\S]*?)</${tag}>`, 'gi');
  return Array.from(xml.matchAll(pattern), (match) => match[1]);
};

const texts = (xml: string, tag: string): string[] => {
  const pattern = new RegExp(String.raw`<${tag}(?:\s[^>]*)?>([\s\S]*?)</${tag}>`, 'gi');
  return Array.from(xml.matchAll(pattern), (match) =>
    decodeXml(match[1].replace(/<[^>]+>/g, '').trim()),
  );
};

const firstText = (xml: string, tag: string): string | null => texts(xml, tag)[0] ?? null;

const amount = (xml: string): { value: number; currency: string | null } | null => {
  const match =
    xml.match(/<Amt[^>]*Ccy="([A-Z]{3})"[^>]*>([^<]+)<\/Amt>/i) ??
    xml.match(/<Amt[^>]*>([^<]+)<\/Amt>/i);

  if (!match) return null;

  const valueText = match.length === 3 ? match[2] : match[1];
  const value = Number(valueText.trim().replace(/,/g, ''));
  if (!Number.isFinite(value)) return null;

  const currency = match.length === 3 ? match[1] : null;
  return { value, currency };
};

const balanceForType = (
  xml: string,
  code: string,
): { value: number; currency: string | null } | null => {
  const balanceBlock = blocks(xml, 'Bal').find(
    (block) => firstText(block, 'Cd')?.toUpperCase() === code,
  );
  return balanceBlock ? amount(balanceBlock) : null;
};

export const parseCamt053Statement = (xml: string): BankStatementParseResult => {
  if (!/<Stmt[\s>]/i.test(xml)) throw new Error('CAMT.053 statement does not contain Stmt');

  const entries = blocks(xml, 'Ntry');
  if (!entries.length) throw new Error('CAMT.053 statement does not contain Ntry entries');

  const opening = balanceForType(xml, 'OPBD');
  const closing = balanceForType(xml, 'CLBD');

  const transactions: CanonicalBankTransaction[] = entries.map((entry, index) => {
    const entryAmount = amount(entry);
    if (!entryAmount) {
      throw new Error('CAMT.053 entry ' + String(index + 1) + ' has an invalid amount');
    }

    const direction = (firstText(entry, 'CdtDbtInd') ?? '').toUpperCase();
    if (direction !== 'CRDT' && direction !== 'DBIT') {
      throw new Error('CAMT.053 entry ' + String(index + 1) + ' has an invalid CdtDbtInd');
    }

    const date =
      firstText(blocks(entry, 'BookgDt')[0] ?? '', 'Dt') ??
      firstText(blocks(entry, 'ValDt')[0] ?? '', 'Dt');

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new Error('CAMT.053 entry ' + String(index + 1) + ' has an invalid booking date');
    }

    const refs = [
      firstText(entry, 'AcctSvcrRef'),
      ...texts(entry, 'EndToEndId'),
      ...texts(entry, 'InstrId'),
    ].filter((value): value is string => Boolean(value));

    const descriptions = [
      ...texts(entry, 'Ustrd'),
      ...texts(entry, 'AddtlNtryInf'),
    ].filter(Boolean);

    return {
      transactionDate: date,
      valueDate: firstText(blocks(entry, 'ValDt')[0] ?? '', 'Dt') ?? date,
      description:
        descriptions.join(' | ') ||
        refs.join(' | ') ||
        'CAMT entry ' + String(index + 1),
      reference: refs.join(' | '),
      signedAmount: direction === 'CRDT' ? entryAmount.value : -entryAmount.value,
      runningBalance: null,
      externalTransactionId: refs[0] ?? null,
      rawData: {
        entry: entry.replace(/\s+/g, ' ').trim(),
        credit_debit_indicator: direction,
        currency: entryAmount.currency ?? '',
      },
    };
  });

  const dates = transactions.map((transaction) => transaction.transactionDate).sort();
  const firstEntryAmount = amount(entries[0]);

  return {
    sourceFormat: 'camt053',
    transactions,
    statementStart: dates[0] ?? null,
    statementEnd: dates.at(-1) ?? null,
    openingBalance: opening?.value ?? null,
    closingBalance: closing?.value ?? null,
    currencyCode: closing?.currency ?? opening?.currency ?? firstEntryAmount?.currency ?? null,
  };
};
