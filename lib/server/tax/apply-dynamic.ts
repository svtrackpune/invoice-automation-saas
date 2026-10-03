import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeCanonicalAddress } from '@/lib/addresses';
import { DynamicTaxDeterminationProvider } from './dynamic-provider';
import type { TaxSystem } from './types';

type InputLine={
  product_service_id?:string|null; description:string; quantity:number; unit_price:number;
  discount_type?:'percentage'|'fixed'|'amount'|null; discount_value?:number; hsn_sac?:string|null; tax_rate_id?:string|null;
};
type AppliedLine=InputLine&{discount:number;tax_amount:number;tax_category:string;dynamic_tax_snapshot:any[];jurisdiction_id:string|null;tax_rule_id:string|null;source_provider:string};
const round2=(v:number)=>Math.round((v+Number.EPSILON)*100)/100;

function normalizeLineDiscount(line:InputLine,base:number){
  const value=Math.max(0,Number(line.discount_value||0));
  if((line.discount_type||null)==='percentage')return round2(base*Math.min(value,100)/100);
  return round2(Math.min(value,base));
}

function invoiceDiscount(lines:Array<{net:number}>,type:string|null|undefined,value:number){
  const total=lines.reduce((s,x)=>s+x.net,0);
  if(!type||value<=0||total<=0)return 0;
  if(type==='percentage')return round2(total*Math.min(value,100)/100);
  return round2(Math.min(value,total));
}

function allocateDiscount(totalDiscount:number,netValues:number,index:number){
  if(totalDiscount<=0||netValues.length===0)return 0;
  const total=netValues.reduce((s,x)=>s+x,0);
  if(index===netValues.length-1)return round2(Math.max(0,totalDiscount-netValues.slice(0,-1).reduce((s,x,j)=>s+round2(totalDiscount*x/total),0)));
  return round2(totalDiscount*netValues[index]/total);
}

export async function applyDynamicTax(params:{
  db:SupabaseClient;
  businessId:string;
  customerId:string;
  invoiceDate:string;
  currencyCode:string;
  items:InputLine[];
  invoiceDiscountType?:string|null;
  invoiceDiscountValue?:number;
  taxSystem?:TaxSystem|null;
}){
  const {data:b,error:be}=await params.db.from('businesses').select('id,country_code,address_iso,legal_name,name,base_currency_code').eq('id',params.businessId).single();
  if(be||!b)throw new Error('Business not found.');
  const {data:c,error:ce}=await params.db.from('customers').select('id,tax_id,billing_address_iso,shipping_address_iso').eq('id',params.customerId).eq('business_id',params.businessId).eq('is_active',true).single();
  if(ce||!c)throw new Error('Customer not found or inactive.');
  const supplierAddress=normalizeCanonicalAddress((b.address_iso||{}) as Record<string,unknown>,b.country_code);
  const buyerAddress=normalizeCanonicalAddress((c.shipping_address_iso||c.billing_address_iso||{}) as Record<string,unknown>,b.country_code);
  const netValues=params.items.map((line)=>{const base=round2(line.quantity*line.unit_price);return Math.max(0,round2(base-normalizeLineDiscount(line,base)));});
  const totalInvoiceDiscount=invoiceDiscount(netValues.map(net=>({net})),params.invoiceDiscountType,Number(params.invoiceDiscountValue||0));
  const finalDiscounts:number[]=[];const finalNet:number[]=[];
  for(let i=0;i<params.items.length;i++){const base=round2(params.items[i].quantity*params.items[i].unit_price);const lineDisc=normalizeLineDiscount(params.items[i],base);const allocated=allocateDiscount(totalInvoiceDiscount,netValues,i);finalDiscounts.push(round2(lineDisc+allocated));finalNet.push(Math.max(0,round2(base-lineDisc-allocated)));}
  const provider=new DynamicTaxDeterminationProvider(params.db);
  const supplierTax=await params.db.from('business_tax_registrations').select('registration_number,tax_system').eq('business_id',params.businessId).eq('is_primary',true).limit(1).maybeSingle();
  const taxResult=await provider.calculateTaxes({businessId:params.businessId,invoiceDate:params.invoiceDate,supplierAddress,buyerAddress,supplierTaxId:supplierTax.data?.registration_number||null,buyerTaxId:c.tax_id||null,taxSystem:params.taxSystem||null,currencyCode:params.currencyCode,lines:params.items.map((line,i)=>({invoiceItemId:String(i),taxCode:line.tax_rate_id||null,netAmount:finalNet[i]}))});
  const byLine=new Map<string,any[]>();
  for(const line of taxResult.lines){if(!byLine.has(line.invoiceItemId))byLine.set(line.invoiceItemId,[]);byLine.get(line.invoiceItemId)!.push(line);}
  const applied:AppliedLine[]=params.items.map((line,i)=>{
    const taxes=byLine.get(String(i))||[];const taxAmount=round2(taxes.reduce((s,x)=>s+x.taxAmount,0));
    const first=taxes[0];
    return {...line,discount:finalDiscounts[i],tax_amount:taxAmount,tax_category:first?.taxCategory||'STANDARD',dynamic_tax_snapshot:taxes,jurisdiction_id:first?.jurisdictionId||null,tax_rule_id:first?.taxRuleId||null,source_provider:provider.name,discount_type:finalDiscounts[i]>0?'fixed':null};
  });
  return {items:applied,totalTax:round2(taxResult.totalTax),supplierAddress,buyerAddress,provider:provider.name};
}