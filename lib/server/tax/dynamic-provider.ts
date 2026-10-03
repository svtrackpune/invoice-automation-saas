import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
  TaxCalculationParams, TaxCalculationResult, TaxDeterminationProvider,
  TaxCalculationLineResult, TaxCategory, TaxSystem, CanonicalAddress,
} from './types';

export const EU_MEMBER_STATES=new Set([
  'AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU',
  'IE','IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE',
]);

const VIES_ENDPOINT='https://ec.europa.eu/taxation_customs/vies/services/checkVatService';
const round6=(v:number)=>Math.round((Number(v)+Number.EPSILON)*1_000_000)/1_000_000;
const normalizeVat=(id:string|null|undefined)=>String(id??'').replace(/[^A-Za-z0-9]/g,'').toUpperCase();

export const validVat=(id:string|null|undefined,country:string)=>{
  const normalized=normalizeVat(id);
  const prefix=country.toUpperCase();
  return Boolean(normalized&&normalized.startsWith(prefix)&&normalized.length>=prefix.length+2);
};

export type VatValidationResult={valid:boolean;source:'vies'|'syntax'|'unavailable'};
export type VatValidator=(id:string|null|undefined,country:string)=>Promise<VatValidationResult>;

export async function validateVatWithVies(id:string|null|undefined,country:string):Promise<VatValidationResult>{
  const cc=country.toUpperCase();
  const normalized=normalizeVat(id);
  if(!EU_MEMBER_STATES.has(cc)||!validVat(normalized,cc)) return {valid:false,source:'syntax'};
  const number=normalized.slice(cc.length);
  const envelope='<?xml version="1.0" encoding="UTF-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><checkVat xmlns="urn:ec.europa.eu:taxud:vies:services:checkVat:types"><countryCode>'+cc+'</countryCode><vatNumber>'+number+'</vatNumber></checkVat></soap:Body></soap:Envelope>';
  try{
    const response=await fetch(VIES_ENDPOINT,{
      method:'POST',
      headers:{'Content-Type':'text/xml; charset=utf-8','SOAPAction':'""'},
      body:envelope,
      signal:AbortSignal.timeout(5000),
    });
    if(!response.ok)return {valid:false,source:'unavailable'};
    const xml=await response.text();
    const match=xml.match(/<[^>]*valid[^>]*>\s*(true|false)\s*<\/[^>]*valid\s*>/i);
    if(!match)return {valid:false,source:'unavailable'};
    return {valid:match[1].toLowerCase()==='true',source:'vies'};
  }catch{
    return {valid:false,source:'unavailable'};
  }
}

type Rule={
  id:string;business_id:string|null;jurisdiction_id:string;tax_system:string;tax_code:string;
  name:string;tax_category:TaxCategory;effective_from:string;effective_to:string|null;
  is_active:boolean;metadata:Record<string,unknown>;
};
type Jurisdiction={
  id:string;country_code:string;subdivision_code:string|null;jurisdiction_type:string;name:string;
};
type Component={
  id:string;tax_rule_id:string;tax_code:string;rate:number;sequence:number;
  calculation_basis:'net'|'gross_plus_previous';compound_on_component_id:string|null;metadata:Record<string,unknown>;
};

const asArray=(v:unknown):string[]=>Array.isArray(v)?v.map(String):[];
const has=(values:string[],expected:string)=>values.some(v=>v.toUpperCase()===expected.toUpperCase());
const textMeta=(m:Record<string,unknown>,...keys:string[])=>{
  for(const key of keys){const value=m[key];if(typeof value==='string'&&value.trim())return value.trim().toUpperCase();}
  return null;
};

function ruleScore(rule:Rule,jurisdiction:Jurisdiction,buyer:CanonicalAddress,seller:CanonicalAddress,lineTaxCode:string|null){
  const m=rule.metadata||{};
  const buyerCountries=asArray(m.buyer_country_codes??m.country_codes);
  if(buyerCountries.length&&!has(buyerCountries,buyer.country_code))return -Infinity;
  const sellerCountries=asArray(m.seller_country_codes);
  if(sellerCountries.length&&!has(sellerCountries,seller.country_code))return -Infinity;
  const subdivisions=asArray(m.buyer_subdivision_codes??m.subdivision_codes);
  if(subdivisions.length&&(!buyer.country_subdivision_code||!has(subdivisions,buyer.country_subdivision_code)))return -Infinity;
  const postalPrefixes=asArray(m.postal_prefixes);
  if(postalPrefixes.length&&(!buyer.postal_code||!postalPrefixes.some(p=>buyer.postal_code!.toUpperCase().startsWith(p.toUpperCase()))))return -Infinity;
  const localities=asArray(m.buyer_localities??m.localities??m.cities);
  if(localities.length&&(!buyer.locality||!localities.some(x=>x.toUpperCase()===buyer.locality!.toUpperCase())))return -Infinity;
  const businessPriority=rule.business_id?100:0;
  const sameCountry=jurisdiction.country_code===buyer.country_code?40:-Infinity;
  if(!Number.isFinite(sameCountry))return -Infinity;
  let score=businessPriority+sameCountry;
  if(jurisdiction.subdivision_code&&jurisdiction.subdivision_code===buyer.country_subdivision_code)score+=50;
  if(lineTaxCode&&rule.tax_code===lineTaxCode)score+=25;
  const priority=Number(m.priority);
  if(Number.isFinite(priority))score+=priority;
  return score;
}

function jurisdictionRank(type:string){
  switch(type){case 'country':return 0;case 'state':return 10;case 'county':return 20;case 'city':return 30;case 'special_district':return 40;default:return 50;}
}

const admin=()=>createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{
  auth:{autoRefreshToken:false,persistSession:false},
});

export class DynamicTaxDeterminationProvider implements TaxDeterminationProvider{
  readonly name='moneymatters.dynamic-tax-v1';
  constructor(
    private readonly db:SupabaseClient=admin(),
    private readonly vatValidator:VatValidator=validateVatWithVies,
  ){}

  async calculateTaxes(params:TaxCalculationParams):Promise<TaxCalculationResult>{
    if(!params.businessId)throw new Error('Tax calculation business context is required.');
    if(!params.buyerAddress.country_code)throw new Error('Buyer tax destination country is required.');
    if(!params.lines.length)return {lines:[],totalTax:0};

    const system=inferSystem(params.buyerAddress.country_code,params.supplierAddress.country_code,params.taxSystem);
    let reverseCharge=false;
    if(system==='VAT'&&EU_MEMBER_STATES.has(params.supplierAddress.country_code)&&EU_MEMBER_STATES.has(params.buyerAddress.country_code)&&params.supplierAddress.country_code!==params.buyerAddress.country_code){
      reverseCharge=(await this.vatValidator(params.buyerTaxId,params.buyerAddress.country_code)).valid;
    }

    const {data:rules,error:rulesError}=await this.db.from('tax_rules')
      .select('id,business_id,jurisdiction_id,tax_system,tax_code,name,tax_category,effective_from,effective_to,is_active,metadata')
      .eq('tax_system',system)
      .eq('is_active',true);
    if(rulesError)throw rulesError;

    const effectiveRules=((rules||[]) as Rule[]).filter(rule=>
      (rule.business_id===null||rule.business_id===params.businessId) &&
      rule.effective_from<=params.invoiceDate &&
      (!rule.effective_to||rule.effective_to>=params.invoiceDate)
    );
    if(!effectiveRules.length)throw new Error('No active tax rules are configured for '+system+'.');

    const jurisdictionIds=[...new Set(effectiveRules.map(r=>r.jurisdiction_id))];
    const {data:jurs,error:jError}=await this.db.from('jurisdictions')
      .select('id,country_code,subdivision_code,jurisdiction_type,name')
      .in('id',jurisdictionIds);
    if(jError)throw jError;
    const jurisdictions=new Map(((jurs||[]) as Jurisdiction[]).map(j=>[j.id,j]));
    const usable=effectiveRules.filter(r=>jurisdictions.has(r.jurisdiction_id));
    if(!usable.length)throw new Error('No applicable jurisdiction tax rules are configured.');

    const ids=usable.map(r=>r.id);
    const {data:components,error:cError}=await this.db.from('tax_rule_components')
      .select('id,tax_rule_id,tax_code,rate,sequence,calculation_basis,compound_on_component_id,metadata')
      .in('tax_rule_id',ids)
      .order('sequence',{ascending:true});
    if(cError)throw cError;
    const byRule=new Map<string,Component[]>();
    for(const component of (components||[]) as Component[]){
      if(!byRule.has(component.tax_rule_id))byRule.set(component.tax_rule_id,[]);
      byRule.get(component.tax_rule_id)!.push(component);
    }

    const result:TaxCalculationLineResult[]=[];
    for(const line of params.lines){
      let candidates=usable.map(rule=>{
        const jurisdiction=jurisdictions.get(rule.jurisdiction_id)!;
        return {rule,jurisdiction,score:ruleScore(rule,jurisdiction,params.buyerAddress,params.supplierAddress,line.taxCode||null)};
      }).filter(x=>Number.isFinite(x.score));

      if(reverseCharge){
        candidates=candidates.filter(x=>x.rule.tax_category==='REVERSE_CHARGE');
        if(!candidates.length)throw new Error('EU VAT reverse charge is applicable but no REVERSE_CHARGE rule is configured.');
      }

      candidates.sort((a,b)=>{
        const scoreDiff=(b.score??0)-(a.score??0);
        if(scoreDiff!==0)return scoreDiff;
        const rankDiff=jurisdictionRank(a.jurisdiction.jurisdiction_type)-jurisdictionRank(b.jurisdiction.jurisdiction_type);
        if(rankDiff!==0)return rankDiff;
        return String(b.rule.effective_from).localeCompare(String(a.rule.effective_from))||String(a.rule.tax_code).localeCompare(String(b.rule.tax_code));
      });

      const selectedByTaxCode=new Map<string,{rule:Rule;jurisdiction:Jurisdiction;score:number}>();
      for(const candidate of candidates){
        const key=String(candidate.rule.tax_code);
        if(!selectedByTaxCode.has(key))selectedByTaxCode.set(key,candidate);
      }
      const selected=[...selectedByTaxCode.values()].sort((a,b)=>{
        const rank=jurisdictionRank(a.jurisdiction.jurisdiction_type)-jurisdictionRank(b.jurisdiction.jurisdiction_type);
        return rank||((b.score??0)-(a.score??0))||String(a.rule.tax_code).localeCompare(String(b.rule.tax_code));
      });
      if(!selected.length)throw new Error('No applicable '+system+' tax rule for item '+line.invoiceItemId+'.');

      if(reverseCharge){
        const selectedRule=selected[0];
        const comps=byRule.get(selectedRule.rule.id)||[];
        result.push({
          invoiceItemId:line.invoiceItemId,jurisdictionId:selectedRule.rule.jurisdiction_id,taxRuleId:selectedRule.rule.id,
          taxComponentId:comps[0]?.id||null,taxCode:selectedRule.rule.tax_code,taxCategory:'REVERSE_CHARGE',rate:0,
          taxableAmount:round6(line.netAmount),taxAmount:0,isReverseCharge:true,
          componentSequence:comps[0]?.sequence||1,calculationBasis:comps[0]?.calculation_basis||'net',sourceProvider:this.name,
        });
        continue;
      }

      for(const chosen of selected){
        const comps=byRule.get(chosen.rule.id)||[];
        if(!comps.length)throw new Error('Tax rule '+chosen.rule.tax_code+' has no tax components.');
        const previousTax=new Map<string,number>();
        for(const comp of comps){
          let taxable=round6(line.netAmount);
          if(comp.calculation_basis==='gross_plus_previous'){
            if(!comp.compound_on_component_id)throw new Error('Compound tax component is missing its base component.');
            taxable=round6(line.netAmount+(previousTax.get(comp.compound_on_component_id)||0));
          }
          const tax=round6(taxable*Number(comp.rate)/100);
          previousTax.set(comp.id,tax);
          result.push({
            invoiceItemId:line.invoiceItemId,jurisdictionId:chosen.rule.jurisdiction_id,taxRuleId:chosen.rule.id,
            taxComponentId:comp.id,taxCode:comp.tax_code,taxCategory:chosen.rule.tax_category,rate:Number(comp.rate),
            taxableAmount:taxable,taxAmount:tax,isReverseCharge:false,componentSequence:comp.sequence,
            calculationBasis:comp.calculation_basis,sourceProvider:this.name,
          });
        }
      }
    }

    return {lines:result,totalTax:round6(result.reduce((sum,line)=>sum+line.taxAmount,0))};
  }
}

export const inferSystem=(buyer:string,seller:string,requested:TaxSystem|null|undefined):TaxSystem=>
  requested||(buyer==='IN'||seller==='IN'?'GST':(buyer==='US'?'SALES_TAX':(buyer==='CA'?'GST':'VAT')));

export const __taxProviderInternals={normalizeVat,textMeta};