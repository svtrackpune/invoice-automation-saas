import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL('../' + path, import.meta.url), 'utf8');

test('Android and installed web app start in the simple mobile experience', async () => {
  const capacitor = await read('capacitor.config.ts');
  const manifest = JSON.parse(await read('public/manifest.json'));
  const page = await read('app/mobile/page.tsx');

  assert.ok(capacitor.includes('https://mm.nilanga.in/mobile?app=android'));
  assert.equal(manifest.start_url, '/mobile?app=android');
  assert.ok(page.includes("localStorage.setItem('moneymatters.simpleMobileAppMode', '1')"));
  assert.ok(page.includes("supabase.rpc('get_my_business_context')"));
  assert.ok(page.includes('/?next=%2Fmobile'));
  assert.ok(page.includes('/onboarding?next=%2Fmobile'));
  assert.ok(manifest.shortcuts.some((shortcut) => shortcut.url === '/mobile?tab=sales'));
});

test('mobile home focuses everyday tasks with clear bottom navigation and customer search', async () => {
  const page = await read('app/mobile/page.tsx');
  const nav = await read('components/mobile/MobileBottomNav.tsx');

  for (const label of ['Cash Bill', 'New invoice', 'Add customer', 'Receive payment', 'Recent sales', 'Sales', 'Your customers', 'Other tasks']) {
    assert.ok(page.includes(label), 'mobile app is missing: ' + label);
  }
  for (const tab of ['home', 'sales', 'customers', 'more']) {
    assert.ok(nav.includes("id: '" + tab + "'"), 'missing mobile navigation tab: ' + tab);
  }
  assert.ok(page.includes('aria-label="Search customers"'));
  assert.ok(page.includes('customerSearch.trim()'));
  assert.ok(page.includes('Sign out'));
});

test('mobile sign-in, OAuth, password reset and onboarding preserve the mobile destination', async () => {
  const auth = await read('app/page.tsx');
  const onboarding = await read('app/onboarding/page.tsx');
  const forgot = await read('app/auth/forgot-password/page.tsx');
  const callback = await read('app/auth/callback/route.ts');

  assert.ok(auth.includes('function requestedLandingPath()'));
  assert.ok(auth.includes("params.get('oauth_next') === '/mobile'"));
  assert.ok(auth.includes('encodeURIComponent(requestedLandingPath())'));
  assert.ok(auth.includes("window.location.replace(hasBusiness ? requestedLandingPath() : onboardingLandingPath())"));
  assert.ok(onboarding.includes('function onboardingDestination()'));
  assert.ok(onboarding.includes('window.location.replace(onboardingDestination())'));
  assert.ok(forgot.includes("get('next') === '/mobile'"));
  assert.ok(forgot.includes('encodeURIComponent(nextPath)'));
  assert.ok(callback.includes("safeNext(incoming.searchParams.get('next'))"));
});

test('Android workflow pages use the lightweight mobile chrome after an everyday action opens', async () => {
  const layout = await read('app/next-workspace/layout.tsx');

  assert.ok(layout.includes("localStorage.getItem('moneymatters.simpleMobileAppMode') === '1'"));
  assert.ok(layout.includes('function MobileWorkspaceChrome'));
  assert.ok(layout.includes('simpleMobileAppMode ? <MobileWorkspaceChrome'));
  assert.ok(layout.includes('<MobileBottomNav activeTab={activeTab} />'));
  assert.ok(layout.includes('aria-label="Active business"'));
});
