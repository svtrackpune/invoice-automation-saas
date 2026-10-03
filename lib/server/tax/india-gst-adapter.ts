import type { TaxAdapter, TaxLineSnapshot, TaxSnapshotInput } from './types';

const round6=(value:number)=>Math.round(value*1_000_000)/1_000_000;

const distribute=(total:number,items:TaxSnapshotInput['items'])=>{
  const raw=items.reduce((sum,item)=>sum+Math.max(item.taxAmount,0),0);
  const scale=raw>0?total/raw:1;
  return items.map(item=>({...item,taxableAmount:round6(Math.max(item.taxableAmount,0)*scale),taxAmount:round6(Math.max(item.taxAmount,0)*scale)}));
};

export const IndiaGSTAdapter:TaxAdapter={
  name:'IndiaGSTAdapter',
  taxSystem:'GST',
  snapshot(input){
    const items=distribute(input.taxTotal,input.items);
    const lines:TaxLineSnapshot[]=[];
    const add=(item:(typeof items)[number],taxCode:string,rate:number,amount:number,category:TaxLineSnapshot['taxCategory'],reverseCharge=false)=>{
      lines.push({
        invoiceId:input.invoiceId,invoiceItemId:item.id,jurisdictionId:input.placeOfSupplySubdivisionCode||'IN',
        taxCode,taxCategory:category,rate,taxableAmount:item.taxableAmount,taxAmount:amount,
        baseTaxAmount:round6(amount*input.exchangeRate),transactionCurrencyCode:input.currencyCode,
        baseCurrencyCode:input.baseCurrencyCode,exchangeRate:input.exchangeRate,isReverseCharge:reverseCharge,
        sourceAdapter:'IndiaGSTAdapter',
      });
    };
    for(const item of items){
      if(input.reverseCharge){add(item,'GST-RC',item.taxRate,item.taxAmount,'REVERSE_CHARGE',true);continue;}
      const intraState=String(input.supplyType||'').toUpperCase()==='INTRA_STATE' ||
        (!!input.supplierSubdivisionCode&&!!input.placeOfSupplySubdivisionCode&&input.supplierSubdivisionCode===input.placeOfSupplySubdivisionCode);
      if(intraState){
        const cgst=round6(item.taxAmount/2);
        add(item,'CGST',item.taxRate/2,cgst,'STANDARD');
        add(item,'SGST',item.taxRate/2,round6(item.taxAmount-cgst),'STANDARD');
      }else add(item,'IGST',item.taxRate,item.taxAmount,'STANDARD');
    }
    return lines;
  },
};