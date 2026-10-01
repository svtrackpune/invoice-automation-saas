import { createHash } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type ReceiptPdfData = {
  receipt: {
    id: string; business_id: string; receipt_number: string; receipt_date: string;
    amount: number; currency_code: string | null; payment_method: string | null;
    reference_number: string | null; customer_id: string | null; payment_id: string | null;
  };
  payment: { amount: number; invoice_id: string | null } | null;
  invoice: {
    invoice_number: string; invoice_date: string; total: number;
    amount_paid: number; balance_due: number; document_kind: string;
  } | null;
  customer: { display_name: string | null; legal_name: string | null; phone: string | null; email: string | null } | null;
  business: {
    name: string | null; legal_name: string | null; address: any;
    phone: string | null; email: string | null; website: string | null;
    tax_registration_number: string | null;
  } | null;
  items: Array<{
    name: string; sku: string | null; quantity: number;
    unit_price: number; line_total: number;
  }>;
};

const plain = (value: unknown) => String(value ?? '').replace(/[\r\n]+/g, ' ').trim();
const pdfText = (value: unknown) => plain(value)
  .replace(/\\/g, '\\\\')
  .replace(/\(/g, '\\(')
  .replace(/\)/g, '\\)')
  .replace(/[^\x20-\x7E]/g, ' ');

const money = (value: number, currency = 'INR') => {
  const amount = Number(value || 0);
  return currency === 'INR'
    ? `Rs. ${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `${currency} ${amount.toFixed(2)}`;
};

const addressText = (value: any) => {
  if (!value) return '';
  if (typeof value === 'string') return plain(value);
  if (typeof value === 'object') {
    return [
      value.line1, value.address_line1, value.street, value.line2, value.address_line2,
      value.city, value.state, value.postal_code || value.pin || value.pincode, value.country,
    ].filter(Boolean).map(plain).filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', ');
  }
  return plain(value);
};

const wrap = (value: string, width = 86) => {
  const words = value.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (!current) current = word;
    else if (current.length + word.length + 1 <= width) current += ` ${word}`;
    else { lines.push(current); current = word; }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
};

const encodePdf = (pages: string[][], width = 595, height = 842) => {
  const objects: string[] = [];
  const add = (value: string) => { objects.push(value); return objects.length; };
  const catalogId = add('');
  const pagesId = add('');
  const normalFontId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const boldFontId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
  const pageIds: number[] = [];

  for (const commands of pages) {
    const stream = commands.join('\n') + '\n';
    const contentId = add(`<< /Length ${Buffer.byteLength(stream, 'ascii')} >>\\nstream\\n${stream}endstream`);
    pageIds.push(add(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 ${normalFontId} 0 R /F2 ${boldFontId} 0 R >> >> /Contents ${contentId} 0 R >>`
    ));
  }

  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;

  const chunks = ['%PDF-1.4\n%Moneymatters\n'];
  const offsets: number[] = [0];
  let offset = Buffer.byteLength(chunks[0], 'ascii');

  objects.forEach((object, index) => {
    offsets[index + 1] = offset;
    const body = `${index + 1} 0 obj\n${object}\nendobj\n`;
    chunks.push(body);
    offset += Buffer.byteLength(body, 'ascii');
  });

  const xrefOffset = offset;
  chunks.push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
  for (let i = 1; i <= objects.length; i += 1) {
    chunks.push(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  }
  chunks.push(`trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);
  return Buffer.from(chunks.join(''), 'ascii');
};

export const buildReceiptPdf = (data: ReceiptPdfData) => {
  const width = 595;
  const height = 842;
  const left = 42;
  const right = 42;
  const bottom = 48;
  const commands: string[][] = [[]];
  let page = commands[0];
  let y = height - 46;

  const text = (x: number, yy: number, value: unknown, size = 10, bold = false) => {
    page.push(`BT ${bold ? '/F2' : '/F1'} ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${yy.toFixed(2)} Tm (${pdfText(value)}) Tj ET`);
  };
  const line = (yy: number) => page.push(`0.78 0.78 0.78 RG 0.7 w ${left} ${yy.toFixed(2)} m ${width - right} ${yy.toFixed(2)} l S`);
  const nextPage = () => {
    commands.push([]);
    page = commands[commands.length - 1];
    y = height - 46;
    text(left, y, `Payment Receipt ${data.receipt.receipt_number}`, 12, true);
    y -= 18; line(y); y -= 20;
  };

  const businessName = plain(data.business?.name || data.business?.legal_name || 'Business');
  const businessLegal = plain(data.business?.legal_name || '');
  const address = addressText(data.business?.address);
  const contact = [data.business?.phone, data.business?.email, data.business?.website].filter(Boolean).map(plain).join(' · ');
  const customerName = plain(data.customer?.display_name || data.customer?.legal_name || 'Cash Customer');
  const invoiceNumber = plain(data.invoice?.invoice_number || '');
  const currency = plain(data.receipt.currency_code || 'INR') || 'INR';
  const received = Number(data.payment?.amount ?? data.receipt.amount ?? 0);
  const total = Number(data.invoice?.total ?? received);
  const balance = Math.max(0, Number(data.invoice?.balance_due ?? Math.max(total - received, 0)));

  text(left, y, businessName, 18, true); y -= 22;
  if (businessLegal && businessLegal !== businessName) { text(left, y, businessLegal, 9); y -= 14; }
  for (const item of wrap(address, 90)) { if (address) { text(left, y, item, 8.5); y -= 12; } }
  for (const item of wrap(contact, 90)) { if (contact) { text(left, y, item, 8.5); y -= 12; } }
  if (data.business?.tax_registration_number) { text(left, y, `GSTIN / Tax ID: ${plain(data.business.tax_registration_number)}`, 8.5); y -= 12; }
  y -= 6; line(y); y -= 24;

  text(left, y, 'PAYMENT RECEIPT', 15, true);
  text(width - right - 180, y, `Receipt: ${plain(data.receipt.receipt_number)}`, 9, true);
  y -= 18;
  text(left, y, `Date: ${plain(data.receipt.receipt_date)}`, 9);
  if (invoiceNumber) text(left + 120, y, `Invoice: ${invoiceNumber}`, 9);
  y -= 26;

  page.push(`0.96 0.97 0.98 rg ${left} ${y - 10} ${width - left - right} 48 re f`);
  text(left + 12, y + 22, 'Customer', 8.5);
  text(left + 92, y + 22, customerName, 10, true);
  if (data.customer?.phone) text(left + 92, y + 8, plain(data.customer.phone), 8.5);
  if (data.customer?.email) text(left + 255, y + 8, plain(data.customer.email), 8.5);
  y -= 68;

  text(left, y, 'Item', 9, true);
  text(left + 365, y, 'Qty', 9, true);
  text(width - right - 92, y, 'Amount', 9, true);
  y -= 8; line(y); y -= 18;

  for (const item of data.items) {
    const nameLines = wrap(plain(item.name || 'Item'), 58);
    const sku = plain(item.sku || '');
    const rowHeight = Math.max(16, nameLines.length * 12 + (sku ? 10 : 0));
    if (y - rowHeight < bottom + 130) nextPage();
    nameLines.forEach((value, index) => text(left, y - index * 12, value, 8.8, index === 0));
    if (sku) text(left, y - nameLines.length * 12, `SKU: ${sku}`, 7.5);
    text(left + 365, y, String(Number(item.quantity || 0)), 8.8);
    text(width - right - 92, y, money(Number(item.line_total || 0), currency), 8.8, true);
    y -= rowHeight; line(y + 5); y -= 8;
  }

  if (y - 145 < bottom) nextPage();
  y -= 6;
  text(width - right - 205, y, 'Total', 10, true);
  text(width - right - 92, y, money(total, currency), 10, true); y -= 18;
  text(width - right - 205, y, 'Received', 10);
  text(width - right - 92, y, money(received, currency), 10, true); y -= 18;
  text(width - right - 205, y, 'Balance', 10);
  text(width - right - 92, y, money(balance, currency), 10, true); y -= 24;

  text(left, y, `Payment method: ${plain(data.receipt.payment_method || '—')}`, 8.5); y -= 14;
  if (data.receipt.reference_number) { text(left, y, `Reference: ${plain(data.receipt.reference_number)}`, 8.5); y -= 14; }
  y -= 6; line(y); y -= 20;
  text(left, y, 'Retain this digital receipt as proof of purchase for warranty or guarantee claims.', 8.5); y -= 14;
  text(left, y, 'This is a computer-generated receipt.', 8);
  return encodePdf(commands, width, height);
};

export const getServerSupabase = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Server Supabase environment is not configured.');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
};

export const sha256Hex = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

export async function loadReceiptPdfData(db: SupabaseClient, receiptId: string): Promise<ReceiptPdfData> {
  const { data: receipt, error } = await db.from('receipts')
    .select('id,business_id,receipt_number,receipt_date,amount,currency_code,payment_method,reference_number,customer_id,payment_id')
    .eq('id', receiptId)
    .single();
  if (error || !receipt) throw new Error('Receipt not found.');

  const [payment, customer, business] = await Promise.all([
    receipt.payment_id
      ? db.from('payments').select('amount,invoice_id').eq('id', receipt.payment_id).eq('business_id', receipt.business_id).maybeSingle()
      : Promise.resolve({ data: null } as any),
    receipt.customer_id
      ? db.from('customers').select('display_name,legal_name,phone,email').eq('id', receipt.customer_id).eq('business_id', receipt.business_id).maybeSingle()
      : Promise.resolve({ data: null } as any),
    db.from('businesses').select('name,legal_name,address,phone,email,website,tax_registration_number').eq('id', receipt.business_id).single(),
  ]);

  const invoiceId = payment.data?.invoice_id || null;
  const [invoice, invoiceItems] = await Promise.all([
    invoiceId
      ? db.from('invoices').select('invoice_number,invoice_date,total,amount_paid,balance_due,document_kind').eq('id', invoiceId).eq('business_id', receipt.business_id).maybeSingle()
      : Promise.resolve({ data: null } as any),
    invoiceId
      ? db.from('invoice_items').select('quantity,unit_price,line_total,description,product_service_id').eq('invoice_id', invoiceId).order('sort_order')
      : Promise.resolve({ data: [] } as any),
  ]);

  const productIds = Array.from(new Set((invoiceItems.data || []).map((x: any) => x.product_service_id).filter(Boolean)));
  const productResult = productIds.length
    ? await db.from('products_services').select('id,name,sku').in('id', productIds).eq('business_id', receipt.business_id)
    : { data: [] } as any;

  const products = productResult.data || [];
  const items = (invoiceItems.data || []).map((x: any) => {
    const product = products.find((p: any) => p.id === x.product_service_id);
    return {
      name: plain(product?.name || x.description || 'Item'),
      sku: product?.sku ? plain(product.sku) : null,
      quantity: Number(x.quantity || 0),
      unit_price: Number(x.unit_price || 0),
      line_total: Number(x.line_total || 0),
    };
  });

  return {
    receipt,
    payment: payment.data || null,
    invoice: invoice.data || null,
    customer: customer.data || null,
    business: business.data || null,
    items,
  };
}
