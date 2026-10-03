import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type CanonicalParty = {
  id: string;
  name: string;
  legalName: string | null;
  email: string | null;
  phone: string | null;
  taxId: string | null;
  address: { country_code: string; country_subdivision_code: string | null; locality: string | null; postal_code: string | null; address_line_1: string | null; address_line_2: string | null };
  endpointId: string | null;
  endpointScheme: string | null;
};
export type CanonicalInvoiceLine = {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  netAmount: number;
  taxAmount: number;
  lineTotal: number;
  unitCode: string | null;
  hsnSac: string | null;
  taxCode: string | null;
  taxCategory: string | null;
  taxRate: number | null;
  taxLines: Array<{taxCode:string;taxCategory:string;rate:number;taxableAmount:number;taxAmount:number;isReverseCharge:boolean}>;
};
export type CanonicalInvoice = {
  id: string;
  number: string;
  issueDate: string;
  dueDate: string | null;
  currencyCode: string;
  status: string;
  note: string | null;
  terms: string | null;
  buyerReference: string | null;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  amountPaid: number;
  balanceDue: number;
  businessId: string;
  supplier: CanonicalParty;
  customer: CanonicalParty;
  lines: CanonicalInvoiceLine[];
  taxLines: Array<{taxCode:string;taxCategory:string;rate:number;taxableAmount:number;taxAmount:number;isReverseCharge:boolean;invoiceItemId:string|null}>;
};

const admin = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth:{autoRefreshToken:false,persistSession:false} });
const text = (v: unknown) => String(v ?? '').trim();
const num = (v: unknown) => Number(v ?? 0);

function addressOf(value: any, fallbackCountry: string) {
  return {
    country_code: text(value?.country_code || fallbackCountry).toUpperCase(),
    country_subdivision_code: value?.country_subdivision_code ? text(value.country_subdivision_code).toUpperCase() : null,
    locality: value?.locality ? text(value.locality) : null,
    postal_code: value?.postal_code ? text(value.postal_code) : null,
    address_line_1: value?.address_line_1 ? text(value.address_line_1) : null,
    address_line_2: value?.address_line_2 ? text(value.address_line_2) : null,
  };
}

export async function loadCanonicalInvoice(db: SupabaseClient, invoiceId: string): Promise<CanonicalInvoice> {
  const { data: invoice, error: invoiceError } = await db.from('invoices').select('id,business_id,invoice_number,invoice_date,due_date,status,currency_code,notes,terms,buyer_reference,subtotal,discount_total,tax_total,total,amount_paid,balance_due,customer_id,journal_entry_id').eq('id',invoiceId).single();
  if (invoiceError || !invoice) throw new Error('Invoice not found.');
  if (!invoice.journal_entry_id) throw new Error('Only posted invoices can be exported as e-invoices.');

  const [{data:b,error:be},{data:c,error:ce},{data:items,error:ie},{data:taxLines,error:te}] = await Promise.all([
    db.from('businesses').select('id,name,legal_name,email,phone,tax_registration_number,address,address_iso,country_code,e_invoice_endpoint_id,e_invoice_endpoint_scheme').eq('id',invoice.business_id).single(),
    db.from('customers').select('id,display_name,legal_name,email,phone,tax_id,billing_address_iso,shipping_address_iso,e_invoice_endpoint_id,e_invoice_endpoint_scheme').eq('id',invoice.customer_id).eq('business_id',invoice.business_id).single(),
    db.from('invoice_items').select('id,description,quantity,unit_price,discount,tax_amount,line_total,hsn_sac,sort_order,product_service_id').eq('invoice_id',invoice.id).order('sort_order').order('id'),
    db.from('invoice_tax_lines').select('invoice_item_id,tax_code,tax_category,rate,taxable_amount,tax_amount,is_reverse_charge').eq('invoice_id',invoice.id).order('invoice_item_id'),
  ]);
  if (be || ce || ie || te || !b || !c || !items) throw new Error('Invoice canonicalization data is incomplete.');

  const lineTaxes = new Map<string, any[]>();
  for (const line of (taxLines || [])) { const key=String(line.invoice_item_id || ''); if(!lineTaxes.has(key)) lineTaxes.set(key,[]); lineTaxes.get(key)!.push(line); }
  const customerAddress = addressOf(c.shipping_address_iso || c.billing_address_iso, b.country_code);
  const supplierAddress = addressOf(b.address_iso, b.country_code);
  const supplierName=text(b.legal_name||b.name)||'Supplier';
  const customerName=text(c.legal_name||c.display_name)||'Customer';
  const supplier:CanonicalParty={id:b.id,name:supplierName,legalName:b.legal_name,email:b.email,phone:b.phone,taxId:b.tax_registration_number,address:supplierAddress,endpointId:b.e_invoice_endpoint_id,endpointScheme:b.e_invoice_endpoint_scheme};
  const customer:CanonicalParty={id:c.id,name:customerName,legalName:c.legal_name,email:c.email,phone:c.phone,taxId:c.tax_id,address:customerAddress,endpointId:c.e_invoice_endpoint_id,endpointScheme:c.e_invoice_endpoint_scheme};

  const lines=(items||[]).map((item:any)=>{
    const taxes=(lineTaxes.get(item.id)||[]).map((x:any)=>({taxCode:text(x.tax_code),taxCategory:text(x.tax_category),rate:num(x.rate),taxableAmount:num(x.taxable_amount),taxAmount:num(x.tax_amount),isReverseCharge:Boolean(x.is_reverse_charge)}));
    const first=taxes[0];
    const net=num(item.quantity)*num(item.unit_price)-num(item.discount);
    return {id:item.id,description:text(item.description)||'Item',quantity:num(item.quantity),unitPrice:num(item.unit_price),netAmount:Math.max(0,net),taxAmount:num(item.tax_amount),lineTotal:num(item.line_total),unitCode:null,hsnSac:item.hsn_sac?text(item.hsn_sac):null,taxCode:first?.taxCode||null,taxCategory:first?.taxCategory||null,taxRate:first?.rate??null,taxLines:taxes};
  });
  const flattened=(taxLines||[]).map((x:any)=>({taxCode:text(x.tax_code),taxCategory:text(x.tax_category),rate:num(x.rate),taxableAmount:num(x.taxable_amount),taxAmount:num(x.tax_amount),isReverseCharge:Boolean(x.is_reverse_charge),invoiceItemId:x.invoice_item_id?String(x.invoice_item_id):null}));

  return {id:String(invoice.id),number:text(invoice.invoice_number),issueDate:String(invoice.invoice_date),dueDate:invoice.due_date?String(invoice.due_date):null,currencyCode:text(invoice.currency_code).toUpperCase(),status:text(invoice.status),note:invoice.notes?text(invoice.notes):null,terms:invoice.terms?text(invoice.terms):null,buyerReference:invoice.buyer_reference?text(invoice.buyer_reference):null,subtotal:num(invoice.subtotal),discountTotal:num(invoice.discount_total),taxTotal:num(invoice.tax_total),total:num(invoice.total),amountPaid:num(invoice.amount_paid),balanceDue:num(invoice.balance_due),businessId:String(invoice.business_id),supplier,customer,lines,taxLines:flattened};
}

export function canonicalFromAdmin(invoiceId: string) { return loadCanonicalInvoice(admin(), invoiceId); }