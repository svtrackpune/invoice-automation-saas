import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const layout=readFileSync('app/next-workspace/layout.tsx','utf8');
const search=readFileSync('app/next-workspace/GlobalSearch.tsx','utf8');
const dashboard=readFileSync('app/next-workspace/settings/page.tsx','utf8');
const payments=readFileSync('app/next-workspace/settings/payments/page.tsx','utf8');
const communications=readFileSync('app/next-workspace/settings/communications/page.tsx','utf8');

test('settings destinations are discoverable',()=>{
  assert.match(layout,/\/next-workspace\/settings/);
  assert.match(layout,/\/next-workspace\/settings\/communications/);
  assert.match(layout,/\/next-workspace\/settings\/payments/);
  assert.match(search,/communication-settings/);
  assert.match(search,/razorpay cashfree stripe/);
  for (const keyword of ['WhatsApp','WAPI','SMS','Telegram','SMTP','Email Settings','Gateways','Razorpay','Cashfree','Stripe']) assert.match(search, new RegExp(keyword, 'i'));
  assert.match(communications,/Communications & Alerts/);
  assert.match(dashboard,/\/next-workspace\/settings\/communications/);
  assert.match(dashboard,/\/next-workspace\/settings\/payments/);
});

test('payment gateway UI exposes environment and canonical endpoints',()=>{
  assert.match(payments,/cashfree_environment/);
  assert.match(payments,/\/api\/payments\/webhook\/razorpay/);
  assert.match(payments,/\/api\/payments\/webhook\/cashfree/);
  assert.match(payments,/\/api\/payments\/webhook\/stripe/);
  assert.match(payments,/gateway_convenience_fee_pct/);
});
