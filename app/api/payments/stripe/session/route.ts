import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { StripePaymentAdapter } from '@/lib/server/payments/stripe';

export const runtime='nodejs';
const json=(body:unknown,status=200)=>NextResponse.json(body,{status});

export async function POST(req:Request){
  try{
    const authorization=req.headers.get('authorization');if(!authorization)return json({error:'Authorization required'},401);
    const supabaseUrl=process.env.NEXT_PUBLIC_SUPABASE_URL,publishableKey=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,serviceRoleKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
    if(!supabaseUrl||!publishableKey||!serviceRoleKey)return json({error:'Payment service is not configured'},503);
    const userClient=createClient(supabaseUrl,publishableKey,{global:{headers:{Authorization:authorization}}});
    const {data:{user}}=await userClient.auth.getUser();if(!user)return json({error:'Unauthorized'},401);
    const {data:contexts,error:contextError}=await userClient.rpc('get_my_business_context');const context=contexts?.[0];
    if(contextError||!context)return json({error:contextError?.message||'Business context not found'},403);
    const body=await req.json(),invoiceId=String(body.invoice_id||'');if(!invoiceId)return json({error:'invoice_id is required'},400);
    const admin=createClient(supabaseUrl,serviceRoleKey);
    const {data:credentials,error:credentialError}=await admin.rpc('resolve_payment_gateway_credentials',{p_business_id:context.business_id,p_provider:'stripe'});
    if(credentialError||!credentials?.enabled||typeof credentials.secret!=='string'||!credentials.secret)return json({error:'Stripe is not enabled or merchant credentials are incomplete.'},503);
    const {data:invoice,error:invoiceError}=await admin.from('invoices').select('id,invoice_number,customer_id,balance_due,currency_code,status,journal_entry_id').eq('id',invoiceId).eq('business_id',context.business_id).single();
    if(invoiceError||!invoice)return json({error:'Invoice not found'},404);
    if(!invoice.journal_entry_id||['void','draft'].includes(String(invoice.status)))return json({error:'Invoice must be posted before creating a payment session'},409);
    if(Number(invoice.balance_due)<=0)return json({error:'Invoice has no outstanding balance'},400);
    const customer=invoice.customer_id?(await admin.from('customers').select('email').eq('id',invoice.customer_id).eq('business_id',context.business_id).maybeSingle()).data:null;
    const adapter=new StripePaymentAdapter(credentials.secret);
    const amount=Number(invoice.balance_due),reservationId=crypto.randomUUID();
    const session=await adapter.createPaymentSession({businessId:context.business_id,invoiceId:invoice.id,amount,currency:invoice.currency_code,successUrl:String(body.success_url||new URL('/next-workspace/payments?stripe=success',req.url).toString()),cancelUrl:String(body.cancel_url||new URL('/next-workspace/payments?stripe=cancelled',req.url).toString()),description:'Invoice '+invoice.invoice_number,customerEmail:customer?.email||null,mode:body.mode==='payment_intent'?'payment_intent':'checkout',metadata:{moneymatters_payment_link_id:reservationId}});
    if(!session.checkoutUrl&&session.mode==='checkout')return json({error:'Stripe Checkout session did not return a URL'},502);
    const {data:link,error:linkError}=await admin.from('payment_links').insert({id:reservationId,business_id:context.business_id,invoice_id:invoice.id,provider:'stripe',provider_link_id:session.providerReference,amount,currency_code:invoice.currency_code,status:'created',short_url:session.checkoutUrl||null,created_by:user.id,metadata:{mode:session.mode,payment_intent_id:session.paymentIntentId||null,moneymatters_payment_link_id:reservationId}}).select('*').single();
    if(linkError||!link)return json({error:linkError?.message||'Stripe payment session registration failed'},500);
    return json({payment_session:{...session,payment_link_id:link.id,payment_link:link}});
  }catch(error){return json({error:error instanceof Error?error.message:'Unexpected error'},500);}
}