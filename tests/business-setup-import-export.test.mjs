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
const optionalSheetsMigration = read('supabase/migrations/20261017201000_business_setup_allow_empty_master_sheets.sql');
const dataExportUtility = read('lib/business-data-export.ts');

test('sample workbook contains seven expected worksheets, sample rows, and instructions', () => {
  for (const sheet of ['0. Instructions & Legend','1. Business Profile','2. Bank & Accounts','3. Customers','4. Vendors','5. Categories','6. Products & Services']) assert.ok(workbook.includes(sheet));
  for (const field of ['Business Name','GSTIN','PAN','UPI ID','Opening Balance','Customer','Vendor','Category','Subcategory','HSN/SAC','Opening Stock']) assert.ok(workbook.includes(field));
  assert.ok(workbook.includes('SAMPLE CUSTOMER - REPLACE OR DELETE'));
  assert.ok(workbook.includes('SAMPLE PRODUCT - REPLACE OR DELETE'));
  assert.ok(workbook.includes('Moneymatters-Sample-Business-Setup-Template.xlsx'));
  assert.ok(workbook.includes("business_type: ''"));
  assert.ok(workbook.includes("profileSheet.getCell('C2').dataValidation"));
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
  assert.ok(commitMigration.includes("'business_setup_opening_balance'"));
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

test('Instructions worksheet gives field-level required/optional definitions for setup data', () => {
  assert.ok(workbook.includes("['Sheet / Section', 'Column / Topic', 'Required?', 'Definition, allowed values & safety rules']"));
  for (const field of ['Business Name','Record Type','Account Code','Opening Balance Date','Customers','Vendors','Default HSN/SAC','Item Type','Opening Stock Cost','Sell Enabled / Purchase Enabled / Active']) assert.ok(workbook.includes("'" + field + "'"));
  assert.ok(workbook.includes('5,000 data rows per worksheet'));
  assert.ok(workbook.includes("sheet.views = [{ state: 'frozen', ySplit: 1 }];"));
});

test('Workbook parser row limits match the server per-sheet guard', () => {
  assert.ok(workbook.includes('const sheetCounts: Array<[string, number]>'));
  assert.ok(workbook.includes('const oversized = sheetCounts.find(([, count]) => count > 5000)'));
  assert.ok(workbook.includes('maximum is 5,000 per worksheet'));
});

test('setup preview and commit make the target active business explicit', () => {
  assert.ok(migrationPage.includes('type ActiveBusinessContext={business_id:string;business_name:string}'));
  assert.ok(migrationPage.includes('Import target business'));
  assert.ok(migrationPage.includes('setupBusinessName'));
  assert.ok(migrationPage.includes('Commit this validated business setup to "'));
});

test('export uses bounded pagination for setup master sheets and full business tables', () => {
  assert.ok(exportPage.includes('async function fetchPagedRows('));
  assert.ok(exportPage.includes('.range(from,to)'));
  assert.ok(exportPage.includes(",'customers',5000)"));
  assert.ok(exportPage.includes("async (from,to)=>await supabase.from(table).select('*').eq('business_id',businessId).range(from,to)"));
  assert.ok(exportPage.includes('for (let index=0; index<parentIds.length; index+=250)'));
  assert.ok(exportPage.includes('Use the full business-data export for larger historical datasets.'));
});

test('setup migration preview warns which active business will receive the commit', () => {
  assert.ok(migrationPage.includes('Import target business'));
  assert.ok(migrationPage.includes('setSetupBusinessName(target.business_name'));
  assert.ok(migrationPage.includes('Commit this validated business setup to "'));
  assert.ok(migrationPage.includes("setSetupBusinessName('');setSetupError('')"));
});

test('sample workbook is simplified while preserving the seven migration worksheets', () => {
  assert.ok(workbook.includes("['name','Name'],['phone','Phone'],['email','Email'],['gstin','GSTIN']"));
  assert.ok(workbook.includes("['category','Subcategory','description','Description']") || workbook.includes("['category','Category'],['subcategory','Subcategory'],['description','Description']"));
  assert.ok(workbook.includes('const guide = ['));
  assert.ok(workbook.includes('Maximum 5,000 rows per data worksheet'));
  assert.ok(workbook.includes('requiredFields: string[]'));
  assert.ok(workbook.includes("SHEET_NAMES.customers, ['name']"));
});

test('optional master worksheets may be empty after sample rows are deleted', () => {
  assert.ok(optionalSheetsMigration.includes('CREATE OR REPLACE FUNCTION public._validate_business_setup_payload'));
  assert.ok(!optionalSheetsMigration.includes('Add at least one customer.'));
  assert.ok(!optionalSheetsMigration.includes('Add at least one vendor.'));
  assert.ok(!optionalSheetsMigration.includes('Add at least one product or service.'));
  assert.ok(optionalSheetsMigration.includes("REVOKE ALL ON FUNCTION public._validate_business_setup_payload(uuid,jsonb) FROM PUBLIC,anon,authenticated"));
});

test('full business Excel export is directly available from Integration & Data and reused by export center', () => {
  assert.ok(migrationPage.includes('Export Full Business Data (.xlsx)'));
  assert.ok(migrationPage.includes('onClick={exportFullBusinessExcel}'));
  assert.ok(migrationPage.includes('Migration-ready export options'));
  assert.ok(migrationPage.includes("import { exportFullBusinessDataToExcel } from '@/lib/business-data-export'"));
  assert.ok(exportPage.includes("import { exportFullBusinessDataToExcel } from '@/lib/business-data-export'"));
  assert.ok(exportPage.includes('Full export complete:'));
});

test('full business Excel export pages through all table data, includes a manifest and strips secrets', () => {
  assert.ok(dataExportUtility.includes('EXCEL_MAX_DATA_ROWS = 1_000_000'));
  assert.ok(dataExportUtility.includes('.range(from,to)'));
  assert.ok(dataExportUtility.includes("const manifest = workbook.addWorksheet('00 Export Manifest');"));
  assert.ok(dataExportUtility.includes('SENSITIVE_KEY'));
  assert.ok(dataExportUtility.includes('no partial workbook was downloaded') || dataExportUtility.includes('no partial workbook'));
  assert.ok(dataExportUtility.includes('CHILD_RELATIONS'));
});
