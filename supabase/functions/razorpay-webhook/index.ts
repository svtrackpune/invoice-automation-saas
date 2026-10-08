import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json"}});
const hmac=async(secret:string,body:string)=>{
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const sig=await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map((b)=>b.toString(16).padStart(2,"0")).join("");
};
const safe=(a:string,b:string)=>{if(a.length!==b.length)return false;let x=0;for(let i=0;i<a.length;i++)x|=a.charCodeAt(i)^b.charCodeAt(i);return x===0;};

Deno.serve(async(req)=>{
  if(req.method!=="POST")return json({error:"POST required"},405);
  const raw=await req.text(),signature=req.headers.get("x-razorpay-signature")||"",eventId=req.headers.get("x-razorpay-event-id")||"";
  if(!raw||!signature||!eventId)return json({error:"Webhook body/headers missing"},401);
  let parsed:Record<string,unknown>;
  try{parsed=JSON.parse(raw) as Record<string,unknown>;}catch{return json({error:"Invalid webhook JSON"},400);}
  const root=parsed.payload&&typeof parsed.payload==="object"?parsed.payload as Record<string,unknown>:{};
  const linkEntity=root.payment_link&&typeof root.payment_link==="object"?root.payment_link as Record<string,unknown>:{};
  const payment=root.payment&&typeof root.payment==="object"?root.payment as Record<string,unknown>:{};
  const providerLinkId=typeof linkEntity.id==="string"?linkEntity.id:"";
  if(!providerLinkId)return json({error:"Razorpay payment link id missing"},400);

  const supabaseUrl=Deno.env.get("SUPABASE_URL")!,serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!serviceKey)return json({error:"Payment service is not configured"},503);
  const admin=createClient(supabaseUrl,serviceKey);
  const {data:link}=await admin.from("payment_links").select("id,business_id,invoice_id,status,provider_link_id").eq("provider","razorpay").eq("provider_link_id",providerLinkId).maybeSingle();
  if(!link)return json({ok:true,ignored:true});

  const {data:credentials,error:credentialError}=await admin.rpc("resolve_payment_gateway_credentials",{p_business_id:link.business_id,p_provider:"razorpay"});
  if(credentialError||!credentials?.webhook_secret)return json({error:"Razorpay merchant webhook signing secret is not configured"},503);
  if(!safe(await hmac(String(credentials.webhook_secret),raw),signature))return json({error:"Invalid signature"},401);

  try{
    const eventType=String(parsed.event||"unknown");
    const claimed=await admin.rpc("claim_payment_webhook_event",{p_provider:"razorpay",p_event_id:eventId,p_event_type:eventType,p_signature:signature,p_payload:parsed});
    if(claimed.error)throw claimed.error;if(!claimed.data)return json({ok:true,duplicate:true});
    const map:Record<string,string>={"payment_link.paid":"paid","payment_link.partially_paid":"partially_paid","payment_link.cancelled":"cancelled","payment_link.expired":"expired"};
    if(map[eventType])await admin.from("payment_links").update({status:map[eventType],updated_at:new Date().toISOString(),gateway_transaction_id:typeof payment.id==="string"?payment.id:null,metadata:{provider_event_id:eventId}}).eq("id",link.id).eq("business_id",link.business_id);
    if(eventType==="payment_link.paid"||eventType==="payment_link.partially_paid"){
      const amount=Number(payment.amount||linkEntity.amount_paid||0)/100;
      const tx=typeof payment.id==="string"?payment.id:providerLinkId+":"+eventId;
      if(amount<=0)throw new Error("Webhook payment amount is invalid");
      const settled=await admin.rpc("record_gateway_payment",{p_provider:"razorpay",p_provider_link_id:providerLinkId,p_provider_transaction_id:tx,p_event_id:eventId,p_amount:amount,p_payment_date:new Date().toISOString().slice(0,10),p_notes:"Razorpay "+eventType});
      if(settled.error)throw settled.error;
    }
    await admin.from("payment_webhook_events").update({status:"processed",processed_at:new Date().toISOString(),error_message:null}).eq("event_id",eventId).eq("provider","razorpay");
    return json({ok:true});
  }catch(error){
    await admin.from("payment_webhook_events").update({status:"failed",processed_at:new Date().toISOString(),error_message:error instanceof Error?error.message:"Processing failed"}).eq("event_id",eventId).eq("provider","razorpay");
    return json({error:error instanceof Error?error.message:"Webhook processing failed"},500);
  }
});