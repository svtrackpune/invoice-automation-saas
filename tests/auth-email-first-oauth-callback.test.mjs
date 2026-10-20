import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL('../' + path, import.meta.url), 'utf8');

test('Google and Facebook OAuth use the callback route and email is the only required confirmation factor', async () => {
  const auth = await read('app/page.tsx');
  const callback = await read('app/auth/callback/route.ts');
  assert.match(auth, /Continue with Google/);
  assert.match(auth, /Continue with Facebook/);
  assert.match(auth, /signInWithOAuth/);
  assert.match(auth, /\/auth\/callback\?next=\/next-workspace/);
  assert.match(auth, /access_type:'offline',prompt:'consent'/);
  assert.match(callback, /searchParams\.get\('code'\)/);
  assert.match(callback, /target\.searchParams\.set\('code', code\)/);
  assert.match(callback, /oauth_exchange_failed/);
  assert.doesNotMatch(callback, /business_memberships/);
  assert.doesNotMatch(auth, /signInWithOtp|verifyOtp|phone_confirmed_at|Forgot email\?|Sign in with mobile OTP/);
});

test('signup validates Indian mobile numbers as metadata and password recovery uses email', async () => {
  const auth = await read('app/page.tsx');
  const forgot = await read('app/auth/forgot-password/page.tsx');
  assert.match(auth, /phoneValidationError\('IN',phone\)/);
  assert.match(auth, /\^\[6-9\]\\d\{9\}\$/);
  assert.match(auth, /phoneValue=.*91/);
  assert.match(auth, /href="\/auth\/forgot-password"/);
  assert.match(forgot, /resetPasswordForEmail/);
  assert.match(forgot, /redirectTo: window\.location\.origin \+ '\/'/);
  assert.match(auth, /PASSWORD_RECOVERY/);
  assert.match(auth, /supabase\.auth\.updateUser\(\{password\}\)/);
});

test('production auth migration preserves onboarding RPC grants, stores profile phone metadata, and never checks phone confirmation', async () => {
  const migration = await read('supabase/migrations/20261021150000_realign_auth_email_primary.sql');
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.check_organization_owner_verification\(\)/);
  assert.match(migration, /email_confirmed_at IS NOT NULL/);
  assert.match(migration, /raw_app_meta_data->>'provider'/);
  assert.match(migration, /UPDATE public\.user_profiles/);
  assert.match(migration, /raw_user_meta_data->>'phone'/);
  assert.match(migration, /TO authenticated, service_role/);
  assert.doesNotMatch(migration, /phone_confirmed_at|enforce_dual_auth_for_first_workspace_owner/);
});

test('all seven public PDF types use inline delivery and Unicode-safe text sanitization', async () => {
  const tokens = await read('lib/server/documents/public-tokens.ts');
  const route = await read('app/api/public-documents/pdf/route.ts');
  const kit = await read('lib/server/documents/pdf-kit.ts');
  for (const type of ['invoice', 'quotation', 'receipt', 'challan', 'purchase_order', 'credit_note', 'cash_bill']) {
    assert.ok(tokens.includes("'" + type + "'"), 'token resolver missing ' + type);
    assert.ok(route.includes("'" + type + "'"), 'PDF route missing ' + type);
  }
  assert.match(route, /Content-Disposition.*inline; filename=/);
  assert.ok(kit.includes(".replace(/[\\r\\n\\t]+/g, ' ')"));
  assert.ok(kit.includes(".replace(/[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]/g, '')"));
  assert.doesNotMatch(kit, /replace\(\/\[\^\\x00-\\x7F\]/);
});
