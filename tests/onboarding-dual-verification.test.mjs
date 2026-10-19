import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL('../' + path, import.meta.url), 'utf8');

test('workspace creation exposes one unambiguous RPC and delegates to a distinct core function', async () => {
  const migration = await read('supabase/migrations/20261019150000_fix_onboarding_rpc_overload_and_dual_auth_verification.sql');
  assert.match(migration, /RENAME TO create_business_for_current_user_core/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.create_business_for_current_user\(/);
  assert.match(migration, /v_business := public\.create_business_for_current_user_core\(/);
  assert.match(migration, /p_feature_flags jsonb DEFAULT '\{\}'::jsonb/);
  assert.match(migration, /REVOKE EXECUTE ON FUNCTION public\.create_business_for_current_user_core/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.create_business_for_current_user\([\s\S]*TO authenticated, service_role/);
});

test('first owner membership requires Supabase email and phone confirmation', async () => {
  const migration = await read('supabase/migrations/20261019150000_fix_onboarding_rpc_overload_and_dual_auth_verification.sql');
  assert.match(migration, /u\.email_confirmed_at, u\.phone_confirmed_at/);
  assert.match(migration, /MESSAGE = 'Verify both your email address and mobile number before launching your first workspace\.'/);
  assert.match(migration, /WHERE om\.user_id = NEW\.user_id AND om\.is_active AND om\.role::text = 'owner'/);
  assert.match(migration, /BEFORE INSERT OR UPDATE ON public\.organization_members/);
  assert.match(migration, /REVOKE EXECUTE ON FUNCTION public\.enforce_dual_auth_for_first_workspace_owner\(\) FROM PUBLIC, anon, authenticated/);
});

test('new account verification uses Supabase email confirmation followed by authenticated phone-change OTP', async () => {
  const auth = await read('app/page.tsx');
  assert.match(auth, /emailRedirectTo:\`\$\{window\.location\.origin\}\/\`/);
  assert.match(auth, /supabase\.auth\.resend\(\{type:'signup'/);
  assert.match(auth, /supabase\.auth\.updateUser\(\{phone:normalizedPhone,data:/);
  assert.match(auth, /supabase\.auth\.verifyOtp\(\{phone:requestedPhone,token:otp,type:'phone_change'\}\)/);
  assert.match(auth, /normalizedPhone!==requestedPhone/);
  assert.match(auth, /setRequestedPhone\(normalizedPhone\)/);
  assert.match(auth, /!s\.user\.email_confirmed_at/);
  assert.match(auth, /!s\.user\.phone_confirmed_at/);
  assert.match(auth, /needsPhoneVerification/);
  assert.match(auth, /onVerified=\{async\(\)=>\{const\{data\}=await supabase\.auth\.getSession\(\);await check\(data\.session\)\}\}/);
});
