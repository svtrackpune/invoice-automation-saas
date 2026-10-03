import type { CanonicalBankTransaction } from './parsers/types';

export interface BankReconciliationRule {
  id: string;
  name: string;
  priority: number;
  enabled: boolean;
  direction: 'both' | 'inbound' | 'outbound';
  referencePattern?: string | null;
  descriptionPattern?: string | null;
  counterpartyPattern?: string | null;
  amountMin?: number | null;
  amountMax?: number | null;
  targetAccountId?: string | null;
  autoApply: boolean;
  confidenceThreshold: number;
}

export interface RuleSuggestion {
  ruleId: string;
  ruleName: string;
  targetAccountId: string | null;
  confidence: number;
  reason: string;
  autoApply: boolean;
}

export const normalizeRuleText = (value: string | null | undefined): string =>
  (value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const regexMatches = (pattern: string | null | undefined, value: string): boolean => {
  if (!pattern) return true;
  try {
    return new RegExp(pattern, 'i').test(value);
  } catch {
    return false;
  }
};

export const evaluateBankRule = (
  transaction: CanonicalBankTransaction,
  rule: BankReconciliationRule,
): RuleSuggestion | null => {
  if (!rule.enabled) return null;

  const direction = transaction.signedAmount > 0 ? 'inbound' : 'outbound';
  if (rule.direction !== 'both' && rule.direction !== direction) return null;

  const amount = Math.abs(transaction.signedAmount);
  if (rule.amountMin !== null && rule.amountMin !== undefined && amount < rule.amountMin) return null;
  if (rule.amountMax !== null && rule.amountMax !== undefined && amount > rule.amountMax) return null;

  const reference = normalizeRuleText(transaction.reference);
  const description = normalizeRuleText(transaction.description);
  const combined = reference + ' ' + description;

  if (!regexMatches(rule.referencePattern, reference)) return null;
  if (!regexMatches(rule.descriptionPattern, description)) return null;
  if (!regexMatches(rule.counterpartyPattern, combined)) return null;

  let confidence = 0.70;
  const reasons: string[] = [];

  if (rule.referencePattern) { confidence += 0.10; reasons.push('reference pattern matched'); }
  if (rule.descriptionPattern) { confidence += 0.10; reasons.push('description pattern matched'); }
  if (rule.counterpartyPattern) { confidence += 0.07; reasons.push('counterparty pattern matched'); }
  if (rule.amountMin !== null || rule.amountMax !== null) { confidence += 0.03; reasons.push('amount range matched'); }

  confidence = Math.min(confidence, 0.99);

  return {
    ruleId: rule.id,
    ruleName: rule.name,
    targetAccountId: rule.targetAccountId ?? null,
    confidence,
    reason: reasons.join('; ') || 'general recurring rule matched',
    autoApply: rule.autoApply && confidence >= rule.confidenceThreshold,
  };
};

export const applyBankReconciliationRules = (
  transaction: CanonicalBankTransaction,
  rules: BankReconciliationRule[],
): RuleSuggestion | null =>
  rules
    .filter((rule) => rule.enabled)
    .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name))
    .map((rule) => evaluateBankRule(transaction, rule))
    .filter((suggestion): suggestion is RuleSuggestion => suggestion !== null)
    .sort((a, b) => {
      if (a.autoApply !== b.autoApply) return a.autoApply ? -1 : 1;
      return b.confidence - a.confidence;
    })[0] ?? null;
