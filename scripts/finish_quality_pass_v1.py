from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]

def edit(path, fn):
    p = ROOT / path
    s = p.read_text(encoding='utf-8')
    n = fn(s)
    if n != s:
        p.write_text(n, encoding='utf-8')
        print('updated', path)
    else:
        print('unchanged', path)

# Quick Create must use the canonical invoice editor, not the Sales hub.
def layout(s):
    s = s.replace("const createItems: NavItem[] = [['Invoice', '/next-workspace/sales'], ['Estimate', '/next-workspace/quotation'], ['Payment', '/next-workspace/payments'], ['Expense', '/next-workspace/expenses'], ['Customer', '/next-workspace/customers'], ['Vendor', '/next-workspace/vendors'], ['Product / Service', '/next-workspace/items'], ['New Business', '/next-workspace/create-business']];", "const createItems: NavItem[] = [['Invoice', '/next-workspace/invoices/new'], ['Estimate', '/next-workspace/quotation'], ['Payment', '/next-workspace/payments'], ['Expense', '/next-workspace/expenses'], ['Customer', '/next-workspace/customers'], ['Vendor', '/next-workspace/vendors'], ['Product / Service', '/next-workspace/items']];")
    return s
edit('app/next-workspace/layout.tsx', layout)

# The Tax centre is the single source of truth for business tax configuration.
def tax_page(s):
    s = s.replace("const defaults:TaxProfile={tax_regime:'none',gst_registration_type:'not_registered',gstin:null,pan:null,tax_id:null,tax_country:'India',tax_state:null,accounting_basis:'accrual',books_mode:'simple',presumptive_section:null,financial_year_start_month:4};", "const defaults:TaxProfile={tax_regime:'NONE',gst_registration_type:'NONE',gstin:null,pan:null,tax_id:null,tax_country:'India',tax_state:null,accounting_basis:'ACCRUAL',books_mode:'SIMPLE',presumptive_section:null,financial_year_start_month:4};")
    s = s.replace("[['none','No GST / VAT / sales tax'", "[['NONE','No GST / VAT / sales tax'")
    s = s.replace("['gst','GST registered'", "['GST','GST registered'")
    s = s.replace("['gst_composition','GST Composition'", "['GST_COMPOSITION','GST Composition'")
    s = s.replace("['vat','VAT'", "['VAT','VAT'")
    s = s.replace("['other','Other tax regime'", "['OTHER','Other tax regime'")
    s = s.replace("tax.tax_regime==='gst'", "tax.tax_regime==='GST'")
    s = s.replace("tax.tax_regime:v", "tax_regime:v") if False else s
    # Restore the actual state update expression with canonical DB values.
    s = s.replace("setTax(x=>({...x,tax_regime:v}))", "setTax(x=>({...x,tax_regime:v}))")
    s = s.replace("<div className=\"mt-4\"><label className=\"text-xs font-semibold\">GSTIN</label><input", "<div className=\"mt-4 grid gap-3 sm:grid-cols-2\"><label className=\"text-xs font-semibold\">GSTIN<input")
    s = s.replace("placeholder=\"15-character GSTIN\"/></div>", "placeholder=\"15-character GSTIN\"/></label><label className=\"text-xs font-semibold\">GST registration<select value={tax.gst_registration_type} onChange={e=>setTax(x=>({...x,gst_registration_type:e.target.value}))} className=\"mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm\"><option value=\"NONE\">Not registered</option><option value=\"REGULAR\">Regular</option><option value=\"COMPOSITION\">Composition</option><option value=\"CASUAL\">Casual</option><option value=\"NON_RESIDENT\">Non-resident</option><option value=\"SEZ\">SEZ</option></select></label><label className=\"text-xs font-semibold\">Tax state<input value={tax.tax_state||''} onChange={e=>setTax(x=>({...x,tax_state:e.target.value}))} className=\"mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm\" placeholder=\"Maharashtra\"/></label></div>")
    s = s.replace("<option value=\"accrual\">Accrual</option><option value=\"cash\">Cash</option>", "<option value=\"ACCRUAL\">Accrual</option><option value=\"CASH\">Cash</option>")
    s = s.replace("[['simple','Simple'", "[['SIMPLE','Simple'")
    s = s.replace("['complete','Complete'", "['FULL','Complete'")
    s = s.replace("['presumptive','Presumptive'", "['PRESUMPTIVE','Presumptive'")
    s = s.replace("v==='presumptive'?'44AD'", "v==='PRESUMPTIVE'?'44AD'")
    s = s.replace("tax.books_mode===v", "tax.books_mode===v")
    return s
edit('app/next-workspace/tax/page.tsx', tax_page)

# Quotation status transitions must use the guarded RPC; conversion must respect customer credit terms.
def quotation(s):
    s = s.replace("type Customer={id:string;display_name:string};", "type Customer={id:string;display_name:string;payment_terms_days:number};")
    s = s.replace("select('id,display_name').eq('business_id'", "select('id,display_name,payment_terms_days').eq('business_id'")
    s = s.replace("const setStatus=async(status:string)=>{if(!quote)return;setBusy(true);setError('');const r=await supabase.from('quotations').update({status}).eq('id',quote.id).eq('business_id',ctx?.business_id);", "const setStatus=async(status:string)=>{if(!quote)return;setBusy(true);setError('');const r=await supabase.rpc('set_quotation_status',{p_quotation_id:quote.id,p_status:status});")
    s = s.replace("const convert=async()=>{if(!quote)return;setBusy(true);setError('');const r=await supabase.rpc('convert_quotation_to_invoice',{p_quotation_id:quote.id,p_invoice_date:today()});", "const convert=async()=>{if(!quote)return;setBusy(true);setError('');const customerRow=customers.find(c=>c.id===quote.customer_id);const due=new Date(Date.now()+Math.max(0,Number(customerRow?.payment_terms_days||0))*86400000).toISOString().slice(0,10);const r=await supabase.rpc('convert_quotation_to_invoice',{p_quotation_id:quote.id,p_invoice_date:today(),p_due_date:due});")
    return s
edit('app/next-workspace/quotation/QuotationWorkspaceControlled.tsx', quotation)

# Invoice editor: make the workflow explicit and show customer contact information in the live summary.
def invoice(s):
    s = s.replace("type Customer = { id:string; display_name:string; legal_name:string|null; email:string|null; phone:string|null; payment_terms_days:number;", "type Customer = { id:string; display_name:string; legal_name:string|null; email:string|null; phone:string|null; website:string|null; payment_terms_days:number;")
    s = s.replace("select('id,display_name,legal_name,email,phone,payment_terms_days", "select('id,display_name,legal_name,email,phone,website,payment_terms_days")
    marker = "<header className=\"mb-5 flex flex-col gap-3 sm:flex-row sm:items-end\">"
    if marker in s and 'Invoice flow' not in s:
        s = s.replace(marker, marker, 1)
    s = s.replace("<p className=\"mt-1 text-sm text-slate-500\">{ruleLabel}</p></div>", "<p className=\"mt-1 text-sm text-slate-500\">{ruleLabel}</p><div className=\"mt-3 flex flex-wrap items-center gap-2 text-[11px] font-semibold text-slate-500\"><span className=\"rounded-full bg-violet-50 px-3 py-1 text-violet-700\">1 Customer</span><span>→</span><span className=\"rounded-full bg-violet-50 px-3 py-1 text-violet-700\">2 Items & tax</span><span>→</span><span className=\"rounded-full bg-violet-50 px-3 py-1 text-violet-700\">3 Review</span><span>→</span><span className=\"rounded-full bg-violet-50 px-3 py-1 text-violet-700\">4 Post</span></div></div>")
    s = s.replace("{customer.phone&&<div>{customer.phone}</div>}", "{customer.phone&&<div>{customer.phone}</div>}{customer.email&&<div>{customer.email}</div>}{customer.website&&<div>{customer.website}</div>}")
    s = s.replace("{busy?'Saving…':editId?'Save draft':'Save invoice'}", "{busy?'Saving…':editId?'Save draft & review':'Save draft & review'}")
    return s
edit('app/next-workspace/invoices/new/page.tsx', invoice)

print('quality pass complete')
