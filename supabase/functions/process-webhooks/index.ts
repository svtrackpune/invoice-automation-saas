import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

async function sign(secret:string,timestamp:number,payload:string){
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const sig=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(String(timestamp)+'.'+payload));
  return Array.from(new Uint8Array(sig)).map((b)=>b.toString(16).padStart(2,'0')).join('');
}
function retryDelayMs(attempt:number){return Math.min(60*60*1000,Math.max(60*1000,2**Math.max(attempt-1,0)*60*1000));}
async function bodyText(response:Response){return (await response.text()).slice(0,4000);}

Deno.serve(async(req)=>{
  if(req.method!=='POST')return json({error:'POST required'},405);
  try{
    const {data:materialized,error:materializeError}=await admin.rpc('materialize_webhook_deliveries',{p_limit:50});
    if(materializeError)throw materializeError;
    const {data:deliveries,error:claimError}=await admin.rpc('claim_webhook_deliveries',{p_limit:50});
    if(claimError)throw claimError;
    let delivered=0,failed=0;
    for(const row of deliveries||[]){
      const timestamp=Math.floor(Date.now()/1000);
      const payload=JSON.stringify(row.payload);
      const signature=await sign(row.secret,timestamp,payload);
      try{
        const response=await fetch(row.target_url,{method:'POST',headers:{'Content-Type':'application/json','User-Agent':'Moneymatters-Webhooks/1.0','X-Moneymatters-Event':row.event_type,'X-Moneymatters-Event-Id':row.event_id,'X-Moneymatters-Timestamp':String(timestamp),'X-Moneymatters-Signature':'t='+timestamp+',v1='+signature},body:payload});
        const responseBody=await bodyText(response);
        if(!response.ok)throw new Error('Webhook endpoint returned HTTP '+response.status+': '+responseBody.slice(0,500));
        await admin.from('webhook_delivery_logs').update({status:'delivered',response_status:response.status,response_body:responseBody,request_timestamp:timestamp,signature:'t='+timestamp+',v1='+signature,delivered_at:new Date().toISOString(),last_error:null,updated_at:new Date().toISOString()}).eq('id',row.id);
        delivered++;
      }catch(error){
        const message=error instanceof Error?error.message:'Webhook delivery failed';
        const terminal=Number(row.attempt)>=5;
        await admin.from('webhook_delivery_logs').update({status:terminal?'failed':'queued',next_attempt_at:new Date(Date.now()+retryDelayMs(Number(row.attempt))).toISOString(),request_timestamp:timestamp,signature:'t='+timestamp+',v1='+signature,last_error:message,updated_at:new Date().toISOString()}).eq('id',row.id);
        failed++;
      }
    }
    return json({ok:true,materialized:materialized||0,claimed:(deliveries||[]).length,delivered,failed});
  }catch(error){return json({error:error instanceof Error?error.message:'Webhook worker failed'},500);}
});