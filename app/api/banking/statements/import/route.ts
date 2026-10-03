import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { parseBankStatement } from '@/lib/server/banking/parsers';
import { bankTransactionFingerprint } from '@/lib/server/banking/fingerprint';
import { findBestBankMatch } from '@/lib/server/banking/matching';
import type { BankReconciliationRule } from '@/lib/server/banking/rules';

export const runtime = 'nodejs';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const json = (body: unknown, status = 200) => NextResponse.json(body, { status });

const contentHash = (content: string): string =>
  createHash('sha256').update(content, 'utf8').digest('hex');

const balanceVerified = (
  opening: number | null,
  closing: number | null,
  rows: Array<{ signedAmount: number; runningBalance: number | null }>,
): boolean => {
  if (opening === null || closing === null || rows.length === 0) return false;

  const total = rows.reduce((sum, row) => sum + row.signedAmount, 0);
  if (Math.abs(opening + total - closing) > 0.01) return false;

  const balances = rows
    .map((row) => row.runningBalance)
    .filter((value): value is number => value !== null);

  return balances.length === rows.length
    ? Math.abs((balances.at(-1) ?? closing) - closing) <= 0.01
    : true;
};

export async function POST(req: Request) {
  try {
    const authorization = req.headers.get('authorization');
    if (!authorization) return json({ error: 'Authorization required' }, 401);

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !publishableKey || !serviceRoleKey) {
      return json({ error: 'Banking service is not configured' }, 503);
    }

    const userClient = createClient(supabaseUrl, publishableKey, {
      global: { headers: { Authorization: authorization } },
    });

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return json({ error: 'Unauthorized' }, 401);

    const { data: contexts, error: contextError } = await userClient.rpc('get_my_business_context');
    const context = contexts?.[0];
    if (contextError || !context) {
      return json({ error: contextError?.message || 'Business context not found' }, 403);
    }

    const form = await req.formData();
    const file = form.get('file');
    const bankAccountId = typeof form.get('bank_account_id') === 'string'
      ? String(form.get('bank_account_id'))
      : '';

    if (!(file instanceof File)) return json({ error: 'A statement file is required' }, 400);
    if (!bankAccountId) return json({ error: 'bank_account_id is required' }, 400);
    if (file.size <= 0) return json({ error: 'Statement file is empty' }, 400);
    if (file.size > MAX_FILE_BYTES) return json({ error: 'Statement file exceeds the 10 MB limit' }, 413);

    const source = await file.text();
    const parsed = parseBankStatement(source, file.name);

    if (parsed.transactions.length === 0) {
      return json({ error: 'Statement contains no bank transactions' }, 400);
    }

    const statementStart = parsed.statementStart ?? parsed.transactions
      .map((row) => row.transactionDate)
      .sort()[0] ?? null;

    const statementEnd = parsed.statementEnd ?? parsed.transactions
      .map((row) => row.transactionDate)
      .sort()
      .at(-1) ?? null;

    const verifiedBalance = balanceVerified(
      parsed.openingBalance,
      parsed.closingBalance,
      parsed.transactions,
    );

    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: bankAccount, error: bankError } = await admin
      .from('bank_accounts')
      .select('id,business_id,currency_code,is_active')
      .eq('id', bankAccountId)
      .eq('business_id', context.business_id)
      .single();

    if (bankError || !bankAccount || !bankAccount.is_active) {
      return json({ error: 'Bank account not found' }, 404);
    }

    if (parsed.currencyCode && String(parsed.currencyCode).toUpperCase() !== String(bankAccount.currency_code).toUpperCase()) {
      return json({ error: 'Statement currency does not match the selected bank account currency' }, 409);
    }

    const { data: invoices, error: invoiceError } = await admin
      .from('invoices')
      .select('id,invoice_number,balance_due,currency_code')
      .eq('business_id', context.business_id)
      .in('status', ['sent', 'posted', 'partially_paid', 'overdue'])
      .gt('balance_due', 0)
      .limit(5000);

    if (invoiceError) return json({ error: invoiceError.message }, 500);

    const { data: payments, error: paymentError } = await admin
      .from('payments')
      .select('id,amount,reference,currency_code')
      .eq('business_id', context.business_id)
      .eq('direction', 'inbound')
      .limit(5000);

    if (paymentError) return json({ error: paymentError.message }, 500);

    const { data: rules, error: rulesError } = await admin
      .from('bank_reconciliation_rules')
      .select('id,name,priority,enabled,direction,reference_pattern,description_pattern,counterparty_pattern,amount_min,amount_max,target_account_id,auto_apply,confidence_threshold')
      .eq('business_id', context.business_id)
      .eq('enabled', true)
      .order('priority', { ascending: true });

    if (rulesError) return json({ error: rulesError.message }, 500);

    const ruleRows = (rules ?? []).map((rule) => ({
      ...rule,
      autoApply: Boolean(rule.auto_apply),
      confidenceThreshold: Number(rule.confidence_threshold),
      referencePattern: rule.reference_pattern,
      descriptionPattern: rule.description_pattern,
      counterpartyPattern: rule.counterparty_pattern,
      amountMin: rule.amount_min === null ? null : Number(rule.amount_min),
      amountMax: rule.amount_max === null ? null : Number(rule.amount_max),
      targetAccountId: rule.target_account_id,
    })) as BankReconciliationRule[];

    const importRows = parsed.transactions.map((transaction) => {
      const invoicesForCurrency = (invoices ?? [])
        .filter((invoice) => String(invoice.currency_code).toUpperCase() === String(bankAccount.currency_code).toUpperCase())
        .map((invoice) => ({
          id: invoice.id,
          invoiceNumber: invoice.invoice_number,
          balanceDue: Number(invoice.balance_due),
          currencyCode: invoice.currency_code,
        }));

      const paymentsForCurrency = (payments ?? [])
        .filter((payment) => String(payment.currency_code).toUpperCase() === String(bankAccount.currency_code).toUpperCase())
        .map((payment) => ({
          id: payment.id,
          amount: Number(payment.amount),
          reference: payment.reference,
          currencyCode: payment.currency_code,
        }));

      const suggestion = findBestBankMatch(
        transaction,
        invoicesForCurrency,
        paymentsForCurrency,
        ruleRows,
      );

      return {
        transaction_date: transaction.transactionDate,
        value_date: transaction.valueDate,
        description: transaction.description,
        reference: transaction.reference,
        signed_amount: transaction.signedAmount,
        running_balance: transaction.runningBalance,
        external_transaction_id: transaction.externalTransactionId,
        suggested_account_id: suggestion.type === 'rule' ? suggestion.recordId : null,
        raw_data: {
          ...transaction.rawData,
          reconciliation_suggestion: {
            type: suggestion.type,
            record_id: suggestion.recordId,
            confidence: suggestion.confidence,
            difference_amount: suggestion.differenceAmount,
            reason: suggestion.reason,
            rule_id: suggestion.rule?.ruleId ?? null,
            auto_apply: suggestion.rule?.autoApply ?? false,
          },
        },
      };
    });

    const fingerprintSet = new Set<string>();
    for (const transaction of parsed.transactions) {
      const fingerprint = bankTransactionFingerprint(
        context.business_id,
        bankAccountId,
        transaction,
      );
      if (fingerprintSet.has(fingerprint)) {
        return json({ error: 'Statement contains duplicate canonical transaction fingerprints' }, 409);
      }
      fingerprintSet.add(fingerprint);
    }

    const { data: result, error: importError } = await admin.rpc('import_bank_statement_rows', {
      p_business_id: context.business_id,
      p_bank_account_id: bankAccountId,
      p_source_format: parsed.sourceFormat,
      p_filename: file.name,
      p_content_hash: contentHash(source),
      p_statement_start: statementStart,
      p_statement_end: statementEnd,
      p_opening_balance: parsed.openingBalance,
      p_closing_balance: parsed.closingBalance,
      p_balance_verified: verifiedBalance,
      p_rows: importRows,
    });

    if (importError) return json({ error: importError.message }, 409);

    return json({
      total_rows: parsed.transactions.length,
      inserted_rows: Number(result?.inserted_rows ?? 0),
      duplicate_skipped_rows: Number(result?.duplicate_skipped_rows ?? 0),
      balance_verified: Boolean(result?.balance_verified ?? verifiedBalance),
      import_id: result?.import_id ?? null,
      source_format: parsed.sourceFormat,
      statement_start: statementStart,
      statement_end: statementEnd,
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Unexpected statement import error' }, 400);
  }
}
