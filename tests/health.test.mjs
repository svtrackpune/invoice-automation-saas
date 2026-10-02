import test from 'node:test';
import assert from 'node:assert/strict';
import { GET as health } from '../app/healthz/route.ts';
import { checkDatabaseReadiness } from '../lib/server/readiness.ts';

test('GET /healthz returns healthy with no-store caching', async () => {
  const response = health();
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.status, 'healthy');
  assert.equal(typeof body.timestamp, 'string');
  assert.equal(Number.isNaN(Date.parse(body.timestamp)), false);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('readiness check reports connected when the database query succeeds', async () => {
  const db = {
    from(table) {
      assert.equal(table, 'businesses');
      return {
        select(columns) {
          assert.equal(columns, 'id');
          return {
            async limit(count) {
              assert.equal(count, 1);
              return { error: null };
            },
          };
        },
      };
    },
  };

  assert.equal(await checkDatabaseReadiness(db), true);
});

test('readiness check reports disconnected when the database query fails', async () => {
  const db = {
    from() {
      return {
        select() {
          return {
            async limit() {
              return { error: { name: 'PostgrestError', code: 'PGRST000' } };
            },
          };
        },
      };
    },
  };

  assert.equal(await checkDatabaseReadiness(db), false);
});
