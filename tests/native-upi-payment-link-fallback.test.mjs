import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('create-payment-link returns a successful native-UPI skip when merchant gateway is not configured', async () => {
  const edge = await read('supabase/functions/create-payment-link/index.ts');
  assert.match(edge, /payment_qr_enabled,upi_id,enable_upi/);
  assert.match(edge, /razorpay_enabled/);
  assert.match(edge, /cashfree_enabled/);
  assert.match(edge, /stripe_enabled/);
  assert.match(edge, /status:"skipped",reason:"native_upi_configured",upi_qr_available:true/);
  assert.match(edge, /settings\?\.payment_link_enabled!==true\|\|!gatewayEnabled/);
  assert.match(edge, /if\(nativeUpiConfigured\)return nativeUpiSkipped\(\)/);
  assert.match(edge, /return json\(\{error:error instanceof Error\?error\.message:"Unexpected error"\},500\)/);
});

test('post-commit checkout failures never become invoice-posting error banners', async () => {
  const viewer = await read('app/next-workspace/documents/DocumentReviewCenter.tsx');
  const start = viewer.indexOf('const finalize = async () => {');
  const end = viewer.indexOf('const canCreateCreditNote', start);
  assert.ok(start >= 0 && end > start, 'invoice finalize action must exist');
  const finalize = viewer.slice(start, end);
  assert.match(finalize, /supabase\.rpc\('post_invoice'/);
  assert.match(finalize, /link\.data\?\.status === 'skipped'/);
  assert.match(finalize, /link\.data\?\.reason === 'native_upi_configured'/);
  assert.match(finalize, /window\.location\.assign\('\/next-workspace\/documents\?type=invoice&id='/);
  assert.doesNotMatch(finalize, /Payment link generation can be retried below/);
  assert.doesNotMatch(finalize, /setError\(link\.error/);
});

test('public invoice web payment card shows bank details together with UPI QR and a native UPI action', async () => {
  const page = await read('app/invoice/[token]/page.tsx');
  assert.match(page, /PAYMENT/);
  assert.match(page, /Bank settlement details/);
  assert.match(page, /Pay Now via UPI/);
  assert.match(page, /Scan to pay the invoice amount\./);
  assert.match(page, /canonical\?\.financials\.upiQrString/);
});
