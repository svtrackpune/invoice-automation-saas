import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (p) => readFile(new URL(p, root), 'utf8');

test('receipt delivery is payment-wide and channel-flexible', async () => {
  const sql = await read('supabase/migrations/20261001200000_receipt_digital_delivery_whatsapp_v1.sql');
  const worker = await read('supabase/functions/process-notifications/index.ts');
  const cashCustomer = await read('supabase/migrations/20261001202000_receipt_delivery_schema_alignment_v2.sql');
  const routing = await read('supabase/migrations/20261001205000_receipt_delivery_preference_and_primary_route_v5.sql');
  const authoritative = await read('supabase/migrations/20261001206000_receipt_delivery_authoritative_v6.sql');
  const customerUi = await read('app/next-workspace/customers/CustomerManagerControlled.tsx');
  assert.match(sql, /AFTER INSERT ON public\.receipts/);
  assert.match(sql, /notification_type.*receipt/s);
  assert.match(routing, /receipt_delivery_enabled/);
  assert.match(sql, /channel.*email.*whatsapp.*sms.*telegram/s);
  assert.match(sql, /attachment_type.*receipt_pdf/);
  assert.match(sql, /idempotency_key.*receipt:/);
  assert.match(routing, /Automatic receipt routing is deliberately one channel per event/);
  assert.match(sql, /c\.phone/);
  assert.match(sql, /c\.email/);
  assert.match(sql, /telegram_chat_id/);
  assert.match(worker, /connection\.provider === "resend"/);
  assert.match(worker, /connection\.provider === "wapi"/);
  assert.match(worker, /connection\.provider === "twilio"/);
  assert.match(worker, /connection\.provider === "telegram-bot"/);
  assert.match(worker, /job\.action_url/);
  assert.match(worker, /resolveTenantConnection\(/);
  assert.doesNotMatch(worker, /WHATSAPP_ACCESS_TOKEN|TELEGRAM_BOT_TOKEN|RESEND_API_KEY|TWILIO_AUTH_TOKEN/);
  assert.match(cashCustomer, /notify_customer = true/);
  assert.match(routing, /receipt_delivery_enabled = true/);
  assert.match(authoritative, /coalesce\(c\.receipt_delivery_enabled, true\)/);
  assert.match(authoritative, /selected_channel := 'whatsapp'/);
  assert.match(customerUi, /telegram_chat_id/);
  assert.match(customerUi, /receipt_delivery_enabled/);
  assert.match(customerUi, /Automatic digital receipt delivery/);
  const prefs = await read('app/next-workspace/preferences/page.tsx');
  assert.match(prefs, /notification_telegram_enabled/);
  assert.match(prefs, /Customer delivery channels/);
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

test('payment settlement guarantees one receipt, a live ledger balance and idempotent multi-channel PDF outbox jobs', async () => {
  const migration = await read('supabase/migrations/20261011190732_payment_receipt_ledger_notifications.sql');
  const tokenMigration = await read('supabase/migrations/20261011190933_receipt_token_for_every_receipt.sql');
  const receiptRenderer = await read('lib/server/receipt-pdf.ts');
  const worker = await read('supabase/functions/process-notifications/index.ts');

  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.fn_get_customer_outstanding_balance/);
  assert.match(migration, /sum\(coalesce\(i\.balance_due, 0\)\)/);
  assert.match(migration, /i\.status::text NOT IN \('draft', 'void', 'cancelled'\)/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.fn_get_customer_outstanding_balance\(uuid,uuid\)\s+FROM PUBLIC, anon, authenticated/);
  assert.doesNotMatch(migration, /GRANT EXECUTE ON FUNCTION public\.fn_get_customer_outstanding_balance\(uuid,uuid\)[\s\S]{0,80}TO anon/);

  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS receipts_payment_id_uidx/);
  assert.match(migration, /CREATE CONSTRAINT TRIGGER trg_payment_settled_notify[\s\S]*?DEFERRABLE INITIALLY DEFERRED/);
  assert.match(migration, /NEW\.direction::text <> 'inbound'/);
  assert.match(migration, /ON CONFLICT \(payment_id\) WHERE payment_id IS NOT NULL DO NOTHING/);
  assert.match(migration, /CREATE CONSTRAINT TRIGGER trg_enqueue_receipt_delivery_notifications[\s\S]*?DEFERRABLE INITIALLY DEFERRED/);
  assert.match(migration, /public\._issue_receipt_access_token\(r\.id, 'customer_download'\)/);
  assert.doesNotMatch(migration, /document_tokens|aggregate_id|event_type|payload jsonb/i);

  for (const channel of ['whatsapp', 'email', 'sms', 'telegram']) {
    assert.ok(migration.includes("'" + channel + "'"), 'missing receipt channel route: ' + channel);
  }
  assert.match(migration, /FOREACH v_channel IN ARRAY v_channels/);
  assert.match(migration, /receipt:' \|\| r\.id::text \|\| ':v5:' \|\| v_channel/);
  assert.match(migration, /customer_outstanding_balance/);
  assert.match(migration, /delivery_idempotency_key/);

  assert.match(receiptRenderer, /rpc\('fn_get_customer_outstanding_balance'/);
  assert.match(receiptRenderer, /Customer outstanding balance could not be calculated/);
  assert.match(worker, /customer_outstanding_balance: metadata\.customer_outstanding_balance/);
  assert.match(worker, /Customer outstanding balance:/);
  assert.match(worker, /Customer Outstanding Balance/);
  assert.match(worker, /customerOutstandingBalance:/);
  assert.match(worker, /application\/pdf/);
  assert.match(worker, /sendDocument/);
  assert.ok(tokenMigration.indexOf("v_access := public._issue_receipt_access_token") < tokenMigration.indexOf("IF r.customer_id IS NULL"),
    'the receipt access token must be minted even when there is no customer contact or configured delivery channel');
});
