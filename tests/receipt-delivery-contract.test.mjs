import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (p) => readFile(new URL(p, root), 'utf8');

test('receipt delivery is payment-wide and channel-flexible', async () => {
  const sql = await read('supabase/migrations/20261001200000_receipt_digital_delivery_whatsapp_v1.sql');
  const worker = await read('supabase/functions/process-notifications/index.ts');
  const cashCustomer = await read('supabase/migrations/20261001202000_receipt_delivery_schema_alignment_v2.sql');
  assert.match(sql, /AFTER INSERT ON public\.receipts/);
  assert.match(sql, /notification_type.*receipt/);
  assert.match(sql, /channel.*email.*whatsapp.*sms.*telegram/s);
  assert.match(sql, /attachment_type.*receipt_pdf/);
  assert.match(sql, /idempotency_key.*receipt:/);
  assert.match(sql, /nullif\(trim\(coalesce\(c\.phone,''\)\),''\) IS NOT NULL/);
  assert.match(sql, /nullif\(trim\(coalesce\(c\.email,''\)\),''\) IS NOT NULL/);
  assert.match(sql, /telegram_chat_id/);
  assert.match(worker, /case "email":/);
  assert.match(worker, /case "whatsapp":/);
  assert.match(worker, /case "sms":/);
  assert.match(worker, /case "telegram":/);
  assert.match(worker, /attachment_type.*receipt_pdf/);
  assert.match(worker, /sendDocument/);
  assert.match(cashCustomer, /notify_customer = true/);
});

test('walk-in Cash & Carry remains optional-contact while phone enables receipt delivery', async () => {
  const sql = await read('supabase/migrations/20261001188000_cash_bill_walkin_customer_optional_v1.sql');
  const ui = await read('app/next-workspace/cash-bill/CashBillControlled.tsx');
  assert.match(sql, /nullif\(trim\(coalesce\(p_phone,''\)\),''\) IS NULL/);
  assert.match(ui, /Customer mobile number \(optional\)/);
  assert.doesNotMatch(ui, /!p\.customerPhone\.trim\(\).*Complete Cash & Carry/);
});

test('secure customer receipt PDF endpoint is bearer-token protected and non-cacheable', async () => {
  const route = await read('app/api/receipts/pdf/route.ts');
  const renderer = await read('lib/server/receipt-pdf.ts');
  assert.match(route, /receipt_access_tokens/);
  assert.match(route, /sha256Hex/);
  assert.match(route, /private, no-store/);
  assert.match(route, /X-Robots-Tag/);
  assert.match(renderer, /export const sha256Hex/);
  assert.match(renderer, /export async function loadReceiptPdfData/);
  assert.match(renderer, /export \{ buildReceiptPdf \}/);
});

test('dedicated notification worker cadence is one minute', async () => {
  const sql = await read('supabase/migrations/20261001201000_notification_worker_minute_schedule_v1.sql');
  assert.match(sql, /moneymatters-notification-worker/);
  assert.match(sql, /\* \* \* \* \*/);
  assert.match(sql, /process-notifications/);
});
