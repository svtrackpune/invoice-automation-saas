import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json"}});
const sign=async(secret:string,timestamp:string,body:string)=>{
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const sig=await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(timestamp+body));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
};
const safe=(a:string,b:string)=>{if(a.length!==b.length)return false;let x=0;for(let i=0;i<a.length;i++)x|=a.charCodeAt(i)^b.charCodeAt(i);return x===0;};

Deno.serve(async(req)=>{
  if(req.method!=="POST")return json({error:"POST required"},405);
  const raw=await req.text(),signature=req.headers.get("x-webhook-signature")||"",timestamp=req.headers.get("x-webhook-timestamp")||"";
  if(!raw||!signature||!timestamp)return json({error:"Webhook body/headers missing"},401);
  let parsed:Record<string,unknown>;try{parsed=JSON.parse(raw) as Record<string,unknown>;}catch{return json({error:"Invalid webhook JSON"},400);}
  const data=parsed.data&&typeof parsed.data==="object"?parsed.data as Record<string,unknown>:{};
  const order=data.order&&typeof data.order==="object"?data.order as Record<string,unknown>:{};
  const tags=order.order_tags&&typeof order.order_tags==="object"?order.order_tags as Record<string,unknown>:{};
  const linkId=typeof data.link_id==="string"?data.link_id:typeof data.cf_link_id==="string"?data.cf_link_id:typeof tags.cf_link_id==="string"?tags.cf_link_id:typeof tags.link_id==="string"?tags.link_id:"";
  if(!linkId)return json({ok:true,ignored:true});
  const supabaseUrl=Deno.env.get("SUPABASE_URL")!,serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");if(!serviceKey)return json({error:"Payment service is not configured"},503);
  const admin=createClient(supabaseUrl,serviceKey);
  const {data:link}=await admin.from("payment_links").select("id,business_id,invoice_id,amount,currency_code,provider_link_id").eq("provider","cashfree").eq("provider_link_id",linkId).maybeSingle();if(!link)return json({ok:true,ignored:true});
  const {data:credentials,error:credentialError}=await admin.rpc("resolve_payment_gateway_credentials",{p_business_id:link.business_id,p_provider:"cashfree"});
  if(credentialError||!credentials?.webhook_secret)return json({error:"Cashfree merchant webhook signing secret is not configured"},503);
  if(!safe(await sign(String(credentials.webhook_secret),timestamp,raw),signature))return json({error:"Invalid signature"},401);
  try{
    const eventId=String(req.headers.get("x-request-id")||parsed.event_id||parsed.cf_event_id||crypto.randomUUID()),eventType=String(parsed.type||parsed.event||data.link_status||"cashfree");
    const claimed=await admin.rpc("claim_payment_webhook_event",{p_provider:"cashfree",p_event_id:eventId,p_event_type:eventType,p_signature:signature,p_payload:parsed});if(claimed.error)throw claimed.error;if(!claimed.data)return json({ok:true,duplicate:true});
    const statusRaw=String(data.link_status||data.status||"").toUpperCase();
    const payment=data.payment&&typeof data.payment==="object"?data.payment as Record<string,unknown>:{};
    const paymentStatus=String(payment.payment_status||payment.payment_status_code||"").toUpperCase();
    const tx=typeof payment.cf_payment_id==="string"?payment.cf_payment_id:typeof payment.payment_id==="string"?payment.payment_id:typeof order.order_id==="string"?order.order_id:typeof data.order_id==="string"?data.order_id:null;
    const amount=Number(payment.payment_amount??payment.amount??0);
    const successful=["PAID","SUCCESS","COMPLETED","SUCCESSFUL","CAPTURED"].includes(statusRaw)||["SUCCESS","PAID","SUCCESSFUL","CAPTURED"].includes(paymentStatus);
    if(successful&&tx&&Number.isFinite(amount)&&amount>0){
      if(amount>Number(link.amount)+0.000001)throw new Error("Cashfree webhook amount exceeds the payment link amount");
      const settled=await admin.rpc("record_gateway_payment",{p_provider:"cashfree",p_provider_link_id:link.provider_link_id,p_provider_transaction_id:tx,p_event_id:eventId,p_gross_amount:amount,p_fee_amount:0,p_net_amount:amount,p_payment_date:new Date().toISOString().slice(0,10),p_notes:"Cashfree payment link webhook"});if(settled.error)throw settled.error;
      await admin.from("payment_links").update({status:amount+0.000001>=Number(link.amount)?"paid":"partially_paid",gateway_transaction_id:tx,updated_at:new Date().toISOString(),metadata:{provider_event_id:eventId}}).eq("id",link.id).eq("business_id",link.business_id);
    }else if(successful){
      await admin.from("payment_links").update({metadata:{provider_event_id:eventId,accounting_waiting_for_payment_event:true},updated_at:new Date().toISOString()}).eq("id",link.id).eq("business_id",link.business_id);
    }else if(["PARTIALLY_PAID","PARTIAL_PAYMENT"].includes(statusRaw)){
      await admin.from("payment_links").update({status:"partially_paid",updated_at:new Date().toISOString(),metadata:{provider_event_id:eventId}}).eq("id",link.id).eq("business_id",link.business_id);
    }else if(["CANCELLED","EXPIRED","FAILED"].includes(statusRaw)){
      await admin.from("payment_links").update({status:statusRaw==="CANCELLED"?"cancelled":statusRaw==="EXPIRED"?"expired":"failed",updated_at:new Date().toISOString(),metadata:{provider_event_id:eventId}}).eq("id",link.id).eq("business_id",link.business_id);
    }
    await admin.from("payment_webhook_events").update({status:"processed",processed_at:new Date().toISOString(),error_message:null}).eq("event_id",eventId).eq("provider","cashfree");
    return json({ok:true});
  }catch(error){return json({error:error instanceof Error?error.message:"Cashfree webhook processing failed"},500);}
});