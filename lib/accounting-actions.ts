import { supabase } from '@/lib/supabase';

export async function postInvoice(invoiceId: string, locationId: string | null = null) {
  return supabase.rpc('post_invoice', { p_invoice_id: invoiceId, p_location_id: locationId });
}

export async function createInvoiceFromItems(input: {
  businessId: string;
  customerId: string;
  invoiceDate: string;
  dueDate: string;
  items: unknown[];
  discountType?: string | null;
  discountValue?: number;
  notes?: string | null;
  terms?: string | null;
}) {
  return supabase.rpc('create_invoice_from_items', {
    p_business_id: input.businessId,
    p_customer_id: input.customerId,
    p_invoice_date: input.invoiceDate,
    p_due_date: input.dueDate,
    p_items: input.items,
    p_invoice_discount_type: input.discountType || null,
    p_invoice_discount_value: Number(input.discountValue || 0),
    p_notes: input.notes || null,
    p_terms: input.terms || null,
  });
}

export async function recordCustomerPayment(input: {
  businessId: string;
  customerId: string;
  invoiceId: string;
  amount: number;
  method: string;
  accountId: string;
  reference?: string | null;
  paymentDate: string;
  notes?: string | null;
}) {
  return supabase.rpc('record_customer_payment', {
    p_business_id: input.businessId,
    p_customer_id: input.customerId,
    p_invoice_id: input.invoiceId,
    p_amount: Number(input.amount),
    p_method: input.method,
    p_account_id: input.accountId,
    p_reference: input.reference || null,
    p_payment_date: input.paymentDate,
    p_notes: input.notes || null,
  });
}

export async function recordVendorPayment(input: {
  businessId: string;
  vendorId: string;
  billId: string;
  amount: number;
  method: string;
  accountId: string;
  reference?: string | null;
  paymentDate: string;
  notes?: string | null;
}) {
  return supabase.rpc('record_vendor_payment', {
    p_business_id: input.businessId,
    p_vendor_id: input.vendorId,
    p_bill_id: input.billId,
    p_amount: Number(input.amount),
    p_method: input.method,
    p_account_id: input.accountId,
    p_reference: input.reference || null,
    p_payment_date: input.paymentDate,
    p_notes: input.notes || null,
  });
}
