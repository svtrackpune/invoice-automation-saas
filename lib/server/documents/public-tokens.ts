import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { buildReceiptPdf, getServerSupabase, loadReceiptPdfData, sha256Hex } from '@/lib/server/receipt-pdf';
import { buildPublicDocumentPdf } from '@/lib/server/documents/public-pdf';

export type PublicDocumentType = 'invoice' | 'quotation' | 'challan' | 'receipt';
type Row = Record<string, unknown>;

export type PublicDocument = {
  type: PublicDocumentType;
  templateName?: string | null;
  settlementDisplayMode?: 'upi_qr' | 'bank_transfer' | 'both' | 'none' | null;
  id: string;
  businessId: string;
  number: string;
  date: string;
  dueDate: string | null;
  validUntil: string | null;
  status: string;
  currencyCode: string;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  amountPaid: number;
  balanceDue: number;
  notes: string | null;
  terms: string | null;
  paymentLink: string | null;
  paymentQrPayload: string | null;
  vehicleNumber: string | null;
  transporterName: string | null;
  ewayBillNumber: string | null;
  business: {
    name: string; legalName: string | null; email: string | null; phone: string | null;
    website: string | null; address: unknown; taxRegistrationNumber: string | null; logoStoragePath: string | null; pan: string | null;
  };
  customer: {
    name: string; legalName: string | null; email: string | null; phone: string | null; address: unknown;
    billingAddress: unknown; shippingAddress: unknown; taxId: string | null;
  };
  placeOfSupplyStateCode: string | null; supplyType: string | null;
  cgstAmount: number; sgstAmount: number; igstAmount: number;
  bankDetails: { name: string | null; institutionName: string | null; accountHolderName: string | null;
    accountNumber: string | null; accountLast4: string | null; ifscCode: string | null; branchName: string | null;
    accountType?: string | null } | null;
  upiId: string | null;
  items: Array<{
    description: string; quantity: number; unit: string | null; unitPrice: number;
    discount: number; taxAmount: number; lineTotal: number; hsnSac: string | null;
  }>;
};

const text = (v: unknown) => String(v ?? '').trim();
const n = (v: unknown) => Number(v ?? 0);
const nullable = (v: unknown) => v == null || text(v) === '' ? null : text(v);
const TOKEN_PATTERN = /^[A-Fa-f0-9]{48,128}$/;

/** Canonical recipient route for an existing opaque public token. */
export function getPublicDocumentPath(type: PublicDocumentType, token: string): string | null {
  if (!TOKEN_PATTERN.test(token)) return null;
  const segment = type === 'quotation' ? 'quote' : type === 'challan' ? 'delivery-challan' : type;
  return '/' + segment + '/' + token;
}

function statusAllowed(type: PublicDocumentType, status: string, validUntil: string | null) {
  const s = status.toLowerCase();
  if (type === 'invoice') return ['sent', 'partially_paid', 'paid'].includes(s);
  if (type === 'quotation') {
    // Expiry blocks acceptance, not access to the already-shared quotation document.
    return ['sent', 'accepted', 'converted'].includes(s);
  }
  if (type === 'challan') return !['draft', 'void', 'cancelled', 'deleted'].includes(s);
  return true;
}

async function loadParties(db: SupabaseClient, businessId: string, customerId: string | null) {
  const [businessResult, customerResult, taxProfileResult] = await Promise.all([
    db.from('businesses')
      .select('id,name,legal_name,email,phone,website,address,tax_registration_number,logo_storage_path')
      .eq('id', businessId).maybeSingle(),
    customerId
      ? db.from('customers').select('id,display_name,legal_name,email,phone,billing_address,shipping_address,tax_id')
          .eq('id', customerId).eq('business_id', businessId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    db.from('business_tax_profiles').select('gstin,pan,gst_registration_type').eq('business_id', businessId).maybeSingle(),
  ]);
  if (businessResult.error || !businessResult.data) throw new Error('Public document business is unavailable.');
  if (customerId && (customerResult.error || !customerResult.data)) throw new Error('Public document customer is unavailable.');
  if (taxProfileResult.error) throw new Error('Public document tax profile is unavailable.');
  const b = businessResult.data as Row;
  const c = (customerResult.data ?? {}) as Row;
  const taxProfile = (taxProfileResult.data ?? {}) as Row;
  const gstType = text(taxProfile.gst_registration_type).toUpperCase();
  return {
    business: {
      name: text(b.legal_name || b.name) || 'Business',
      legalName: nullable(b.legal_name), email: nullable(b.email), phone: nullable(b.phone),
      website: nullable(b.website), address: b.address ?? null,
      taxRegistrationNumber: gstType === 'NONE' ? null : nullable(taxProfile.gstin || b.tax_registration_number),
      logoStoragePath: nullable(b.logo_storage_path), pan: nullable(taxProfile.pan),
    },
    customer: {
      name: text(c.legal_name || c.display_name) || 'Customer',
      legalName: nullable(c.legal_name), email: nullable(c.email), phone: nullable(c.phone),
      address: c.shipping_address ?? c.billing_address ?? null,
      billingAddress: c.billing_address ?? null, shippingAddress: c.shipping_address ?? null, taxId: nullable(c.tax_id),
    },
  };
}

export async function loadPublicDocumentById(
  type: PublicDocumentType,
  id: string,
  businessId: string,
): Promise<PublicDocument | null> {
  const db = getServerSupabase();
  if (type === 'receipt') {
    const data = await loadReceiptPdfData(db, id);
    if (text(data.receipt.business_id) !== businessId) return null;
    return {
      type, id: text(data.receipt.id), businessId, number: text(data.receipt.receipt_number),
      date: text(data.receipt.receipt_date), dueDate: null, validUntil: null, status: 'paid',
      currencyCode: text(data.receipt.currency_code || 'INR') || 'INR', subtotal: n(data.receipt.amount),
      discountTotal: 0, taxTotal: 0, total: n(data.receipt.amount), amountPaid: n(data.receipt.amount),
      balanceDue: Math.max(0, n(data.customer_outstanding)), notes: nullable(data.receipt.notes), terms: null,
      paymentLink: null, paymentQrPayload: null, vehicleNumber: null, transporterName: null, ewayBillNumber: null,
      placeOfSupplyStateCode: null, supplyType: null, cgstAmount: 0, sgstAmount: 0, igstAmount: 0,
      bankDetails: null, upiId: null,
      business: {
        name: text(data.business?.legal_name || data.business?.name) || 'Business',
        legalName: nullable(data.business?.legal_name), email: nullable(data.business?.email),
        phone: nullable(data.business?.phone), website: nullable(data.business?.website), address: data.business?.address ?? null,
        taxRegistrationNumber: nullable(data.business?.tax_registration_number), logoStoragePath: nullable(data.business?.logo_storage_path), pan: null,
      },
      customer: {
        name: text(data.customer?.legal_name || data.customer?.display_name) || 'Customer',
        legalName: nullable(data.customer?.legal_name), email: nullable(data.customer?.email),
        phone: nullable(data.customer?.phone), address: data.customer?.billing_address ?? null,
        billingAddress: data.customer?.billing_address ?? null, shippingAddress: data.customer?.shipping_address ?? null,
        taxId: nullable(data.customer?.tax_id),
      },
      items: data.items.map(item => ({
        description: text(item.name) || 'Item', quantity: n(item.quantity), unit: null,
        unitPrice: n(item.unit_price), discount: 0, taxAmount: 0, lineTotal: n(item.line_total), hsnSac: null,
      })),
    };
  }

  let row: Row;
  let customerId: string;
  let typeToken: string;
  let templateName: string | null = null;
  let number: string;
  let date: string;
  let dueDate: string | null = null;
  let validUntil: string | null = null;
  let status: string;
  let currencyCode = 'INR';
  let subtotal = 0, discountTotal = 0, taxTotal = 0, total = 0, amountPaid = 0, balanceDue = 0;
  let notes: string | null = null, terms: string | null = null;
  let paymentLink: string | null = null, paymentQrPayload: string | null = null;
  let vehicleNumber: string | null = null, transporterName: string | null = null, ewayBillNumber: string | null = null;
  let placeOfSupplyStateCode: string | null = null, supplyType: string | null = null;
  let cgstAmount = 0, sgstAmount = 0, igstAmount = 0;
  let bankDetails: PublicDocument['bankDetails'] = null, upiId: string | null = null;
  let paymentBankAccountId: string | null = null;
  let settlementDisplayMode: PublicDocument['settlementDisplayMode'] = null;
  let items: PublicDocument['items'] = [];

  if (type === 'invoice') {
    const result = await db.from('invoices')
      .select('id,business_id,customer_id,invoice_number,invoice_date,due_date,status,currency_code,subtotal,discount_total,tax_total,total,amount_paid,balance_due,notes,terms,payment_display_mode,payment_link,payment_qr_payload,public_share_token,place_of_supply_state_code,supply_type,cgst_amount,sgst_amount,igst_amount,payment_bank_account_id,template_id')
      .eq('id', id).eq('business_id', businessId).maybeSingle();
    if (result.error || !result.data) return null;
    row = result.data as Row;
    const templateId = nullable(row.template_id);
    if (templateId) {
      const templateResult = await db.from('document_templates').select('template_name')
        .eq('id', templateId).maybeSingle();
      if (!templateResult.error && templateResult.data) templateName = nullable(templateResult.data.template_name);
    }
    typeToken = text(row.public_share_token);
    customerId = text(row.customer_id); number = text(row.invoice_number); date = text(row.invoice_date);
    status = text(row.status); dueDate = nullable(row.due_date); currencyCode = text(row.currency_code || 'INR') || 'INR';
    subtotal = n(row.subtotal); discountTotal = n(row.discount_total); taxTotal = n(row.tax_total);
    total = n(row.total); amountPaid = n(row.amount_paid); balanceDue = n(row.balance_due);
    notes = nullable(row.notes); terms = nullable(row.terms);
    placeOfSupplyStateCode = nullable(row.place_of_supply_state_code); supplyType = nullable(row.supply_type);
    cgstAmount = n(row.cgst_amount); sgstAmount = n(row.sgst_amount); igstAmount = n(row.igst_amount);
    paymentBankAccountId = nullable(row.payment_bank_account_id);
    if (text(row.payment_display_mode) === 'online') {
      paymentLink = nullable(row.payment_link);
      paymentQrPayload = nullable(row.payment_qr_payload || row.payment_link);
    }
    const itemResult = await db.from('invoice_items')
      .select('description,quantity,unit_price,discount,tax_amount,line_total,hsn_sac,product_service_id,sort_order')
      .eq('invoice_id', id).order('sort_order');
    if (itemResult.error) throw new Error('Invoice items are unavailable.');
    const productIds = Array.from(new Set(((itemResult.data || []) as Row[]).map(x => text(x.product_service_id)).filter(Boolean)));
    const productsResult = productIds.length
      ? await db.from('products_services').select('id,name,unit').eq('business_id', businessId).in('id', productIds)
      : { data: [], error: null };
    if (productsResult.error) throw new Error('Invoice products are unavailable.');
    const products = new Map(((productsResult.data || []) as Row[]).map(p => [text(p.id), p]));
    items = ((itemResult.data || []) as Row[]).map(item => {
      const product = products.get(text(item.product_service_id));
      return {
        description: text(product?.name || item.description) || 'Item', quantity: n(item.quantity),
        unit: nullable(product?.unit), unitPrice: n(item.unit_price), discount: n(item.discount),
        taxAmount: n(item.tax_amount), lineTotal: n(item.line_total), hsnSac: nullable(item.hsn_sac),
      };
    });
  } else if (type === 'quotation') {
    const result = await db.from('quotations')
      .select('id,business_id,customer_id,quotation_number,quotation_date,valid_until,status,currency_code,subtotal,discount_amount,tax_amount,total,notes,terms,public_accept_token')
      .eq('id', id).eq('business_id', businessId).maybeSingle();
    if (result.error || !result.data) return null;
    row = result.data as Row;
    typeToken = text(row.public_accept_token);
    customerId = text(row.customer_id); number = text(row.quotation_number); date = text(row.quotation_date);
    status = text(row.status); validUntil = nullable(row.valid_until); currencyCode = text(row.currency_code || 'INR') || 'INR';
    subtotal = n(row.subtotal); discountTotal = n(row.discount_amount); taxTotal = n(row.tax_amount); total = n(row.total);
    balanceDue = total; notes = nullable(row.notes); terms = nullable(row.terms);
    const itemResult = await db.from('quotation_items')
      .select('description,quantity,unit_price,discount_type,discount_value,tax_rate_id,sort_order,line_discount,line_tax,line_total')
      .eq('quotation_id', id).order('sort_order');
    if (itemResult.error) throw new Error('Quotation items are unavailable.');
    items = ((itemResult.data || []) as Row[]).map(item => {
      const base = n(item.quantity) * n(item.unit_price);
      const computedDiscount = text(item.discount_type) === 'percentage' ? base * n(item.discount_value) / 100 : n(item.discount_value);
      const discount = item.line_discount == null ? computedDiscount : n(item.line_discount);
      const taxAmount = n(item.line_tax);
      const computedLineTotal = Math.max(0, base - discount) + taxAmount;
      return {
        description: text(item.description) || 'Item',
        quantity: n(item.quantity),
        unit: null,
        unitPrice: n(item.unit_price),
        discount,
        taxAmount,
        lineTotal: item.line_total == null ? computedLineTotal : n(item.line_total),
        hsnSac: null,
      };
    });
  } else {
    const result = await db.from('delivery_challans')
      .select('id,business_id,customer_id,challan_number,challan_date,status,subtotal,total,notes,terms,vehicle_number,transporter_name,eway_bill_number,public_share_token')
      .eq('id', id).eq('business_id', businessId).maybeSingle();
    if (result.error || !result.data) return null;
    row = result.data as Row;
    typeToken = text(row.public_share_token);
    customerId = text(row.customer_id); number = text(row.challan_number); date = text(row.challan_date);
    status = text(row.status); subtotal = n(row.subtotal); total = n(row.total); balanceDue = total;
    notes = nullable(row.notes); terms = nullable(row.terms); vehicleNumber = nullable(row.vehicle_number);
    transporterName = nullable(row.transporter_name); ewayBillNumber = nullable(row.eway_bill_number);
    const itemResult = await db.from('delivery_challan_items')
      .select('description,quantity,unit,unit_price,line_total,hsn_sac,sort_order')
      .eq('challan_id', id).eq('business_id', businessId).order('sort_order');
    if (itemResult.error) throw new Error('Delivery challan items are unavailable.');
    items = ((itemResult.data || []) as Row[]).map(item => ({
      description: text(item.description) || 'Item', quantity: n(item.quantity), unit: nullable(item.unit),
      unitPrice: n(item.unit_price), discount: 0, taxAmount: 0, lineTotal: n(item.line_total), hsnSac: nullable(item.hsn_sac),
    }));
  }

  if (!statusAllowed(type, status, validUntil)) return null;
  if (typeToken.length < 48) return null;
  if (type === 'invoice' || type === 'quotation') {
    const settingsResult = await db.from('document_payment_settings')
      .select('upi_id,payment_qr_enabled,default_bank_account_id,settlement_display_mode')
      .eq('business_id', businessId).maybeSingle();
    if (settingsResult.error) throw new Error('Document payment settings are unavailable.');

    // Respect an invoice's explicit bank selection, then fall back to the document
    // mapping and business defaults so existing invoices without a selected bank render correctly.
    let selectedBankId: string | null = type === 'invoice' ? paymentBankAccountId : null;
    if (!selectedBankId) {
      const preferred = await db.from('business_document_bank_accounts')
        .select('bank_account_id,display_order,created_at')
        .eq('business_id', businessId).eq('document_type', type)
        .order('display_order', { ascending: true }).order('created_at', { ascending: true })
        .limit(1).maybeSingle();
      if (preferred.error) throw new Error('Document bank-account preferences are unavailable.');
      selectedBankId = nullable(preferred.data?.bank_account_id);
    }
    if (!selectedBankId) selectedBankId = nullable(settingsResult.data?.default_bank_account_id);
    if (!selectedBankId) {
      const businessSettings = await db.from('business_settings').select('default_bank_account_id')
        .eq('business_id', businessId).maybeSingle();
      if (businessSettings.error) throw new Error('Business settlement preferences are unavailable.');
      selectedBankId = nullable(businessSettings.data?.default_bank_account_id);
    }

    let bankResult: { data: Row | null; error: { message?: string } | null } = { data: null, error: null };
    if (selectedBankId) {
      const result = await db.from('bank_accounts')
        .select('id,name,institution_name,account_holder_name,account_number,account_last4,ifsc_code,branch_name,account_type,metadata,is_active')
        .eq('id', selectedBankId).eq('business_id', businessId).eq('is_active', true).maybeSingle();
      if (result.error) throw new Error('Document settlement details are unavailable.');
      bankResult = { data: result.data as Row | null, error: null };
    }

    // If an old document points to a deleted or inactive account, fail over only
    // to an active account belonging to the same business.
    if (!bankResult.data) {
      const fallback = await db.from('bank_accounts')
        .select('id,name,institution_name,account_holder_name,account_number,account_last4,ifsc_code,branch_name,account_type,metadata,is_active')
        .eq('business_id', businessId).eq('is_active', true)
        .order('is_primary', { ascending: false }).order('created_at', { ascending: true })
        .limit(1).maybeSingle();
      if (fallback.error) throw new Error('Document settlement details are unavailable.');
      bankResult = { data: fallback.data as Row | null, error: null };
    }

    if (bankResult.data) {
      const b = bankResult.data;
      bankDetails = {
        name: nullable(b.name), institutionName: nullable(b.institution_name),
        accountHolderName: nullable(b.account_holder_name), accountNumber: nullable(b.account_number),
        accountLast4: nullable(b.account_last4), ifscCode: nullable(b.ifsc_code), branchName: nullable(b.branch_name),
        accountType: nullable(b.account_type),
      };
      upiId = nullable(settingsResult.data?.upi_id) || nullable((b.metadata as Row | null)?.upi_id);
    } else {
      upiId = nullable(settingsResult.data?.upi_id);
    }
    if (settingsResult.data?.payment_qr_enabled === false) {
      upiId = null;
      if (type === 'invoice') paymentQrPayload = null;
    }
    const requestedMode = text(settingsResult.data?.settlement_display_mode);
    if (requestedMode === 'both' && upiId && bankDetails) settlementDisplayMode = 'both';
    else if (requestedMode === 'bank_transfer' && bankDetails) settlementDisplayMode = 'bank_transfer';
    else if (requestedMode === 'upi_qr' && upiId) settlementDisplayMode = 'upi_qr';
    else if (upiId) settlementDisplayMode = 'upi_qr';
    else if (bankDetails) settlementDisplayMode = 'bank_transfer';
    else settlementDisplayMode = 'none';
  }
  const parties = await loadParties(db, businessId, customerId || null);
  return {
    type, id, businessId, number, date, dueDate, validUntil, status, currencyCode,
    ...(type === 'invoice' ? { templateName } : {}),
    ...(settlementDisplayMode ? { settlementDisplayMode } : {}),
    subtotal, discountTotal, taxTotal, total, amountPaid, balanceDue, notes, terms,
    paymentLink, paymentQrPayload, vehicleNumber, transporterName, ewayBillNumber,
    placeOfSupplyStateCode, supplyType, cgstAmount, sgstAmount, igstAmount, bankDetails, upiId,
    business: parties.business, customer: parties.customer, items,
  };
}

export async function resolvePublicDocumentByToken(type: PublicDocumentType, token: string): Promise<PublicDocument | null> {
  if (!['invoice', 'quotation', 'challan', 'receipt'].includes(type) || !getPublicDocumentPath(type, token)) return null;
  const db = getServerSupabase();
  if (type === 'receipt') {
    const { data, error } = await db.from('receipt_access_tokens')
      .select('receipt_id,business_id,purpose,expires_at,revoked_at')
      .eq('token_hash', sha256Hex(token)).maybeSingle();
    if (error || !data || data.revoked_at) return null;
    if (!['customer_download', 'whatsapp_delivery'].includes(text(data.purpose))) return null;
    if (data.expires_at && new Date(String(data.expires_at)).getTime() <= Date.now()) return null;
    return loadPublicDocumentById('receipt', text(data.receipt_id), text(data.business_id));
  }

  const table = type === 'invoice' ? 'invoices' : type === 'quotation' ? 'quotations' : 'delivery_challans';
  const tokenColumn = type === 'invoice' ? 'public_share_token' : type === 'quotation' ? 'public_accept_token' : 'public_share_token';
  const found = await db.from(table).select('id,business_id').eq(tokenColumn, token).maybeSingle();
  if (found.error || !found.data) return null;
  const document = await loadPublicDocumentById(type, text(found.data.id), text(found.data.business_id));
  if (!document) return null;
  // A token lookup and row read happen separately; re-check the token on the document row to prevent stale token use.
  const verify = await db.from(table).select(tokenColumn).eq('id', document.id).eq('business_id', document.businessId).maybeSingle();
  if (verify.error || !verify.data || text((verify.data as Row)[tokenColumn]) !== token) return null;
  return document;
}

export async function renderDocumentToBuffer(type: PublicDocumentType, id: string, businessId: string): Promise<Buffer> {
  if (type === 'receipt') {
    const db = getServerSupabase();
    const data = await loadReceiptPdfData(db, id);
    if (text(data.receipt.business_id) !== businessId) throw new Error('Receipt not found.');
    return buildReceiptPdf(data);
  }
  const document = await loadPublicDocumentById(type, id, businessId);
  if (!document) throw new Error('Public document not found.');
  return buildPublicDocumentPdf(document);
}
