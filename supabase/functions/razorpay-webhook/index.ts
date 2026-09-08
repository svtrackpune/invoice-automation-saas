import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const hmac = async (secret:string, body:string) => {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), {name:"HMAC",hash:"SHA-256"}, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map(b=>b.toString(16).padStart(2,"0")).join("");
};
const timingSafe = (a:string,b:string) => { if(a.length!==b.length) return false; let x=0; for(let i=0;i<a.length;i++) x|=a.charCodeAt(i)^b.charCodeAt(i); return x===0; };
const json = (body:unknown,status=200) => new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json"}});

Deno.serve(async(req) => {
  if(req.method!=="POST") return json({error:"POST required"},405);
  const raw=await req.text();
  const signature=req.headers.get("x-razorpay-signature")||"";
  const eventId=req.headers.get("x-razorpay-event-id")||"";
  const secret=Deno.env.get("RAZORPAY_WEBHOOK_SECRET");
  if(!secret||!signature||!eventId) return json({error:"Webhook configuration/headers missing"},401);
  const expected=await hmac(secret,raw);
  if(!timingSafe(expected,signature)) return json({error:"Invalid signature"},401);

  const admin=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    const payload=JSON.parse(raw);
    const eventType=String(payload.event||"unknown");
    const pl=payload?.payload?.payment_link?.entity;
    const payment=payload?.payload?.payment?.entity;
    const providerLinkId=pl?.id;

    const {data:claimed,error:claimError}=await admin.rpc("claim_payment_webhook_event",{
      p_provider:"razorpay",p_event_id:eventId,p_event_type:eventType,p_signature:signature,p_payload:payload
    });
    if(claimError) throw claimError;
    if(!claimed) return json({ok:true,duplicate:true});

    if(!providerLinkId) {
      await admin.from("payment_webhook_events").update({status:"ignored",processed_at:new Date().toISOString()}).eq("event_id",eventId).eq("provider","razorpay");
      return json({ok:true,ignored:true});
    }

    const {data:link}=await admin.from("payment_links").select("id,business_id,invoice_id,status").eq("provider","razorpay").eq("provider_link_id",providerLinkId).single();
    if(!link) {
      await admin.from("payment_webhook_events").update({status:"ignored",processed_at:new Date().toISOString(),error_message:"Payment link not registered"}).eq("event_id",eventId).eq("provider","razorpay");
      return json({ok:true,ignored:true});
    }

    const statusMap:Record<string,string>={"payment_link.paid":"paid","payment_link.partially_paid":"partially_paid","payment_link.cancelled":"cancelled","payment_link.expired":"expired"};
    const mapped=statusMap[eventType];
    if(mapped) await admin.from("payment_links").update({status:mapped,updated_at:new Date().toISOString(),gateway_transaction_id:payment?.id||null,metadata:{provider_event_id:eventId}}).eq("id",link.id);

    if(eventType==="payment_link.paid"||eventType==="payment_link.partially_paid") {
      const {data:inv}=await admin.from("invoices").select("customer_id").eq("id",link.invoice_id).eq("business_id",link.business_id).single();
      const {data:acct}=await admin.from("accounts").select("id").eq("business_id",link.business_id).eq("code","1000").eq("is_active",true).maybeSingle();
      if(!inv||!acct) throw new Error("Invoice/customer or payment account not found");
      const amount=Number(payment?.amount||pl?.amount_paid||0)/100;
      if(amount<=0) throw new Error("Webhook payment amount is invalid");
      const reference=payment?.id || providerLinkId+":"+eventId;
      const {error:pr}=await admin.rpc("record_customer_payment",{
        p_business_id:link.business_id,p_customer_id:inv.customer_id,p_invoice_id:link.invoice_id,p_amount:amount,
        p_method:"payment_gateway",p_account_id:acct.id,p_reference:reference,p_gateway_transaction_id:payment?.id||null,
        p_payment_date:new Date().toISOString().slice(0,10),p_notes:"Razorpay "+eventType
      });
      if(pr) throw pr;
    }

    await admin.from("payment_webhook_events").update({status:"processed",processed_at:new Date().toISOString(),error_message:null}).eq("event_id",eventId).eq("provider","razorpay");
    return json({ok:true});
  } catch(e) {
    await admin.from("payment_webhook_events").update({status:"failed",processed_at:new Date().toISOString(),error_message:e instanceof Error?e.message:"Processing failed"}).eq("event_id",eventId).eq("provider","razorpay");
    return json({error:e instanceof Error?e.message:"Webhook processing failed"},500);
  }
});