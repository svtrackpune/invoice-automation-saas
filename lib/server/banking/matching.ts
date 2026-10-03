import type { CanonicalBankTransaction } from './parsers/types';
import type { BankReconciliationRule, RuleSuggestion } from './rules';
import { applyBankReconciliationRules } from './rules';

export interface InvoiceMatchCandidate {
  id: string;
  invoiceNumber: string;
  balanceDue: number;
  currencyCode: string;
}

export interface PaymentMatchCandidate {
  id: string;
  amount: number;
  reference: string | null;
  currencyCode: string;
}

export interface MatchOptions {
  amountTolerance?: number;
  gatewayFeeTolerancePct?: number;
  gatewayFeeToleranceAmount?: number;
  bankChargePattern?: RegExp;
  gatewayFeePattern?: RegExp;
  fxPattern?: RegExp;
}

export interface BankMatchSuggestion {
  type: 'invoice' | 'payment' | 'gateway_fee' | 'bank_charge' | 'fx_difference' | 'rule' | 'none';
  recordId: string | null;
  confidence: number;
  differenceAmount: number;
  reason: string;
  rule?: RuleSuggestion;
}

const DEFAULT_OPTIONS: Required<Pick<MatchOptions, 'amountTolerance' | 'gatewayFeeTolerancePct' | 'gatewayFeeToleranceAmount'>> = {
  amountTolerance: 0.01,
  gatewayFeeTolerancePct: 0.03,
  gatewayFeeToleranceAmount: 5,
};

export const normalizedMatchText = (value: string | null | undefined): string =>
  (value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');

export const matchInvoiceReference = (
  transaction: CanonicalBankTransaction,
  invoice: InvoiceMatchCandidate,
  amountTolerance = DEFAULT_OPTIONS.amountTolerance,
): BankMatchSuggestion | null => {
  if (transaction.signedAmount <= 0) return null;
  const invoiceReference = normalizedMatchText(invoice.invoiceNumber);
  const transactionReference = normalizedMatchText(transaction.reference + ' ' + transaction.description);
  if (!invoiceReference || !transactionReference.includes(invoiceReference)) return null;

  const difference = Math.abs(transaction.signedAmount - invoice.balanceDue);
  if (difference > amountTolerance) return null;

  return {
    type: 'invoice',
    recordId: invoice.id,
    confidence: 0.99,
    differenceAmount: difference,
    reason: 'Exact invoice reference and amount match',
  };
};

export const matchGatewayFee = (
  transaction: CanonicalBankTransaction,
  invoice: InvoiceMatchCandidate,
  options: MatchOptions = {},
): BankMatchSuggestion | null => {
  if (transaction.signedAmount <= 0) return null;

  const invoiceRef = normalizedMatchText(invoice.invoiceNumber);
  const txnRef = normalizedMatchText(transaction.reference + ' ' + transaction.description);
  if (!invoiceRef || !txnRef.includes(invoiceRef)) return null;

  const fee = invoice.balanceDue - transaction.signedAmount;
  if (fee <= 0) return null;

  const pct = options.gatewayFeeTolerancePct ?? DEFAULT_OPTIONS.gatewayFeeTolerancePct;
  const maxFee = options.gatewayFeeToleranceAmount ?? DEFAULT_OPTIONS.gatewayFeeToleranceAmount;
  const allowed = Math.max(maxFee, invoice.balanceDue * pct);

  if (fee > allowed) return null;

  const differenceAmount = Math.max(0, invoice.balanceDue - transaction.signedAmount);
  return {
    type: 'gateway_fee',
    recordId: invoice.id,
    confidence: 0.95 - Math.min(fee / Math.max(invoice.balanceDue, 1), 0.10),
    differenceAmount,
    reason: 'Bank credit matches invoice gross less an explicit gateway-fee tolerance',
  };
};

export const classifyExplicitDifference = (
  transaction: CanonicalBankTransaction,
  options: MatchOptions = {},
): BankMatchSuggestion | null => {
  const text = transaction.reference + ' ' + transaction.description;

  if ((options.gatewayFeePattern ?? /gateway\s*(?:payment\s*)?(?:fee|charge)|processing fee|merchant fee|stripe fee|razorpay fee|payable fee|payment processing charge|gateway commission/i).test(text)) {
    return {
      type: 'gateway_fee',
      recordId: null,
      confidence: 0.93,
      differenceAmount: 0,
      reason: 'Explicit gateway/payment-processing fee indicator detected',
    };
  }

  if ((options.bankChargePattern ?? /bank charge|service charge|bank fee|sms charge|annual fee|cash handling charge/i).test(text)) {
    return {
      type: 'bank_charge',
      recordId: null,
      confidence: 0.93,
      differenceAmount: 0,
      reason: 'Explicit bank charge indicator detected',
    };
  }

  if ((options.fxPattern ?? /\bfx\b|forex|exchange rate|currency conversion|exchange difference/i).test(text)) {
    return {
      type: 'fx_difference',
      recordId: null,
      confidence: 0.90,
      differenceAmount: 0,
      reason: 'Explicit foreign-exchange difference indicator detected',
    };
  }

  return null;
};

export const findBestBankMatch = (
  transaction: CanonicalBankTransaction,
  invoices: InvoiceMatchCandidate[],
  payments: PaymentMatchCandidate[],
  rules: BankReconciliationRule[] = [],
  options: MatchOptions = {},
): BankMatchSuggestion => {
  const explicit = classifyExplicitDifference(transaction, options);
  if (explicit) return explicit;

  const exactInvoice = invoices
    .map((invoice) => matchInvoiceReference(transaction, invoice, options.amountTolerance ?? DEFAULT_OPTIONS.amountTolerance))
    .find((match): match is BankMatchSuggestion => Boolean(match));
  if (exactInvoice) return exactInvoice;

  const feeInvoice = invoices
    .map((invoice) => matchGatewayFee(transaction, invoice, options))
    .find((match): match is BankMatchSuggestion => Boolean(match));
  if (feeInvoice) return feeInvoice;

  const txnReference = normalizedMatchText(transaction.reference + ' ' + transaction.description);
  const payment = payments.find((candidate) => {
    const reference = normalizedMatchText(candidate.reference);
    return transaction.signedAmount > 0 &&
      txnReference.length > 0 &&
      reference.length > 0 &&
      txnReference.includes(reference) &&
      Math.abs(transaction.signedAmount - candidate.amount) <= (options.amountTolerance ?? DEFAULT_OPTIONS.amountTolerance);
  });

  if (payment) {
    return {
      type: 'payment',
      recordId: payment.id,
      confidence: 0.94,
      differenceAmount: Math.abs(transaction.signedAmount - payment.amount),
      reason: 'Payment reference and amount match',
    };
  }

  const rule = applyBankReconciliationRules(transaction, rules);
  if (rule) {
    return {
      type: 'rule',
      recordId: rule.targetAccountId,
      confidence: rule.confidence,
      differenceAmount: 0,
      reason: rule.reason,
      rule,
    };
  }

  return {
    type: 'none',
    recordId: null,
    confidence: 0,
    differenceAmount: 0,
    reason: 'No deterministic match found',
  };
};
