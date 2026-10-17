import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const layout=readFileSync('app/next-workspace/layout.tsx','utf8');
function routes(){
 const m=layout.match(/const baseGroups: NavGroup\[\] = \[([\s\S]*?)\n\];/);
 assert.ok(m,'baseGroups catalog exists');
 return [...m[1].matchAll(/\{ id: '([^']+)', name: '[^']+', items: \[([\s\S]*?)\]\s*\}/g)]
  .flatMap(([,id,block])=>[...block.matchAll(/href: '([^']+)'/g)].map(([,href])=>({id,href})));
}
function normalizeNavigationPath(pathname){
 let p=pathname;
 while(p.length>1&&p.endsWith('/'))p=p.slice(0,-1);
 const legacy='/next-workspace/purchases';
 if(p===legacy)return '/next-workspace/bills';
 if(p.startsWith(legacy+'/'))return '/next-workspace/bills'+p.slice(legacy.length);
 return p||'/';
}
function bestMatch(pathname){
 let p=pathname;
 while(p.length>1&&p.endsWith('/'))p=p.slice(0,-1);
 p=normalizeNavigationPath(p);
 return routes().filter(r=>{const h=r.href;return p===h||(h!=='/next-workspace'&&p.startsWith(h+'/'));})
  .sort((a,b)=>b.href.length-a.href.length)[0]??null;
}
test('route parent resolves by longest registered route',()=>{
 assert.equal(bestMatch('/next-workspace').id,'overview');
 assert.equal(bestMatch('/next-workspace/reports/daily-cash-book').id,'reports');
 assert.equal(bestMatch('/next-workspace/day-book').id,'reports');
 assert.equal(bestMatch('/next-workspace/banking').id,'treasury');
 assert.equal(bestMatch('/next-workspace/purchases').id,'purchases');
 assert.equal(bestMatch('/next-workspace/purchases').href,'/next-workspace/bills');
 assert.equal(bestMatch('/next-workspace/settings/payments').id,'settings');
});
test('active child item wins over a matching parent link',()=>{
 assert.equal(bestMatch('/next-workspace/settings/payments').href,'/next-workspace/settings/payments');
 assert.equal(bestMatch('/next-workspace/settings/communications').href,'/next-workspace/settings/communications');
 assert.equal(bestMatch('/next-workspace/invoices/new').href,'/next-workspace/invoices');
 assert.match(layout,/getActiveNavHref\(pathname\) === item\.href/);
});
test('path changes add the active group without discarding user-opened sections',()=>{
 assert.match(layout,/useState<string\[]>\(\(\) =>/);
 assert.match(layout,/current\.includes\(activeGroupId\) \? current : \[\.\.\.current, activeGroupId\]/);
 assert.match(layout,/current\.filter\(id => id !== group\.id\)/);
 assert.match(layout,/getActiveGroupId\(pathname\) === group\.id/);
 assert.doesNotMatch(layout,/openGroup|setOpenGroup|useState\(['"]Sales & Billing['"]\)/);
});
test('primary navigation groups have stable ids',()=>{
 for(const [id,name] of [['overview','Overview'],['sales','Sales & Billing'],['purchases','Purchases & Expenses'],['documents','Documents'],['treasury','Treasury & Banking'],['reports','Reports & Compliance'],['settings','Settings & Configuration']])
  assert.ok(layout.includes(`id: '${id}', name: '${name}'`));
});

test('purchase navigation has one canonical list entry and preserves legacy detail highlighting',()=>{
 const purchaseRoutes=routes().filter(r=>r.id==='purchases');
 assert.equal(purchaseRoutes.filter(r=>r.href==='/next-workspace/bills').length,1);
 assert.ok(!purchaseRoutes.some(r=>r.href==='/next-workspace/purchases'));
 assert.equal(bestMatch('/next-workspace/purchases/abc123').href,'/next-workspace/bills');
 assert.equal(bestMatch('/next-workspace/purchases/new').href,'/next-workspace/bills');
 assert.match(layout,/function normalizeNavigationPath/);
 assert.ok(layout.includes('const normalizedPath = normalizeNavigationPath(pathname)'));
});
