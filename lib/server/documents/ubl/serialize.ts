import type { CanonicalInvoice } from '../canonical';

export const PEPPOL_CUSTOMIZATION_ID='urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0';
export const PEPPOL_PROFILE_ID='urn:fdc:peppol.eu:2017:poacc:billing:01:1.0';
export const UBL_INVOICE_NS='urn:oasis:names:specification:ubl:schema:xsd:Invoice-2';
export const CAC_NS='urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2';
export const CBC_NS='urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2';
const EAS = new Set(['0002','0007','0009','0037','0060','0088','0096','0097','0106','0130','0135','0142','0147','0151','0154','0158','0170','0177','0183','0184','0188','0190','0191','0192','0193','0194','0195','0196','0198','0199','0200','0201','0202','0203','0204','0205','0208','0209','0210','0211','0212','0213','0215','0216','0217','0218','0219','0220','0221','0225','0230','0235','0240','0242','0244','0245','0246','0248','9910','9913','9914','9915','9918','9919','9920','9922','9923','9924','9925','9926','9927','9928','9929','9930','9931','9932','9933','9934','9935','9936','9937','9938','9939','9940','9941','9942','9943','9944','9945','9946','9947','9948','9949','9950','9951','9952','9953','9957','9959','AN','AQ','AS','AU','EM']);
const esc=(v:unknown)=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
const dec=(v:number)=>Number(v||0).toFixed(2);
function amount(tag:string,value:number,currency:string){return `<cbc:${tag} currencyID="${esc(currency)}">${dec(value)}</cbc:${tag}>`;}

export function validateCanonicalForPeppol(inv:CanonicalInvoice){
  if(!inv.number||!/^\d{4}-\d{2}-\d{2}$/.test(inv.issueDate)) throw new Error('Invoice number and issue date are required.');
  if(!inv.supplier.endpointId||!inv.customer.endpointId) throw new Error('PEPPOL endpoint identifiers are required.');
  if(!/^[A-Z]{3}$/.test(inv.currencyCode)) throw new Error('Invoice currency must be an ISO 4217 code.');
  for(const p of [inv.supplier,inv.customer]) {
    if(!p.endpointId||!p.endpointScheme) throw new Error('Supplier and customer PEPPOL EndpointID plus schemeID are required.');
    if(!EAS.has(p.endpointScheme)) throw new Error('Endpoint schemeID is not a supported CEF EAS code.');
    if(!p.address.country_code||!p.name) throw new Error('Party country and name are required.');
  }
  if(inv.lines.length===0) throw new Error('At least one invoice line is required.');
  if(Math.abs(inv.taxTotal-inv.taxLines.reduce((s,x)=>s+x.taxAmount,0))>0.02) throw new Error('Tax snapshot does not reconcile to invoice tax total.');
}

function partyXml(role:'AccountingSupplierParty'|'AccountingCustomerParty',p:any){
  const tag=role==='AccountingSupplierParty'?'SellerSupplierParty':'BuyerCustomerParty';
  return `<cac:${role}><cac:Party><cbc:EndpointID schemeID="${esc(p.endpointScheme)}">${esc(p.endpointId)}</cbc:EndpointID><cac:PartyName><cbc:Name>${esc(p.name)}</cbc:Name></cac:PartyName><cac:PostalAddress><cbc:StreetName>${esc(p.address.address_line_1||'')}</cbc:StreetName><cbc:CityName>${esc(p.address.locality||'')}</cbc:CityName>${p.address.postal_code?`<cbc:PostalZone>${esc(p.address.postal_code)}</cbc:PostalZone>`:''}<cac:Country><cbc:IdentificationCode>${esc(p.address.country_code)}</cbc:IdentificationCode></cac:Country></cac:PostalAddress>${p.taxId?`<cac:PartyTaxScheme><cbc:CompanyID>${esc(p.taxId)}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>`:''}<cac:PartyLegalEntity><cbc:RegistrationName>${esc(p.legalName||p.name)}</cbc:RegistrationName></cac:PartyLegalEntity></cac:Party></cac:${role}>`.replace(tag,tag);
}

export function serializePeppolUblInvoice(inv:CanonicalInvoice){
  validateCanonicalForPeppol(inv);
  const grouped=new Map<string,{taxable:number;tax:number;rate:number;category:string}>();
  for(const line of inv.taxLines){const key=`${line.taxCategory}|${line.rate.toFixed(6)}|${line.taxCode}`; const g=grouped.get(key)||{taxable:0,tax:0,rate:line.rate,category:line.taxCategory}; g.taxable+=line.taxableAmount; g.tax+=line.taxAmount; grouped.set(key,g);}
  const subtotal=inv.lines.reduce((s,l)=>s+l.netAmount,0);
  const taxSubtotals=Array.from(grouped.values()).map(g=>`<cac:TaxSubtotal>${amount('TaxableAmount',g.taxable,inv.currencyCode)}${amount('TaxAmount',g.tax,inv.currencyCode)}<cac:TaxCategory><cbc:ID>${g.category==='ZERO_RATED'?'Z':g.category==='EXEMPT'?'E':g.category==='REVERSE_CHARGE'?'AE':'S'}</cbc:ID><cbc:Percent>${dec(g.rate)}</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal>`).join('');
  const lines=inv.lines.map((l,i)=>`<cac:InvoiceLine><cbc:ID>${i+1}</cbc:ID><cbc:InvoicedQuantity${l.unitCode?` unitCode="${esc(l.unitCode)}"`:''}>${dec(l.quantity)}</cbc:InvoicedQuantity>${amount('LineExtensionAmount',l.netAmount,inv.currencyCode)}<cac:Item><cbc:Description>${esc(l.description)}</cbc:Description><cbc:Name>${esc(l.description)}</cbc:Name><cac:ClassifiedTaxCategory><cbc:ID>${l.taxCategory==='ZERO_RATED'?'Z':l.taxCategory==='EXEMPT'?'E':l.taxCategory==='REVERSE_CHARGE'?'AE':'S'}</cbc:ID><cbc:Percent>${dec(l.taxRate||0)}</cbc:Percent>${l.hsnSac?`<cbc:Name>${esc(l.hsnSac)}</cbc:Name>`:''}<cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:ClassifiedTaxCategory></cac:Item><cac:Price>${amount('PriceAmount',l.unitPrice,inv.currencyCode)}</cac:Price></cac:InvoiceLine>`).join('');
  const allowance=inv.discountTotal>0?`<cac:AllowanceCharge><cbc:ChargeIndicator>false</cbc:ChargeIndicator>${amount('Amount',inv.discountTotal,inv.currencyCode)}</cac:AllowanceCharge>`:'';
  return `<?xml version="1.0" encoding="UTF-8"?><Invoice xmlns="${UBL_INVOICE_NS}" xmlns:cac="${CAC_NS}" xmlns:cbc="${CBC_NS}"><cbc:CustomizationID>${PEPPOL_CUSTOMIZATION_ID}</cbc:CustomizationID><cbc:ProfileID>${PEPPOL_PROFILE_ID}</cbc:ProfileID><cbc:ID>${esc(inv.number)}</cbc:ID><cbc:IssueDate>${esc(inv.issueDate)}</cbc:IssueDate><cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode><cbc:DocumentCurrencyCode>${esc(inv.currencyCode)}</cbc:DocumentCurrencyCode>${partyXml('AccountingSupplierParty',inv.supplier)}${partyXml('AccountingCustomerParty',inv.customer)}<cac:TaxTotal>${amount('TaxAmount',inv.taxTotal,inv.currencyCode)}${taxSubtotals}</cac:TaxTotal>${allowance}<cac:LegalMonetaryTotal>${amount('LineExtensionAmount',subtotal,inv.currencyCode)}${amount('TaxExclusiveAmount',inv.total-inv.taxTotal,inv.currencyCode)}${amount('TaxInclusiveAmount',inv.total,inv.currencyCode)}${amount('PayableAmount',inv.balanceDue,inv.currencyCode)}</cac:LegalMonetaryTotal>${lines}</Invoice>`;
}

export function validatePeppolXml(xml:string){
  for(const marker of ['<cbc:CustomizationID>','<cbc:ProfileID>','<cac:AccountingSupplierParty>','<cac:AccountingCustomerParty>','<cbc:EndpointID schemeID=','<cac:TaxTotal>','<cac:LegalMonetaryTotal>','<cac:InvoiceLine>']) if(!xml.includes(marker)) throw new Error('UBL validation failed: missing '+marker);
  if(!xml.includes(PEPPOL_CUSTOMIZATION_ID)||!xml.includes(PEPPOL_PROFILE_ID)) throw new Error('UBL validation failed: wrong PEPPOL identifiers.');
  return xml;
}