'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';

const DIRECT_BUSINESS_TABLES = [
  'businesses','customers','vendors','products_services','accounts','tax_rates','invoices','bills','payments','expenses',
  'bank_accounts','quotations','receipts','documents','employees','payroll_runs','recurring_invoices','payment_allocations',
  'accounting_periods','journal_entries','credit_notes','debit_notes','customer_credit_ledger','customer_refunds','write_offs',
  'vendor_credits','vendor_credit_ledger','inventory_locations','inventory_balances','inventory_movements','inventory_transfers',
  'customer_item_pricing','business_document_preferences','business_document_bank_accounts','document_payment_settings',
  'business_brand_assets','brand_color_presets','recurring_expense_templates','automation_rules','automation_runs',
  'integration_connections','business_tax_profiles','tax_filing_profiles','tax_adjustments','tds_rules','tds_transactions',
  'tcs_rules','tcs_transactions','tax_transaction_lines','report_snapshots','ca_exports','notification_jobs',
  'notification_delivery_evidence','business_whatsapp_connections','whatsapp_templates','whatsapp_notification_queue',
  'vendor_purchase_items','ai_agent_preferences','ai_insight_events','ai_action_requests','document_render_jobs',
  'recurring_invoice_runs','fx_rates','bank_reconciliations','year_end_closings',
] as const;

const CHILD_TABLES = [
  'invoice_items','quotation_items','bill_items','credit_note_items','debit_note_items','journal_lines',
  'vendor_credit_items','recurring_invoice_items','inventory_transfer_items','payroll_items','bank_transactions',
  'bank_reconciliation_items','reconciliation_items',
] as const;

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function safeSheetName(name: string) {
  return name.replace(/[\\/?*:[\]]/g, '_').slice(0, 31) || 'Sheet';
}

function uniqueSheetName(workbook: any, requested: string) {
  const base = safeSheetName(requested);
  if (!workbook.getWorksheet(base)) return base;
  for (let n = 2; n < 1000; n += 1) {
    const suffix = `_${n}`;
    const candidate = `${base.slice(0, 31 - suffix.length)}${suffix}`;
    if (!workbook.getWorksheet(candidate)) return candidate;
  }
  throw new Error(`Unable to allocate a worksheet name for ${requested}.`);
}

function normalizeCellValue(value: unknown): any {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value instanceof Date) return value;
  return JSON.stringify(value);
}

function appendRowsAsWorksheet(workbook: any, requestedName: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  if (!columns.length) return;
  const sheet = workbook.addWorksheet(uniqueSheetName(workbook, requestedName));
  sheet.addRow(columns);
  for (const row of rows) {
    sheet.addRow(columns.map((column) => normalizeCellValue(row[column])));
  }
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  for (let index = 1; index <= columns.length; index += 1) {
    sheet.getColumn(index).width = Math.min(
      42,
      Math.max(12, columns[index - 1].length + 2),
    );
  }
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

export default function DataExportPage() {
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState<string[]>([]);

  async function exportData() {
    setRunning(true);
    setMessage('Preparing your business export…');
    setFailed([]);
    let exportLogId: string | null = null;

    try {
      const [{ data: context, error: contextError }, { data: auth }] = await Promise.all([
        supabase.rpc('get_my_business_context'),
        supabase.auth.getUser(),
      ]);
      if (contextError) throw contextError;

      const activeId = localStorage.getItem('moneymatters.activeBusinessId');
      const businessId = (context || []).find((row: { business_id: string }) => row.business_id === activeId)?.business_id
        || context?.[0]?.business_id;

      if (!businessId || !auth.user) {
        throw new Error('No active business or authenticated user was found.');
      }

      const { data: log } = await supabase
        .from('data_export_logs')
        .insert({
          business_id: businessId,
          requested_by: auth.user.id,
          export_format: 'xlsx',
          scope: 'business_data',
          status: 'started',
        })
        .select('id')
        .maybeSingle();

      exportLogId = log?.id || null;

      const { default: ExcelJS } = await import('@andreeewill/exceljs/dist/exceljs.min.js');
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'Moneymatters';
      workbook.lastModifiedBy = 'Moneymatters';
      workbook.created = new Date();
      workbook.modified = new Date();

      const failures: string[] = [];
      const exported = new Set<string>();

      for (const table of DIRECT_BUSINESS_TABLES) {
        const { data, error } = await supabase
          .from(table)
          .select('*')
          .eq('business_id', businessId);

        if (error) {
          failures.push(table);
          continue;
        }

        if (data?.length) {
          appendRowsAsWorksheet(workbook, table, data as Record<string, unknown>[]);
          exported.add(table);
        }
      }

      const relationMap: Record<string, { parent: string; childKey: string; parentKey: string }> = {
        invoice_items: { parent: 'invoices', childKey: 'invoice_id', parentKey: 'id' },
        quotation_items: { parent: 'quotations', childKey: 'quotation_id', parentKey: 'id' },
        bill_items: { parent: 'bills', childKey: 'bill_id', parentKey: 'id' },
        credit_note_items: { parent: 'credit_notes', childKey: 'credit_note_id', parentKey: 'id' },
        debit_note_items: { parent: 'debit_notes', childKey: 'debit_note_id', parentKey: 'id' },
        journal_lines: { parent: 'journal_entries', childKey: 'journal_entry_id', parentKey: 'id' },
        vendor_credit_items: { parent: 'vendor_credits', childKey: 'vendor_credit_id', parentKey: 'id' },
        recurring_invoice_items: { parent: 'recurring_invoices', childKey: 'recurring_invoice_id', parentKey: 'id' },
        inventory_transfer_items: { parent: 'inventory_transfers', childKey: 'transfer_id', parentKey: 'id' },
        payroll_items: { parent: 'payroll_runs', childKey: 'payroll_run_id', parentKey: 'id' },
        bank_transactions: { parent: 'bank_accounts', childKey: 'bank_account_id', parentKey: 'id' },
        bank_reconciliation_items: { parent: 'bank_reconciliations', childKey: 'reconciliation_id', parentKey: 'id' },
      };

      for (const table of CHILD_TABLES) {
        const relation = relationMap[table];
        if (!relation || !exported.has(relation.parent)) continue;

        const { data: parents } = await supabase
          .from(relation.parent)
          .select(relation.parentKey)
          .eq('business_id', businessId);

        const ids = (parents || []) as unknown as Array<Record<string, unknown>>;
        const parentIds = ids.map((row) => row[relation.parentKey])
          .filter(Boolean);

        if (!ids.length) continue;

        const { data, error } = await supabase
          .from(table)
          .select('*')
          .in(relation.childKey, parentIds);

        if (error) {
          failures.push(table);
          continue;
        }

        if (data?.length) appendRowsAsWorksheet(workbook, table, data as Record<string, unknown>[]);
      }

      if (!workbook.worksheets.length) {
        throw new Error('No exportable business data was found.');
      }

      const buffer = await workbook.xlsx.writeBuffer();
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      downloadWorkbook(buffer, `moneymatters-business-export-${stamp}.xlsx`);

      if (exportLogId) {
        await supabase
          .from('data_export_logs')
          .update({
            status: 'completed',
            sheet_count: workbook.worksheets.length,
            completed_at: new Date().toISOString(),
            error_summary: failures.length ? failures.join(', ') : null,
          })
          .eq('id', exportLogId);
      }

      setFailed(failures);
      setMessage(`Export complete: ${workbook.worksheets.length} sheets downloaded.`);
    } catch (error: unknown) {
      const text = error instanceof Error ? error.message : 'Export failed.';
      if (exportLogId) {
        await supabase
          .from('data_export_logs')
          .update({ status: 'failed', error_summary: text })
          .eq('id', exportLogId);
      }
      setMessage(text);
    } finally {
      setRunning(false);
    }
  }

  return <main className="min-h-[calc(100vh-100px)] bg-[#fbfaff] p-4 sm:p-7">
    <div className="mx-auto max-w-5xl">
      <header className="mb-6">
        <p className="text-[10px] font-bold uppercase tracking-[.18em] text-violet-600">Data & export</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-950">Your business data</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
          Export your business records to Excel for reporting, analysis or migration. The export is restricted to the active business and never includes authentication secrets.
        </p>
      </header>
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-xl bg-violet-50 p-4"><b className="block text-sm text-violet-900">Excel workbook</b><span className="mt-1 block text-xs leading-5 text-violet-700">Separate sheets for customers, products, invoices, payments, expenses, accounting and operational data.</span></div>
          <div className="rounded-xl bg-emerald-50 p-4"><b className="block text-sm text-emerald-900">Business scoped</b><span className="mt-1 block text-xs leading-5 text-emerald-700">Only records belonging to your active business are requested through Supabase RLS.</span></div>
          <div className="rounded-xl bg-amber-50 p-4"><b className="block text-sm text-amber-900">Portable data</b><span className="mt-1 block text-xs leading-5 text-amber-700">Use the workbook for analysis, accountant handoff or future migration.</span></div>
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button type="button" disabled={running} onClick={exportData} className="rounded-xl bg-violet-600 px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-violet-700 disabled:cursor-wait disabled:opacity-60">{running ? 'Preparing export…' : 'Export all business data to Excel'}</button>
          {message && <span className="text-sm text-slate-600">{message}</span>}
        </div>
        {failed.length > 0 && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800"><b>Some optional datasets could not be exported:</b> {failed.join(', ')}. This does not affect the sheets that were successfully exported.</div>}
      </section>
    </div>
  </main>;
}
