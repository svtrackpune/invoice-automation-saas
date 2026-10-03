import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

test('strategic remediation stays outside deferred Treasury surfaces',()=>{
  const files=execFileSync('git',['diff','--name-only','origin/main...HEAD'],{encoding:'utf8'}).split('\n').filter(Boolean);
  const forbidden=files.filter((path)=>/plaid|treasury/i.test(path));
  assert.deepEqual(forbidden,[]);
});