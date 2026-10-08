// Gate 1 tenant-routing regression contracts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  selectFailoverConnection,
  nextAttemptMetadata,
  readAttemptState,
} from '../lib/server/notifications/failover.ts';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

const connection = (id, businessId, channel, priority, provider) => ({
  id,
  business_id: businessId,
  channel,
  provider,
  display_name: id,
  endpoint_url: null,
  external_instance_id: null,
  secret_ref: 'vault-ref',
  secret: 'server-only-secret',
  sender: channel === 'email' ? 'billing@example.test' : null,
  default_recipient: null,
  priority,
  failover_group: 'customer-delivery',
  enabled: true,
  health_status: 'healthy',
  config: {},
});

test('tenant routing keeps Business A and Business B on separate Wapi connections', () => {
  const a = connection('wapi-a', 'business-a', 'whatsapp', 1, 'wapi');
  const b = connection('wapi-b', 'business-b', 'whatsapp', 1, 'wapi');

  assert.equal(
    selectFailoverConnection([a], {
      deliveryIdempotencyKey: 'receipt:a',
      attemptedChannels: [],
      deliveryAttempt: 1,
    })?.id,
    'wapi-a',
  );

  assert.equal(
    selectFailoverConnection([b], {
      deliveryIdempotencyKey: 'receipt:b',
      attemptedChannels: [],
      deliveryAttempt: 1,
    })?.id,
    'wapi-b',
  );

  assert.notEqual(a.business_id, b.business_id);
});

test('failover keeps one logical idempotency key and changes only the route', () => {
  const state = readAttemptState(
    {
      idempotency_key: 'receipt:r1:v3',
      delivery_idempotency_key: 'receipt:r1:v3',
      attempted_channels: ['whatsapp'],
      delivery_attempt: 1,
    },
    'fallback:r1',
    1,
  );

  const email = connection('email-a', 'business-a', 'email', 2, 'resend');
  const next = selectFailoverConnection([email], state);

  assert.equal(next?.channel, 'email');

  const metadata = nextAttemptMetadata(state, email);
  assert.equal(metadata.delivery_idempotency_key, 'receipt:r1:v3');
  assert.equal(metadata.idempotency_key, 'receipt:r1:v3');
  assert.equal(metadata.delivery_attempt, 2);
  assert.deepEqual(metadata.attempted_channels, ['whatsapp', 'email']);
});

test('Vault credentials never appear in application connection columns or settings responses', async () => {
  const migration = await read(
    'supabase/migrations/20261003180000_gate1_tenant_notification_connections.sql',
  );
  const settings = await read('app/next-workspace/whatsapp/page.tsx');

  assert.match(migration, /secret_ref uuid/);
  assert.match(migration, /vault\.create_secret/);
  assert.match(migration, /vault\.update_secret/);
  assert.doesNotMatch(
    migration,
    /api_key\s+text|bot_token\s+text|smtp_password\s+text|auth_token\s+text/,
  );
  assert.match(migration, /config \?\| ARRAY/);
  assert.match(settings, /type="password"/);
  assert.match(settings, /save_business_notification_connection/);
  assert.doesNotMatch(settings, /decrypted_secret/);
});

test('receipt failover preserves a single notification job identity', async () => {
  const migration = await read(
    'supabase/migrations/20261003180000_gate1_tenant_notification_connections.sql',
  );
  const worker = await read('supabase/functions/process-notifications/index.ts');

  assert.match(migration, /delivery_idempotency_key text/);
  assert.match(migration, /notification_jobs_delivery_idempotency_uidx/);
  assert.match(migration, /ON CONFLICT\(business_id, delivery_idempotency_key\) DO NOTHING/);
  assert.match(migration, /attempt_no integer NOT NULL DEFAULT 1/);
  assert.match(worker, /channel: fallback\.channel/);
  assert.match(worker, /delivery_idempotency_key: key/);
  assert.doesNotMatch(worker, /INSERT INTO|\.insert\(/);
});

test('Wapi and Telegram adapters use tenant Vault secrets without logging them', async () => {
  const wapi = await read('lib/server/notifications/adapters/wapi.ts');
  const telegram = await read('lib/server/notifications/adapters/telegram.ts');
  const worker = await read('supabase/functions/process-notifications/index.ts');

  assert.match(wapi, /Authorization: 'Bearer ' \+ connection\.secret/);
  assert.match(wapi, /\/message\/sendText/);
  assert.match(telegram, /api\.telegram\.org\/bot/);
  assert.match(telegram, /type: 'text_link'/);
  assert.doesNotMatch(worker, /WHATSAPP_ACCESS_TOKEN|TELEGRAM_BOT_TOKEN|RESEND_API_KEY|TWILIO_AUTH_TOKEN/);
});

test('customer routing uses business_preferences and protects the hosted SMTP boundary', async () => {
  const migration = await read(
    'supabase/migrations/20261008252000_harden_communications_runtime.sql',
  );
  const settings = await read('app/next-workspace/whatsapp/page.tsx');
  const worker = await read('supabase/functions/process-notifications/index.ts');

  assert.match(migration, /public\.business_preferences%rowtype/);
  assert.match(migration, /bp\.notification_whatsapp_enabled/);
  assert.doesNotMatch(migration, /b\.notification_(whatsapp|email|sms|telegram)_enabled/);
  assert.match(migration, /trg_guard_hosted_smtp_port/);
  assert.match(migration, /REVOKE ALL ON FUNCTION mm_private.guard_hosted_smtp_port/);
  assert.match(migration, /port 465 or another permitted relay port/);
  assert.match(migration, /fallback_channel/);
  assert.match(settings, /value="resend"/);
  assert.match(settings, /value="sendgrid"/);
  assert.match(settings, /provider:smtp\.provider/);
  assert.match(worker, /connection\.config\.port\|\|465/);
});
