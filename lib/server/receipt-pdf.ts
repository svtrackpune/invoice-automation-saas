import { createHash } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

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

type PdfData = {
  receipt: ReceiptRow;
  payment: { amount: number; invoice_id: string | null } | null;
  invoice: { invoice_number: string; invoice_date: string; total: number; amount_paid: number; balance_due: number; document_kind: string } | null;
  customer: { display_name: string | null; legal_name: string | null; phone: string | null; email: string | null } | null;
  business: { name: string | null; legal_name: string | null; address: any; phone: string | null; email: string | null; website: string | null; tax_registration_number: string | null } | null;
  items: Array<{ name: string; sku: string | null; quantity: number; unit_price: number; line_total: number }>;
  allocations: Array<{ invoice_number: string; total_due: number; amount_applied: number; remaining_balance: number }>;
  customer_outstanding: number;
};

const cleanText = (value: unknown) => String(value ?? '').replace(/[\\()\r\n\u0000-\u001f]/g, (ch) => {
  if (ch === '\\') return '\\\\';
  if (ch === '(') return '\\(';
  if (ch === ')') return '\\)';
  return ' ';
}).replace(/[^\\x20-\\x7E]/g, '');

const plain = (value: unknown) => String(value ?? '').replace(/[\\r\\n]/g, ' ').trim();

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
  const words = value.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (!current) {
      current = word.slice(0, maxChars);
      continue;
    }
    if ((current.length + 1 + word.length) <= maxChars) {
      current += ` ${word}`;
    } else {
      lines.push(current);
      current = word.slice(0, maxChars);
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
};

const pdfEscape = (value: string) => cleanText(value);

const buildReceiptPdf = (data: PdfData) => {
  const pageWidth = 595;
  const pageHeight = 842;
  const left = 42;
  const right = 42;
  const top = 46;
  const bottom = 46;
  const usableWidth = pageWidth - left - right;
  const pages: string[][] = [[]];

  const ensurePage = () => pages[pages.length - 1];
  const newPage = () => { pages.push([]); };

  const textLine = (page: string[], x: number, y: number, value: string, size = 10, bold = false) => {
    const font = bold ? '/F2' : '/F1';
    page.push(`BT ${font} ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm (${pdfEscape(value)}) Tj ET`);
  };
  const line = (page: string[], x1: number, y1: number, x2: number, y2: number) => {
    page.push(`0.78 0.78 0.78 RG 0.7 w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`);
  };
  const rect = (page: string[], x: number, y: number, w: number, h: number) => {
    page.push(`0.96 0.97 0.98 rg ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
  };

  let y = pageHeight - top;
  let page = ensurePage();

  const businessName = plain(data.business?.name || data.business?.legal_name || 'Business');
  const businessLegal = plain(data.business?.legal_name || '');
  const address = addressText(data.business?.address);
  const contact = [data.business?.phone, data.business?.email, data.business?.website].filter(Boolean).map(plain).join(' · ');
  const receiptNumber = plain(data.receipt.receipt_number);
  const customerName = plain(data.customer?.display_name || data.customer?.legal_name || 'Cash Customer');
  const invoiceNumber = plain(data.invoice?.invoice_number || '');
  const paymentAmount = Number(data.payment?.amount ?? data.receipt.amount ?? 0);
  const total = Number(data.invoice?.total ?? paymentAmount);
  const balance = Math.max(0, Number(data.invoice?.balance_due ?? Math.max(total - paymentAmount, 0)));
  const currency = plain(data.receipt.currency_code || 'INR') || 'INR';

  textLine(page, left, y, businessName, 18, true);
  y -= 22;
  if (businessLegal && businessLegal !== businessName) { textLine(page, left, y, businessLegal, 9, false); y -= 14; }
  if (address) { for (const wrapped of wrap(address, 92)) { textLine(page, left, y, wrapped, 8.5); y -= 12; } }
  if (contact) { for (const wrapped of wrap(contact, 92)) { textLine(page, left, y, wrapped, 8.5); y -= 12; } }
  if (data.business?.tax_registration_number) { textLine(page, left, y, `GSTIN / Tax ID: ${plain(data.business.tax_registration_number)}`, 8.5); y -= 12; }

  y -= 8;
  line(page, left, y, pageWidth - right, y);
  y -= 24;
  textLine(page, left, y, 'PAYMENT RECEIPT', 15, true);
  textLine(page, pageWidth - right - 190, y, `Receipt: ${receiptNumber}`, 9, true);
  y -= 18;
  textLine(page, left, y, `Date: ${plain(data.receipt.receipt_date)}`, 9);
  if (invoiceNumber) textLine(page, left + 120, y, `Invoice: ${invoiceNumber}`, 9);
  y -= 20;

  rect(page, left, y - 8, usableWidth, 48);
  textLine(page, left + 12, y + 22, 'Customer', 8.5);
  textLine(page, left + 92, y + 22, customerName, 10, true);
  if (data.customer?.phone) textLine(page, left + 92, y + 8, plain(data.customer.phone), 8.5);
  if (data.customer?.email) textLine(page, left + 265, y + 8, plain(data.customer.email), 8.5);
  y -= 54;
  rect(page, left, y - 8, usableWidth, 40);
  textLine(page, left + 12, y + 17, `Received with thanks from ${customerName}`, 9.5, true);
  textLine(page, left + 12, y + 3, `Current customer ledger outstanding: ${money(data.customer_outstanding, currency)}`, 8.5);
  y -= 56;

  if (data.allocations.length) {
    textLine(page, left, y, 'Invoice Allocation', 9, true);
    y -= 8;
    line(page, left, y, pageWidth - right, y);
    y -= 16;
    for (const allocation of data.allocations) {
      const label = `${plain(allocation.invoice_number)} · Applied ${money(allocation.amount_applied, currency)} · Balance ${money(allocation.remaining_balance, currency)}`;
      textLine(page, left, y, label, 8.2);
      y -= 14;
    }
    y -= 4;
  }

  textLine(page, left, y, 'Items', 9, true);
  textLine(page, left + 365, y, 'Qty', 9, true);
  textLine(page, pageWidth - right - 92, y, 'Amount', 9, true);
  y -= 8;
  line(page, left, y, pageWidth - right, y);
  y -= 18;

  for (const item of data.items) {
    const itemName = plain(item.name || 'Item');
    const itemLines = wrap(itemName, 58);
    const sku = plain(item.sku || '');
    const rowHeight = Math.max(16, itemLines.length * 12 + (sku ? 10 : 0));
    if (y - rowHeight < bottom + 100) {
      newPage();
      page = ensurePage();
      y = pageHeight - top;
      textLine(page, left, y, `Payment Receipt ${receiptNumber}`, 12, true);
      y -= 18;
      line(page, left, y, pageWidth - right, y);
      y -= 18;
    }
    itemLines.forEach((v, idx) => textLine(page, left, y - idx * 12, v, 8.8, idx === 0));
    if (sku) textLine(page, left, y - itemLines.length * 12, `SKU: ${sku}`, 7.5);
    textLine(page, left + 365, y, String(Number(item.quantity || 0)), 8.8);
    textLine(page, pageWidth - right - 92, y, money(Number(item.line_total || 0), currency), 8.8, true);
    y -= rowHeight;
    line(page, left, y + 5, pageWidth - right, y + 5);
    y -= 8;
  }

  if (y - 150 < bottom) {
    newPage();
    page = ensurePage();
    y = pageHeight - top;
    textLine(page, left, y, `Payment Receipt ${receiptNumber}`, 12, true);
    y -= 24;
  }

  y -= 8;
  textLine(page, pageWidth - right - 205, y, 'Total', 10, true);
  textLine(page, pageWidth - right - 92, y, money(total, currency), 10, true);
  y -= 18;
  textLine(page, pageWidth - right - 205, y, 'Received', 10);
  textLine(page, pageWidth - right - 92, y, money(paymentAmount, currency), 10, true);
  y -= 18;
  textLine(page, pageWidth - right - 205, y, 'Balance', 10);
  textLine(page, pageWidth - right - 92, y, money(balance, currency), 10, true);
  y -= 24;

  textLine(page, left, y, `Payment method: ${plain(data.receipt.payment_method || '—')}`, 8.5);
  y -= 14;
  if (data.receipt.reference_number) { textLine(page, left, y, `Reference: ${plain(data.receipt.reference_number)}`, 8.5); y -= 14; }
  y -= 6;
  line(page, left, y, pageWidth - right, y);
  y -= 20;
  textLine(page, left, y, 'Retain this digital receipt as proof of purchase for warranty or guarantee claims.', 8.5);
  y -= 14;
  textLine(page, left, y, 'This is a computer-generated receipt.', 8);
  y -= 22;
  textLine(page, left, y, businessName, 8, true);

  return encodePdf(pages, pageWidth, pageHeight);
};

const encodePdf = (pages: string[][], pageWidth: number, pageHeight: number) => {
  const objects: string[] = [];
  const addObject = (value: string) => { objects.push(value); return objects.length; };
  const catalogId = addObject('');
  const pagesId = addObject('');
  const fontNormalId = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const fontBoldId = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
  const pageIds: number[] = [];

  for (const commands of pages) {
    const stream = commands.join('\n') + '\n';
    const contentId = addObject(`<< /Length ${Buffer.byteLength(stream, 'ascii')} >>\nstream\n${stream}endstream`);
    const pageId = addObject(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${fontNormalId} 0 R /F2 ${fontBoldId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    pageIds.push(pageId);
  }

  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;

  const chunks: string[] = ['%PDF-1.4\n%Moneymatters\n'];
  const offsets: number[] = [0];
  let offset = Buffer.byteLength(chunks[0], 'ascii');

  objects.forEach((obj, index) => {
    offsets[index + 1] = offset;
    const body = `${index + 1} 0 obj\n${obj}\nendobj\n`;
    chunks.push(body);
    offset += Buffer.byteLength(body, 'ascii');
  });

  const xrefOffset = offset;
  chunks.push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
  for (let i = 1; i <= objects.length; i += 1) chunks.push(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  chunks.push(`trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  return Buffer.from(chunks.join(''), 'ascii');
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
      ? db.from('customers').select('display_name,legal_name,phone,email').eq('id', receipt.customer_id).eq('business_id', receipt.business_id).maybeSingle()
      : Promise.resolve({ data: null } as any),
    db.from('businesses').select('name,legal_name,address,phone,email,website,tax_registration_number').eq('id', receipt.business_id).single(),
  ]);

  const invoiceId = paymentResult.data?.invoice_id || null;
  const [allocationResult, invoiceBalanceResult] = await Promise.all([
    receipt.payment_id
      ? db.from('payment_allocations').select('invoice_id,amount').eq('business_id', receipt.business_id).eq('payment_id', receipt.payment_id)
      : Promise.resolve({ data: [] } as any),
    receipt.customer_id
      ? db.from('invoices').select('balance_due,status').eq('business_id', receipt.business_id).eq('customer_id', receipt.customer_id).in('status', ['sent','posted','partially_paid','overdue'])
      : Promise.resolve({ data: [] } as any),
  ]);

  const allocationInvoiceIds = Array.from(new Set((allocationResult.data || []).map((row: any) => row.invoice_id).filter(Boolean)));
  const allocationInvoiceResult = allocationInvoiceIds.length
    ? await db.from('invoices').select('id,invoice_number,total,balance_due').in('id', allocationInvoiceIds).eq('business_id', receipt.business_id)
    : { data: [] } as any;
  const allocations = (allocationResult.data || []).map((row: any) => {
    const source = (allocationInvoiceResult.data || []).find((invoice: any) => invoice.id === row.invoice_id);
    return {
      invoice_number: plain(source?.invoice_number || row.invoice_id || '—'),
      total_due: Number(source?.total || 0),
      amount_applied: Number(row.amount || 0),
      remaining_balance: Math.max(0, Number(source?.balance_due || 0)),
    };
  });
  const customerOutstanding = (invoiceBalanceResult.data || []).reduce((sum: number, row: any) => sum + Math.max(0, Number(row.balance_due || 0)), 0);

  const [invoiceResult, itemsResult] = await Promise.all([
    invoiceId
      ? db.from('invoices').select('invoice_number,invoice_date,total,amount_paid,balance_due,document_kind').eq('id', invoiceId).eq('business_id', receipt.business_id).maybeSingle()
      : Promise.resolve({ data: null } as any),
    invoiceId
      ? db.from('invoice_items').select('quantity,unit_price,line_total,description,product_service_id').eq('invoice_id', invoiceId).order('sort_order')
      : Promise.resolve({ data: [] } as any),
  ]);

  const productIds = Array.from(new Set((itemsResult.data || []).map((item: any) => item.product_service_id).filter(Boolean)));
  const productsResult = productIds.length
    ? await db.from('products_services').select('id,name,sku').in('id', productIds).eq('business_id', receipt.business_id)
    : { data: [] } as any;

  const products = productsResult.data || [];
  const items = (itemsResult.data || []).map((item: any) => {
    const product = products.find((p: any) => p.id === item.product_service_id);
    return {
      name: plain(product?.name || item.description || 'Item'),
      sku: product?.sku ? plain(product.sku) : null,
      quantity: Number(item.quantity || 0),
      unit_price: Number(item.unit_price || 0),
      line_total: Number(item.line_total || 0),
    };
  });

  return {
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
