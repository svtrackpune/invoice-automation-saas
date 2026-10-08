import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { StripePaymentAdapter } from '@/lib/server/payments/stripe';

export const runtime='nodejs';
const json=(body:unknown,status=200)=>NextResponse.json(body,{status});

export async function POST(req:Request){
  const supabaseUrl=process.env.NEXT_PUBLIC_SUPABASE_URL,serviceRoleKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!supabaseUrl||!serviceRoleKey)return json({error:'Payment service is not configured'},503);
  const raw=await req.text();let body:Record<string,unknown>;
  try{body=JSON.parse(raw) as Record<string,unknown>;}catch{return json({error:'Invalid webhook JSON'},400);}
  const data=body.data&&typeof body.data==='object'?body.data as Record<string,unknown>:{};
  const object=data.object&&typeof data.object==='object'?data.object as Record<string,unknown>:{};
  const providerLinkId=typeof object.id==='string'?object.id:typeof object.payment_intent==='string'?object.payment_intent:'';
  if(!providerLinkId)return json({error:'Stripe payment identifier is missing'},400);
  const admin=createClient(supabaseUrl,serviceRoleKey);
  const {data:link,error:linkError}=await admin.from('payment_links').select('id,business_id,invoice_id,amount,currency_code').eq('provider','stripe').eq('provider_link_id',providerLinkId).maybeSingle();
  if(linkError||!link)return json({ok:true,ignored:true});
  const {data:credentials,error:credentialError}=await admin.rpc('resolve_payment_gateway_credentials',{p_business_id:link.business_id,p_provider:'stripe'});
  if(credentialError||!credentials?.webhook_secret)return json({error:'Stripe merchant webhook signing secret is not configured'},503);
  const adapter=new StripePaymentAdapter(String(credentials.webhook_secret));
  let verified:Awaited<ReturnType<StripePaymentAdapter['verifyWebhook']>>;
  try{verified=await adapter.verifyWebhook(new Request(req.url,{method:'POST',headers:req.headers,body:raw}));}
  catch(error){return json({error:error instanceof Error?error.message:'Invalid webhook'},401);}
  let payload;try{payload=adapter.normalizeWebhookPayload(verified.event,verified.signature);}
  catch(error){return json({error:error instanceof Error?error.message:'Invalid webhook payload'},400);}
  try{
    const claimed=await admin.rpc('claim_payment_webhook_event',{p_provider:'stripe',p_event_id:payload.eventId,p_event_type:payload.eventType,p_signature:verified.signature,p_payload:verified.event});
    if(claimed.error)throw claimed.error;if(!claimed.data)return json({ok:true,duplicate:true});
    if(payload.currency!==String(link.currency_code).toUpperCase())throw new Error('Stripe webhook currency does not match the payment session currency');
    if(Math.abs(Number(link.amount)-payload.amount)>0.000001)throw new Error('Stripe webhook amount does not match the payment session amount');
    if(payload.eventType==='payment_intent.payment_failed'||payload.eventType==='checkout.session.async_payment_failed'){
      await admin.from('payment_webhook_events').update({status:'processed',processed_at:new Date().toISOString(),error_message:null}).eq('event_id',payload.eventId).eq('provider','stripe');
      return json({ok:true});
    }
    const settled=await admin.rpc('record_gateway_payment',{p_provider:'stripe',p_provider_link_id:payload.providerLinkId,p_provider_transaction_id:payload.providerTransactionId,p_event_id:payload.eventId,p_amount:payload.amount,p_payment_date:payload.paymentDate,p_notes:payload.notes});
    if(settled.error)throw settled.error;
    await admin.from('payment_links').update({status:'paid',gateway_transaction_id:payload.providerTransactionId,updated_at:new Date().toISOString(),metadata:{provider_event_id:payload.eventId,...payload.metadata}}).eq('id',link.id).eq('business_id',link.business_id);
    await admin.from('payment_webhook_events').update({status:'processed',processed_at:new Date().toISOString(),error_message:null}).eq('event_id',payload.eventId).eq('provider','stripe');
    return json({ok:true});
  }catch(error){
    await admin.from('payment_webhook_events').update({status:'failed',processed_at:new Date().toISOString(),error_message:error instanceof Error?error.message:'Processing failed'}).eq('event_id',payload.eventId).eq('provider','stripe');
    return json({error:error instanceof Error?error.message:'Webhook processing failed'},500);
  }
}