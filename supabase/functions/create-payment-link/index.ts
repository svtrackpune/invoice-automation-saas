import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  let reservationId:string|null=null;
  let admin:ReturnType<typeof createClient>|null=null;
  try{
    const auth=req.headers.get("Authorization");if(!auth)return json({error:"Authorization required"},401);
    const supabaseUrl=Deno.env.get("SUPABASE_URL")!,anonKey=Deno.env.get("SUPABASE_ANON_KEY")!,serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if(!serviceKey)return json({error:"Payment service is not configured"},503);
    const userClient=createClient(supabaseUrl,anonKey,{global:{headers:{Authorization:auth}}});
    const {data:{user},error:userError}=await userClient.auth.getUser();if(userError||!user)return json({error:"Unauthorized"},401);
    const input=await req.json(),invoiceId=String(input.invoice_id||""),requestedProvider=String(input.provider||"").trim().toLowerCase();
    if(!invoiceId)return json({error:"invoice_id is required"},400);
    const {data:contexts}=await userClient.rpc("get_my_business_context");const context=contexts?.[0];if(!context)return json({error:"Business context not found"},403);
    admin=createClient(supabaseUrl,serviceKey);const businessId=context.business_id;
    const {data:invoice,error:invoiceError}=await admin.from("invoices").select("id,invoice_number,customer_id,balance_due,currency_code,status,journal_entry_id").eq("id",invoiceId).eq("business_id",businessId).single();
    if(invoiceError||!invoice)return json({error:"Invoice not found"},404);
    if(!["sent","posted","partially_paid","overdue"].includes(String(invoice.status))||!invoice.journal_entry_id)return json({error:"Invoice must be posted before creating a payment link"},409);
    if(Number(invoice.balance_due)<=0)return json({error:"Invoice has no outstanding balance"},400);
    const {data:existing}=await admin.from("payment_links").select("*").eq("business_id",businessId).eq("invoice_id",invoice.id).in("status",["creating","created","paid","partially_paid"]).order("created_at",{ascending:false}).limit(1).maybeSingle();
    if(existing?.short_url)return json({payment_link:existing});
    if(existing?.status==="creating")return json({error:"Payment link creation is already in progress. Please retry shortly."},409);
    const {data:settings}=await admin.from("document_payment_settings").select("payment_gateway_provider,payment_link_enabled").eq("business_id",businessId).maybeSingle();
    const provider=requestedProvider||String(settings?.payment_gateway_provider||"").toLowerCase();
    if(!["razorpay","cashfree","stripe"].includes(provider))return json({error:"Select a payment gateway in Payment Settings before generating a payment link."},409);
    if(settings?.payment_link_enabled!==true)return json({error:"Payment link generation is disabled in Payment Settings."},409);
    const {data:credentials,error:credentialError}=await admin.rpc("resolve_payment_gateway_credentials",{p_business_id:businessId,p_provider:provider});
    if(credentialError||!credentials?.enabled||typeof credentials.secret!=="string"||!credentials.secret)return json({error:"Merchant "+provider+" credentials are not fully configured."},503);
    const customer=invoice.customer_id?(await admin.from("customers").select("display_name,email,phone").eq("id",invoice.customer_id).eq("business_id",businessId).maybeSingle()).data:null;
    reservationId=crypto.randomUUID();const amount=Number(invoice.balance_due);
    const {data:reservation,error:reservationError}=await admin.from("payment_links").insert({id:reservationId,business_id:businessId,invoice_id:invoice.id,provider,amount,currency_code:invoice.currency_code||"INR",status:"creating",created_by:user.id,metadata:{state:"creating",requested_provider:provider}}).select("*").single();
    if(reservationError||!reservation)return json({error:reservationError?.message||"Unable to reserve payment link creation"},409);

    let providerLinkId="",shortUrl="",expiresAt:string|null=null,extra:Record<string,unknown>={};

    if(provider==="razorpay"){
      const keyId=typeof credentials.key_id==="string"?credentials.key_id:"";if(!keyId)throw new Error("Razorpay Key ID is not configured.");
      const expires=Math.floor(Date.now()/1000)+30*24*60*60,amountMinor=Math.round(amount*100),referenceId=String(invoice.invoice_number).slice(0,30)+"-"+reservationId.replaceAll("-","").slice(0,8);
      const response=await fetch("https://api.razorpay.com/v1/payment_links",{method:"POST",headers:{Authorization:"Basic "+btoa(keyId+":"+String(credentials.secret)),"Content-Type":"application/json"},body:JSON.stringify({amount:amountMinor,currency:invoice.currency_code||"INR",accept_partial:true,first_min_partial_amount:Math.min(100,amountMinor),expire_by:expires,reference_id:referenceId,description:"Payment for invoice "+invoice.invoice_number,customer:{name:customer?.display_name||"Customer",contact:customer?.phone||undefined,email:customer?.email||undefined},notify:{sms:false,email:false},reminder_enable:false,notes:{business_id:businessId,invoice_id:invoice.id,payment_link_id:reservationId}})});
      const payload=await response.json().catch(()=>({})) as Record<string,unknown>;if(!response.ok)throw new Error(String((payload.error as Record<string,unknown>|undefined)?.description||"Razorpay payment link creation failed"));
      providerLinkId=String(payload.id||"");shortUrl=String(payload.short_url||"");expiresAt=new Date(expires*1000).toISOString();extra={reference_id:referenceId};
    }else if(provider==="cashfree"){
      const appId=typeof credentials.app_id==="string"?credentials.app_id:"";if(!appId)throw new Error("Cashfree App ID is not configured.");
      const publicUrl=(Deno.env.get("MONEYMATTERS_PUBLIC_URL")||"").replace(/\/+$/,"");if(!publicUrl)throw new Error("Public application URL is not configured.");
      const response=await fetch("https://api.cashfree.com/pg/links",{method:"POST",headers:{"Content-Type":"application/json","x-client-id":appId,"x-client-secret":String(credentials.secret),"x-api-version":"2025-01-01","x-idempotency-key":reservationId},body:JSON.stringify({customer_details:{customer_id:reservationId.replaceAll("-","").slice(0,32),customer_name:customer?.display_name||"Customer",customer_email:customer?.email||undefined,customer_phone:customer?.phone||undefined},link_amount:amount,link_currency:invoice.currency_code||"INR",link_id:reservationId,link_purpose:"Invoice "+invoice.invoice_number,link_notify:{send_sms:false,send_email:false},link_meta:{notify_url:supabaseUrl.replace(/\/+$/,"")+"/functions/v1/cashfree-webhook",return_url:publicUrl+"/next-workspace/payments?cashfree=success"},link_notes:{business_id:businessId,invoice_id:invoice.id}})});
      const payload=await response.json().catch(()=>({})) as Record<string,unknown>;if(!response.ok)throw new Error(String(payload.message||payload.type||"Cashfree payment link creation failed"));
      providerLinkId=String(payload.link_id||reservationId);shortUrl=String(payload.link_url||"");extra={cashfree_request_id:payload.request_id||null};if(!shortUrl)throw new Error("Cashfree payment link URL was not returned.");
    }else{
      const form=new URLSearchParams({mode:"payment",success_url:String(input.success_url||new URL("/next-workspace/payments?stripe=success",req.url).toString()),cancel_url:String(input.cancel_url||new URL("/next-workspace/payments?stripe=cancelled",req.url).toString()),"line_items[0][price_data][currency]":String(invoice.currency_code||"INR").toLowerCase(),"line_items[0][price_data][product_data][name]":"Invoice "+invoice.invoice_number,"line_items[0][price_data][unit_amount]":String(Math.round(amount*100)),"line_items[0][quantity]":"1","metadata[moneymatters_business_id]":businessId,"metadata[moneymatters_invoice_id]":invoice.id,"metadata[moneymatters_payment_link_id]":reservationId});
      if(customer?.email)form.set("customer_email",customer.email);
      const response=await fetch("https://api.stripe.com/v1/checkout/sessions",{method:"POST",headers:{Authorization:"Bearer "+String(credentials.secret),"Content-Type":"application/x-www-form-urlencoded"},body:form});
      const payload=await response.json().catch(()=>({})) as Record<string,unknown>;if(!response.ok)throw new Error(String((payload.error as Record<string,unknown>|undefined)?.message||"Stripe payment link creation failed"));
      providerLinkId=String(payload.id||"");shortUrl=String(payload.url||"");extra={payment_intent_id:payload.payment_intent||null};if(!shortUrl)throw new Error("Stripe Checkout URL was not returned.");
    }

    if(!providerLinkId||!shortUrl)throw new Error("Payment gateway did not return a usable payment link.");
    const {data:link,error:linkError}=await admin.from("payment_links").update({provider_link_id:providerLinkId,short_url:shortUrl,status:"created",expires_at:expiresAt,metadata:{...(reservation.metadata||{}),state:"created",provider_link_id:providerLinkId,...extra},updated_at:new Date().toISOString()}).eq("id",reservationId).eq("business_id",businessId).select("*").single();
    if(linkError||!link)throw new Error(linkError?.message||"Payment link registration failed");
    await admin.from("invoices").update({payment_link:shortUrl,payment_qr_payload:shortUrl}).eq("id",invoice.id).eq("business_id",businessId);
    const {error:notifyError}=await admin.rpc("enqueue_payment_link_notification",{p_business_id:businessId,p_payment_link_id:link.id});
    if(notifyError)await admin.from("payment_links").update({metadata:{...(link.metadata||{}),notification_enqueue_error:notifyError.message},updated_at:new Date().toISOString()}).eq("id",link.id).eq("business_id",businessId);
    return json({payment_link:link});
  }catch(error){
    if(admin&&reservationId){
      await admin.from("payment_links").update({status:"failed",metadata:{state:"failed",error:error instanceof Error?error.message:"Unexpected error"},updated_at:new Date().toISOString()}).eq("id",reservationId).eq("business_id",String((error as {business_id?:string})?.business_id||""));
    }
    return json({error:error instanceof Error?error.message:"Unexpected error"},500);
  }
});