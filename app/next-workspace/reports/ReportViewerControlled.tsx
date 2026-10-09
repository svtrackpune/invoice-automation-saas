'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { supabase, type BusinessContext } from '@/lib/supabase';
import { PageHeader } from '@/components/ui/finops/PageHeader';
import { StatCard } from '@/components/ui/finops/StatCard';
import { aggregateRows, escapeCsv, fiscalYearStart, formatKpi, money, numberValue, REPORT_GROUP_OPTIONS, statusLabel, type GroupKey, type ReportColumn, type ReportDataRow, type ReportId, type ReportTemplate, type StatusKey } from '@/lib/reports/report-definitions';
import { REPORT_TEMPLATE_MAP } from '@/lib/reports/report-definitions-catalog';

type RangeKey='today'|'week'|'mtd'|'qtd'|'fytd'|'custom';
type Props={reportId:ReportId;initialFrom?:string;initialTo?:string;initialGroup?:GroupKey;initialStatus?:StatusKey;initialQuery?:string;onBack:()=>void};
type Customer={id:string;display_name:string};
type Invoice={id:string;invoice_number:string;invoice_date:string;due_date:string;status:string;currency_code:string;subtotal:number;tax_total:number;total:number;amount_paid:number;balance_due:number;customer_id:string};
type Payment={id:string;payment_date:string;amount:number;direction:string;method:string;reference:string|null;invoice_id:string|null;customer_id:string|null;currency_code:string};
type InvoiceItem={id:string;invoice_id:string;product_service_id:string|null;description:string;quantity:number;unit_price:number;discount:number;tax_amount:number;line_total:number;tax_rate_id:string|null;hsn_sac:string|null};
type TaxRate={id:string;name:string;rate:number};
type Product={id:string;name:string;sku:string|null;hsn_sac:string|null};
type Period={period_start:string;period_end:string;status:string};

const pad=(value:number)=>String(value).padStart(2,'0');
const toDate=(d:Date)=>d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
const today=()=>toDate(new Date());
const startOfWeek=()=>{const d=new Date();const day=(d.getDay()+6)%7;d.setDate(d.getDate()-day);return toDate(d)};
const startOfMonth=()=>{const d=new Date();return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-01'};
const startOfQuarter=()=>{const d=new Date();const fiscalMonth=(d.getMonth()+9)%12;const quarterStart=(Math.floor(fiscalMonth/3)*3+3)%12;const year=d.getMonth()>=3?d.getFullYear():d.getFullYear()-1;const actualYear=year+(quarterStart===0&&d.getMonth()<3?1:0);return actualYear+'-'+pad(quarterStart+1)+'-01'};
const startFor=(range:RangeKey)=>{const d=new Date();if(range==='today')return toDate(d);if(range==='week')return startOfWeek();if(range==='mtd')return startOfMonth();if(range==='qtd')return startOfQuarter();if(range==='fytd')return toDate(fiscalYearStart(d));return startOfMonth()};
const customersMap=(rows:Customer[])=>new Map(rows.map(x=>[x.id,x.display_name]));
const taxesMap=(rows:TaxRate[])=>new Map(rows.map(x=>[x.id,x]));
const invoiceStatus=(status:string,balance:number,due:string)=>{if(balance<=0)return'paid';if(status==='draft'||status==='void')return status;if(new Date(due+'T23:59:59')<new Date())return'overdue';return status};
const searchText=(data:Record<string,unknown>)=>Object.values(data).map(x=>String(x??'')).join(' ').toLowerCase();

export default function ReportViewerControlled(p:Props){
 const template=REPORT_TEMPLATE_MAP.get(p.reportId) as ReportTemplate;
 const[ctx,setCtx]=useState<BusinessContext|null>(null),[rows,setRows]=useState<ReportDataRow[]>([]),[periods,setPeriods]=useState<Period[]>([]);
 const[range,setRange]=useState<RangeKey>(p.initialFrom?'custom':'mtd'),[from,setFrom]=useState(p.initialFrom||startFor('mtd')),[to,setTo]=useState(p.initialTo||today());
 const[groupBy,setGroupBy]=useState<GroupKey>(p.initialGroup||'none'),[status,setStatus]=useState<StatusKey>(p.initialStatus||'all'),[q,setQ]=useState(p.initialQuery||'');
 const[loading,setLoading]=useState(true),[error,setError]=useState(''),[saving,setSaving]=useState(false),[collapsed,setCollapsed]=useState<Record<string,boolean>>({});
 useEffect(()=>{if(range!=='custom'){setFrom(startFor(range));setTo(today())}},[range]);

 useEffect(()=>{
  let active=true;
  const load=async()=>{
   setLoading(true);setError('');
   const c=await supabase.rpc('get_my_business_context');const business=c.data?.[0] as BusinessContext|undefined;
   if(!business){p.onBack();return}if(!active)return;setCtx(business);
   const periodResult=await supabase.from('accounting_periods').select('period_start,period_end,status').eq('business_id',business.business_id).order('period_end',{ascending:false}).limit(24);
   if(active)setPeriods((periodResult.data||[]) as Period[]);
   try{const data=await fetchRows(template,business.business_id,from,to,business.currency_code);if(active)setRows(data)}
   catch(e){if(active)setError(e instanceof Error?e.message:'Unable to load report data.')}
   if(active)setLoading(false);
  };
  void load();return()=>{active=false};
 },[p.reportId,from,to]);

 const groupSupported=useMemo(()=>new Set(template.allowedGroups),[template]);
 const filtered=useMemo(()=>{const query=q.trim().toLowerCase();return rows.filter(row=>{const data=row.data;const statusValue=String(data.status_key||data.status||data.direction||data.type||'');return (status==='all'||statusValue===status)&&(!query||row.searchText.includes(query));})},[rows,q,status]);
 const grouped=useMemo(()=>{
   if(groupBy==='none'||!groupSupported.has(groupBy))return[{key:'__all',label:'All records',rows:filtered}];
   const field=groupField(groupBy,template);if(!field)return[{key:'__all',label:'All records',rows:filtered}];
   const map=new Map<string,ReportDataRow[]>();filtered.forEach(row=>{const label=String(row.data[field]??'Unassigned')||'Unassigned';if(!map.has(label))map.set(label,[]);map.get(label)!.push(row)});
   return [...map.entries()].sort((a,b)=>a[0].localeCompare(b[0],undefined,{numeric:true,sensitivity:'base'})).map(([label,groupRows])=>({key:label,label,rows:groupRows}));
 },[filtered,groupBy,groupSupported,template]);
 const kpis=useMemo(()=>aggregateRows(template,filtered,ctx?.currency_code||'INR'),[template,filtered,ctx?.currency_code]);
 const lockedPeriods=useMemo(()=>periods.filter(x=>x.status==='closed'||x.status==='locked').filter(x=>x.period_start<=to&&x.period_end>=from),[periods,from,to]);
 const activeGroup=groupBy!=='none'&&groupSupported.has(groupBy);

 const exportCsv=()=>{
   const columns=template.columns;
   const header=(activeGroup?['Group',...columns.map(x=>x.label)]:columns.map(x=>x.label)).map(escapeCsv).join(',');
   const dataRows=activeGroup?grouped.flatMap(g=>g.rows.map(row=>[g.label,...columns.map(c=>csvValue(row.data[c.key],c.kind))])):filtered.map(row=>columns.map(c=>csvValue(row.data[c.key],c.kind)));
   const csv=[header,...dataRows.map(row=>row.map(escapeCsv).join(','))].join('\n');
   const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='moneymatters-'+p.reportId+'-'+from+'-'+to+'.csv';a.click();URL.revokeObjectURL(url);
 };
 const saveView=()=>{
   const name=window.prompt('Name this report view');if(!name?.trim()||!ctx)return;
   setSaving(true);const key='moneymatters.report.presets';let current:unknown[]=[];try{current=JSON.parse(localStorage.getItem(key)||'[]')}catch{current=[]}
   const preset={id:crypto.randomUUID(),name:name.trim(),reportId:p.reportId,from,to,range,groupBy,status,q,businessId:ctx.business_id,createdAt:new Date().toISOString()};localStorage.setItem(key,JSON.stringify([preset,...current].slice(0,20)));window.dispatchEvent(new CustomEvent('moneymatters:report-presets-updated'));setSaving(false);
 };
 if(loading||!ctx)return <div className="grid min-h-[70vh] place-items-center bg-slate-50 text-sm text-slate-500">Loading {template.title}…</div>;
 return <main className="report-studio-page min-h-[calc(100vh-100px)] bg-slate-50 p-3 text-slate-950 sm:p-6 lg:p-7">
  <style>{'@media print{.report-print-hide{display:none!important}.report-studio-page{background:#fff!important;padding:0!important}.report-print-canvas{box-shadow:none!important;border:0!important}.report-print-table{font-size:9px!important}.report-print-table th,.report-print-table td{padding:4px 6px!important}}'}</style>
  <div className="mx-auto max-w-[1500px]">
   <PageHeader className="report-print-hide" breadcrumbs={[{label:'Workspace',href:'/next-workspace'},{label:'Reports & compliance',href:'/next-workspace/reports'},{label:ctx.business_name},{label:template.title}]} title={template.title} subtitle={template.description} badge={template.statutory?{label:'Statutory-ready view',variant:'statutory'}:{label:ctx.business_name,variant:'neutral'}} actions={<div className="flex flex-wrap items-center gap-2"><button type="button" onClick={p.onBack} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold">← Reports</button><button type="button" onClick={exportCsv} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold">Export CSV</button><button type="button" onClick={()=>window.print()} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold">Print / PDF</button><button type="button" disabled={saving} onClick={saveView} className="rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white">Save View</button></div>}/>

   <section className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{kpis.map(k=><StatCard key={k.key} title={k.label} value={formatKpi(k.value,k.format,ctx.currency_code||'INR')} tone="neutral" className="min-h-[104px] p-4"><span className="text-[10px] text-finops-neutral-muted">{filtered.length} filtered record{filtered.length===1?'':'s'}</span></StatCard>)}</section>

   <section className="report-print-hide mt-4 rounded-xl border border-slate-200/80 bg-white p-2.5 shadow-[0_1px_2px_rgba(15,23,42,.02)]"><div className="flex flex-wrap items-center gap-1">{(['today','week','mtd','qtd','fytd'] as RangeKey[]).map(x=><button key={x} type="button" onClick={()=>{setRange(x);setCollapsed({})}} className={'rounded-md px-2.5 py-1.5 text-[11px] font-semibold '+(range===x?'bg-slate-900 text-white':'text-slate-600 hover:bg-slate-100')}>{x==='today'?'Today':x==='week'?'This Week':x==='mtd'?'MTD':x==='qtd'?'QTD':'FYTD'}</button>)}<button type="button" onClick={()=>setRange('custom')} className={'rounded-md px-2.5 py-1.5 text-[11px] font-semibold '+(range==='custom'?'bg-slate-900 text-white':'text-slate-600 hover:bg-slate-100')}>Custom Range</button></div>
    <div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-[150px_150px_minmax(220px,1fr)_150px_170px]"><label className="text-[9px] font-bold uppercase tracking-wider text-slate-400">From<input type="date" value={from} onChange={e=>{setRange('custom');setFrom(e.target.value)}} className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-xs text-slate-800"/></label><label className="text-[9px] font-bold uppercase tracking-wider text-slate-400">To<input type="date" value={to} onChange={e=>{setRange('custom');setTo(e.target.value)}} className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-xs text-slate-800"/></label><label className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Search<input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search current result set…" className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-3 text-xs text-slate-800"/></label><label className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Group By<select value={groupBy} onChange={e=>{setGroupBy(e.target.value as GroupKey);setCollapsed({})}} className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs">{REPORT_GROUP_OPTIONS.map(x=><option key={x.key} value={x.key} disabled={!groupSupported.has(x.key)}>{x.label}{!groupSupported.has(x.key)?' · N/A':''}</option>)}</select></label><label className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Status<select value={status} onChange={e=>setStatus(e.target.value as StatusKey)} className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs">{template.statusOptions.map(x=><option key={x} value={x}>{x==='all'?'All':statusLabel(x)}</option>)}</select></label></div>
   </section>
   {lockedPeriods.length>0&&<div className="report-print-hide mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800"><b>Period control:</b> this range overlaps {lockedPeriods.length} closed/locked accounting period{lockedPeriods.length===1?'':'s'}. Historical data is read-only.</div>}
   {error&&<div className="report-print-hide mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-700">{error}</div>}
   <section className="report-print-canvas mt-4 overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,.03)]"><div className="report-print-hide flex items-center justify-between border-b border-slate-100 px-4 py-3"><div><h2 className="text-sm font-semibold">{template.title}</h2><p className="mt-0.5 text-[10px] text-slate-400">{from} → {to} · {groupBy==='none'?'No grouping':'Grouped by '+REPORT_GROUP_OPTIONS.find(x=>x.key===groupBy)?.label}</p></div><span className="text-[10px] font-semibold text-slate-400">{filtered.length} rows</span></div>
    <div className="overflow-x-auto"><table className="report-print-table w-full min-w-[980px] text-left text-xs"><thead className="border-b border-slate-100 bg-slate-50/80 text-[9px] font-bold uppercase tracking-wider text-slate-500"><tr>{activeGroup&&<th className="px-3 py-2.5">Group</th>}{template.columns.map(col=><th key={col.key} className={'px-3 py-2.5 '+(col.kind==='money'||col.kind==='number'?'text-right':'')}>{col.label}</th>)}</tr></thead><tbody>
      {grouped.map(group=>{const isCollapsed=Boolean(collapsed[group.key]);const groupKpis=aggregateRows(template,group.rows,ctx.currency_code||'INR');return <Fragment key={group.key}>{activeGroup&&<tr className="bg-slate-50/70"><td className="px-3 py-2" colSpan={template.columns.length+1}><button type="button" onClick={()=>setCollapsed(v=>({...v,[group.key]:!v[group.key]}))} className="flex w-full items-center gap-2 text-left"><span className="grid h-5 w-5 place-items-center rounded border border-slate-200 bg-white text-[10px]">{isCollapsed?'›':'⌄'}</span><span className="font-semibold">{group.label}</span><span className="text-[10px] text-slate-400">{group.rows.length} rows · {groupKpis.filter(x=>x.format==='money').slice(0,1).map(x=>formatKpi(x.value,x.format,ctx.currency_code||'INR'))}</span></button></td></tr>}{!isCollapsed&&group.rows.map(row=><tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50">{activeGroup&&<td className="px-3 py-2 text-[10px] text-slate-400">{group.label}</td>}{template.columns.map(col=><td key={col.key} className={'px-3 py-2 '+cellClass(col)}>{renderCell(row.data[col.key],col,ctx.currency_code||'INR')}</td>)}</tr>)}{!isCollapsed&&activeGroup&&<tr className="border-b border-slate-200 bg-slate-50 font-semibold">{activeGroup&&<td className="px-3 py-2 text-[10px] text-slate-400">Subtotal</td>}{template.columns.map(col=><td key={col.key} className={'px-3 py-2 '+cellClass(col)}>{subtotalCell(col,group.rows,ctx.currency_code||'INR')}</td>)}</tr>}</Fragment>})}
      {!filtered.length&&<tr><td colSpan={template.columns.length+(activeGroup?1:0)} className="p-12 text-center text-sm text-slate-500">No records match the selected filters.</td></tr>}
    </tbody></table></div><div className="report-print-hide border-t border-slate-100 px-4 py-2.5 text-[10px] text-slate-400">Business: {ctx.business_name} · Currency: {ctx.currency_code} · Report range: {from} to {to}</div>
   </section>
  </div>
 </main>;
}

async function fetchRows(template:ReportTemplate,businessId:string,from:string,to:string,currency:string):Promise<ReportDataRow[]>{
 const customerResult=await supabase.from('customers').select('id,display_name').eq('business_id',businessId).eq('is_active',true).order('display_name').limit(5000);
 if(customerResult.error)throw new Error(customerResult.error.message);const customers=customerResult.data as Customer[];const customersById=customersMap(customers);

 if(template.source==='invoices'||template.source==='aging'){
  const result=await supabase.from('invoices').select('id,invoice_number,invoice_date,due_date,status,currency_code,subtotal,tax_total,total,amount_paid,balance_due,customer_id').eq('business_id',businessId).order('invoice_date',{ascending:false}).limit(5000);
  if(result.error)throw new Error(result.error.message);const invoices=result.data as Invoice[];
  return invoices.filter(i=>i.currency_code===currency).filter(i=>template.source==='aging'?i.invoice_date<=to:i.invoice_date>=from&&i.invoice_date<=to).filter(i=>template.source==='aging'?Number(i.balance_due)>0&&!['draft','void'].includes(i.status):true).map(i=>{
   const statusKey=invoiceStatus(i.status,Number(i.balance_due),i.due_date);
   if(template.source==='aging'){const daysOverdue=Math.max(0,Math.floor((new Date(to+'T23:59:59').getTime()-new Date(i.due_date+'T23:59:59').getTime())/86400000));const bucket=daysOverdue<=0?'Current':daysOverdue<=30?'1–30':daysOverdue<=60?'31–60':daysOverdue<=90?'61–90':'90+';const data={invoice_number:i.invoice_number,customer:customersById.get(i.customer_id)||'Unknown customer',invoice_date:i.invoice_date,due_date:i.due_date,bucket,total:Number(i.total||0),balance:Number(i.balance_due||0),days_overdue:daysOverdue,overdue:daysOverdue>0?Number(i.balance_due||0):0,status:statusKey,status_key:statusKey};return{id:i.id,data,searchText:searchText(data)}}
   const data={invoice_number:i.invoice_number,invoice_date:i.invoice_date,customer:customersById.get(i.customer_id)||'Unknown customer',status:statusKey,status_key:statusKey,subtotal:Number(i.subtotal||0),tax:Number(i.tax_total||0),total:Number(i.total||0),balance:Number(i.balance_due||0)};return{id:i.id,data,searchText:searchText(data)};
  });
 }

 const paymentResult=await supabase.from('payments').select('id,payment_date,amount,direction,method,reference,invoice_id,customer_id,currency_code').eq('business_id',businessId).order('payment_date',{ascending:false}).limit(5000);
 if(paymentResult.error)throw new Error(paymentResult.error.message);const payments=paymentResult.data as Payment[];
 if(template.source==='payments'){
  return payments.filter(x=>x.currency_code===currency&&x.payment_date>=from&&x.payment_date<=to).map(x=>{const direction=String(x.direction);const amount=Number(x.amount||0);const data={payment_date:x.payment_date,customer:customersById.get(x.customer_id||'')||'Unassigned',direction,method:String(x.method).replaceAll('_',' '),reference:x.reference||'—',amount,inbound_amount:['in','inbound'].includes(direction)?amount:0,outbound_amount:['out','outbound'].includes(direction)?amount:0,net:['out','outbound'].includes(direction)?-amount:amount,status:direction,status_key:direction};return{id:x.id,data,searchText:searchText(data)}})
 }
 if(template.source==='pos_payments'){
  const invoiceIds=payments.map(x=>x.invoice_id).filter(Boolean) as string[];let invoiceById=new Map<string,{invoice_number:string;document_kind:string}>();
  if(invoiceIds.length){const inv=await supabase.from('invoices').select('id,invoice_number,document_kind').eq('business_id',businessId).in('id',invoiceIds);if(inv.error)throw new Error(inv.error.message);invoiceById=new Map((inv.data||[]).map((x:any)=>[x.id,x]));}
  return payments.filter(x=>x.currency_code===currency&&x.payment_date>=from&&x.payment_date<=to&&['in','inbound'].includes(String(x.direction))).filter(x=>invoiceById.get(x.invoice_id||'')?.document_kind==='cash_bill').map(x=>{const method=String(x.method);const amount=Number(x.amount||0);const data={payment_date:x.payment_date,invoice_number:invoiceById.get(x.invoice_id||'')?.invoice_number||'Cash Bill',customer:customersById.get(x.customer_id||'')||'Walk-in',method:method.replaceAll('_',' '),reference:x.reference||'—',amount,cash_amount:method==='cash'?amount:0,upi_amount:method==='upi'?amount:0,direction:'inbound',status:'inbound',status_key:'inbound'};return{id:x.id,data,searchText:searchText(data)}})
 }
 if(template.source==='customer_statement'){
  const invoiceResult=await supabase.from('invoices').select('id,invoice_number,invoice_date,total,balance_due,status,customer_id,currency_code').eq('business_id',businessId).eq('currency_code',currency).gte('invoice_date',from).lte('invoice_date',to).order('invoice_date');
  if(invoiceResult.error)throw new Error(invoiceResult.error.message);
  const invoiceRows=(invoiceResult.data||[]).map((i:any)=>{const data={date:i.invoice_date,customer:customersById.get(i.customer_id)||'Unknown customer',type:'invoice',document:i.invoice_number,debit:Number(i.total||0),credit:0,net:Number(i.total||0),reference:i.invoice_number,status:'invoice',status_key:'invoice'};return{id:'invoice-'+i.id,data,searchText:searchText(data)}});
  const payRows=payments.filter(x=>x.currency_code===currency&&x.payment_date>=from&&x.payment_date<=to&&x.customer_id).map(x=>{const data={date:x.payment_date,customer:customersById.get(x.customer_id||'')||'Unknown customer',type:'payment',document:x.invoice_id||'Payment',debit:0,credit:Number(x.amount||0),net:-Number(x.amount||0),reference:x.reference||'—',method:String(x.method).replaceAll('_',' '),status:'payment',status_key:'payment'};return{id:'payment-'+x.id,data,searchText:searchText(data)}});
  return [...invoiceRows,...payRows].sort((a,b)=>String(a.data.date).localeCompare(String(b.data.date))||a.id.localeCompare(b.id));
 }

 const itemResult=await supabase.from('invoice_items').select('id,invoice_id,product_service_id,description,quantity,unit_price,discount,tax_amount,line_total,tax_rate_id,hsn_sac').order('sort_order').limit(10000);
 if(itemResult.error)throw new Error(itemResult.error.message);const itemRows=itemResult.data as InvoiceItem[];const itemInvoiceIds=[...new Set(itemRows.map(x=>x.invoice_id))];if(!itemInvoiceIds.length)return[];
 const invResult=await supabase.from('invoices').select('id,invoice_number,invoice_date,status,currency_code,customer_id').eq('business_id',businessId).in('id',itemInvoiceIds).limit(10000);
 if(invResult.error)throw new Error(invResult.error.message);const invById=new Map((invResult.data||[]).map((x:any)=>[x.id,x]));
 const productIds=[...new Set(itemRows.map(x=>x.product_service_id).filter(Boolean) as string[])];const productResult=productIds.length?await supabase.from('products_services').select('id,name,sku,hsn_sac').eq('business_id',businessId).in('id',productIds).limit(10000):{data:[],error:null};if(productResult.error)throw new Error(productResult.error.message);const productById=new Map((productResult.data||[]).map((x:any)=>[x.id,x as Product]));
 const taxIds=[...new Set(itemRows.map(x=>x.tax_rate_id).filter(Boolean) as string[])];const taxResult=taxIds.length?await supabase.from('tax_rates').select('id,name,rate').eq('business_id',businessId).in('id',taxIds):{data:[],error:null};if(taxResult.error)throw new Error(taxResult.error.message);const taxById=taxesMap((taxResult.data||[]) as TaxRate[]);
 return itemRows.flatMap(item=>{const inv:any=invById.get(item.invoice_id);if(!inv||inv.currency_code!==currency||inv.invoice_date<from||inv.invoice_date>to||['draft','void'].includes(inv.status))return[];const product=productById.get(item.product_service_id||'');const tax=taxById.get(item.tax_rate_id||'');const taxValue=Number(item.tax_amount||0);const gross=Number(item.line_total||0);const taxable=Math.max(0,gross-taxValue);const slab=Number(tax?.rate||0)?Number(tax?.rate)+'%':'Exempt/0%';const data={invoice_date:inv.invoice_date,invoice_number:inv.invoice_number,item:product?.name||item.description,sku:product?.sku||'—',customer:customersById.get(inv.customer_id)||'Unknown customer',quantity:Number(item.quantity||0),net:taxable,taxable,tax:taxValue,total:gross,tax_slab:slab,tax_name:tax?.name||'No tax',hsn_sac:item.hsn_sac||product?.hsn_sac||'—',status:'posted',status_key:'posted'};return[{id:item.id,data,searchText:searchText(data)}]});
}

function groupField(group:GroupKey,template:ReportTemplate){const map:Record<string,string|undefined>={customer:'customer',date:template.dateField,payment_mode:'method',tax_slab:'tax_slab'};const preferred=map[group];return preferred&&template.columns.some(c=>c.key===preferred)?preferred:template.columns.find(c=>c.groupKey===group)?.key}
function csvValue(value:unknown,kind:ReportColumn['kind']){if(value===null||value===undefined)return'';if(kind==='money'||kind==='number')return String(Number(value)||0);return String(value)}
function cellClass(column:ReportColumn){return column.kind==='money'||column.kind==='number'?'font-mono tabular-nums text-right':column.kind==='date'?'font-mono text-[11px] text-slate-500':column.kind==='status'?'font-semibold text-slate-700':''}
function renderCell(value:unknown,column:ReportColumn,currency:string){if(column.kind==='money')return money(Number(value||0),currency);if(column.kind==='number')return numberValue(Number(value||0));if(column.kind==='status')return statusLabel(String(value||'—'));return String(value??'—')}
function subtotalCell(column:ReportColumn,rows:ReportDataRow[],currency:string){if(column.kind==='money')return money(rows.reduce((n,r)=>n+Number(r.data[column.key]||0),0),currency);if(column.kind==='number')return numberValue(rows.reduce((n,r)=>n+Number(r.data[column.key]||0),0));return column.key==='customer'||column.key==='method'||column.key==='tax_slab'?'Subtotal':''}
