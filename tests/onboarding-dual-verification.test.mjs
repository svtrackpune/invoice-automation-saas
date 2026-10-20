import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL('../' + path, import.meta.url), 'utf8');

test('workspace creation retains the single permissioned onboarding RPC wrapper', async () => {
  const previousMigration = await read('supabase/migrations/20261019132047_fix_onboarding_rpc_overload_and_dual_auth_verification.sql');
  assert.match(previousMigration, /RENAME TO create_business_for_current_user_core/);
  assert.match(previousMigration, /CREATE OR REPLACE FUNCTION public\.create_business_for_current_user\(/);
  assert.match(previousMigration, /v_business := public\.create_business_for_current_user_core\(/);
  assert.match(previousMigration, /p_feature_flags jsonb DEFAULT '\{\}'::jsonb/);
  assert.match(previousMigration, /REVOKE EXECUTE ON FUNCTION public\.create_business_for_current_user_core/);
  assert.match(previousMigration, /GRANT EXECUTE ON FUNCTION public\.create_business_for_current_user\([\s\S]*TO authenticated, service_role/);
});

test('first owner trigger requires confirmed email or trusted OAuth and never requires SMS verification', async () => {
  const migration = await read('supabase/migrations/20261021_realign_auth_email_primary.sql');
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.check_organization_owner_verification\(\)/);
  assert.match(migration, /u\.email_confirmed_at IS NOT NULL/);
  assert.match(migration, /raw_app_meta_data->>'provider'.*'google'.*'facebook'.*'github'/);
  assert.match(migration, /organization_owner_requires_dual_verification/);
  assert.match(migration, /organization_members/);
  assert.match(migration, /REVOKE EXECUTE ON FUNCTION public\.check_organization_owner_verification\(\)/);
  assert.doesNotMatch(migration, /phone_confirmed_at|enforce_dual_auth_for_first_workspace_owner/);
});

test('signup stores a validated mobile number as metadata while email/OAuth controls account verification', async () => {
  const auth = await read('app/page.tsx');
  assert.match(auth, /\^\[6-9\]\\d\{9\}\$/);
  assert.match(auth, /data:\{display_name:name\.trim\(\),phone:phoneValue,mobile_number:digits,country_code:'IN'\}/);
  assert.match(auth, /signInWithOAuth\(\{provider,options:\{redirectTo:/);
  assert.match(auth, /Continue with Google/);
  assert.match(auth, /Continue with Facebook/);
  assert.match(auth, /hasTrustedOAuthIdentity/);
  assert.doesNotMatch(auth, /signInWithOtp|verifyOtp|phone_confirmed_at|PhoneVerificationGate|Sign in with mobile OTP|Forgot email\?/);
});

test('password recovery sends email and updates the password from the recovery session', async () => {
  const auth = await read('app/page.tsx');
  const forgot = await read('app/auth/forgot-password/page.tsx');
  assert.match(forgot, /resetPasswordForEmail\(normalizedEmail/);
  assert.match(forgot, /redirectTo: window\.location\.origin \+ '\/'/);
  assert.match(auth, /window\.location\.hash\.includes\('type=recovery'\)/);
  assert.match(auth, /event==='PASSWORD_RECOVERY'/);
  assert.match(auth, /supabase\.auth\.updateUser\(\{password\}\)/);
  assert.match(auth, /Forgot password\?/);
});
