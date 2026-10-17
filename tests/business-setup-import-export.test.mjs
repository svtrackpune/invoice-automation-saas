import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');
const workbook = read('lib/business-setup-workbook.ts');
const migrationPage = read('app/next-workspace/data-migration/page.tsx');
const exportPage = read('app/next-workspace/data-export/page.tsx');
const previewMigration = read('supabase/migrations/20261017200000_business_setup_staging_and_preview.sql');
const commitMigration = read('supabase/migrations/20261017200100_business_setup_atomic_commit.sql');
const guardMigration = read('supabase/migrations/20261017200200_business_setup_opening_balance_permission_guard.sql');

test('sample workbook contains seven expected worksheets, sample rows, and instructions', () => {
  for (const sheet of ['0. Instructions & Legend','1. Business Profile','2. Bank & Accounts','3. Customers','4. Vendors','5. Categories','6. Products & Services']) assert.ok(workbook.includes(sheet));
  for (const field of ['Business Name','GSTIN','PAN','UPI ID','Opening Balance','Customer','Vendor','Category','Subcategory','HSN/SAC','Opening Stock']) assert.ok(workbook.includes(field));
  assert.ok(workbook.includes('SAMPLE CUSTOMER - REPLACE OR DELETE'));
  assert.ok(workbook.includes('SAMPLE PRODUCT - REPLACE OR DELETE'));
  assert.ok(workbook.includes('Moneymatters-Sample-Business-Setup-Template.xlsx'));
  assert.ok(workbook.includes("business_type: ''"));
  assert.ok(workbook.includes("profileSheet.getCell('C2').dataValidation"));
  assert.ok(workbook.includes('Do not leave the sample rows in the file.'));
});

test('parser enforces complete workbook schema, size limits, and sheet row identities', () => {
  assert.ok(workbook.includes('workbook.getWorksheet(name)'));
  assert.ok(workbook.includes('15 * 1024 * 1024'));
  assert.ok(workbook.includes('_sheet_row: rowNumber'));
  assert.ok(workbook.includes('Workbook is missing required worksheet'));
  assert.ok(workbook.includes("itemcodesku:'sku'"));
  assert.ok(workbook.includes("taxratepercent:'tax_rate'"));
});

test('migration UI presents local row preview before commit and preserves the existing migration tools', () => {
  assert.ok(migrationPage.includes('Download Sample Business Setup Template (.xlsx)'));
  assert.ok(migrationPage.includes('Validate & Preview'));
  assert.ok(migrationPage.includes("supabase.rpc('preview_business_setup_import'"));
  assert.ok(migrationPage.includes("supabase.rpc('commit_business_setup_import'"));
  assert.ok(migrationPage.includes('disabled={setupBusy||!setupPreview.can_commit}'));
  assert.ok(migrationPage.includes('setupPreview.issues.slice(0,200)'));
  assert.ok(migrationPage.includes('Workbook preview'));
  assert.ok(migrationPage.includes('sheet.rows.slice(0,3)'));
  assert.ok(migrationPage.includes('Stage import ({rows.length})'));
});

test('staging is private and validation enforces tenant and accounting permissions', () => {
  assert.ok(previewMigration.includes('ALTER TABLE public.business_setup_import_staging ENABLE ROW LEVEL SECURITY'));
  assert.ok(previewMigration.includes('REVOKE ALL ON TABLE public.business_setup_import_staging FROM PUBLIC, anon, authenticated'));
  assert.ok(previewMigration.includes("has_business_permission(p_business_id,'settings.manage',auth.uid())"));
  assert.ok(guardMigration.includes('accounting.post is required to import non-zero opening balances'));
  assert.ok(guardMigration.includes('Business Type must be sole_proprietorship'));
  assert.ok(guardMigration.includes('Mark only one bank account as primary'));
});

test('commit revalidates staged data and keeps stock and opening ledger entries safe', () => {
  assert.ok(commitMigration.includes("v_stage.status<>'validated'"));
  assert.ok(commitMigration.includes('FOR UPDATE'));
  assert.ok(commitMigration.includes('public.validate_journal_entry_balance(v_entry_id)'));
  assert.ok(commitMigration.includes("source_type='business_setup_opening_balance'"));
  assert.ok(commitMigration.includes('no opening_stock/opening_stock_cost fields are changed for existing items'));
  assert.ok(commitMigration.includes('public.document_payment_settings'));
  assert.ok(commitMigration.includes('public.business_document_bank_accounts'));
  assert.ok(commitMigration.includes('business_type=CASE'));
  assert.ok(commitMigration.includes('GRANT EXECUTE ON FUNCTION public.commit_business_setup_import(uuid) TO authenticated'));
});

test('data export offers the sample and populated setup workbooks alongside the full-data export', () => {
  assert.ok(exportPage.includes('Download Sample Business Setup Template (.xlsx)'));
  assert.ok(exportPage.includes('Export Business Setup Workbook (.xlsx)'));
  assert.ok(exportPage.includes('downloadBusinessSetupWorkbook'));
  assert.ok(exportPage.includes('Export all business data to Excel'));
  assert.ok(exportPage.includes("eq('source_type','business_setup_opening_balance')"));
  assert.ok(exportPage.includes("if(String(acct?.code||'')==='3000')continue"));
  assert.ok(exportPage.includes('average_cost'));
});
