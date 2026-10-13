/**
 * Canonical normalization layer shared by workspace, public web, print and PDF
 * document surfaces. It is deliberately pure: callers remain responsible for
 * authorization, token validation, and fetching tenant-scoped source records.
 */
export type CanonicalDocumentType = 'invoice' | 'quotation' | 'receipt' | 'challan';
export type SettlementDisplayMode = 'upi_qr' | 'bank_transfer' | 'both' | 'none';

export interface CanonicalDocumentViewModel {
  business: {
    legalName: string;
    tradeName?: string;
    logoUrl?: string;
    address: string;
    phone: string;
    email: string;
    gstin?: string;
    pan?: string;
    bankDetails?: {
      bankName: string;
      accountNumber: string;
      ifsc: string;
      branch?: string;
      upiId?: string;
    };
  };
  customer: {
    name: string;
    billingAddress: string;
    shippingAddress?: string;
    phone?: string;
    email?: string;
    gstin?: string;
  };
  settlementDisplayMode: SettlementDisplayMode;
  document: {
    type: CanonicalDocumentType;
    number: string;
    date: string;
    dueDate?: string;
    status: string;
    publicUrl: string;
    currency: string;
  };
  items: Array<{
    name: string;
    description: string;
    unit?: string;
    hsn?: string;
    quantity: number;
    unitPrice: number;
    discount: number;
    taxRate: number;
    amount: number;
  }>;
  financials: {
    subtotal: number;
    totalDiscount: number;
    taxBreakdown: Array<{ name: string; rate: number; amount: number }>;
    roundOff: number;
    grandTotal: number;
    amountPaid: number;
    balanceDue: number;
    amountInWords: string;
    upiQrString?: string;
  };
}

type Source = Record<string, any>;

const record = (v: unknown): Source => v && typeof v === 'object' && !Array.isArray(v) ? v as Source : {};
const first = (...values: unknown[]): unknown => values.find(v => v !== undefined && v !== null && String(v).trim() !== '');
const str = (v: unknown, fallback = '') => String(v ?? fallback).trim();
const num = (v: unknown, fallback = 0) => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const nullableText = (...v: unknown[]) => {
  const x = first(...v);
  return x === undefined ? undefined : str(x) || undefined;
};

export function canonicalAddress(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string' || typeof value === 'number') return str(value).split(/\n|,/).map(x => x.trim()).filter(Boolean).join(', ');
  const a = record(value);
  return [
    first(a.line1, a.address_line1, a.address_line_1, a.street),
    first(a.line2, a.address_line2, a.address_line_2),
    [first(a.city, a.locality), first(a.state, a.state_name), first(a.postal_code, a.pin, a.pincode, a.zip)].filter(Boolean).join(' '),
    first(a.country, a.country_name),
  ].map(value => str(value)).filter(Boolean).join(', ');
}

function numberWords(value: number): string {
  const small = ['', 'One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
  const tens = ['', '', 'Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
  const below100 = (n: number) => n < 20 ? small[n] : [tens[Math.floor(n / 10)], small[n % 10]].filter(Boolean).join(' ');
  const below1000 = (n: number) => [
    n >= 100 ? small[Math.floor(n / 100)] + ' Hundred' : '',
    n % 100 ? below100(n % 100) : '',
  ].filter(Boolean).join(' ');
  const whole = Math.floor(Math.max(0, value));
  if (whole === 0) return 'Zero';
  const groups: Array<[number, string]> = [[10000000,'Crore'],[100000,'Lakh'],[1000,'Thousand'],[1,'']];
  let n = whole;
  const parts: string[] = [];
  for (const [size, label] of groups) {
    if (n >= size) {
      const count = Math.floor(n / size);
      parts.push((size === 1 ? below1000(count) : numberWordsGroup(count)) + (label ? ' ' + label : ''));
      n %= size;
    }
  }
  return parts.join(' ');
}
function numberWordsGroup(n: number): string {
  const small = ['', 'One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
  const tens = ['', '', 'Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
  if (n < 20) return small[n] || '';
  if (n < 100) return [tens[Math.floor(n / 10)], small[n % 10]].filter(Boolean).join(' ');
  return [small[Math.floor(n / 100)] + ' Hundred', n % 100 ? numberWordsGroup(n % 100) : ''].filter(Boolean).join(' ');
}

export function amountInWords(value: number, currency = 'INR'): string {
  const normalized = String(currency || 'INR').toUpperCase();
  if (normalized !== 'INR') return normalized + ' ' + num(value).toFixed(2) + ' Only';
  const safe = Math.max(0, num(value));
  const rupees = Math.floor(safe + 0.000001);
  const paise = Math.round((safe - rupees) * 100);
  return numberWords(rupees) + ' Indian Rupees' + (paise ? ' and ' + numberWordsGroup(paise) + ' Paise' : '') + ' Only';
}

function canonicalType(source: Source, explicitType?: string): CanonicalDocumentType {
  const t = str(first(explicitType, source.type, source.document_type, source.documentType, source.document_kind)).toLowerCase();
  if (t.includes('challan')) return 'challan';
  if (t.includes('receipt') || t.includes('voucher')) return 'receipt';
  if (t.includes('quotation') || t.includes('quote') || t.includes('estimate')) return 'quotation';
  return 'invoice';
}

function normalizeItems(input: unknown): CanonicalDocumentViewModel['items'] {
  if (!Array.isArray(input)) return [];
  return input.map((raw) => {
    const item = record(raw);
    const quantity = Math.max(0, num(first(item.quantity, item.qty), 0));
    const unitPrice = Math.max(0, num(first(item.unitPrice, item.unit_price, item.rate, item.price), 0));
    const discount = Math.max(0, num(first(item.discount, item.discount_amount), 0));
    const taxAmount = Math.max(0, num(first(item.taxAmount, item.tax_amount), 0));
    const base = Math.max(0, quantity * unitPrice - discount);
    const name = str(first(item.name, item.item_name, item.product_name, item.description), 'Item');
    const detail = nullableText(item.detail, item.item_description, item.description);
    return {
      name,
      description: detail || name,
      unit: nullableText(item.unit, item.unit_name, item.unit_of_measure) || 'pcs',
      hsn: nullableText(item.hsn, item.hsnSac, item.hsn_sac, item.sac_code),
      quantity,
      unitPrice,
      discount,
      taxRate: Math.max(0, num(first(item.taxRate, item.tax_rate, item.gst_rate), 0)),
      amount: Math.max(0, num(first(item.amount, item.lineTotal, item.line_total, item.total), base + taxAmount)),
    };
  });
}

export function createCanonicalDocumentViewModel(
  input: unknown,
  options: { type?: CanonicalDocumentType; publicUrl?: string; upiId?: string | null; prefillUpiAmount?: boolean; settlementDisplayMode?: SettlementDisplayMode | null; paymentQrEnabled?: boolean } = {},
): CanonicalDocumentViewModel {
  const root = record(input);
  const payload = record(root.payload);
  const source = Object.keys(payload).length ? payload : root;
  const businessSource = record(first(source.business, source.merchant, source.company));
  const customerSource = record(first(source.customer, source.party, source.vendor, source.counterparty));
  const paymentSource = record(first(source.bank, source.bankDetails, source.bank_details, source.paymentSelection));
  const documentType = canonicalType(source, options.type);
  const currency = str(first(source.currency, source.currency_code, source.currencyCode), 'INR').toUpperCase();
  const items = normalizeItems(first(source.items, source.line_items, source.invoice_items, source.quotation_items));
  const subtotal = num(first(source.subtotal, source.sub_total), items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0));
  const discount = num(first(source.totalDiscount, source.discount_total, source.discount_amount, source.discountTotal));
  const tax = num(first(source.tax_total, source.taxTotal, source.tax_amount, source.taxAmount));
  const total = num(first(source.grandTotal, source.total, source.total_amount, source.grand_total), subtotal - discount + tax);
  const paid = num(first(source.amountPaid, source.amount_paid, source.amount_received, source.amountReceived, documentType === 'receipt' ? source.amount : undefined));
  const balance = Math.max(0, num(first(source.balanceDue, source.balance_due, documentType === 'receipt' ? source.customer_outstanding : undefined), Math.max(0, total - paid)));
  const roundOff = num(first(source.roundOff, source.round_off, source.round_off_amount), total - (subtotal - discount + tax));
  const gstin = nullableText(businessSource.gstin, businessSource.taxRegistrationNumber, businessSource.tax_registration_number, businessSource.gst_number);
  const customerGstin = nullableText(customerSource.gstin, customerSource.taxId, customerSource.tax_id, customerSource.gst_number);
  const bankName = nullableText(paymentSource.institutionName, paymentSource.institution_name, paymentSource.bankName, paymentSource.bank_name, paymentSource.name);
  const accountNumber = nullableText(paymentSource.accountNumber, paymentSource.account_number, paymentSource.account_last4);
  const ifsc = nullableText(paymentSource.ifsc, paymentSource.ifscCode, paymentSource.ifsc_code);
  const bankUpi = nullableText(options.upiId, paymentSource.upiId, paymentSource.upi_id);
  const bankDetails = bankName || accountNumber || ifsc ? {
    bankName: bankName || 'Bank',
    accountNumber: accountNumber || '',
    ifsc: ifsc || '',
    ...(nullableText(paymentSource.branch, paymentSource.branchName, paymentSource.branch_name) ? { branch: str(first(paymentSource.branch, paymentSource.branchName, paymentSource.branch_name)) } : {}),
    ...(bankUpi ? { upiId: bankUpi } : {}),
  } : undefined;
  const businessName = str(first(businessSource.legalName, businessSource.legal_name, businessSource.name, businessSource.business_name), 'Business');
  const customerName = str(first(customerSource.legalName, customerSource.legal_name, customerSource.display_name, customerSource.name, customerSource.customer_name), 'Customer');
  const publicUrl = str(first(options.publicUrl, source.publicUrl, source.public_url, root.publicUrl));
  const explicitQr = options.paymentQrEnabled === false ? undefined : nullableText(source.upiQrString, source.payment_qr_payload, source.paymentQrPayload, source.payment_qr_payload);
  const qrUpi = ['invoice', 'quotation'].includes(documentType) && currency === 'INR' && balance > 0 && bankUpi
    ? 'upi://pay?' + new URLSearchParams({
      pa: bankUpi,
      pn: businessName,
      ...(options.prefillUpiAmount === false ? {} : { am: balance.toFixed(2) }),
      cu: 'INR',
      tn: str(first(source.number, source.document_number, source.invoice_number, source.quotation_number, source.receipt_number)),
    }).toString()
    : undefined;
  const usableQr = Boolean(qrUpi || (explicitQr && /^upi:\/\/pay\?/i.test(explicitQr) && currency === 'INR' && balance > 0));
  const usableBank = Boolean(bankDetails && (bankDetails.accountNumber || bankDetails.ifsc || bankDetails.bankName));
  const requestedSettlementMode = str(first(options.settlementDisplayMode, source.settlement_display_mode, source.settlementDisplayMode)).toLowerCase();
  let settlementDisplayMode: SettlementDisplayMode;
  if (requestedSettlementMode === 'both' && usableQr && usableBank) settlementDisplayMode = 'both';
  else if (requestedSettlementMode === 'upi_qr' && usableQr) settlementDisplayMode = 'upi_qr';
  else if (requestedSettlementMode === 'bank_transfer' && usableBank) settlementDisplayMode = 'bank_transfer';
  else if (requestedSettlementMode === 'none') settlementDisplayMode = 'none';
  else if (usableQr) settlementDisplayMode = 'upi_qr';
  else if (usableBank) settlementDisplayMode = 'bank_transfer';
  else settlementDisplayMode = 'none';

  const taxArray = Array.isArray(source.taxBreakdown || source.tax_breakdown)
    ? (source.taxBreakdown || source.tax_breakdown) as unknown[]
    : [];
  let taxBreakdown = taxArray.map(raw => {
    const t = record(raw);
    return { name: str(first(t.name, t.tax_name, t.tax_code), 'GST'), rate: num(first(t.rate, t.tax_rate)), amount: num(first(t.amount, t.tax_amount)) };
  });
  const cgst = num(first(source.cgstAmount, source.cgst_amount));
  const sgst = num(first(source.sgstAmount, source.sgst_amount));
  const igst = num(first(source.igstAmount, source.igst_amount));
  if (!taxBreakdown.length && (cgst || sgst || igst)) {
    taxBreakdown = [
      ...(cgst ? [{ name: 'CGST', rate: 0, amount: cgst }] : []),
      ...(sgst ? [{ name: 'SGST', rate: 0, amount: sgst }] : []),
      ...(igst ? [{ name: 'IGST', rate: 0, amount: igst }] : []),
    ];
  } else if (!taxBreakdown.length && tax) {
    taxBreakdown = [{ name: 'GST / Tax', rate: items.length ? items.reduce((sum, i) => sum + i.taxRate, 0) / items.length : 0, amount: tax }];
  }

  return {
    settlementDisplayMode,
    business: {
      legalName: str(first(businessSource.legalName, businessSource.legal_name, businessSource.name, businessSource.business_name), 'Business'),
      ...(nullableText(businessSource.name, businessSource.tradeName, businessSource.trade_name) ? { tradeName: str(first(businessSource.name, businessSource.tradeName, businessSource.trade_name)) } : {}),
      ...(nullableText(businessSource.logoUrl, businessSource.logo_url, businessSource.logoStoragePath, businessSource.logo_storage_path) ? { logoUrl: str(first(businessSource.logoUrl, businessSource.logo_url, businessSource.logoStoragePath, businessSource.logo_storage_path)) } : {}),
      address: canonicalAddress(first(businessSource.address, businessSource.registered_address)),
      phone: str(first(businessSource.phone, businessSource.mobile, businessSource.alternate_phone)),
      email: str(first(businessSource.email, businessSource.alternate_email)),
      ...(gstin ? { gstin } : {}),
      ...(nullableText(businessSource.pan, businessSource.pan_number) ? { pan: str(first(businessSource.pan, businessSource.pan_number)) } : {}),
      ...(bankDetails ? { bankDetails } : {}),
    },
    customer: {
      name: customerName,
      billingAddress: canonicalAddress(first(customerSource.billingAddress, customerSource.billing_address, customerSource.address, customerSource.address_line)),
      ...(nullableText(customerSource.shippingAddress, customerSource.shipping_address) ? { shippingAddress: canonicalAddress(first(customerSource.shippingAddress, customerSource.shipping_address)) } : {}),
      ...(nullableText(customerSource.phone, customerSource.mobile) ? { phone: str(first(customerSource.phone, customerSource.mobile)) } : {}),
      ...(nullableText(customerSource.email) ? { email: str(customerSource.email) } : {}),
      ...(customerGstin ? { gstin: customerGstin } : {}),
    },
    document: {
      type: documentType,
      number: str(first(source.number, source.document_number, source.invoice_number, source.quotation_number, source.receipt_number, source.challan_number, source.bill_number), '—'),
      date: str(first(source.date, source.document_date, source.invoice_date, source.quotation_date, source.receipt_date, source.challan_date)),
      ...(nullableText(source.dueDate, source.due_date) ? { dueDate: str(first(source.dueDate, source.due_date)) } : {}),
      status: str(first(source.status, source.state), 'unknown'),
      publicUrl,
      currency,
    },
    items,
    financials: {
      subtotal,
      totalDiscount: discount,
      taxBreakdown,
      roundOff,
      grandTotal: total,
      amountPaid: paid,
      balanceDue: balance,
      amountInWords: amountInWords(total, currency),
      ...(qrUpi ? { upiQrString: qrUpi } : explicitQr ? { upiQrString: explicitQr } : {}),
    },
  };
}
