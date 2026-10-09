import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync('app/globals.css', 'utf8');
const semantic = readFileSync('components/ui/finops/semantic.ts', 'utf8');
const header = readFileSync('components/ui/finops/PageHeader.tsx', 'utf8');
const statCard = readFileSync('components/ui/finops/StatCard.tsx', 'utf8');
const statusBadge = readFileSync('components/ui/finops/StatusBadge.tsx', 'utf8');
const primitives = readFileSync('components/ui/finops/FinOpsPrimitives.tsx', 'utf8');
const dashboard = readFileSync('app/next-workspace/page.tsx', 'utf8');

test('FinOps theme defines the prescribed semantic palettes', () => {
  const expected = [
    ['finops-inflow', '#059669'], ['finops-inflow-muted', '#10b981'],
    ['finops-inflow-tint', '#ecfdf5'], ['finops-inflow-border', '#a7f3d0'],
    ['finops-outflow', '#e11d48'], ['finops-outflow-muted', '#f43f5e'],
    ['finops-outflow-tint', '#fff1f2'], ['finops-outflow-border', '#fecdd3'],
    ['finops-treasury', '#0284c7'], ['finops-treasury-muted', '#0ea5e9'],
    ['finops-treasury-tint', '#f0f9ff'], ['finops-treasury-border', '#bae6fd'],
    ['finops-statutory', '#6366f1'], ['finops-statutory-muted', '#8b5cf6'],
    ['finops-statutory-tint', '#f5f3ff'], ['finops-statutory-border', '#ddd6fe'],
    ['finops-pending', '#d97706'], ['finops-pending-muted', '#f59e0b'],
    ['finops-pending-tint', '#fffbeb'], ['finops-pending-border', '#fde68a'],
    ['finops-neutral-background', '#f8fafc'], ['finops-neutral-surface', '#ffffff'],
    ['finops-neutral-border', '#e2e8f0'], ['finops-neutral-text', '#0f172a'],
    ['finops-neutral-muted', '#64748b'],
  ];

  for (const [token, value] of expected) {
    assert.match(css, new RegExp(`--color-${token}:\\s*${value.replace('#', '\\#')}`), `missing or incorrect ${token}`);
  }
  for (const tone of ['inflow', 'outflow', 'treasury', 'statutory', 'pending', 'neutral']) {
    assert.match(semantic, new RegExp(`^ {2}${tone}: \\{`, 'm'), `semantic engine is missing ${tone}`);
  }
});

test('PageHeader exposes standard breadcrumbs, status tone, subtitle and action slots', () => {
  for (const contract of ['title: string', 'subtitle?: string', 'badge?:', 'actions?: ReactNode', 'breadcrumbs?:']) {
    assert.ok(header.includes(contract), `missing PageHeader contract: ${contract}`);
  }
  assert.match(header, /aria-label="Breadcrumb"/);
  assert.match(header, /aria-current/);
  assert.match(header, /finOpsToneClasses/);
});

test('metric tiles are backward-compatible and use explicit semantic tones', () => {
  assert.match(statCard, /tone\?: FinOpsSemanticTone/);
  assert.match(statCard, /tone = 'neutral'/);
  assert.match(statCard, /finops-metric-tile/);
  assert.match(statCard, /finOpsToneClasses\[tone\]/);
});

test('status and shared card primitives consume the central semantic map', () => {
  assert.match(statusBadge, /const statusTones/);
  assert.match(statusBadge, /paid: 'inflow'/);
  assert.match(statusBadge, /overdue: 'outflow'/);
  assert.match(statusBadge, /reconciled: 'treasury'/);
  assert.match(primitives, /finOpsToneClasses/);
  assert.match(primitives, /border-finops-neutral-border/);
});

test('executive workspace KPIs use the shared metric tile with explicit tones', () => {
  assert.match(dashboard, /import StatCard from '@\/components\/ui\/finops\/StatCard'/);
  assert.match(dashboard, /tone="treasury"/);
  assert.match(dashboard, /tone="inflow"/);
  assert.match(dashboard, /tone="statutory"/);
});

test('operational workspace headers use the standardized PageHeader primitive', () => {
  const headerRoutes = [
    'app/next-workspace/page.tsx',
    'app/next-workspace/invoices/page.tsx',
    'app/next-workspace/invoices/new/page.tsx',
    'app/next-workspace/quotation/QuotationWorkspaceControlled.tsx',
    'app/next-workspace/customers/Customer360Controlled.tsx',
    'app/next-workspace/vendors/Vendor360Controlled.tsx',
    'app/next-workspace/purchases/new/page.tsx',
    'app/next-workspace/purchases/[id]/page.tsx',
    'app/next-workspace/sales/page.tsx',
    'app/next-workspace/customers/CustomerManagerControlled.tsx',
    'app/next-workspace/vendors/page.tsx',
    'app/next-workspace/items/page.tsx',
    'app/next-workspace/bills/page.tsx',
    'app/next-workspace/payments/page.tsx',
    'app/next-workspace/receipts/page.tsx',
    'app/next-workspace/delivery-challans/page.tsx',
    'app/next-workspace/barcodes/page.tsx',
    'app/next-workspace/day-book/page.tsx',
    'app/next-workspace/stock-audit/page.tsx',
    'app/next-workspace/banking/BankingControlled.tsx',
    'app/next-workspace/expenses/ExpenseWorkspaceControlled.tsx',
    'app/next-workspace/reports/page.tsx',
    'app/next-workspace/reports/ReportViewerControlled.tsx',
    'app/next-workspace/reports/daily-cash-book/page.tsx',
    'app/next-workspace/reports/statutory-hub/page.tsx',
    'app/next-workspace/accounting/page.tsx',
    'app/next-workspace/tax/page.tsx',
    'app/next-workspace/settings/page.tsx',
    'app/next-workspace/settings/payments/page.tsx',
    'app/next-workspace/whatsapp/page.tsx',
    'app/next-workspace/settings/diagnostics/page.tsx',
    'app/next-workspace/business-settings/page.tsx',
    'app/next-workspace/create-business/page.tsx',
    'app/next-workspace/data-migration/page.tsx',
    'app/next-workspace/profile/page.tsx',
    'app/next-workspace/cash-bill/settings/page.tsx',
    'app/next-workspace/cash-bill/CashBillControlled.tsx',
    'app/next-workspace/brand/DocumentThemeStudio.tsx',
    'app/next-workspace/documents/library/page.tsx',
  ];

  const missing = headerRoutes.filter((path) => {
    const source = readFileSync(path, 'utf8');
    return !source.includes("from '@/components/ui/finops/PageHeader'") || !source.includes('<PageHeader');
  });
  assert.deepEqual(missing, [], `routes missing shared PageHeader: ${missing.join(', ')}`);
});

test('financial summary-card migrations use the shared StatCard primitive', () => {
  const metricRoutes = [
    'app/next-workspace/page.tsx',
    'app/next-workspace/invoices/page.tsx',
    'app/next-workspace/invoices/new/page.tsx',
    'app/next-workspace/quotation/QuotationWorkspaceControlled.tsx',
    'app/next-workspace/customers/Customer360Controlled.tsx',
    'app/next-workspace/vendors/Vendor360Controlled.tsx',
    'app/next-workspace/purchases/new/page.tsx',
    'app/next-workspace/purchases/[id]/page.tsx',
    'app/next-workspace/vendors/page.tsx',
    'app/next-workspace/items/page.tsx',
    'app/next-workspace/bills/page.tsx',
    'app/next-workspace/payments/page.tsx',
    'app/next-workspace/receipts/page.tsx',
    'app/next-workspace/day-book/page.tsx',
    'app/next-workspace/banking/BankingControlled.tsx',
    'app/next-workspace/expenses/ExpenseWorkspaceControlled.tsx',
    'app/next-workspace/reports/ReportViewerControlled.tsx',
    'app/next-workspace/reports/daily-cash-book/page.tsx',
    'app/next-workspace/accounting/page.tsx',
    'app/next-workspace/tax/page.tsx',
    'app/next-workspace/settings/diagnostics/page.tsx',
  ];
  const missing = metricRoutes.filter((path) => {
    const source = readFileSync(path, 'utf8');
    return !source.includes("from '@/components/ui/finops/StatCard'") || !source.includes('<StatCard');
  });
  assert.deepEqual(missing, [], `summary-card routes missing shared StatCard: ${missing.join(', ')}`);
});

test('invoice and purchase entry/detail routes retain their finance workflows and page wrappers', () => {
  const invoiceEditor = readFileSync('app/next-workspace/invoices/new/page.tsx', 'utf8');
  const purchaseEntry = readFileSync('app/next-workspace/purchases/new/page.tsx', 'utf8');
  const purchaseDetail = readFileSync('app/next-workspace/purchases/[id]/page.tsx', 'utf8');
  const dashboard = readFileSync('app/next-workspace/page.tsx', 'utf8');

  assert.match(invoiceEditor, /return <main className="min-h-screen/);
  assert.match(invoiceEditor, /onClick={saveInvoice}/);
  assert.match(invoiceEditor, /update_cash_bill_any_state/);
  assert.match(purchaseEntry, /supabase\.rpc\('post_bill'/);
  assert.match(purchaseEntry, /is_purchase_order:isPO/);
  assert.match(purchaseDetail, /onClick={recordPayment}/);
  assert.match(purchaseDetail, /Receive Goods & Convert to Bill/);
  assert.doesNotMatch(dashboard, /\/>\}\s+description=/);
});
