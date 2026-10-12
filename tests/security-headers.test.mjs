import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server.js';
import { middleware } from '../middleware.ts';

process.env.NODE_ENV = 'production';
process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.co';

test('middleware injects production security headers', () => {
  const request = new NextRequest('https://app.example.com/dashboard');
  const response = middleware(request);
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(response.headers.get('X-Frame-Options'), 'DENY');
  assert.equal(response.headers.get('Permissions-Policy'), 'camera=(), microphone=(), geolocation=()');
  const csp = response.headers.get('Content-Security-Policy');
  assert.ok(csp);
  assert.match(csp, /script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
  assert.match(csp, /connect-src/);
  assert.match(csp, /https:\/\/project\.supabase\.co/);
  assert.doesNotMatch(csp, /script-src[^;]*unsafe-eval/);
  assert.equal(response.headers.get('Strict-Transport-Security'), 'max-age=63072000; includeSubDomains; preload');
});

test('middleware permits same-origin framing only for an embedded invoice edit', () => {
  const embeddedRequest = new NextRequest('https://app.example.com/next-workspace/invoices/new?edit=invoice-123&embedded=1');
  const embeddedResponse = middleware(embeddedRequest);
  assert.equal(embeddedResponse.headers.get('X-Frame-Options'), 'SAMEORIGIN');
  assert.match(embeddedResponse.headers.get('Content-Security-Policy') || '', /frame-ancestors 'self'/);

  const missingEditRequest = new NextRequest('https://app.example.com/next-workspace/invoices/new?embedded=1');
  const missingEditResponse = middleware(missingEditRequest);
  assert.equal(missingEditResponse.headers.get('X-Frame-Options'), 'DENY');
  assert.match(missingEditResponse.headers.get('Content-Security-Policy') || '', /frame-ancestors 'none'/);

  const nonEmbeddedRequest = new NextRequest('https://app.example.com/next-workspace/invoices/new?edit=invoice-123');
  const nonEmbeddedResponse = middleware(nonEmbeddedRequest);
  assert.equal(nonEmbeddedResponse.headers.get('X-Frame-Options'), 'DENY');
  assert.match(nonEmbeddedResponse.headers.get('Content-Security-Policy') || '', /frame-ancestors 'none'/);
});

test('middleware rejects unauthorized cross-origin API mutations', async () => {
  const request = new NextRequest('https://app.example.com/api/receipts/pdf', {
    method: 'POST',
    headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' },
  });
  const response = middleware(request);
  const body = await response.json();
  assert.equal(response.status, 403);
  assert.equal(body.success, false);
  assert.equal(body.error.code, 'CORS_FORBIDDEN');
});
