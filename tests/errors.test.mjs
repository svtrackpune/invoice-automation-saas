import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import {
  ValidationError,
  withErrorHandler,
} from '../lib/server/errors.ts';

test('withErrorHandler sanitizes unexpected runtime errors and returns a request id', async () => {
  const request = new Request('https://app.example.com/api/test');

  const response = await withErrorHandler(request, async () => {
    throw new Error('SQL connection failed: password=SYNTHETIC_TEST_FIXTURE_DO_NOT_USE');
  });

  const body = await response.json();

  assert.equal(response.status, 500);
  assert.equal(body.success, false);
  assert.equal(body.error.code, 'INTERNAL_SERVER_ERROR');
  assert.equal(body.error.message, 'An unexpected server error occurred.');
  assert.equal(body.error.details.length, 0);
  assert.match(body.error.requestId, /^[0-9a-f-]{36}$/i);
  assert.equal(response.headers.get('X-Request-Id'), body.error.requestId);
  assert.doesNotMatch(JSON.stringify(body), /super-secret/);
  assert.doesNotMatch(JSON.stringify(body), /password/);
});

test('ValidationError produces HTTP 422 with structured field issues', async () => {
  const schema = z.object({
    token: z.string().min(32),
    amount: z.number().positive(),
  });

  const parsed = schema.safeParse({
    token: 'short',
    amount: -1,
  });

  assert.equal(parsed.success, false);

  const request = new Request('https://app.example.com/api/test');
  const response = await withErrorHandler(request, async () => {
    throw ValidationError.fromZodIssues(parsed.error.issues);
  });

  const body = await response.json();

  assert.equal(response.status, 422);
  assert.equal(body.success, false);
  assert.equal(body.error.code, 'VALIDATION_FAILED');
  assert.equal(body.error.message, 'Request validation failed.');
  assert.ok(Array.isArray(body.error.details));
  assert.ok(body.error.details.some((detail) => detail.field === 'token'));
  assert.ok(body.error.details.some((detail) => detail.field === 'amount'));
  assert.match(body.error.requestId, /^[0-9a-f-]{36}$/i);
});
