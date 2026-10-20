import { createHash } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createCanonicalDocumentViewModel } from '@/lib/shared/document-view-model';
import { createUnicodePdfDocument, pdfColor, pdfDocumentToBuffer, pdfFontName, pdfTextWidth, safePdfText } from '@/lib/server/documents/pdf-kit';

type ReceiptRow = {
  id: string;
  receipt_number: string;
  receipt_date: string;
  amount: number;
  currency_code: string | null;
  payment_method: string | null;
  reference_number: string | null;
  customer_id: string | null;
  payment_id: string | null;
  notes: string | null;
  business_id: string;
};

type ReceiptTheme = { templateKey?: string | null; primaryColor?: string | null; secondaryColor?: string | null; accentColor?: string | null; textColor?: string | null; backgroundColor?: string | null };

type PdfData = {
  documentTheme?: ReceiptTheme | null;
  receipt: ReceiptRow;
  payment: { amount: number; invoice_id: string | null } | null;
  invoice: { invoice_number: string; invoice_date: string; total: number; amount_paid: number; balance_due: number; document_kind: string } | null;
  customer: { display_name: string | null; legal_name: string | null; phone: string | null; email: string | null; billing_address: any; shipping_address: any; tax_id: string | null } | null;
  business: { name: string | null; legal_name: string | null; address: any; phone: string | null; email: string | null; website: string | null; tax_registration_number: string | null; logo_storage_path: string | null; currency_code: string | null; base_currency_code: string | null } | null;
  items: Array<{ name: string; description: string; sku: string | null; unit: string | null; quantity: number; unit_price: number; line_total: number }>;
  allocations: Array<{ invoice_number: string; invoice_date: string | null; total_due: number; amount_applied: number; remaining_balance: number }>;
  customer_outstanding: number;
};

const plain = (value: unknown) => safePdfText(value);

const money = (value: number, currency = 'INR') => {
  const amount = Number(value || 0);
  if (currency === 'INR') return `Rs. ${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `${currency} ${amount.toFixed(2)}`;
};

const addressText = (value: any) => {
  if (!value) return '';
  if (typeof value === 'string') return plain(value).replace(/,/g, ', ');
  if (typeof value === 'object') {
    return [value.line1, value.address_line1, value.street, value.line2, value.address_line2, value.city, value.state, value.postal_code || value.pin || value.pincode, value.country]
      .filter(Boolean)
      .map(plain)
      .filter(Boolean)
      .filter((v, i, a) => a.indexOf(v) === i)
      .join(', ');
  }
  return plain(value);
};

const wrap = (value: string, maxChars: number) => {
  const words = safePdfText(value).split(/\\s+/u).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const part = word.length > maxChars && /^[\\x00-\\x7F]+$/.test(word) ? word.slice(0, maxChars) : word;
    if (!current) {
      current = part;
      continue;
    }
    if ((current.length + 1 + part.length) <= maxChars) {
      current += ` ${part}`;
    } else {
      lines.push(current);
      current = part;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
};

type PdfPalette = { key: string; primary: string; secondary: string; accent: string; ink: string; background: string; pale: string; accentPale: string };
const pdfHex = (value: string | null | undefined, fallback = '#4338CA') => {
  const raw = String(value || fallback).trim().replace(/^#/, '');
  const hex = /^[0-9a-f]{6}$/i.test(raw) ? raw : fallback.replace(/^#/, '');
  return [0, 2, 4].map(offset => (parseInt(hex.slice(offset, offset + 2), 16) / 255).toFixed(3)).join(' ');
};
const mixPdfHex = (value: string | null | undefined, ratio = 0.91, fallback = '#4338CA') => {
  const raw = String(value || fallback).trim().replace(/^#/, '');
  const hex = /^[0-9a-f]{6}$/i.test(raw) ? raw : fallback.replace(/^#/, '');
  const channels = [0, 2, 4].map(offset => {
    const source = parseInt(hex.slice(offset, offset + 2), 16);
    return Math.round(source * (1 - ratio) + 255 * ratio).toString(16).padStart(2, '0');
  });
  return pdfHex('#' + channels.join(''));
};
function resolveReceiptPalette(input?: ReceiptTheme | null): PdfPalette {
  const key = ['classic', 'minimal', 'modern', 'premium', 'professional'].includes(String(input?.templateKey || '').toLowerCase())
    ? String(input?.templateKey).toLowerCase() : 'modern';
  const presets: Record<string, { primary: string; secondary: string; accent: string; background: string }> = {
    classic: { primary: '#7F1D1D', secondary: '#78716C', accent: '#991B1B', background: '#FFFFFF' },
    minimal: { primary: '#111827', secondary: '#64748B', accent: '#2563EB', background: '#FFFFFF' },
    modern: { primary: '#4338CA', secondary: '#64748B', accent: '#7C3AED', background: '#F8FAFC' },
    premium: { primary: '#4C1D95', secondary: '#7C3AED', accent: '#A855F7', background: '#FAF5FF' },
    professional: { primary: '#0F3B66', secondary: '#52677C', accent: '#145A8D', background: '#FFFFFF' },
  };
  const preset = presets[key];
  const primaryHex = input?.primaryColor || preset.primary;
  const accentHex = input?.accentColor || preset.accent;
  const backgroundHex = input?.backgroundColor || preset.background;
  return {
    key, primary: pdfHex(primaryHex), secondary: pdfHex(input?.secondaryColor || preset.secondary),
    accent: pdfHex(accentHex), ink: pdfHex(input?.textColor || '#172033'),
    background: pdfHex(backgroundHex), pale: mixPdfHex(backgroundHex, 0.93),
    accentPale: mixPdfHex(accentHex, 0.91),
  };
}


const buildReceiptPdf = async (data: PdfData): Promise<Buffer> => {
  const canonical = createCanonicalDocumentViewModel({
    type: 'receipt',
    number: data.receipt.receipt_number,
    date: data.receipt.receipt_date,
    currency_code: data.receipt.currency_code || 'INR',
    amount: data.receipt.amount,
    total: data.receipt.amount,
    amount_paid: data.receipt.amount,
    balance_due: data.customer_outstanding,
    customer_outstanding: data.customer_outstanding,
    business: data.business,
    customer: data.customer,
    items: data.items,
  }, { type: 'receipt' });
  const palette = resolveReceiptPalette(data.documentTheme);
  const receiptAmount = Number(data.receipt.amount || 0);
  const currency = plain(data.receipt.currency_code || 'INR').toUpperCase() || 'INR';
  const ledgerCurrency = plain(data.business?.base_currency_code || data.business?.currency_code || currency).toUpperCase() || currency;
  const receiptNumber = plain(data.receipt.receipt_number);
  const customerName = plain(data.customer?.legal_name || data.customer?.display_name || 'Cash Customer');
  const customerPhone = plain(data.customer?.phone || '');
  const customerEmail = plain(data.customer?.email || '');
  const invoiceNumber = plain(data.invoice?.invoice_number || (data.allocations.length === 1 ? data.allocations[0].invoice_number : ''));

  const pageWidth = 595;
  const pageHeight = 842;
  const left = 42;
  const right = 42;
  const top = 42;
  const bottom = 42;
  const usableWidth = pageWidth - left - right;
  type ReceiptPage = { index: number };
  const pdf = createUnicodePdfDocument({ size: [pageWidth, pageHeight], margin: 0, bufferPages: true });
  const pages: ReceiptPage[] = [{ index: 0 }];
  let page: ReceiptPage = pages[0];

  const textLine = (target: ReceiptPage, x: number, y: number, value: string, size = 10, bold = false, fill = palette.ink) => {
    const text = safePdfText(value);
    if (!text) return;
    pdf.switchToPage(target.index);
    pdf.font(pdfFontName(text, bold)).fontSize(size).fillColor(pdfColor(fill))
      .text(text, x, pageHeight - y - size, { lineBreak: false });
  };
  const line = (target: ReceiptPage, x1: number, y1: number, x2: number, y2: number, color = palette.secondary, width = 0.7) => {
    pdf.switchToPage(target.index);
    pdf.moveTo(x1, pageHeight - y1).lineTo(x2, pageHeight - y2).lineWidth(width).stroke(pdfColor(color));
  };
  const rect = (target: ReceiptPage, x: number, y: number, w: number, h: number, fill = palette.pale) => {
    pdf.switchToPage(target.index);
    pdf.rect(x, pageHeight - y - h, w, h).fill(pdfColor(fill));
  };
  const polygon = (target: ReceiptPage, points: Array<[number, number]>, fill: string) => {
    if (points.length < 3) return;
    pdf.switchToPage(target.index);
    pdf.moveTo(points[0][0], pageHeight - points[0][1]);
    for (const [x, y] of points.slice(1)) pdf.lineTo(x, pageHeight - y);
    pdf.closePath().fill(pdfColor(fill));
  };
  const estimateTextWidth = (value: string, size: number, bold = false) => pdfTextWidth(pdf, value, size, bold);
  const drawVectorCorners = (target: ReceiptPage) => {
    rect(target, 0, 0, pageWidth, pageHeight, palette.background);
    if (palette.key === 'minimal') {
      line(target, 455, 842, 595, 842, palette.primary, 1.2);
      line(target, 595, 842, 595, 790, palette.accent, 1.2);
      rect(target, 575, 822, 4, 4, palette.accent);
    } else if (palette.key === 'classic') {
      polygon(target, [[495,842],[595,842],[595,798]], mixPdfHex(data.documentTheme?.primaryColor, 0.88, '#7F1D1D'));
      polygon(target, [[535,842],[595,842],[595,816]], palette.accent);
    } else if (palette.key === 'premium') {
      polygon(target, [[468,842],[595,842],[595,790]], mixPdfHex(data.documentTheme?.primaryColor, 0.86, '#4C1D95'));
      polygon(target, [[525,842],[595,842],[595,812]], palette.accent);
      line(target, 555, 842, 595, 802, palette.primary, 1.3);
    } else if (palette.key === 'professional') {
      polygon(target, [[492,842],[595,842],[595,794]], mixPdfHex(data.documentTheme?.primaryColor, 0.87, '#0F3B66'));
      polygon(target, [[565,842],[595,842],[595,812]], palette.accent);
      line(target, 520, 842, 520, 827, palette.primary, 1.5);
      line(target, 520, 827, 595, 827, palette.primary, 1.5);
    } else {
      polygon(target, [[485,842],[595,842],[595,792]], mixPdfHex(data.documentTheme?.primaryColor, 0.88, '#4338CA'));
      polygon(target, [[535,842],[595,842],[595,816]], palette.accent);
      line(target, 555, 842, 595, 802, palette.primary, 1.4);
    }
    polygon(target, [[0,0],[34,0],[0,34]], mixPdfHex(data.documentTheme?.accentColor, 0.90, '#7C3AED'));
  };
  drawVectorCorners(page);
  let y = pageHeight - top;
  const businessName = plain(data.business?.name || data.business?.legal_name || 'Business');
  const businessLegal = plain(data.business?.legal_name || '');
  const address = addressText(data.business?.address);
  const businessContact = [data.business?.phone, data.business?.email, data.business?.website].filter(Boolean).map(plain).join(' · ');

  const startContinuationPage = () => {
    pdf.addPage({ size: [pageWidth, pageHeight], margin: 0 });
    page = { index: pages.length };
    pages.push(page);
    drawVectorCorners(page);
    y = pageHeight - top;
    textLine(page, left, y, `Payment Receipt ${receiptNumber} (continued)`, 11, true, palette.primary);
    y -= 16;
    line(page, left, y, pageWidth - right, y);
    y -= 18;
  };
  const ensureSpace = (height: number) => {
    if (y - height < bottom + 20) startContinuationPage();
  };
  const drawTopBox = (height: number, fill?: string) => {
    rect(page, left, y - height, usableWidth, height, fill);
    return y;
  };

  textLine(page, left, y, businessName, 17, true, palette.primary);
  y -= 20;
  if (businessLegal && businessLegal !== businessName) { textLine(page, left, y, businessLegal, 8.5); y -= 11; }
  if (address) {
    for (const wrapped of wrap(address, 92)) { textLine(page, left, y, wrapped, 8); y -= 10; }
  }
  if (businessContact) {
    for (const wrapped of wrap(businessContact, 92)) { textLine(page, left, y, wrapped, 8); y -= 10; }
  }
  if (data.business?.tax_registration_number) { textLine(page, left, y, `GSTIN / Tax ID: ${plain(data.business.tax_registration_number)}`, 8); y -= 10; }
  y -= 3;
  line(page, left, y, pageWidth - right, y);
  y -= 19;
  textLine(page, left, y, 'PAYMENT RECEIPT / VOUCHER', 13, true, palette.primary);
  const receiptLabel = `Receipt: ${receiptNumber}`;
  textLine(page, pageWidth - right - estimateTextWidth(receiptLabel, 8.5, true), y + 1, receiptLabel, 8.5, true);
  y -= 16;
  textLine(page, left, y, `Receipt date: ${plain(data.receipt.receipt_date)}`, 8.5);
  if (invoiceNumber) textLine(page, left + 210, y, `Invoice: ${invoiceNumber}`, 8.5);
  y -= 13;

  const nameLines = wrap(customerName, 78);
  const phoneFitsInline = Boolean(customerPhone && nameLines.length === 1 &&
    estimateTextWidth(customerName, 9.5, true) + estimateTextWidth(customerPhone, 8.3) + 18 <= usableWidth - 24);
  const contactRows = nameLines.length + (customerPhone && !phoneFitsInline ? 1 : 0) + (customerEmail ? 1 : 0);
  const customerCardHeight = Math.max(43, 20 + contactRows * 10);
  const customerTop = drawTopBox(customerCardHeight);
  textLine(page, left + 10, customerTop - 12, 'CUSTOMER', 7.5, true);
  let customerY = customerTop - 25;
  nameLines.forEach((value, index) => {
    textLine(page, left + 10, customerY, value, 9.5, index === 0);
    if (index === 0 && phoneFitsInline) {
      textLine(page, left + 10 + estimateTextWidth(value, 9.5, true) + 9, customerY, customerPhone, 8.3);
    }
    customerY -= 10;
  });
  if (customerPhone && !phoneFitsInline) { textLine(page, left + 10, customerY, customerPhone, 8.3); customerY -= 10; }
  if (customerEmail) textLine(page, left + 10, customerY, customerEmail, 8.1);
  y = customerTop - customerCardHeight - 10;

  const reference = plain(data.receipt.reference_number || '');
  const paymentCardHeight = reference ? 37 : 25;
  const paymentTop = drawTopBox(paymentCardHeight, palette.pale);
  textLine(page, left + 10, paymentTop - 12, `Payment mode: ${plain(data.receipt.payment_method || '—')}`, 8.2);
  if (reference) textLine(page, left + 10, paymentTop - 27, `UTR / transaction reference: ${reference}`, 8.1);
  y = paymentTop - paymentCardHeight - 10;

  if (data.allocations.length) {
    ensureSpace(24 + data.allocations.length * 12);
    textLine(page, left, y, 'INVOICE ALLOCATION', 8.5, true);
    y -= 12;
    line(page, left, y, pageWidth - right, y);
    y -= 11;
    for (const allocation of data.allocations) {
      const allocationText = `${plain(allocation.invoice_number)}  |  Original ${money(allocation.total_due, currency)}  |  Applied ${money(allocation.amount_applied, currency)}  |  Remaining ${money(allocation.remaining_balance, currency)}`;
      const allocationLines = wrap(allocationText, 92);
      ensureSpace(allocationLines.length * 10 + 3);
      allocationLines.forEach((value, index) => textLine(page, left + 2, y - index * 10, value, 7.8));
      y -= allocationLines.length * 10 + 3;
    }
    y -= 4;
  }

  if (data.items.length) {
    ensureSpace(38 + data.items.length * 14);
    textLine(page, left, y, 'INVOICE ITEMS (REFERENCE ONLY)', 8.5, true);
    y -= 12;
    textLine(page, left, y, 'Item / description', 7.8, true);
    textLine(page, left + 370, y, 'Qty', 7.8, true);
    textLine(page, pageWidth - right - 4, y, 'Amount', 7.8, true);
    y -= 7;
    line(page, left, y, pageWidth - right, y);
    y -= 12;

    for (const item of data.items) {
      const itemName = plain(item.name || item.description || 'Item');
      const detail = plain(item.description || '');
      const itemLines = wrap(itemName, 62);
      const detailLines = detail && detail !== itemName ? wrap(detail, 72) : [];
      const sku = plain(item.sku || '');
      const rowHeight = Math.max(12, itemLines.length * 10 + detailLines.length * 8 + (sku ? 8 : 0));
      ensureSpace(rowHeight + 4);
      itemLines.forEach((value, index) => textLine(page, left, y - index * 10, value, 8.2, index === 0));
      let detailY = y - itemLines.length * 10;
      detailLines.forEach((value, index) => textLine(page, left, detailY - index * 8, value, 7.2));
      if (sku) textLine(page, left, detailY - detailLines.length * 8, `SKU: ${sku}`, 7.1);
      const quantityLabel = `${Number(item.quantity || 0)}${item.unit ? ' ' + plain(item.unit) : ''}`;
      textLine(page, left + 370, y, quantityLabel, 8.2);
      const itemAmount = money(Number(item.line_total || 0), currency);
      textLine(page, pageWidth - right - estimateTextWidth(itemAmount, 8.2, true) - 4, y, itemAmount, 8.2, true);
      y -= rowHeight + 3;
      line(page, left, y + 1, pageWidth - right, y + 1);
      y -= 5;
    }
    y -= 3;
  }

  ensureSpace(105);
  const summaryTop = drawTopBox(43, palette.accentPale);
  textLine(page, left + 10, summaryTop - 14, 'AMOUNT RECEIVED', 8.5, true, palette.primary);
  const receivedText = money(receiptAmount, currency);
  textLine(page, pageWidth - right - estimateTextWidth(receivedText, 12, true) - 12, summaryTop - 15, receivedText, 12, true, palette.primary);
  textLine(page, left + 10, summaryTop - 29, `Amount in words: ${canonical.financials.amountInWords}`, 7.2);
  y = summaryTop - 53;

  const ledgerTop = drawTopBox(25, palette.pale);
  textLine(page, left + 10, ledgerTop - 16, 'Current customer ledger balance', 8.2, false, palette.primary);
  const ledgerText = money(data.customer_outstanding, ledgerCurrency);
  textLine(page, pageWidth - right - estimateTextWidth(ledgerText, 9, true) - 10, ledgerTop - 16, ledgerText, 9, true, palette.primary);
  y = ledgerTop - 35;

  ensureSpace(45);
  line(page, left, y, pageWidth - right, y);
  y -= 14;
  textLine(page, left, y, 'Please retain this receipt for your records.', 8.3, true);
  y -= 12;
  const disclaimer = 'This is a computer-generated payment receipt and does not require signature.';
  textLine(page, Math.max(left, (pageWidth - estimateTextWidth(disclaimer, 7.8)) / 2), y, disclaimer, 7.8);
  y -= 12;
  const powered = 'Powered by Moneymatters FinOps | mm.nilanga.in';
  textLine(page, Math.max(left, (pageWidth - estimateTextWidth(powered, 7.2, true)) / 2), y, powered, 7.2, true, palette.accent);

  return await pdfDocumentToBuffer(pdf);
};

export const getServerSupabase = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Server Supabase environment is not configured.');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
};

export const sha256Hex = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

export async function loadReceiptPdfData(db: SupabaseClient, receiptId: string): Promise<PdfData> {
  const { data: receipt, error: receiptError } = await db
    .from('receipts')
    .select('id,business_id,receipt_number,receipt_date,amount,currency_code,payment_method,reference_number,customer_id,payment_id,notes')
    .eq('id', receiptId)
    .single();
  if (receiptError || !receipt) throw new Error('Receipt not found.');

  const [paymentResult, customerResult, businessResult] = await Promise.all([
    receipt.payment_id
      ? db.from('payments').select('amount,invoice_id').eq('id', receipt.payment_id).eq('business_id', receipt.business_id).maybeSingle()
      : Promise.resolve({ data: null } as any),
    receipt.customer_id
      ? db.from('customers').select('display_name,legal_name,phone,email,billing_address,shipping_address,tax_id').eq('id', receipt.customer_id).eq('business_id', receipt.business_id).maybeSingle()
      : Promise.resolve({ data: null } as any),
    db.from('businesses').select('name,legal_name,address,phone,email,website,tax_registration_number,logo_storage_path,currency_code,base_currency_code').eq('id', receipt.business_id).single(),
  ]);

  const preferenceResult = await db.from('business_document_preferences')
    .select('template_id,primary_color,secondary_color,accent_color,text_color,background_color')
    .eq('business_id', receipt.business_id).eq('document_type', 'receipt').maybeSingle();
  if (preferenceResult.error) throw new Error('Receipt theme preferences are unavailable.');
  const preference = (preferenceResult.data || {}) as { template_id?: string | null; primary_color?: string | null; secondary_color?: string | null; accent_color?: string | null; text_color?: string | null; background_color?: string | null };
  const templateResult = preference.template_id
    ? await db.from('document_templates').select('template_key').eq('id', preference.template_id).eq('document_type', 'receipt').eq('is_active', true).maybeSingle()
    : { data: null, error: null } as any;
  if (templateResult.error) throw new Error('Selected receipt template is unavailable.');
  const documentTheme: ReceiptTheme = {
    templateKey: plain(templateResult.data?.template_key || 'modern'),
    primaryColor: preference.primary_color || null,
    secondaryColor: preference.secondary_color || null,
    accentColor: preference.accent_color || null,
    textColor: preference.text_color || null,
    backgroundColor: preference.background_color || null,
  };

  const paymentInvoiceId = paymentResult.data?.invoice_id || null;
  const [allocationResult, outstandingResult] = await Promise.all([
    receipt.payment_id
      ? db.from('payment_allocations').select('invoice_id,amount').eq('business_id', receipt.business_id).eq('payment_id', receipt.payment_id)
      : Promise.resolve({ data: [] } as any),
    receipt.customer_id
      ? db.rpc('fn_get_customer_outstanding_balance', {
          p_business_id: receipt.business_id,
          p_customer_id: receipt.customer_id,
        })
      : Promise.resolve({ data: 0, error: null } as any),
  ]);
  if (receipt.customer_id && outstandingResult.error) {
    throw new Error('Customer outstanding balance could not be calculated.');
  }

  const allocationInvoiceIds = Array.from(new Set((allocationResult.data || []).map((row: any) => row.invoice_id).filter(Boolean)));
  const allocationInvoiceResult = allocationInvoiceIds.length
    ? await db.from('invoices').select('id,invoice_number,invoice_date,total,balance_due').in('id', allocationInvoiceIds).eq('business_id', receipt.business_id)
    : { data: [] } as any;
  const allocations = (allocationResult.data || []).map((row: any) => {
    const source = (allocationInvoiceResult.data || []).find((invoice: any) => invoice.id === row.invoice_id);
    return {
      invoice_number: plain(source?.invoice_number || row.invoice_id || '—'),
      invoice_date: source?.invoice_date ? plain(source.invoice_date) : null,
      total_due: Number(source?.total || 0),
      amount_applied: Number(row.amount || 0),
      remaining_balance: Math.max(0, Number(source?.balance_due || 0)),
    };
  });
  const customerOutstanding = Number(outstandingResult.data || 0);

  const receiptInvoiceId = allocationInvoiceIds.length === 1
    ? String(allocationInvoiceIds[0])
    : allocationInvoiceIds.length === 0 ? paymentInvoiceId : null;
  const [invoiceResult, itemsResult] = await Promise.all([
    receiptInvoiceId
      ? db.from('invoices').select('invoice_number,invoice_date,total,amount_paid,balance_due,document_kind').eq('id', receiptInvoiceId).eq('business_id', receipt.business_id).maybeSingle()
      : Promise.resolve({ data: null } as any),
    receiptInvoiceId
      ? db.from('invoice_items').select('quantity,unit_price,line_total,description,product_service_id').eq('invoice_id', receiptInvoiceId).order('sort_order')
      : Promise.resolve({ data: [] } as any),
  ]);

  const productIds = Array.from(new Set((itemsResult.data || []).map((item: any) => item.product_service_id).filter(Boolean)));
  const productsResult = productIds.length
    ? await db.from('products_services').select('id,name,description,sku,unit').in('id', productIds).eq('business_id', receipt.business_id)
    : { data: [] } as any;

  const products = productsResult.data || [];
  const items = (itemsResult.data || []).map((item: any) => {
    const product = products.find((p: any) => p.id === item.product_service_id);
    return {
      name: plain(product?.name || item.description || 'Item'),
      description: (() => {
        const lineDescription = plain(item.description || '');
        const productDescription = plain(product?.description || '');
        const itemName = plain(product?.name || item.description || 'Item');
        return lineDescription && lineDescription !== itemName
          ? lineDescription
          : productDescription && productDescription !== itemName
            ? productDescription
            : '';
      })(),
      sku: product?.sku ? plain(product.sku) : null,
      unit: product?.unit ? plain(product.unit) : null,
      quantity: Number(item.quantity || 0),
      unit_price: Number(item.unit_price || 0),
      line_total: Number(item.line_total || 0),
    };
  });

  return {
    documentTheme,
    receipt: receipt as ReceiptRow,
    payment: paymentResult.data || null,
    invoice: invoiceResult.data || null,
    customer: customerResult.data || null,
    business: businessResult.data || null,
    items,
    allocations,
    customer_outstanding: customerOutstanding,
  };
}

export { buildReceiptPdf };
