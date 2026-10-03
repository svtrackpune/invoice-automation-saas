'use client';
import {useEffect,useMemo,useState} from 'react';
import {supabase,type BusinessContext} from '@/lib/supabase';
import CashBillControlled from './CashBillControlled';
import OfflineCashBillSync from '@/components/OfflineCashBillSync';
import PosServiceWorker from '@/components/PosServiceWorker';
import { queueOfflineCashBill } from '@/lib/client/offline-cash-bills';
type Product={id:string;name:string;sku:string|null;sales_price:number;default_tax_rate_id:string|null};
type Tax={id:string;name:string;rate:number};
type Account={id:string;code:string;name:string;account_subtype:string|null};
type TaxProfile={tax_regime:string|null;gst_registration_type:string|null;gstin:string|null};
type Bank={id:string;name:string;institution_name:string|null;account_last4:string|null;account_type:string|null;linked_account_id:string|null};
type Line={product_service_id:string;quantity:number;unit_price:number;tax_rate_id:string};
const today=()=>new Date().toISOString().slice(0,10);
export default function CashBillPage(){
 const[ctx,setCtx]=useState<BusinessContext|null>(null),[products,setProducts]=useState<Product[]>([]),[taxes,setTaxes]=useState<Tax[]>([]),[cashAccount,setCashAccount]=useState<Account|null>(null),[upiAccount,setUpiAccount]=useState<Account|null>(null),[upiBankLabel,setUpiBankLabel]=useState(''),[taxRegistered,setTaxRegistered]=useState(false),[lines,setLines]=useState<Line[]>([]),[date,setDate]=useState(today()),[customerPhone,setCustomerPhone]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[success,setSuccess]=useState(''),[createdInvoiceId,setCreatedInvoiceId]=useState(''),[paymentMethod,setPaymentMethod]=useState<'cash'|'upi'>('cash');
 useEffect(()=>{(async()=>{const r=await supabase.rpc('get_my_business_context');const c=r.data?.[0] as BusinessContext|undefined;if(!c){location.href='/';return}setCtx(c);const[ps,ts,as,tp,mapping]=await Promise.all([supabase.from('products_services').select('id,name,sku,sales_price,default_tax_rate_id').eq('business_id',c.business_id).eq('is_active',true).order('name'),supabase.from('tax_rates').select('id,name,rate').eq('business_id',c.business_id).eq('is_active',true).order('rate'),supabase.from('accounts').select('id,code,name,account_subtype').eq('business_id',c.business_id).eq('is_active',true).order('code'),supabase.from('business_tax_profiles').select('tax_regime,gst_registration_type,gstin').eq('business_id',c.business_id).maybeSingle(),supabase.from('business_payment_method_accounts').select('bank_account_id,is_active').eq('business_id',c.business_id).eq('payment_method','upi').eq('is_active',true).maybeSingle()]);setProducts(ps.data||[]);setTaxes(ts.data||[]);const accounts=(as.data||[]) as Account[];setCashAccount(accounts.find(a=>a.account_subtype==='cash')||accounts.find(a=>a.code==='1000')||null);const profile=tp.data as TaxProfile|null;const registered=Boolean(profile&&profile.tax_regime&&profile.tax_regime!=='NONE'&&((profile.tax_regime!=='GST')||profile.gst_registration_type&&profile.gst_registration_type!=='NONE'));setTaxRegistered(registered);if(mapping.data?.bank_account_id){const bank=await supabase.from('bank_accounts').select('id,name,institution_name,account_last4,account_type,linked_account_id').eq('id',mapping.data.bank_account_id).eq('business_id',c.business_id).maybeSingle();const bankRow=bank.data;// Narrow the nullable Supabase row before using bank fields.
if(bankRow){setUpiBankLabel(`${bankRow.name} · ${bankRow.institution_name||'Bank'}${bankRow.account_last4?` · ••••${bankRow.account_last4}`:''}`);const linked=accounts.find(a=>a.id===bankRow.linked_account_id);if(linked)setUpiAccount(linked);}}})();},[]);
 const add=()=>{const p=products[0];if(p)setLines(x=>[...x,{product_service_id:p.id,quantity:1,unit_price:Number(p.sales_price||0),tax_rate_id:taxRegistered?(p.default_tax_rate_id||''):''}])};
 const change=(i:number,k:keyof Line,v:any)=>setLines(x=>x.map((l,j)=>j===i?{...l,[k]:v}:l));
 const totals=useMemo(()=>{let subtotal=0,tax=0;for(const l of lines){const base=Number(l.quantity||0)*Number(l.unit_price||0);subtotal+=base;if(taxRegistered)tax+=base*(taxes.find(t=>t.id===l.tax_rate_id)?.rate||0)/100}return{subtotal,tax,total:subtotal+tax}},[lines,taxes,taxRegistered]);
 const save=async()=>{
  if(!ctx||!lines.length||totals.total<=0)return;
  setBusy(true);setError('');setSuccess('');setCreatedInvoiceId('');
  let settlementAccount=paymentMethod==='cash'?cashAccount:upiAccount;
  if(paymentMethod==='upi'&&!settlementAccount){
    const mapping=await supabase.from('business_payment_method_accounts').select('bank_account_id').eq('business_id',ctx.business_id).eq('payment_method','upi').eq('is_active',true).maybeSingle();
    if(mapping.data?.bank_account_id){
      const linked=await supabase.rpc('ensure_bank_account_ledger',{p_business_id:ctx.business_id,p_bank_account_id:mapping.data.bank_account_id});
      if(!linked.error&&linked.data){const row=await supabase.from('accounts').select('id,code,name,account_subtype').eq('id',linked.data).eq('business_id',ctx.business_id).maybeSingle();settlementAccount=(row.data as Account|null);}
    }
  }
  if(!settlementAccount){setError('No settlement account is configured for the selected payment method. Open Cash & Carry settings and configure UPI, or use Cash.');setBusy(false);return;}
  const payload={businessId:ctx.business_id,phone:customerPhone.trim(),invoiceDate:date,items:lines.map(l=>taxRegistered?l:{...l,tax_rate_id:''}),paymentMethod,accountId:settlementAccount.id,invoiceDiscountType:null,invoiceDiscountValue:0,notes:'Cash & Carry',terms:'Paid in full at counter.'} as const;
  const tempPosUuid=typeof crypto!=='undefined'&&'randomUUID'in crypto?crypto.randomUUID():undefined;
  if(!navigator.onLine){
    const queued=await queueOfflineCashBill(payload,{tempPosUuid});
    setSuccess(`Offline mode: Cash & Carry bill ${queued.offlineTicketNumber} queued and will sync automatically when connectivity returns.`);setBusy(false);return;
  }
  const bill=await supabase.rpc('create_cash_bill',{p_business_id:payload.businessId,p_phone:payload.phone,p_invoice_date:payload.invoiceDate,p_items:payload.items,p_payment_method:payload.paymentMethod,p_account_id:payload.accountId,p_invoice_discount_type:null,p_invoice_discount_value:0,p_notes:payload.notes,p_terms:payload.terms});
  if(bill.error){
    const msg=bill.error.message||'Cash Bill could not be saved.';
    if(!navigator.onLine||/fetch|network|offline|failed to send|connection/i.test(msg)){
      const queued=await queueOfflineCashBill(payload,{tempPosUuid});
      setSuccess(`Connection lost: Cash & Carry bill ${queued.offlineTicketNumber} queued for automatic sync. No duplicate posting will be created if the original request reached the server.`);setBusy(false);return;
    }
    setError(msg);setBusy(false);return;
  }
  setSuccess(`Cash & Carry bill created, posted and marked paid via ${paymentMethod==='cash'?'Cash':'UPI'}.`);setCreatedInvoiceId(String(bill.data));setLines([]);setCustomerPhone('');setDate(today());setPaymentMethod('cash');setBusy(false);
 }
 const newBill=()=>{setLines([]);setCustomerPhone('');setDate(today());setPaymentMethod('cash');setError('');setSuccess('');setCreatedInvoiceId('')};
 if(!ctx)return <div className="grid min-h-screen place-items-center"><span className="text-sm text-slate-500">Loading Cash & Carry workspace…</span></div>;
 return <><PosServiceWorker/><OfflineCashBillSync businessId={ctx.business_id}/><CashBillControlled date={date} setDate={setDate} customerPhone={customerPhone} setCustomerPhone={setCustomerPhone} lines={lines} products={products} taxes={taxes} taxRegistered={taxRegistered} totals={totals} busy={busy} cashAccount={cashAccount} upiAccount={upiAccount} upiBankLabel={upiBankLabel} paymentMethod={paymentMethod} setPaymentMethod={setPaymentMethod} error={error} success={success} createdInvoiceId={createdInvoiceId} add={add} change={change} remove={i=>setLines(x=>x.filter((_,j)=>j!==i))} save={save} newBill={newBill}/></>;
}
