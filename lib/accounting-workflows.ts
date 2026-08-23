import { supabase } from './supabase';

/**
 * Production accounting boundary.
 *
 * The UI can remain in testing mode while these functions provide one typed
 * place to reconnect the polished workflows to the authoritative Postgres
 * accounting engine. No service-role key is ever used in the browser.
 */
export async function createQuotationFromItems(input: {
  businessId: string;
  customerId: string;
  quotationDate: string;
  validUntil?: string | null;
  items: unknown[];
  notes?: string | null;
  terms?: string | null;
  templateId?: string | null;
}) {
  const { data, error } = await supabase.rpc('create_quotation_from_items', {
    p_business_id: input.businessId,
    p_customer_id: input.customerId,
    p_quotation_date: input.quotationDate,
    p_valid_until: input.validUntil ?? null,
    p_items: input.items,
    p_notes: input.notes ?? null,
    p_terms: input.terms ?? null,
    p_template_id: input.templateId ?? null,
  });
  if (error) throw error;
  return data as string;
}

export async function convertQuotationToInvoice(input: {
  quotationId: string;
  invoiceDate?: string;
  dueDate?: string | null;
}) {
  const { data, error } = await supabase.rpc('convert_quotation_to_invoice', {
    p_quotation_id: input.quotationId,
    p_invoice_date: input.invoiceDate ?? null,
    p_due_date: input.dueDate ?? null,
  });
  if (error) throw error;
  return data as string;
}

export async function setQuotationStatus(quotationId: string, status: 'sent' | 'accepted' | 'rejected' | 'expired' | 'cancelled') {
  const { error } = await supabase.rpc('set_quotation_status', {
    p_quotation_id: quotationId,
    p_status: status,
  });
  if (error) throw error;
}

export async function recordCustomerPayment(input: {
  businessId: string;
  customerId: string;
  invoiceId: string;
  amount: number;
  method: 'cash' | 'bank_transfer' | 'upi' | 'card' | 'cheque' | 'payment_gateway' | 'other';
  accountId: string;
  reference?: string | null;
  gatewayTransactionId?: string | null;
  paymentDate?: string;
  notes?: string | null;
}) {
  const { data, error } = await supabase.rpc('record_customer_payment', {
    p_business_id: input.businessId,
    p_customer_id: input.customerId,
    p_invoice_id: input.invoiceId,
    p_amount: input.amount,
    p_method: input.method,
    p_account_id: input.accountId,
    p_reference: input.reference ?? null,
    p_gateway_transaction_id: input.gatewayTransactionId ?? null,
    p_payment_date: input.paymentDate ?? null,
    p_notes: input.notes ?? null,
  });
  if (error) throw error;
  return data;
}

export async function generateReceiptForPayment(paymentId: string) {
  const { data, error } = await supabase.rpc('generate_receipt_for_payment', {
    p_payment_id: paymentId,
  });
  if (error) throw error;
  return data;
}

export async function recalculateInvoiceTotals(invoiceId: string) {
  const { data, error } = await supabase.rpc('recalculate_invoice_totals', {
    p_invoice_id: invoiceId,
  });
  if (error) throw error;
  return data;
}
