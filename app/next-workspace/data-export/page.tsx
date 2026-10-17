'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { downloadBusinessSetupTemplate, downloadBusinessSetupWorkbook, type BusinessSetupWorkbookData } from '@/lib/business-setup-workbook';

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
  'bank_reconciliation_items',
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
  const [setupRunning, setSetupRunning] = useState(false);

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

  async function downloadSampleSetup() {
    setSetupRunning(true); setMessage('');
    try { await downloadBusinessSetupTemplate(); setMessage('Sample setup template downloaded. Replace or delete the sample rows before importing.'); }
    catch (error: unknown) { setMessage(error instanceof Error ? error.message : 'Template download failed.'); }
    finally { setSetupRunning(false); }
  }

  async function exportBusinessSetup() {
    setSetupRunning(true); setMessage('Preparing the seven-sheet setup workbook…'); setFailed([]);
    try {
      const [{data:context,error:contextError},{data:auth}]=await Promise.all([supabase.rpc('get_my_business_context'),supabase.auth.getUser()]);
      if(contextError) throw contextError;
      const selected=localStorage.getItem('moneymatters.activeBusinessId');
      const businessId=(context||[]).find((r:{business_id:string})=>r.business_id===selected)?.business_id||context?.[0]?.business_id;
      if(!businessId||!auth.user) throw new Error('No active business or authenticated user was found.');
      const [bizR,acctR,bankR,custR,vendorR,catR,subR,itemR,taxR,balR,journalR]=await Promise.all([
        supabase.from('businesses').select('id,name,legal_name,business_type,phone,email,website,tax_registration_number,registration_number,address,address_iso,country_code,currency_code,timezone').eq('id',businessId).single(),
        supabase.from('accounts').select('id,code,name,account_type,normal_balance,account_subtype,description').eq('business_id',businessId).order('code'),
        supabase.from('bank_accounts').select('*').eq('business_id',businessId).eq('is_active',true).order('name'),
        supabase.from('customers').select('id,display_name,legal_name,phone,email,tax_id,tax_type,billing_address,shipping_address,credit_limit,payment_terms_days,notes,metadata').eq('business_id',businessId).order('display_name'),
        supabase.from('vendors').select('id,display_name,legal_name,contact_person_name,phone,email,tax_id,tax_type,address,payment_terms_days,notes,metadata').eq('business_id',businessId).order('display_name'),
        supabase.from('product_categories').select('id,name,description,default_hsn_sac,default_tax_rate_id').eq('business_id',businessId).order('name'),
        supabase.from('product_subcategories').select('id,category_id,name,description').eq('business_id',businessId).order('name'),
        supabase.from('products_services').select('id,name,sku,description,item_type,unit,hsn_sac,sales_price,purchase_price,default_tax_rate_id,is_active,inventory_tracked,reorder_level,barcode,sell_enabled,purchase_enabled,category_id,subcategory_id').eq('business_id',businessId).order('name'),
        supabase.from('tax_rates').select('id,rate').eq('business_id',businessId).eq('is_active',true),
        supabase.from('inventory_balances').select('product_service_id,quantity_on_hand,average_cost').eq('business_id',businessId),
        supabase.from('journal_entries').select('id,entry_date').eq('business_id',businessId).eq('source_type','business_setup_opening_balance').in('status',['posted','locked']).order('entry_date').limit(1)
      ]);
      const results=[bizR,acctR,bankR,custR,vendorR,catR,subR,itemR,taxR,balR,journalR];
      const failedResult=results.find(x=>x.error); if(failedResult?.error) throw failedResult.error;
      const rows=(v:unknown)=>(Array.isArray(v)?v:[]) as Array<Record<string,unknown>>;
      const biz=bizR.data as unknown as Record<string,unknown>;
      const accounts=rows(acctR.data),banks=rows(bankR.data),customers=rows(custR.data),vendors=rows(vendorR.data);
      const cats=rows(catR.data),subs=rows(subR.data),items=rows(itemR.data),taxes=rows(taxR.data),balances=rows(balR.data);
      const acctById=new Map(accounts.map(x=>[String(x.id),x])),catById=new Map(cats.map(x=>[String(x.id),x])),subById=new Map(subs.map(x=>[String(x.id),x]));
      const taxById=new Map(taxes.map(x=>[String(x.id),Number(x.rate||0)])),stockById=new Map<string,number>(),stockValueById=new Map<string,number>();
      for(const x of balances){const id=String(x.product_service_id),qty=Number(x.quantity_on_hand||0);stockById.set(id,(stockById.get(id)||0)+qty);stockValueById.set(id,(stockValueById.get(id)||0)+qty*Number(x.average_cost||0));}
      const journals=rows(journalR.data),openingLines:Array<Record<string,unknown>>=[];
      if(journals.length){const lineResult=await supabase.from('journal_lines').select('account_id,entity_type,entity_id,debit,credit').eq('journal_entry_id',String(journals[0].id));if(lineResult.error)throw lineResult.error;openingLines.push(...rows(lineResult.data));}
      const acctOpen=new Map<string,number>(),customerOpen=new Map<string,number>(),vendorOpen=new Map<string,number>();
      for(const line of openingLines){const kind=String(line.entity_type||''),id=String(line.entity_id||'');if(kind==='customer'&&id)customerOpen.set(id,(customerOpen.get(id)||0)+Number(line.debit||0));else if(kind==='vendor'&&id)vendorOpen.set(id,(vendorOpen.get(id)||0)+Number(line.credit||0));else if(kind==='account'&&line.account_id){const key=String(line.account_id),acct=acctById.get(key);if(String(acct?.code||'')==='3000')continue;const amount=String(acct?.normal_balance||'debit')==='credit'?Number(line.credit||0):Number(line.debit||0);acctOpen.set(key,(acctOpen.get(key)||0)+amount);}}
      const obj=(x:unknown)=>x&&typeof x==='object'?x as Record<string,unknown>:{};
      const addr=obj(biz.address_iso||biz.address);
      const setup:BusinessSetupWorkbookData={
        profile:{business_name:String(biz.name||''),legal_name:String(biz.legal_name||''),business_type:String(biz.business_type||''),phone:String(biz.phone||''),email:String(biz.email||''),website:String(biz.website||''),gstin:String(biz.tax_registration_number||''),pan:String(biz.registration_number||''),address_line_1:String(addr.line1||addr.address_line_1||addr.street||''),address_line_2:String(addr.line2||addr.address_line_2||''),city:String(addr.city||''),state:String(addr.state||''),postal_code:String(addr.postal_code||addr.pincode||''),country_code:String(biz.country_code||'IN'),currency_code:String(biz.currency_code||'INR'),timezone:String(biz.timezone||'Asia/Kolkata'),opening_balance_date:journals[0]?.entry_date?String(journals[0].entry_date).slice(0,10):''},
        bank_accounts:[
          ...banks.map(x=>{const account=acctById.get(String(x.linked_account_id||'')),metadata=obj(x.metadata);return {record_type:String(metadata.record_type||(String(account?.account_subtype||'')==='cash'||String(x.account_type||'')==='cash'?'cash':String(metadata.upi_id||'')?'upi':'bank')),account_name:String(x.name||''),account_code:String(account?.code||''),account_type:String(account?.account_type||'asset'),normal_balance:String(account?.normal_balance||'debit'),institution_name:String(x.institution_name||''),account_number:String(x.account_number||''),account_holder_name:String(x.account_holder_name||''),ifsc_code:String(x.ifsc_code||''),branch_name:String(x.branch_name||''),currency_code:String(x.currency_code||biz.currency_code||'INR'),upi_id:String(metadata.upi_id||''),is_primary:String(Boolean(x.is_primary)),opening_balance:String(acctOpen.get(String(x.linked_account_id||''))||0),description:''};}),
          ...accounts.filter(account=>!banks.some(bank=>String(bank.linked_account_id||'')===String(account.id))).map(account=>({record_type:'account',account_name:String(account.name||''),account_code:String(account.code||''),account_type:String(account.account_type||'asset'),normal_balance:String(account.normal_balance||'debit'),institution_name:'',account_number:'',account_holder_name:'',ifsc_code:'',branch_name:'',currency_code:String(biz.currency_code||'INR'),upi_id:'',is_primary:'false',opening_balance:String(acctOpen.get(String(account.id))||0),description:String(account.description||'')}))
        ],
        customers:customers.map(x=>{const meta=obj(obj(x.metadata).business_setup_opening_balance);return {name:String(x.display_name||''),legal_name:String(x.legal_name||''),phone:String(x.phone||''),email:String(x.email||''),gstin:String(x.tax_id||''),tax_type:String(x.tax_type||''),billing_address:String(obj(x.billing_address).line1||''),shipping_address:String(obj(x.shipping_address).line1||''),credit_limit:String(x.credit_limit??0),payment_terms_days:String(x.payment_terms_days??0),opening_balance:String(customerOpen.get(String(x.id))??meta.amount??0),notes:String(x.notes||'')};}),
        vendors:vendors.map(x=>{const meta=obj(obj(x.metadata).business_setup_opening_balance);return {name:String(x.display_name||''),legal_name:String(x.legal_name||''),contact_person_name:String(x.contact_person_name||''),phone:String(x.phone||''),email:String(x.email||''),gstin:String(x.tax_id||''),tax_type:String(x.tax_type||''),address:String(obj(x.address).line1||''),payment_terms_days:String(x.payment_terms_days??0),opening_balance:String(vendorOpen.get(String(x.id))??meta.amount??0),notes:String(x.notes||'')};}),
        categories:cats.flatMap(x=>{const children=subs.filter(y=>String(y.category_id)===String(x.id));return (children.length?children:[null]).map(y=>({category:String(x.name||''),subcategory:y?String(y.name||''):'',description:String(x.description||(y?y.description:'')||''),default_hsn_sac:String(x.default_hsn_sac||''),tax_rate:String(taxById.get(String(x.default_tax_rate_id||''))||0)}));}),
        products_services:items.map(x=>({category:String(catById.get(String(x.category_id||''))?.name||''),subcategory:String(subById.get(String(x.subcategory_id||''))?.name||''),item_type:String(x.item_type||'product'),sku:String(x.sku||''),name:String(x.name||''),hsn_sac:String(x.hsn_sac||''),unit:String(x.unit||''),sales_price:String(x.sales_price??0),purchase_price:String(x.purchase_price??0),tax_rate:String(taxById.get(String(x.default_tax_rate_id||''))||0),opening_stock:String(x.inventory_tracked?stockById.get(String(x.id))||0:0),opening_stock_cost:String(x.inventory_tracked?stockValueById.get(String(x.id))??((stockById.get(String(x.id))||0)*Number(x.purchase_price||0)):0),reorder_level:String(x.reorder_level??0),barcode:String(x.barcode||''),description:String(x.description||''),sell_enabled:String(Boolean(x.sell_enabled)),purchase_enabled:String(Boolean(x.purchase_enabled)),is_active:String(Boolean(x.is_active))}))
      };
      await downloadBusinessSetupWorkbook(String(biz.name||'Business'),setup);
      setMessage('Seven-sheet setup workbook exported. Opening balances and stock are included only where safely identified.');
    }catch(error:unknown){setMessage(error instanceof Error?error.message:'Business setup export failed.');}
    finally{setSetupRunning(false);}
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
          <button type="button" disabled={setupRunning} onClick={downloadSampleSetup} className="rounded-xl border border-violet-200 bg-white px-4 py-3 text-sm font-semibold text-violet-800 hover:bg-violet-50 disabled:opacity-60">{setupRunning ? 'Preparing…' : 'Download Sample Business Setup Template (.xlsx)'}</button>
          <button type="button" disabled={setupRunning} onClick={exportBusinessSetup} className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-60">{setupRunning ? 'Preparing setup…' : 'Export Business Setup Workbook (.xlsx)'}</button>
          <button type="button" disabled={running} onClick={exportData} className="rounded-xl bg-violet-600 px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-violet-700 disabled:cursor-wait disabled:opacity-60">{running ? 'Preparing export…' : 'Export all business data to Excel'}</button>
          {message && <span role="status" className="text-sm text-slate-600">{message}</span>}
        </div>
        {failed.length > 0 && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800"><b>Some optional datasets could not be exported:</b> {failed.join(', ')}. This does not affect the sheets that were successfully exported.</div>}
      </section>
    </div>
  </main>;
}
