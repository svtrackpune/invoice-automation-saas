type SupabaseExportClient = { from: (table: string) => any };

const DIRECT_BUSINESS_TABLES = [
  "businesses",
  "customers",
  "vendors",
  "products_services",
  "accounts",
  "tax_rates",
  "invoices",
  "bills",
  "payments",
  "expenses",
  "bank_accounts",
  "quotations",
  "receipts",
  "documents",
  "employees",
  "payroll_runs",
  "recurring_invoices",
  "payment_allocations",
  "accounting_periods",
  "journal_entries",
  "credit_notes",
  "debit_notes",
  "customer_credit_ledger",
  "customer_refunds",
  "write_offs",
  "vendor_credits",
  "vendor_credit_ledger",
  "inventory_locations",
  "inventory_balances",
  "inventory_movements",
  "inventory_transfers",
  "customer_item_pricing",
  "business_document_preferences",
  "business_document_bank_accounts",
  "document_payment_settings",
  "business_brand_assets",
  "brand_color_presets",
  "recurring_expense_templates",
  "automation_rules",
  "automation_runs",
  "integration_connections",
  "business_tax_profiles",
  "tax_filing_profiles",
  "tax_adjustments",
  "tds_rules",
  "tds_transactions",
  "tcs_rules",
  "tcs_transactions",
  "tax_transaction_lines",
  "report_snapshots",
  "ca_exports",
  "notification_jobs",
  "notification_delivery_evidence",
  "business_whatsapp_connections",
  "whatsapp_templates",
  "whatsapp_notification_queue",
  "vendor_purchase_items",
  "ai_agent_preferences",
  "ai_insight_events",
  "ai_action_requests",
  "document_render_jobs",
  "recurring_invoice_runs",
  "fx_rates",
  "bank_reconciliations",
  "year_end_closings"
] as const;
const CHILD_TABLES = [
  "invoice_items",
  "quotation_items",
  "bill_items",
  "credit_note_items",
  "debit_note_items",
  "journal_lines",
  "vendor_credit_items",
  "recurring_invoice_items",
  "inventory_transfer_items",
  "payroll_items",
  "bank_transactions",
  "bank_reconciliation_items"
] as const;
const CHILD_RELATIONS: Record<string, { parent: string; childKey: string; parentKey: string }> = {
  "invoice_items": {
    "parent": "invoices",
    "childKey": "invoice_id",
    "parentKey": "id"
  },
  "quotation_items": {
    "parent": "quotations",
    "childKey": "quotation_id",
    "parentKey": "id"
  },
  "bill_items": {
    "parent": "bills",
    "childKey": "bill_id",
    "parentKey": "id"
  },
  "credit_note_items": {
    "parent": "credit_notes",
    "childKey": "credit_note_id",
    "parentKey": "id"
  },
  "debit_note_items": {
    "parent": "debit_notes",
    "childKey": "debit_note_id",
    "parentKey": "id"
  },
  "journal_lines": {
    "parent": "journal_entries",
    "childKey": "journal_entry_id",
    "parentKey": "id"
  },
  "vendor_credit_items": {
    "parent": "vendor_credits",
    "childKey": "vendor_credit_id",
    "parentKey": "id"
  },
  "recurring_invoice_items": {
    "parent": "recurring_invoices",
    "childKey": "recurring_invoice_id",
    "parentKey": "id"
  },
  "inventory_transfer_items": {
    "parent": "inventory_transfers",
    "childKey": "transfer_id",
    "parentKey": "id"
  },
  "payroll_items": {
    "parent": "payroll_runs",
    "childKey": "payroll_run_id",
    "parentKey": "id"
  },
  "bank_transactions": {
    "parent": "bank_accounts",
    "childKey": "bank_account_id",
    "parentKey": "id"
  },
  "bank_reconciliation_items": {
    "parent": "bank_reconciliations",
    "childKey": "reconciliation_id",
    "parentKey": "id"
  }
};

const EXCEL_MAX_DATA_ROWS = 1_000_000;
const SENSITIVE_KEY = /(password|secret|token|credential|api[_-]?key|private[_-]?key|authorization|refresh[_-]?token|access[_-]?token)/i;
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function safeSheetName(name: string) {
  return name.replace(/[\\/?*:[\]]/g, '_').slice(0, 31) || 'Sheet';
}
function uniqueSheetName(workbook: any, requested: string) {
  const base = safeSheetName(requested);
  if (!workbook.getWorksheet(base)) return base;
  for (let n = 2; n < 1000; n += 1) {
    const suffix = '_' + n;
    const candidate = base.slice(0, 31 - suffix.length) + suffix;
    if (!workbook.getWorksheet(candidate)) return candidate;
  }
  throw new Error('Unable to allocate a worksheet name for ' + requested + '.');
}
function sanitizeValue(value: any): any {
  if (value === null || value === undefined || typeof value !== 'object' || value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(sanitizeValue);
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) continue;
    out[key] = sanitizeValue(entry);
  }
  return out;
}
function cellValue(value: unknown): any {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value instanceof Date) return value;
  return JSON.stringify(value);
}
function downloadWorkbook(buffer: unknown, filename: string) {
  const bytes = buffer instanceof ArrayBuffer
    ? new Uint8Array(buffer)
    : buffer instanceof Uint8Array
      ? buffer
      : new Uint8Array(buffer as ArrayBuffer);
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: XLSX_MIME });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
function appendRowsAsWorksheet(workbook: any, requestedName: string, inputRows: Record<string, unknown>[]) {
  const rows = inputRows.map((row) => sanitizeValue(row) as Record<string, unknown>);
  if (!rows.length) return null;
  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  if (!columns.length) return null;
  const sheet = workbook.addWorksheet(uniqueSheetName(workbook, requestedName));
  sheet.addRow(columns);
  for (const row of rows) sheet.addRow(columns.map((column) => cellValue(row[column])));
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } };
  header.alignment = { vertical: 'middle', wrapText: true };
  header.height = 28;
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = { from: 'A1', to: sheet.getRow(1).getCell(columns.length).address };
  for (let index = 1; index <= columns.length; index += 1) sheet.getColumn(index).width = Math.min(42, Math.max(12, String(columns[index - 1]).length + 2));
  return sheet.name as string;
}
async function fetchPagedRows(
  loadPage: (from: number, to: number) => Promise<{ data: any[] | null; error: { message: string } | null }>,
  label: string,
  maxRows = EXCEL_MAX_DATA_ROWS,
): Promise<any[]> {
  const all: any[] = [];
  const pageSize = 500;
  for (let from = 0; from <= maxRows; from += pageSize) {
    const result = await loadPage(from, from + pageSize - 1);
    if (result.error) throw new Error('Could not export ' + label + ': ' + result.error.message);
    const batch = result.data || [];
    all.push(...batch);
    if (all.length > maxRows) throw new Error(label + ' exceeds the Excel worksheet limit of ' + maxRows.toLocaleString() + ' data rows.');
    if (batch.length < pageSize) return all;
  }
  throw new Error(label + ' exceeded the Excel worksheet row limit.');
}
function makeFilenameDate() {
  const now = new Date();
  return now.getUTCFullYear().toString() + String(now.getUTCMonth() + 1).padStart(2,'0') + String(now.getUTCDate()).padStart(2,'0');
}

export type FullBusinessExcelExportSummary = { sheetCount: number; recordCount: number; datasetCount: number };

export async function exportFullBusinessDataToExcel(client: SupabaseExportClient, businessId: string): Promise<FullBusinessExcelExportSummary> {
  if (!businessId) throw new Error('Select an active business before exporting.');
  const { default: ExcelJS } = await import('@andreeewill/exceljs/dist/exceljs.min.js');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Moneymatters';
  workbook.lastModifiedBy = 'Moneymatters';
  workbook.created = new Date();
  workbook.modified = new Date();
  const counts = new Map<string, number>();
  const worksheetByDataset = new Map<string, string>();
  const failures: string[] = [];
  let recordCount = 0;
  const exportedParents = new Set<string>();

  for (const table of DIRECT_BUSINESS_TABLES) {
    try {
      const rows = await fetchPagedRows(
        async (from,to) => await client.from(table).select('*').eq('business_id',businessId).range(from,to),
        table,
      );
      counts.set(table, rows.length);
      recordCount += rows.length;
      if (rows.length) {
        const worksheet = appendRowsAsWorksheet(workbook, table, rows as Record<string,unknown>[]);
        if (worksheet) {
          worksheetByDataset.set(table, worksheet);
          exportedParents.add(table);
        }
      }
    } catch (error) {
      failures.push(table + ': ' + (error instanceof Error ? error.message : 'read failed'));
    }
  }

  for (const table of CHILD_TABLES) {
    const relation = CHILD_RELATIONS[table];
    if (!relation) continue;
    try {
      const parents = await fetchPagedRows(
        async (from,to) => await client.from(relation.parent).select(relation.parentKey).eq('business_id',businessId).range(from,to),
        relation.parent + ' references for ' + table,
      );
      const parentIds = parents.map((row: Record<string,unknown>) => row[relation.parentKey]).filter(Boolean);
      if (!parentIds.length) {
        counts.set(table, 0);
        continue;
      }
      const childRows: Record<string,unknown>[] = [];
      for (let index = 0; index < parentIds.length; index += 250) {
        const idBatch = parentIds.slice(index,index+250);
        const batch = await fetchPagedRows(
          async (from,to) => await client.from(table).select('*').in(relation.childKey,idBatch).order(relation.childKey).range(from,to),
          table,
        );
        childRows.push(...batch as Record<string,unknown>[]);
        if (childRows.length > EXCEL_MAX_DATA_ROWS) throw new Error('Child dataset exceeds the Excel worksheet row limit.');
      }
      counts.set(table, childRows.length);
      recordCount += childRows.length;
      if (childRows.length) {
        const worksheet = appendRowsAsWorksheet(workbook,table,childRows);
        if (worksheet) worksheetByDataset.set(table,worksheet);
      }
    } catch (error) {
      failures.push(table + ': ' + (error instanceof Error ? error.message : 'read failed'));
    }
  }

  if (failures.length) {
    const displayed = failures.slice(0,12).join('; ');
    const more = failures.length > 12 ? '; plus ' + (failures.length-12) + ' more dataset(s)' : '';
    throw new Error('Full Excel export was stopped; no partial workbook was downloaded. Some business datasets could not be read: ' + displayed + more + '. Check access/permissions and retry.');
  }

  if (!workbook.worksheets.length) throw new Error('No business datasets were exportable.');
  const manifest = workbook.addWorksheet('00 Export Manifest',0);
  manifest.addRow(['Dataset','Records exported','Worksheet','Status']);
  for (const table of [...DIRECT_BUSINESS_TABLES,...CHILD_TABLES]) {
    const count = counts.get(table) || 0;
    manifest.addRow([table,count,worksheetByDataset.get(table)||'—',count?'Included':'No records for this business']);
  }
  const header = manifest.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
  header.alignment = { vertical: 'middle', wrapText: true };
  header.height = 28;
  manifest.columns = [{width:38},{width:20},{width:38},{width:32}];
  manifest.views = [{state:'frozen',ySplit:1}];
  manifest.autoFilter = {from:'A1',to:'D'+manifest.rowCount};

  const buffer = await workbook.xlsx.writeBuffer();
  downloadWorkbook(buffer,'Moneymatters-Full-Business-Export-'+makeFilenameDate()+'.xlsx');
  return { sheetCount: workbook.worksheets.length, recordCount, datasetCount: DIRECT_BUSINESS_TABLES.length + CHILD_TABLES.length };
}
