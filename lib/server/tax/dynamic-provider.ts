import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { TaxCalculationParams, TaxCalculationResult, TaxDeterminationProvider, TaxCalculationLineResult, TaxCategory, TaxSystem, CanonicalAddress } from './types';

const EU_MEMBER_STATES=new Set(['AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE']);
const round2=(v:number)=>Math.round((Number(v)+Number.EPSILON)*100)/100;
const asArray=(v:unknown):string[]=>Array.isArray(v)?v.map(String):[];
const has=(v:unknown,expected:string)=>asArray(v).some(x=>x.toUpperCase()===expected.toUpperCase());
const validVat=(id:string|null|undefined,country:string)=>Boolean(id&&new RegExp('^'+country+'[A-Z0-9]{2,14}$','i').test(id.replace(/[^A-Za-z0-9]/g,'').trim()));
const VIES_ENDPOINT='https://ec.europa.eu/taxation_customs/vies/services/checkVatService';
const viesCache=new Map<string,{valid:boolean;expiresAt:number}>();

async function validateVatWithVies(id:string|null|undefined,country:string):Promise<boolean>{
  const sanitized=(id||'').replace(/[^A-Za-z0-9]/g,'').toUpperCase();
  if(!validVat(sanitized,country))return false;
  const number=sanitized.slice(country.length);
  const key=country+':'+number;
  const cached=viesCache.get(key);
  if(cached&&cached.expiresAt>Date.now())return cached.valid;
  const envelope='<?xml version="1.0" encoding="UTF-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><checkVat xmlns="urn:ec.europa.eu:taxud:vies:services:checkVat:types"><countryCode>'+country+'</countryCode><vatNumber>'+number+'</vatNumber></checkVat></soap:Body></soap:Envelope>';
  try{
    const response=await fetch(VIES_ENDPOINT,{method:'POST',headers:{'Content-Type':'text/xml; charset=utf-8','SOAPAction':'""'},body:envelope,signal:AbortSignal.timeout(5000)});
    if(!response.ok)return false;
    const xml=await response.text();
    const match=xml.match(/<[^>]*valid[^>]*>\s*(true|false)\s*<\/[^>]*valid\s*>/i);
    const valid=Boolean(match&&match[1].toLowerCase()==='true');
    viesCache.set(key,{valid,expiresAt:Date.now()+5*60*1000});
    return valid;
  }catch{return false;}
}

type Rule={id:string;business_id:string|null;jurisdiction_id:string;tax_system:string;tax_code:string;name:string;tax_category:TaxCategory;effective_from:string;effective_to:string|null;is_active:boolean;metadata:Record<string,unknown>};
type Jurisdiction={id:string;country_code:string;subdivision_code:string|null;jurisdiction_type:string;name:string};
type Component={id:string;tax_rule_id:string;tax_code:string;rate:number;sequence:number;calculation_basis:'net'|'gross_plus_previous';compound_on_component_id:string|null;metadata:Record<string,unknown>};

function ruleScore(rule:Rule,j:Jurisdiction,buyer:CanonicalAddress,seller:CanonicalAddress,lineTaxCode:string|null,buyerTaxId:string|null|undefined){
  const m=rule.metadata||{};
  const countryList=asArray(m.country_codes||m.buyer_country_codes);
  if(countryList.length&&!has(countryList,buyer.country_code))return -Infinity;
  const sellerList=asArray(m.seller_country_codes);
  if(sellerList.length&&!has(sellerList,seller.country_code))return -Infinity;
  const subs=asArray(m.subdivision_codes||m.buyer_subdivision_codes);
  if(subs.length&&(!buyer.country_subdivision_code||!has(subs,buyer.country_subdivision_code)))return -Infinity;
  const postalPrefixes=asArray(m.postal_prefixes);
  if(postalPrefixes.length&&(!buyer.postal_code||!postalPrefixes.some(x=>buyer.postal_code!.toUpperCase().startsWith(x.toUpperCase()))))return -Infinity;
  const localities=asArray(m.localities||m.cities||m.buyer_localities);
  if(localities.length&&(!buyer.locality||!localities.some(x=>x.toUpperCase()===buyer.locality!.toUpperCase())))return -Infinity;
  if(Boolean(m.requires_buyer_tax_id)&&!buyerTaxId)return -Infinity;
  let score=rule.business_id?100:0;
  if(j.country_code!==buyer.country_code)return -Infinity;
  score+=40;
  if(j.subdivision_code&&buyer.country_subdivision_code===j.subdivision_code)score+=50;
  if(lineTaxCode&&rule.tax_code===lineTaxCode)score+=25;
  if(m.priority!==undefined)score+=Number(m.priority)||0;
  return score;
}

const admin=()=>createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{autoRefreshToken:false,persistSession:false}});

export class DynamicTaxDeterminationProvider implements TaxDeterminationProvider{
  readonly name='moneymatters.dynamic-tax-v1';
  constructor(private readonly db:SupabaseClient=admin()){}
  async calculateTaxes(params:TaxCalculationParams):Promise<TaxCalculationResult>{
    if(!params.businessId)throw new Error('Tax calculation business context is required.');
    if(!params.lines.length)return {lines:[],totalTax:0};
    const system=inferSystem(params.buyerAddress.country_code,params.supplierAddress.country_code,params.taxSystem);
    const buyerVatValid=system==='VAT'&&EU_MEMBER_STATES.has(params.buyerAddress.country_code)?await validateVatWithVies(params.buyerTaxId,params.buyerAddress.country_code):false;
    const eligibleReverseCharge=system==='VAT'&&EU_MEMBER_STATES.has(params.supplierAddress.country_code)&&EU_MEMBER_STATES.has(params.buyerAddress.country_code)&&params.supplierAddress.country_code!==params.buyerAddress.country_code&&buyerVatValid;
    const {data:rules,error:rulesError}=await this.db.from('tax_rules').select('id,business_id,jurisdiction_id,tax_system,tax_code,name,tax_category,effective_from,effective_to,is_active,metadata').or('business_id.eq.'+params.businessId+',business_id.is.null').eq('tax_system',system).eq('is_active',true).lte('effective_from',params.invoiceDate);
    if(rulesError)throw rulesError;
    const ruleRows=((rules||[]) as Rule[]).filter(r=>!r.effective_to||r.effective_to>=params.invoiceDate);
    if(!ruleRows.length)throw new Error('No active tax rules are configured for '+system+'.');
    const jurisdictionIds=[...new Set(ruleRows.map(r=>r.jurisdiction_id))];
    const {data:jurs,error:jError}=await this.db.from('jurisdictions').select('id,country_code,subdivision_code,jurisdiction_type,name').in('id',jurisdictionIds);
    if(jError)throw jError;
    const jurisdictions=new Map(((jurs||[]) as Jurisdiction[]).map(j=>[j.id,j]));
    const usableRules=ruleRows.filter(r=>jurisdictions.has(r.jurisdiction_id));
    if(!usableRules.length)throw new Error('No applicable jurisdiction tax rules are configured.');
    const ruleIds=usableRules.map(r=>r.id);
    const {data:components,error:cError}=await this.db.from('tax_rule_components').select('id,tax_rule_id,tax_code,rate,sequence,calculation_basis,compound_on_component_id,metadata').in('tax_rule_id',ruleIds).order('sequence');
    if(cError)throw cError;
    const byRule=new Map<string,Component[]>();
    for(const component of (components||[]) as Component[]){if(!byRule.has(component.tax_rule_id))byRule.set(component.tax_rule_id,[]);byRule.get(component.tax_rule_id)!.push(component);}
    const result:TaxCalculationLineResult[]=[];
    for(const line of params.lines){
      const candidates=usableRules.map(r=>({r,j:jurisdictions.get(r.jurisdiction_id)!,score:ruleScore(r,jurisdictions.get(r.jurisdiction_id)!,params.buyerAddress,params.supplierAddress,line.taxCode||null,params.buyerTaxId)})).filter(x=>Number.isFinite(x.score));
      if(eligibleReverseCharge)candidates.splice(0,candidates.length,...candidates.filter(x=>x.r.tax_category==='REVERSE_CHARGE'));
      candidates.sort((a,b)=>((b.score||0)-(a.score||0))||String(b.r.effective_from).localeCompare(String(a.r.effective_from)));
      if(!candidates.length)throw new Error('No applicable '+system+' tax rule for item '+line.invoiceItemId+'.');
      const selected=candidates[0].r;const comps=byRule.get(selected.id)||[];
      if(!comps.length)throw new Error('Tax rule '+selected.tax_code+' has no tax components.');
      if(eligibleReverseCharge){
        result.push({invoiceItemId:line.invoiceItemId,jurisdictionId:selected.jurisdiction_id,taxRuleId:selected.id,taxComponentId:comps[0]?.id||null,taxCode:selected.tax_code,taxCategory:'REVERSE_CHARGE',rate:0,taxableAmount:round2(line.netAmount),taxAmount:0,isReverseCharge:true,componentSequence:comps[0]?.sequence||1,calculationBasis:comps[0]?.calculation_basis||'net',sourceProvider:this.name});
        continue;
      }
      const previous=new Map<string,number>();
      for(const comp of comps){
        const priorTax=previous.get(comp.compound_on_component_id||'')||0;
        const taxable=round2(comp.calculation_basis==='net'?line.netAmount:line.netAmount+priorTax);
        const tax=round2(taxable*Number(comp.rate)/100);
        previous.set(comp.id,tax);
        result.push({invoiceItemId:line.invoiceItemId,jurisdictionId:selected.jurisdiction_id,taxRuleId:selected.id,taxComponentId:comp.id,taxCode:comp.tax_code,taxCategory:selected.tax_category,rate:Number(comp.rate),taxableAmount:taxable,taxAmount:tax,isReverseCharge:false,componentSequence:comp.sequence,calculationBasis:comp.calculation_basis,sourceProvider:this.name});
      }
    }
    return {lines:result,totalTax:round2(result.reduce((sum,line)=>sum+line.taxAmount,0))};
  }
}

const inferSystem=(buyer:string,seller:string,requested:TaxSystem|null|undefined):TaxSystem=>requested||((buyer==='IN'||seller==='IN')?'GST':(buyer==='US'||seller==='US'||buyer==='CA'||seller==='CA')?'SALES_TAX':'VAT');
export { inferSystem, EU_MEMBER_STATES, validVat };