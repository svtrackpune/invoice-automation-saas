import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const layout = readFileSync('app/next-workspace/layout.tsx', 'utf8');

function activeGroupFor(pathname) {
  const groupsBlock = layout.match(/const baseGroups: NavGroup\[\] = \[([\s\S]*?)\n\];/);
  assert.ok(groupsBlock, 'baseGroups navigation catalog must exist');
  const routeItems = [...groupsBlock[1].matchAll(
    /\{ id: '([^']+)', name: '[^']+', items: \[([\s\S]*?)\]\s*\}/g,
  )];
  const routeGroups = routeItems.flatMap(([, id, block]) =>
    [...block.matchAll(/href: '([^']+)'/g)].map(([, href]) => ({ id, href })),
  );

  const normalizedPath = pathname.replace(/\/+$/, '') || '/';
  let best = null;
  for (const route of routeGroups) {
    const href = route.href.replace(/\/+$/, '') || '/';
    const matches = normalizedPath === href
      || (href !== '/next-workspace' && normalizedPath.startsWith(href + '/'));
    if (matches && (!best || href.length > best.href.length)) best = { id: route.id, href };
  }
  return best?.id ?? null;
}

test('workspace root does not capture nested routes as Overview', () => {
  assert.equal(activeGroupFor('/next-workspace'), 'overview');
  assert.equal(activeGroupFor('/next-workspace/reports/daily-cash-book'), 'reports');
  assert.equal(activeGroupFor('/next-workspace/day-book'), 'reports');
  assert.equal(activeGroupFor('/next-workspace/banking'), 'treasury');
  assert.equal(activeGroupFor('/next-workspace/purchases'), 'purchases');
  assert.equal(activeGroupFor('/next-workspace/settings/payments'), 'settings');
});

test('route changes resolve a parent group rather than defaulting to Sales & Billing', () => {
  assert.match(layout, /function getActiveGroupId\(pathname: string\): string \| null/);
  assert.match(layout, /useState<string \| null>\(\(\) => getActiveGroupId\(pathname\)\)/);
  assert.match(layout, /setOpenGroup\(getActiveGroupId\(pathname\)\);/);
  assert.match(layout, /\[pathname\]\);/);
  assert.doesNotMatch(layout, /useState\(['"]Sales & Billing['"]\)/);
});

test('deep routes choose the most specific registered route and keep group ids stable', () => {
  assert.match(layout, /activeMatch\.hrefLength/);
  assert.match(layout, /activeMatch = \{ groupId: group\.id, hrefLength: href\.length \}/);
  assert.match(layout, /openGroup === group\.id/);
  assert.match(layout, /setOpenGroup\(openGroup === group\.id \? null : group\.id\)/);
  assert.match(layout, /label: 'Purchases', href: '\/next-workspace\/purchases'/);
});

test('reports, banking, purchases and settings routes are catalogued in the correct groups', () => {
  assert.match(layout, /id: 'reports', name: 'Reports & Compliance'/);
  assert.match(layout, /href: '\/next-workspace\/reports\/daily-cash-book'/);
  assert.match(layout, /href: '\/next-workspace\/day-book'/);
  assert.match(layout, /id: 'treasury', name: 'Treasury & Banking'/);
  assert.match(layout, /href: '\/next-workspace\/banking'/);
  assert.match(layout, /id: 'purchases', name: 'Purchases & Expenses'/);
  assert.match(layout, /href: '\/next-workspace\/purchases'/);
  assert.match(layout, /id: 'settings', name: 'Settings & Configuration'/);
  assert.match(layout, /href: '\/next-workspace\/settings\/communications'/);
});
