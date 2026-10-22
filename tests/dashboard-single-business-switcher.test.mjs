import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const read = (file) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

test('business switching remains in the global workspace header only', () => {
  const dashboard = read('app/next-workspace/page.tsx');
  const layout = read('app/next-workspace/layout.tsx');

  assert.ok(!dashboard.includes('MMFormSelectControl'), 'dashboard actions must not render a second business selector');
  assert.ok(!dashboard.includes('aria-label="Active business"'), 'redundant dashboard business selector must stay removed');
  assert.ok(!dashboard.includes('const [contexts, setContexts]'), 'removed dashboard selector state should not linger');

  assert.ok(layout.includes('Business switcher'), 'global header switcher remains available');
  assert.ok(layout.includes('businesses.map(b => <button'), 'global switcher still lists available businesses');
  assert.ok(layout.includes("localStorage.setItem('moneymatters.activeBusinessId', id)"), 'global selector persists the chosen business');
  assert.ok(layout.includes("window.dispatchEvent(new Event('moneymatters:business-changed'))"));
  assert.ok(layout.includes('window.location.reload()'), 'switching businesses reloads workspace data in the selected context');
});

test('dashboard quick actions remain after removing the duplicate selector', () => {
  const dashboard = read('app/next-workspace/page.tsx');
  for (const label of ["t('Cash Bill')", "t('New Invoice')", "t('Import Statement')", "t('Refresh')"]) {
    assert.ok(dashboard.includes(label), 'missing dashboard action: ' + label);
  }
});
