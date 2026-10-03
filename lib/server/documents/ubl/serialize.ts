import type { CanonicalInvoice } from '../canonical';

export const PEPPOL_CUSTOMIZATION_ID='urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0';
export const PEPPOL_PROFILE_ID='urn:fdc:peppol.eu:2017:poacc:billing:01:1.0';
export const UBL_INVOICE_NS='urn:oasis:names:specification:ubl:schema:xsd:Invoice-2';
export const CAC_NS='urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2';
export const CBC_NS='urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2';

const EAS = new Set(['0002','0007','0009','0037','0060','0088','0096','0097','0106','0130','0135','0142','0151','0183','0190','0192','0193','0194','0195','0196','0197','0198','0199','9901','9910','9913','9914','9915','9918','9920','9922','9923','9924','9925','9926','9927','9928','9929','9930','9931','9932','9933','9934','9935','9936','9940','9941','9942','9943','9944','9945','9946','9947','9948','9949']);

const esc=(v:unknown)=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
const dec=(v:number)=>Number(v||0).toFixed(2);
const round=(v:number)=>Math.round((Number(v)||0)*100)/100;
const amount=(tag:string,value:number,currency:string)=>`<cbc:${tag} currencyID="${esc(currency)}">${dec(value)}</cbc:${tag}>`;
const category=(value:string|null|undefined)=>value==='ZERO_RATED'?'Z':value==='EXEMPT'?'E':value==='REVERSE_CHARGE'?'AE':'S';

export function validateCanonicalForPeppol(inv:CanonicalInvoice){
  if(!inv.number||!/^d{4}-d{2}-d{2}$/.test(inv.issueDate)) throw new Error('Invoice number and issue date are required.');
  if(inv.dueDate&&!/^\d{4}-\d{2}-\d{2}$/.test(inv.dueDate)) throw new Error('Invoice due date must use YYYY-MM-DD.');
  if(!inv.buyerReference?.trim()) throw new Error('PEPPOL export requires a buyer reference (BT-10) or purchase-order reference (BT-13).');
  if(!/^[A-Z]{3}$/.test(inv.currencyCode)) throw new Error('Invoice currency must be an ISO 4217 code.');
  for(const p of [inv.supplier,inv.customer]){
    if(!p.name||!p.address.country_code) throw new Error('Party name and ISO country code are required.');
    if(!p.endpointId||!p.endpointScheme) throw new Error('Supplier and customer PEPPOL EndpointID plus schemeID are required.');
    if(!EAS.has(p.endpointScheme)) throw new Error('Endpoint schemeID is not a supported CEF EAS code.');
  }
  if(inv.lines.length===0) throw new Error('At least one invoice line is required.');
  const lineSubtotal=round(inv.lines.reduce((s,l)=>s+round(l.netAmount),0));
  const taxSnapshot=round(inv.taxLines.reduce((s,x)=>s+round(x.taxAmount),0));
  const taxExclusive=round(inv.subtotal-inv.discountTotal);
  if(Math.abs(round(lineSubtotal)-round(inv.subtotal))>0.02) throw new Error('Invoice lines do not reconcile to the invoice subtotal.');
  if(Math.abs(taxSnapshot-round(inv.taxTotal))>0.02) throw new Error('Tax snapshot does not reconcile to invoice tax total.');
  if(Math.abs(round(taxExclusive+inv.taxTotal)-round(inv.total))>0.02) throw new Error('Invoice totals do not reconcile for PEPPOL export.');
  if(inv.balanceDue>0&&!inv.dueDate&&!inv.terms?.trim()) throw new Error('A positive payable amount requires a due date or payment terms.');
}

function partyXml(role:'AccountingSupplierParty'|'AccountingCustomerParty',p:CanonicalInvoice['supplier']){
  const legalName=esc(p.legalName||p.name);
  const address=[p.address.address_line_1,p.address.address_line_2].filter(Boolean).map((x,i)=>`<cbc:${i===0?'StreetName':'AdditionalStreetName'}>${esc(x)}</cbc:${i===0?'StreetName':'AdditionalStreetName'}>`).join('');
  const city=p.address.locality?`<cbc:CityName>${esc(p.address.locality)}</cbc:CityName>`:'';
  const postal=p.address.postal_code?`<cbc:PostalZone>${esc(p.address.postal_code)}</cbc:PostalZone>`:'';
  const tax=p.taxId?`<cac:PartyTaxScheme><cbc:CompanyID>${esc(p.taxId)}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>`:'';
  return `<cac:${role}><cac:Party><cbc:EndpointID schemeID="${esc(p.endpointScheme!)}">${esc(p.endpointId!)}</cbc:EndpointID><cac:PartyName><cbc:Name>${esc(p.name)}</cbc:Name></cac:PartyName><cac:PostalAddress>${address}${city}${postal}<cac:Country><cbc:IdentificationCode>${esc(p.address.country_code)}</cbc:IdentificationCode></cac:Country></cac:PostalAddress>${tax}<cac:PartyLegalEntity><cbc:RegistrationName>${legalName}</cbc:RegistrationName></cac:PartyLegalEntity>${p.email?`<cac:Contact><cbc:ElectronicMail>${esc(p.email)}</cbc:ElectronicMail></cac:Contact>`:''}</cac:Party></cac:${role}>`;
}

export function serializePeppolUblInvoice(inv:CanonicalInvoice){
  validateCanonicalForPeppol(inv);
  const grouped=new Map<string,{taxable:number;tax:number;rate:number;category:string}>();
  for(const line of inv.taxLines){
    const key=`${line.taxCategory}|${line.rate.toFixed(6)}|${line.taxCode}`;
    const g=grouped.get(key)||{taxable:0,tax:0,rate:line.rate,category:line.taxCategory};
    g.taxable=round(g.taxable+line.taxableAmount); g.tax=round(g.tax+line.taxAmount); grouped.set(key,g);
  }
  const subtotal=round(inv.lines.reduce((s,l)=>s+round(l.netAmount),0));
  const taxSubtotals=Array.from(grouped.values()).map(g=>{
    const code=category(g.category);
    const exemption=g.category==='EXEMPT'?'<cbc:TaxExemptionReason>Exempt supply</cbc:TaxExemptionReason>':'';
    return `<cac:TaxSubtotal>${amount('TaxableAmount',g.taxable,inv.currencyCode)}${amount('TaxAmount',g.tax,inv.currencyCode)}<cac:TaxCategory><cbc:ID>${code}</cbc:ID><cbc:Percent>${dec(g.rate)}</cbc:Percent>${exemption}<cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal>`;
  }).join('');
  const lines=inv.lines.map((l,i)=>{
    const unit=l.unitCode||'C62';
    const lineNet=round(l.netAmount);
    const price=l.quantity>0?round(lineNet/l.quantity):0;
    const taxCategory=category(l.taxCategory);
    return `<cac:InvoiceLine><cbc:ID>${i+1}</cbc:ID><cbc:InvoicedQuantity unitCode="${esc(unit)}">${dec(l.quantity)}</cbc:InvoicedQuantity>${amount('LineExtensionAmount',lineNet,inv.currencyCode)}<cac:Item><cbc:Description>${esc(l.description)}</cbc:Description><cbc:Name>${esc(l.description)}</cbc:Name><cac:ClassifiedTaxCategory><cbc:ID>${taxCategory}</cbc:ID><cbc:Percent>${dec(l.taxRate||0)}</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:ClassifiedTaxCategory></cac:Item><cac:Price>${amount('PriceAmount',price,inv.currencyCode)}<cbc:BaseQuantity unitCode="${esc(unit)}">1</cbc:BaseQuantity></cac:Price></cac:InvoiceLine>`;
  }).join('');
  const allowance=inv.discountTotal>0?`<cac:AllowanceCharge><cbc:ChargeIndicator>false</cbc:ChargeIndicator>${amount('Amount',inv.discountTotal,inv.currencyCode)}</cac:AllowanceCharge>`:'';
  const due=inv.dueDate?`<cbc:DueDate>${esc(inv.dueDate)}</cbc:DueDate>`:'';
  const terms=(!inv.dueDate&&inv.terms?.trim())?`<cac:PaymentTerms><cbc:Note>${esc(inv.terms)}</cbc:Note></cac:PaymentTerms>`:'';
  const note=inv.note?.trim()?`<cbc:Note>${esc(inv.note)}</cbc:Note>`:'';
  return `<?xml version="1.0" encoding="UTF-8"?><Invoice xmlns="${UBL_INVOICE_NS}" xmlns:cac="${CAC_NS}" xmlns:cbc="${CBC_NS}"><cbc:CustomizationID>${PEPPOL_CUSTOMIZATION_ID}</cbc:CustomizationID><cbc:ProfileID>${PEPPOL_PROFILE_ID}</cbc:ProfileID><cbc:ID>${esc(inv.number)}</cbc:ID><cbc:IssueDate>${esc(inv.issueDate)}</cbc:IssueDate>${due}<cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>${note}<cbc:DocumentCurrencyCode>${esc(inv.currencyCode)}</cbc:DocumentCurrencyCode><cbc:BuyerReference>${esc(inv.buyerReference)}</cbc:BuyerReference>${partyXml('AccountingSupplierParty',inv.supplier)}${partyXml('AccountingCustomerParty',inv.customer)}${terms}${allowance}<cac:TaxTotal>${amount('TaxAmount',inv.taxTotal,inv.currencyCode)}${taxSubtotals}</cac:TaxTotal><cac:LegalMonetaryTotal>${amount('LineExtensionAmount',subtotal,inv.currencyCode)}${amount('TaxExclusiveAmount',round(inv.subtotal-inv.discountTotal),inv.currencyCode)}${amount('TaxInclusiveAmount',round(inv.total),inv.currencyCode)}${amount('PayableAmount',round(inv.balanceDue),inv.currencyCode)}</cac:LegalMonetaryTotal>${lines}</Invoice>`.replace('<cac:AllowanceCharge></cac:AllowanceCharge>','');
}

export function validatePeppolXml(xml:string){
  if(!xml.startsWith('<?xml')) throw new Error('UBL validation failed: XML declaration is missing.');
  if(/<[^!?][^>]*>\s*<\/[^>]+>/.test(xml)||/<[^>]+\/>/.test(xml)) throw new Error('UBL validation failed: empty XML elements are not permitted.');
  for(const marker of ['<cbc:CustomizationID>','<cbc:ProfileID>','<cbc:ID>','<cbc:IssueDate>','<cbc:InvoiceTypeCode>','<cbc:DocumentCurrencyCode>','<cbc:BuyerReference>','<cac:AccountingSupplierParty>','<cac:AccountingCustomerParty>','<cbc:EndpointID schemeID=','<cac:TaxTotal>','<cac:LegalMonetaryTotal>','<cac:InvoiceLine>']) if(!xml.includes(marker)) throw new Error('UBL validation failed: missing '+marker);
  if(!xml.includes(PEPPOL_CUSTOMIZATION_ID)||!xml.includes(PEPPOL_PROFILE_ID)) throw new Error('UBL validation failed: wrong PEPPOL identifiers.');
  if(!xml.includes('currencyID="')) throw new Error('UBL validation failed: monetary amounts require currencyID.');
  return xml;
}
