import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync('app/next-workspace/items/page.tsx', 'utf8');

test('products and services list has client-side pagination with selectable page sizes', () => {
  assert.ok(page.includes("const[page,setPage]=useState(1)"));
  assert.ok(page.includes("const[pageSize,setPageSize]=useState(10)"));
  assert.ok(page.includes("const pageCount=Math.max(1,Math.ceil(sorted.length/pageSize))"));
  assert.ok(page.includes('aria-label="Rows per page"'));
  assert.ok(page.includes('<option value={10}>10</option>'));
  assert.ok(page.includes('<option value={100}>100</option>'));
  assert.ok(page.includes('Page {currentPage} of {pageCount}'));
  assert.ok(page.includes('disabled={currentPage<=1}'));
  assert.ok(page.includes('disabled={currentPage>=pageCount}'));
});

test('products and services supports ascending and descending sort from list headers', () => {
  assert.ok(page.includes("type SortKey='name'|'category'|'sku'|'tax'|'price'|'stock'|'capabilities'"));
  assert.ok(page.includes("type SortDirection='asc'|'desc'"));
  assert.ok(page.includes('function toggleSort(key:SortKey)'));
  assert.ok(page.includes("value=>value==='asc'?'desc':'asc'"));
  assert.ok(page.includes('const sorted=useMemo'));
  assert.ok(page.includes("sortHead('name','Product / service')"));
  assert.ok(page.includes("sortHead('stock','Stock')"));
});

test('list table fits available width without a horizontal scrollbar or forced minimum width', () => {
  assert.ok(page.includes('<table className="w-full table-fixed border-collapse text-left text-sm">'));
  assert.ok(!page.includes('min-w-[1450px]'));
  assert.ok(!page.includes('<div className="overflow-x-auto"><table'));
  assert.ok(page.includes('<colgroup>'));
  assert.ok(page.includes('colSpan={7}'));
});

test('search and type changes reset pagination while inactive filtering still works', () => {
  assert.ok(page.includes('useEffect(()=>{setPage(1)},[q,type,inactive,pageSize])'));
  assert.ok(page.includes("iq=iq.eq('is_active',true)"));
  assert.ok(page.includes('value={type} onChange={e=>setType(e.target.value)}'));
});
