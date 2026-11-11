import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const page = await readFile(
  new URL('../app/next-workspace/quotations/page.tsx', import.meta.url),
  'utf8',
);

test('quotation list search, status, customer and date filters all participate in filtering', () => {
  assert.match(page, /const matchesQuery = !query/);
  assert.match(page, /row\.quotation_number/);
  assert.match(page, /customer\?\.display_name/);
  assert.match(page, /customer\?\.legal_name/);
  assert.match(page, /statusLabel\(row\.status, row\.valid_until\)/);
  assert.match(page, /const matchesStatus = statusFilter === 'all' \|\| row\.status === statusFilter/);
  assert.match(page, /const matchesCustomer = customerId === 'all' \|\| row\.customer_id === customerId/);
  assert.match(page, /const matchesDate = \(!from \|\| row\.quotation_date >= from\) && \(!to \|\| row\.quotation_date <= to\)/);
  assert.match(page, /\[rows, customers, search, statusFilter, customerId, from, to\]/);
});

test('changing filters or sorting resets to page one and pagination clamps safely after refresh/filter changes', () => {
  assert.match(page, /setPage\(1\); \}, \[search, statusFilter, customerId, from, to, pageSize, sortBy, sortDirection\]/);
  assert.match(page, /const pages = pageSize === 'all' \? 1 : Math\.max\(1, Math\.ceil\(sorted\.length \/ Number\(pageSize\)\)\)/);
  assert.match(page, /const currentPage = Math\.min\(page, pages\)/);
  assert.match(page, /sorted\.slice\(\(currentPage - 1\) \* Number\(pageSize\), currentPage \* Number\(pageSize\)\)/);
  assert.match(page, /const rangeStart = sorted\.length === 0 \? 0/);
  assert.match(page, /disabled=\{currentPage <= 1/);
  assert.match(page, /disabled=\{currentPage >= pages/);
});

test('quotation rows open the document viewer by click and keyboard activation', () => {
  assert.match(page, /const openQuotation = \(row: QuotationRow\) =>/);
  assert.match(page, /\/next-workspace\/documents\?type=quotation&id=' \+ encodeURIComponent\(row\.id\)/);
  assert.match(page, /tabIndex=\{0\} aria-label=\{'Open quotation ' \+ row\.quotation_number\}/);
  assert.match(page, /onClick=\{\(\) => openQuotation\(row\)\}/);
  assert.match(page, /event\.key === 'Enter' \|\| event\.key === ' '/);
});

test('sort and row action controls do not trigger row navigation', () => {
  assert.match(page, /onClick=\{event => \{ event\.stopPropagation\(\); toggleSort\(key\); \}\} onKeyDown=\{event => event\.stopPropagation\(\)\}/);
  assert.match(page, /onClick=\{event => event\.stopPropagation\(\)\} onKeyDown=\{event => event\.stopPropagation\(\)\}/);
});

test('quotation list exposes functional date, customer and status controls plus clear filters', () => {
  assert.match(page, /aria-label="Filter by quotation status"/);
  assert.match(page, /aria-label="Filter by customer"/);
  assert.match(page, /aria-label="Filter quotations from date"/);
  assert.match(page, /aria-label="Filter quotations to date"/);
  assert.match(page, /aria-label="Rows per page"/);
  assert.match(page, /Clear filters/);
  assert.match(page, /!loading && <div className="flex flex-col gap-3 border-t/);
});


test('quotation filters have visible labels and all expected page-size choices', () => {
  for (const label of ['Search quotations','Status','Customer','From date','To date','Rows per page']) {
    assert.ok(page.includes('>' + label + '</span>'), 'missing visible filter label: ' + label);
  }
  for (const value of ['10','20','50','100']) {
    assert.ok(page.includes('<option value="' + value + '">' + value + '</option>'), 'missing page-size option: ' + value);
  }
  assert.ok(page.includes('<option value="all">View all</option>'));
});

test('quotation action menu renders outside the scrollable table and is viewport positioned', () => {
  assert.match(page, /import \{ createPortal \} from 'react-dom'/);
  assert.match(page, /createPortal\([\s\S]*?document\.body/);
  assert.match(page, /position: 'fixed'/);
  assert.match(page, /getBoundingClientRect\(\)/);
  assert.match(page, /availableBelow/);
  assert.match(page, /availableAbove/);
  assert.match(page, /maxHeight: actionsPosition\.maxHeight/);
  assert.match(page, /ref=\{actionMenuRef\}/);
  assert.doesNotMatch(page, /className="absolute right-0 top-full z-50/);
  assert.match(page, /window\.addEventListener\('scroll', closeOnScroll, true\)/);
  assert.match(page, /window\.addEventListener\('resize', closeActionsMenu\)/);
});


test('quotation filters have visible labels and all expected page-size choices', () => {
  for (const label of ['Search quotations','Status','Customer','From date','To date','Rows per page']) {
    assert.ok(page.includes('>' + label + '</span>'), 'missing visible filter label: ' + label);
  }
  for (const value of ['10','20','50','100']) {
    assert.ok(page.includes('<option value="' + value + '">' + value + '</option>'), 'missing page-size option: ' + value);
  }
  assert.ok(page.includes('<option value="all">View all</option>'));
});

test('quotation action menu renders outside the scrollable table and is viewport positioned', () => {
  assert.match(page, /import \{ createPortal \} from 'react-dom'/);
  assert.match(page, /createPortal\([\s\S]*?document\.body/);
  assert.match(page, /position: 'fixed'/);
  assert.match(page, /getBoundingClientRect\(\)/);
  assert.match(page, /availableBelow/);
  assert.match(page, /availableAbove/);
  assert.match(page, /maxHeight: actionsPosition\.maxHeight/);
  assert.match(page, /ref=\{actionMenuRef\}/);
  assert.doesNotMatch(page, /className="absolute right-0 top-full z-50/);
  assert.match(page, /window\.addEventListener\('scroll', closeOnScroll, true\)/);
  assert.match(page, /window\.addEventListener\('resize', closeActionsMenu\)/);
});


test('quotation action dropdown never creates an internal vertical scrollbar', () => {
  const portalStart = page.indexOf('createPortal(');
  const portalEnd = page.indexOf('document.body', portalStart);
  assert.ok(portalStart >= 0 && portalEnd > portalStart, 'actions menu must render through a body portal');
  const portal = page.slice(portalStart, portalEnd);

  assert.match(portal, /position: 'fixed'/);
  assert.match(portal, /overflow-visible/);
  assert.doesNotMatch(portal, /overflow-y-auto|overflow-y-scroll|overscroll-contain/);
  assert.doesNotMatch(portal, /maxHeight|max-height/);
  assert.doesNotMatch(portal, /max-h-/);
});

test('quotation action dropdown positions its full content above or below the trigger without a height cap', () => {
  assert.match(page, /const menuHeight = 272/);
  assert.match(page, /const availableBelow = window\.innerHeight - rect\.bottom - gap/);
  assert.match(page, /const availableAbove = rect\.top - gap/);
  assert.match(page, /const openAbove = availableBelow < menuHeight && availableAbove > availableBelow/);
  assert.match(page, /setActionsPosition\(\{ top, left \}\)/);
  assert.doesNotMatch(page, /maxHeight: number/);
  assert.doesNotMatch(page, /maxHeight: actionsPosition\.maxHeight/);
});
