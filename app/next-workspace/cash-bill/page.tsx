'use client';
import {useEffect,useMemo,useState} from 'react';
import {supabase,type BusinessContext} from '@/lib/supabase';
import CashBillControlled from './CashBillControlled';
import OfflineCashBillSync from '@/components/OfflineCashBillSync';
import PosServiceWorker from '@/components/PosServiceWorker';
import {queueOfflineCashBill,nextOfflineTicketNumber} from '@/lib/client/offline-cash-bills';
type Product={id:string;name:string;sku:string|null;sales_price:number;default_tax_rate_id:string|null};
type Tax={id:string;name:string;rate:number};
type Account={id:string;code:string;name:string;account_subtype:string|null};
type Line={product_service_id:string;quantity:number;unit_price:number;tax_rate_id:string};
type Tender='cash'|'upi'; type ReceiptFormat='thermal80'|'a4'|'a5';
const today=()=>new Date().toISOString().slice(0,10);
export default function CashBillPage(){
 const[ctx,setCtx]=useState<BusinessContext|null>(null),[offlinePosEnabled,setOfflinePosEnabled]=useState(false),[products,setProducts]=useState<Product[]>([]),[taxes,setTaxes]=useState<Tax[]>([]),[cashAccount,setCashAccount]=useState<Account|null>(null),[upiAccount,setUpiAccount]=useState<Account|null>(null),[upiBankLabel,setUpiBankLabel]=useState(''),[taxRegistered,setTaxRegistered]=useState(false),[lines,setLines]=useState<Line[]>([]),[date,setDate]=useState(today()),[customerPhone,setCustomerPhone]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[success,setSuccess]=useState(''),[createdInvoiceId,setCreatedInvoiceId]=useState(''),[paymentMethod,setPaymentMethod]=useState<Tender>('cash'),[amountReceived,setAmountReceived]=useState(0),[receiptFormat,setReceiptFormat]=useState<ReceiptFormat>('thermal80'),[discountType,setDiscountType]=useState<''|'percent'|'amount'>(''),[discountValue,setDiscountValue]=useState(0);
 useEffect(()=>{(async()=>{
  const r=await supabase.rpc('get_my_business_context');const c=r.data?.[0] as BusinessContext|undefined;if(!c){location.href='/';return}setCtx(c);
  const savedReceipt=window.localStorage.getItem('moneymatters.cashBillReceiptFormat'); if(savedReceipt==='thermal80'||savedReceipt==='a4'||savedReceipt==='a5') setReceiptFormat(savedReceipt);
  const setup=await supabase.rpc('get_cash_bill_pos_context',{p_business_id:c.business_id});
  if(setup.error){setError(setup.error.message);return}
  const value=setup.data||{};setProducts((value.products||[]) as Product[]);setTaxes((value.taxes||[]) as Tax[]);
  const cash=value.cash_account||null,upi=value.upi_account||null;
  setCashAccount(cash?.id?cash as Account:null);setUpiAccount(upi?.id?upi as Account:null);
  const bank=value.upi_label||{};if(bank.name)setUpiBankLabel(`${bank.name} · ${bank.institution_name||'Bank'}${bank.account_last4?` · ••••${bank.account_last4}`:''}`);
  setOfflinePosEnabled(Boolean(value.offline_pos_enabled));
  const profile=value.tax_profile||{};const registered=Boolean(profile.tax_regime&&profile.tax_regime!=='NONE'&&((profile.tax_regime!=='GST')||profile.gst_registration_type&&profile.gst_registration_type!=='NONE'));setTaxRegistered(registered);
 })()},[]);
 const add=()=>{const p=products[0];if(p)setLines(x=>[...x,{product_service_id:p.id,quantity:1,unit_price:Number(p.sales_price||0),tax_rate_id:taxRegistered?(p.default_tax_rate_id||''):''}])};
 const change=(i:number,k:keyof Line,v:any)=>setLines(x=>x.map((l,j)=>j===i?{...l,[k]:v}:l));
 const totals=useMemo(()=>{let subtotal=0,tax=0;for(const l of lines){const base=Math.max(0,Number(l.quantity||0))*Math.max(0,Number(l.unit_price||0));subtotal+=base;if(taxRegistered)tax+=base*(taxes.find(t=>t.id===l.tax_rate_id)?.rate||0)/100}const beforeDiscount=subtotal+tax;const discount=discountType==='percent'?Math.min(beforeDiscount,beforeDiscount*Math.max(0,discountValue)/100):discountType==='amount'?Math.min(beforeDiscount,Math.max(0,discountValue)):0;return{subtotal,tax,discount,total:Math.max(0,beforeDiscount-discount)}},[lines,taxes,taxRegistered,discountType,discountValue]);
 const searchAndAdd=(query:string,quantity:number)=>{const q=query.trim().toLowerCase();const found=products.find(x=>x.id===query||x.name.toLowerCase()===q||(x.sku||'').toLowerCase()===q)||products.find(x=>x.name.toLowerCase().includes(q)||(x.sku||'').toLowerCase().includes(q));if(!found)return;setLines(current=>{const index=current.findIndex(x=>x.product_service_id===found.id);if(index>=0)return current.map((x,i)=>i===index?{...x,quantity:Number(x.quantity||0)+Math.max(1,quantity)}:x);return [...current,{product_service_id:found.id,quantity:Math.max(1,quantity),unit_price:Number(found.sales_price||0),tax_rate_id:taxRegistered?(found.default_tax_rate_id||''):'']} });};
 const save=async()=>{
  if(!ctx||!lines.length||totals.total<=0)return;setBusy(true);setError('');setSuccess('');setCreatedInvoiceId('');
  const settlementAccount=paymentMethod==='cash'?cashAccount:upiAccount;
  if(!settlementAccount){setError('No settlement account is configured for the selected payment method.');setBusy(false);return}
  const payload={businessId:ctx.business_id,phone:customerPhone.trim(),invoiceDate:date,items:lines.map(l=>taxRegistered?l:{...l,tax_rate_id:''}),paymentMethod,accountId:settlementAccount.id,invoiceDiscountType:discountType||null,invoiceDiscountValue:discountValue,notes:'Cash & Carry',terms:'Paid in full at counter.'} as const;
  const tempPosUuid=crypto.randomUUID();const offlineTicketNumber=nextOfflineTicketNumber(ctx.business_id);
  if(!navigator.onLine){
    if(!offlinePosEnabled){setError('Offline POS is not enabled for this business plan. The Cash Bill requires an active internet connection.');setBusy(false);return}
    const queued=await queueOfflineCashBill(payload,{tempPosUuid,offlineTicketNumber});
    setSuccess(`Offline mode: Cash & Carry bill ${queued.offlineTicketNumber} queued and will sync automatically when connectivity returns.`);setBusy(false);return
  }
  const bill=await supabase.rpc('create_cash_bill',{p_business_id:payload.businessId,p_phone:payload.phone,p_invoice_date:payload.invoiceDate,p_items:payload.items,p_payment_method:payload.paymentMethod,p_account_id:payload.accountId,p_invoice_discount_type:discountType||null,p_invoice_discount_value:discountValue,p_notes:payload.notes,p_terms:payload.terms,p_temp_pos_uuid:tempPosUuid,p_offline_ticket_number:offlineTicketNumber});
  if(bill.error){
    const msg=bill.error.message||'Cash Bill could not be saved.';
    if(!navigator.onLine||/fetch|network|offline|failed to send|connection|timeout/i.test(msg)){
      if(!offlinePosEnabled){setError('Connection was lost and Offline POS is not enabled for this business plan. The Cash Bill was not queued.');setBusy(false);return}
      const queued=await queueOfflineCashBill(payload,{tempPosUuid,offlineTicketNumber});
      setSuccess(`Connection lost: Cash & Carry bill ${queued.offlineTicketNumber} queued for automatic sync. The server idempotency key prevents duplicate accounting or inventory posting.`);setBusy(false);return
    }
    setError(msg);setBusy(false);return
  }
  setSuccess(`Cash & Carry bill created, posted and marked paid via ${paymentMethod==='cash'?'Cash':'UPI'}. Receipt format: ${receiptFormat}.`);setCreatedInvoiceId(String(bill.data));setLines([]);setCustomerPhone('');setDate(today());setPaymentMethod('cash');setAmountReceived(0);setDiscountType('');setDiscountValue(0);setBusy(false);
 };
 const newBill=()=>{setLines([]);setCustomerPhone('');setDate(today());setPaymentMethod('cash');setAmountReceived(0);setDiscountType('');setDiscountValue(0);setError('');setSuccess('');setCreatedInvoiceId('')};
 if(!ctx)return <div className="grid min-h-screen place-items-center"><span className="text-sm text-slate-500">Loading Cash & Carry workspace…</span></div>;
 return <><PosServiceWorker/><OfflineCashBillSync businessId={ctx.business_id}/><CashBillControlled date={date} setDate={setDate} customerPhone={customerPhone} setCustomerPhone={setCustomerPhone} lines={lines} products={products} taxes={taxes} taxRegistered={taxRegistered} totals={totals} busy={busy} cashAccount={cashAccount} upiAccount={upiAccount} upiBankLabel={upiBankLabel} tender={paymentMethod} setTender={setPaymentMethod} amountReceived={amountReceived} setAmountReceived={setAmountReceived} receiptFormat={receiptFormat} setReceiptFormat={setReceiptFormat} discountType={discountType} discountValue={discountValue} setDiscountType={setDiscountType} setDiscountValue={setDiscountValue} searchAndAdd={searchAndAdd} error={error} success={success} createdInvoiceId={createdInvoiceId} add={add} change={change} remove={i=>setLines(x=>x.filter((_,j)=>j!==i))} save={save} newBill={newBill}/></>;
}