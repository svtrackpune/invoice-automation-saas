export type ReportCategory='Financial & Accounting'|'Sales & Receivables'|'POS & Counter Operations'|'Tax & Statutory'|'Saved Custom Presets';
export type ReportId='sales-register'|'aging-summary'|'sales-by-item'|'customer-statement'|'daily-shift-settlement'|'tender-breakdown'|'tax-summary-by-slab'|'hsn-sac-breakdown';
export type ReportSource='invoices'|'aging'|'invoice_items'|'customer_statement'|'pos_payments'|'payments'|'tax_items';
export type GroupKey='none'|'customer'|'date'|'payment_mode'|'tax_slab';
export type StatusKey='all'|'draft'|'sent'|'partially_paid'|'paid'|'overdue'|'void'|'posted'|'invoice'|'payment'|'inbound'|'outbound';
export type ReportColumnKind='text'|'date'|'money'|'number'|'status';
export type ReportColumn={key:string;label:string;kind:ReportColumnKind;groupKey?:Exclude<GroupKey,'none'>};
export type ReportKpi={key:string;label:string;kind:'sum'|'avg'|'count';field?:string;format:'money'|'number'};
export type ReportTemplate={id:ReportId;category:Exclude<ReportCategory,'Financial & Accounting'|'Saved Custom Presets'>;title:string;description:string;tags:string[];source:ReportSource;dateField:string;allowedGroups:GroupKey[];statusOptions:StatusKey[];searchFields:string[];columns:ReportColumn[];kpis:ReportKpi[];statutory?:boolean};
export type ReportValue=string|number|null;
export type ReportDataRow={id:string;data:Record<string,ReportValue>;searchText:string};
export type ReportKpiValue={key:string;label:string;value:number;format:'money'|'number'};

export const REPORT_GROUP_OPTIONS:Array<{key:GroupKey;label:string}>=[
 {key:'none',label:'None'},{key:'customer',label:'Customer'},{key:'date',label:'Date'},{key:'payment_mode',label:'Payment Mode'},{key:'tax_slab',label:'Tax Slab'}
];
export const money=(value:number,currency='INR')=>new Intl.NumberFormat('en-IN',{style:'currency',currency:currency||'INR',maximumFractionDigits:2}).format(Number(value||0));
export const numberValue=(value:number)=>new Intl.NumberFormat('en-IN',{maximumFractionDigits:2}).format(Number(value||0));
export function aggregateRows(template:ReportTemplate,rows:ReportDataRow[],_currency:string):ReportKpiValue[]{return template.kpis.map(kpi=>{if(kpi.kind==='count')return{key:kpi.key,label:kpi.label,value:rows.length,format:kpi.format};const values=rows.map(r=>Number(kpi.field?r.data[kpi.field]||0:0));const total=values.reduce((s,v)=>s+v,0);return{key:kpi.key,label:kpi.label,value:kpi.kind==='avg'?(values.length?total/values.length:0):total,format:kpi.format};});}
export function statusLabel(value:string){return value.replaceAll('_',' ').replace(/\b\w/g,x=>x.toUpperCase());}
export function formatKpi(value:number,format:'money'|'number',currency:string){return format==='money'?money(value,currency):numberValue(value);}
export function escapeCsv(value:unknown){return '"'+String(value??'').replaceAll('"','""')+'"';}
export function fiscalYearStart(date:Date){return new Date(date.getFullYear()-(date.getMonth()<3?1:0),3,1);}
