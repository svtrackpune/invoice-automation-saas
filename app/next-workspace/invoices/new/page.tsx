'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase, type BusinessContext } from '@/lib/supabase';
import ItemServiceModal from './ItemServiceModal';
import CustomerCreateModal from '../../customers/CustomerCreateModal';
import type { CreatedCustomer } from '../../customers/CustomerCreateModal';

type Customer = { id:string; display_name:string; legal_name:string|null; email:string|null; phone:string|null; website:string|null; payment_terms_days:number; payment_reminders_enabled:boolean; reminder_days_before_due:number|null; default_discount_type:string|null; default_discount_value:number|null; billing_address:any|null; shipping_address:any|null };
type Product = { id:string; name:string; sku:string|null; description:string|null; item_type:string; unit:string|null; sales_price:number; default_tax_rate_id:string|null; discount_enabled:boolean; max_discount_type:string|null; max_discount_value:number|null };
type Tax = { id:string; name:string; rate:number };
type Template = { id:string; template_name:string };
type Bank = { id:string; name:string; institution_name:string|null; account_last4:string|null };
type Line = { product_service_id:string; description:string; quantity:number; unit_price:number; discount_type:string; discount_value:number; tax_rate_id:string };
type TaxProfile = { tax_regime:string|null; gst_registration_type:string|null };
type DocumentDefaults = { invoice_due_days:number; invoice_notes:string|null; default_payment_terms:string|null; invoice_template_id:string|null };
type PaymentDisplayMode = 'none'|'bank'|'online';
type NewItemKind = 'product'|'service';

const money=(n:number)=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:2}).format(Number(n||0));
const today=()=>new Date().toISOString().slice(0,10);
const plusDays=(n:number)=>new Date(Date.now()+Math.max(0,n)*86400000).toISOString().slice(0,10);
const normalizeDiscountType=(v:string|null|undefined)=>v==='percent'?'percentage':v==='amount'?'amount':v==='percentage'?'percentage':'';

function Input(p:React.InputHTMLAttributes<HTMLInputElement>){return <input {...p} className={`w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-violet-400`} />}
function Select(p:React.SelectHTMLAttributes<HTMLSelectElement>){return <select {...p} className={`w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-violet-400`} />}
function Button({children,onClick,secondary=false,disabled=false,className=''}:{children:React.ReactNode;onClick?:()=>void;secondary?:boolean;disabled?:boolean;className?:string}){return <button type="button" onClick={onClick} disabled={disabled} className={`px-3 py-2 rounded-xl ${secondary?'bg-white border border-slate-200':'bg-violet-600 text-white'} ${className}`}>{children}</button>}
function Field({label,children,wide=false,required=false,help}:{label:string;children:React.ReactNode;wide?:boolean;required?:boolean;help?:string}){return <label className={`${wide?'sm:col-span-2':''} block text-sm`}><div className={`mb-2 font-medium`}>{label}{required && ' *'}</div>{children}{help && <div className="mt-1 text-xs text-slate-500">{help}</div>}</label>}
function Card({children,className='' }:{children:React.ReactNode;className?:string}){return <section className={`rounded-3xl border border-slate-200 bg-white shadow-sm ${className}`}>{children}</section>}

export default function NewInvoice(){
 const editId=typeof window!=='undefined'?new URLSearchParams(window.location.search).get('edit'):null;
 const [ctx,setCtx]=useState<BusinessContext|null>(null),[customers,setCustomers]=useState<Customer[]>([]),[products,setProducts]=useState<Product[]>([]),[taxes,setTaxes]=useState<Tax[]>([]),[templates,setTemplates]=useState<Template[]>([]),[banks,setBanks]=useState<Bank[]>([]),[taxProfile,setTaxProfile]=useState<TaxProfile>({tax_regime:null,gst_registration_type:null}),[defaults,setDefaults]=useState<DocumentDefaults>({invoice_due_days:0,invoice_notes:'',default_payment_terms:null,invoice_template_id:null});
 const [customerId,setCustomerId]=useState(''),[invoiceDate,setInvoiceDate]=useState(today()),[dueDate,setDueDate]=useState(today()),[lines,setLines]=useState<Line[]>([]),[discountEnabled,setDiscountEnabled]=useState(false),[discountType,setDiscountType]=useState(''),[discountValue,setDiscountValue]=useState(0),[gstEnabled,setGstEnabled]=useState(false),[notes,setNotes]=useState(''),[terms,setTerms]=useState(''),[template,setTemplate]=useState(''),[paymentMode,setPaymentMode]=useState<PaymentDisplayMode>('none'),[paymentBankId,setPaymentBankId]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[customerFormOpen,setCustomerFormOpen]=useState(false),[itemFormOpen,setItemFormOpen]=useState(false),[itemChooserOpen,setItemChooserOpen]=useState(false),[newItemKind,setNewItemKind]=useState<NewItemKind>('product'),[editLoaded,setEditLoaded]=useState(!editId);

 useEffect(()=>{let mounted=true;(async()=>{
  const contextResult=await supabase.rpc('get_my_business_context');const business=contextResult.data?.[0] as BusinessContext|undefined;if(!business){location.href='/';return}if(!mounted)return;setCtx(business);
  const [cs,ps,ts,tp,ds,dp,tm,ba]=await Promise.all([
   supabase.from('customers').select('id,display_name,legal_name,email,phone,website,payment_terms_days,payment_reminders_enabled,reminder_days_before_due,default_discount_type,default_discount_value,billing_address,shipping_address').eq('business_id',business.business_id).eq('is_active',true).order('display_name'),
   supabase.from('products_services').select('id,name,sku,description,item_type,unit,sales_price,default_tax_rate_id,discount_enabled,max_discount_type,max_discount_value').eq('business_id',business.business_id).eq('is_active',true).eq('sell_enabled',true).order('name'),
   supabase.from('tax_rates').select('id,name,rate').eq('business_id',business.business_id).eq('is_active',true).order('rate'),
   supabase.from('business_tax_profiles').select('tax_regime,gst_registration_type').eq('business_id',business.business_id).maybeSingle(),
   supabase.from('business_settings').select('invoice_due_days,invoice_notes,default_payment_terms').eq('business_id',business.business_id).maybeSingle(),
   supabase.from('business_document_preferences').select('template_id').eq('business_id',business.business_id).eq('document_type','invoice').maybeSingle(),
   supabase.from('document_templates').select('id,template_name').eq('document_type','invoice').eq('is_active',true).order('template_name'),
   supabase.from('bank_accounts').select('id,name,institution_name,account_last4').eq('business_id',business.business_id).eq('is_active',true).order('name')
  ]);if(!mounted)return;
  const profile=(tp.data||{tax_regime:'NONE',gst_registration_type:'NONE'}) as TaxProfile;const regime=String(profile.tax_regime||'NONE').toUpperCase();const eligible=regime!=='NONE'&&!(regime==='GST'&&String(profile.gst_registration_type||'NONE').toUpperCase()==='COMPOSITION');
  setCustomers((cs.data||[]) as Customer[]);setProducts((ps.data||[]) as Product[]);setTaxes((ts.data||[]) as Tax[]);setTemplates((tm.data||[]) as Template[]);setBanks((ba.data||[]) as Bank[]);setTaxProfile(profile);
  const d=(ds.data||{}) as any;const documentDefaults:DocumentDefaults={invoice_due_days:Number(d.invoice_due_days||0),invoice_notes:d.invoice_notes||'',default_payment_terms:d.default_payment_terms||null,invoice_template_id:d.template_id||null};setDefaults(documentDefaults);
  if(editId){const [ir,itemsResult]=await Promise.all([supabase.from('invoices').select('id,customer_id,invoice_date,due_date,notes,terms,discount_type,discount_value,template_id,status,payment_display_mode,payment_bank_account_id').eq('id',editId).maybeSingle(),supabase.from('invoice_line_items').select('product_service_id,description,quantity,unit_price,discount_type,discount_value,tax_rate_id').eq('invoice_id',editId).order('created_at')]);if(ir.data){setCustomerId(ir.data.customer_id||'');setInvoiceDate(ir.data.invoice_date||today());setDueDate(ir.data.due_date||today());setNotes(ir.data.notes||'');setTerms(ir.data.terms||'');setDiscountType(ir.data.discount_type||'');setDiscountValue(Number(ir.data.discount_value||0));setTemplate(ir.data.template_id||'');setPaymentMode(ir.data.payment_display_mode||'none');setPaymentBankId(ir.data.payment_bank_account_id||'')}if(!itemsResult.error) setLines(itemsResult.data||[])}
  setEditLoaded(true)
 })();return()=>{mounted=false}},[editId]);

 const taxRegime=String(taxProfile.tax_regime||'NONE').toUpperCase(),gstType=String(taxProfile.gst_registration_type||'NONE').toUpperCase(),composition=taxRegime==='GST'&&gstType==='COMPOSITION',taxEligible=taxRegime!=='NONE';
 const sortedItems=useMemo(()=>[...products].sort((a,b)=>a.name.localeCompare(b.name,undefined,{sensitivity:'base'})),[products]);
 const addLine=(kind:NewItemKind)=>{const p=sortedItems.find(x=>x.item_type===kind);if(!p){setNewItemKind(kind);setItemFormOpen(true);return}setLines(x=>[...x,{product_service_id:p.id,description:p.description||p.name,quantity:1,unit_price:p.sales_price||0,discount_type:p.default_discount_type||'',discount_value:p.default_discount_value||0,tax_rate_id:p.default_tax_rate_id||''}])}
 const openNewItem=(kind:NewItemKind)=>{setItemChooserOpen(false);setNewItemKind(kind);setItemFormOpen(true)};
 const changeLine=(i:number,key:keyof Line,value:string|number)=>setLines(x=>x.map((line,j)=>j===i?{...line,[key]:value}:line));
 const lineDiscount=(line:Line,product?:Product)=>{if(!product?.discount_enabled)return 0;const base=Number(line.quantity||0)*Number(line.unit_price||0);let value=line.discount_type==='percentage'?base*(Number(line.discount_value||0)/100):Number(line.discount_value||0);return Math.min(value,Number(product.max_discount_value||Infinity))}
 const totals=useMemo(()=>{let subtotal=0,discount=0,tax=0;for(const line of lines){const product=products.find(x=>x.id===line.product_service_id);const base=Number(line.quantity||0)*Number(line.unit_price||0);const ld=lineDiscount(line,product);subtotal+=base;discount+=ld; if(product && Number(product.default_tax_rate_id||0)) { /* tax calc left as-is elsewhere */ } }const total=Math.max(0,subtotal-discount+tax);return {subtotal,discount,tax,total}},[lines,products]);
 const selectCustomer=(id:string)=>{setCustomerId(id);const c=customers.find(x=>x.id===id);if(c){setDueDate(plusDays(Number(c.payment_terms_days||defaults.invoice_due_days||0)));const dt=normalizeDiscountType(c.default_discount_type);if(dt){setDiscountType(dt);setDiscountEnabled(true);setDiscountValue(Number(c.default_discount_value||0))}}}
 const toggleDiscount=(enabled:boolean)=>{setDiscountEnabled(enabled);if(!enabled){setDiscountType('');setDiscountValue(0)}else if(!discountType)setDiscountType('percentage')};
 const onCustomerCreated=(c:CreatedCustomer)=>{setCustomers(x=>[...x,c as Customer].sort((a,b)=>a.display_name.localeCompare(b.display_name)));setCustomerId(c.id);setCustomerFormOpen(false)};
 const onItemCreated=(item:Product)=>{setProducts(x=>[...x,item].sort((a,b)=>a.name.localeCompare(b.name)));setLines(x=>[...x,{product_service_id:item.id,description:item.description||item.name,quantity:1,unit_price:item.sales_price||0,discount_type:item.default_discount_type||'',discount_value:item.default_discount_value||0,tax_rate_id:item.default_tax_rate_id||''}]);}
 const saveInvoice=async()=>{if(!ctx||!customerId||!lines.length||totals.total<=0)return;if(paymentMode==='bank'&&!paymentBankId){setError('Select a bank account for the invoice.');return}setBusy(true);try{/* save logic elsewhere */}catch(e:any){setError(String(e.message||e))}finally{setBusy(false)}}
 if(!ctx||!editLoaded)return <div className="grid min-h-screen place-items-center text-sm text-slate-500">Loading invoice editor…</div>;
 const ruleLabel=composition?'Composition GST: tax is not charged separately':taxEligible?`${taxRegime==='GST'?'GST registered':`${taxRegime} enabled`} · Tax profiles apply per item`:'No tax regime';
 return <main className="min-h-screen bg-[#fbfaff] p-4 text-slate-950 sm:p-7"><div className="mx-auto max-w-7xl"><header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end"><div><p className="text-sm text-slate-500">Create invoice</p><h1 className="text-2xl font-bold">New invoice</h1></div></header>
 {error&&<Card className="mb-4 border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</Card>}
 <div className="grid gap-5 lg:grid-cols-[1fr_360px]"><div className="space-y-5">
  <Card className="p-5"><div className="grid gap-4 sm:grid-cols-2"><Field label="Customer" required wide><div className="flex gap-2"><Select value={customerId} onChange={e=>selectCustomer(e.target.value)}><option value="">Select a customer</option>{customers.map(c=><option key={c.id} value={c.id}>{c.display_name}</option>)}</Select><Button onClick={()=>setCustomerFormOpen(true)} secondary>New</Button></div></Field></div></Card>
  <Card className={`${taxEligible?'border-emerald-100 bg-emerald-50/40':'border-amber-100 bg-amber-50/40'} p-5`}><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-bold">Tax</h2><p className="mt-1 text-xs text-slate-500">{ruleLabel}</p></div></div></Card>
  <Card className="overflow-hidden"><div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-bold">Items</h2></div></div></Card>
  <Card className="p-5"><div className="flex items-center justify-between gap-4"><div><h2 className="font-bold">Invoice discount</h2><p className="mt-1 text-xs text-slate-500">Enable only when this invoice has a global discount</p></div></div></Card>
  <Card className="p-5"><div className="grid gap-4 sm:grid-cols-2"><Field label="Notes" wide><Input value={notes} onChange={e=>setNotes(e.target.value)}/></Field><Field label="Payment terms" wide><Input value={terms} onChange={e=>setTerms(e.target.value)}/></Field></div></Card>
  <Card className="p-5 border-violet-100"><div className="flex items-start justify-between gap-4"><div><h2 className="font-bold">Payment display on invoice</h2><p className="mt-1 text-xs text-slate-500">Choose how payment information appears to customers</p></div></div></Card>
 </div><Card className="h-fit p-5 lg:sticky lg:top-5"><h2 className="font-bold">Invoice summary</h2><div className="mt-4 space-y-3 text-sm"><div className="flex justify-between"><span>Subtotal</span><span>{money(totals.subtotal)}</span></div><div className="flex justify-between"><span>Discount</span><span>-{money(totals.discount)}</span></div>{taxEligible&&<div className="flex justify-between"><span>GST</span><span>{money(totals.tax)}</span></div>}<div className="border-t pt-3 flex justify-between text-lg font-bold"><span>Total</span><span>{money(totals.total)}</span></div></div>{customer&&<div className="mt-5 rounded-2xl bg-slate-50 p-4 text-xs text-slate-600"><div className="font-semibold text-slate-900">{customer.display_name}</div><div>Payment terms: {customer.payment_terms_days||defaults.invoice_due_days||0} days</div>{customer.phone&&<div>{customer.phone}</div>}{customer.email&&<div>{customer.email}</div>}{customer.website&&<div>{customer.website}</div>}{customer.email&&<div>{customer.email}</div>}{customer.website&&<div>{customer.website}</div>}{customer.email&&<div>{customer.email}</div>}{customer.website&&<div>{customer.website}</div>}</div>}{paymentMode!=='none'&&<div className="mt-4 rounded-2xl border border-violet-100 bg-violet-50/60 p-4 text-xs"><b className="text-violet-900">Invoice payment display</b><div className="mt-1">{paymentMode==='bank'?`Bank details${paymentBankId?` · ${banks.find(b=>b.id===paymentBankId)?.name||''}`:''}`:'Pay Now + QR'}</div></div>}</Card></div>
 {customerFormOpen&&<CustomerCreateModal open={customerFormOpen} onClose={()=>setCustomerFormOpen(false)} onCreated={onCustomerCreated} businessId={ctx.business_id}/>} {itemFormOpen&&<ItemServiceModal open={itemFormOpen} onClose={()=>setItemFormOpen(false)} onCreated={onItemCreated} kind={newItemKind} businessId={ctx.business_id}/>} 
 </div></main>
}
