import test from 'node:test';
import assert from 'node:assert/strict';
import { checkRateLimit } from '../lib/server/rate-limit.ts';

test('rate limiter allows requests through the configured threshold', () => {
  const key = `rate-limit-${crypto.randomUUID()}`;

  for (let index = 1; index <= 3; index += 1) {
    const result = checkRateLimit(key, 3, 60_000);
    assert.equal(result.allowed, true);
    assert.equal(result.limit, 3);
    assert.equal(result.remaining, 3 - index);
  }
});

test('rate limiter rejects request N + 1 and returns retry information', () => {
  const key = `rate-limit-${crypto.randomUUID()}`;

  checkRateLimit(key, 2, 60_000);
  checkRateLimit(key, 2, 60_000);
  const result = checkRateLimit(key, 2, 60_000);

  assert.equal(result.allowed, false);
  assert.equal(result.remaining, 0);
  assert.ok(result.retryAfterSeconds >= 1);
  assert.ok(result.retryAfterSeconds <= 60);
});

test('rate limiter resets after the window expires', async () => {
  const key = `rate-limit-${crypto.randomUUID()}`;

  assert.equal(checkRateLimit(key, 1, 20).allowed, true);
  assert.equal(checkRateLimit(key, 1, 20).allowed, false);

  await new Promise((resolve) => setTimeout(resolve, 30));

  const result = checkRateLimit(key, 1, 20);
  assert.equal(result.allowed, true);
  assert.equal(result.remaining, 0);
});
