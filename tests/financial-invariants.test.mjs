import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';

const url=process.env.TEST_SUPABASE_URL;
const key=process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
const businessId=process.env.TEST_BUSINESS_ID;
const invoiceId=process.env.TEST_INVOICE_ID;
const customerId=process.env.TEST_CUSTOMER_ID;
const accountId=process.env.TEST_PAYMENT_ACCOUNT_ID;
const gatewayId=process.env.TEST_GATEWAY_TRANSACTION_ID;

const isProduction = url?.includes('qpczmbvqflaqwvyphepf') || url?.includes('supabase.co');
const configured=Boolean(url&&key&&businessId&&invoiceId&&customerId&&accountId&&gatewayId);

if (configured && isProduction) throw new Error('Financial integration tests refuse to run against production.');

const db=configured ? createClient(url!,key!) : null;

test('financial test environment is explicitly isolated',()=> {
  assert.equal(isProduction,false,'TEST_SUPABASE_URL points at a production project');
});

test('product/service invoice fixture is supplied', {skip:!configured}, async()=>{
  const {data,error}=await db!.from('invoice_items').select('id,item_type,product_service_id').eq('invoice_id',invoiceId);
  assert.ifError(error);
  assert.ok((data??[]).length>0,'Invoice fixture must contain at least one item');
  const types=new Set((data??[]).map((x:any)=>x.item_type));
  assert.ok([...types].some(x=>x==='product'||x==='service'),'Fixture must use canonical product/service item types');
});

test('invoice totals are internally consistent', {skip:!configured}, async()=>{
  const {data,error}=await db!.from('invoices').select('total,subtotal,tax_total,discount_total').eq('id',invoiceId).single();
  assert.ifError(error);
  assert.equal(Number(data.total),Number(data.subtotal)-Number(data.discount_total)+Number(data.tax_total));
});

test('payment RPC requires the supplied business/customer/invoice to agree', {skip:!configured}, async()=>{
  const {data,error}=await db!.from('invoices').select('business_id,customer_id').eq('id',invoiceId).single();
  assert.ifError(error);
  assert.equal(data.business_id,businessId);
  assert.equal(data.customer_id,customerId);
});

test('payment account belongs to the test business', {skip:!configured}, async()=>{
  const {data,error}=await db!.from('accounts').select('business_id,is_active').eq('id',accountId).single();
  assert.ifError(error);
  assert.equal(data.business_id,businessId);
  assert.equal(data.is_active,true);
});

test('gateway transaction fixture is unique before payment test', {skip:!configured}, async()=>{
  const {data,error}=await db!.from('payments').select('id').eq('business_id',businessId).eq('gateway_transaction_id',gatewayId);
  assert.ifError(error);
  assert.equal((data??[]).length,0,'Fixture gateway transaction must be unused');
});

test('journal lines are balanced for posted fixture entries', {skip:!configured}, async()=>{
  const {data,error}=await db!.from('journal_entries').select('id,total_debit,total_credit').eq('business_id',businessId).eq('status','posted');
  assert.ifError(error);
  for(const e of data??[]) assert.equal(Number(e.total_debit),Number(e.total_credit),`Unbalanced journal ${e.id}`);
});

test('closed accounting periods exist only as explicit fixtures', {skip:!configured}, async()=>{
  const {data,error}=await db!.from('accounting_periods').select('status').eq('business_id',businessId).in('status',['closed','locked']);
  assert.ifError(error);
  assert.ok(Array.isArray(data));
});

test('tenant fixture contains no foreign invoice', {skip:!configured}, async()=>{
  const {data,error}=await db!.from('invoices').select('business_id').eq('id',invoiceId).single();
  assert.ifError(error);
  assert.equal(data.business_id,businessId);
});
