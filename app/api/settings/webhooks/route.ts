import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
export const runtime='nodejs';
const event=z.enum(['invoice.posted','payment.received','stock.threshold_breached']);
const schema=z.object({business_id:z.string().uuid(),name:z.string().trim().min(1).max(100),target_url:z.string().url().refine((v)=>v.startsWith('https://'),'HTTPS endpoint required'),subscribed_events:z.array(event).min(1)}).strict();
const admin=()=>createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{autoRefreshToken:false,persistSession:false}});
async function actor(req:Request){
  const authorization=req.headers.get('authorization')||''; if(!authorization)return null;
  const client=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,{global:{headers:{Authorization:authorization}}});
  const [{data:{user}},ctx]=await Promise.all([client.auth.getUser(),client.rpc('get_my_business_context')]);
  return {user,context:(ctx.data||[]).find((x:any)=>x.business_id),client};
}
export async function GET(req:Request){
  const a=await actor(req); if(!a?.context)return Response.json({error:'Unauthorized'},{status:401});
  const allowed=await a.client.rpc('has_my_business_permission',{p_business_id:a.context.business_id,p_permission:'integrations.manage'});
  if(allowed.error||allowed.data!==true)return Response.json({error:'Permission denied'},{status:403});
  const {data,error}=await admin().from('webhook_subscriptions_safe').select('*').eq('business_id',a.context.business_id).order('created_at',{ascending:false});
  if(error)return Response.json({error:error.message},{status:500});
  return Response.json({data:data||[]});
}
export async function POST(req:Request){
  const a=await actor(req); if(!a?.context)return Response.json({error:'Unauthorized'},{status:401});
  const parsed=schema.safeParse(await req.json()); if(!parsed.success)return Response.json({error:parsed.error.issues[0]?.message||'Invalid request'},{status:400});
  if(parsed.data.business_id!==a.context.business_id)return Response.json({error:'Business context mismatch'},{status:403});
  const allowed=await a.client.rpc('has_my_business_permission',{p_business_id:a.context.business_id,p_permission:'integrations.manage'});
  if(allowed.error||allowed.data!==true)return Response.json({error:'Permission denied'},{status:403});
  const secret='mm_wh_'+randomBytes(32).toString('base64url');
  const {data,error}=await admin().from('webhook_subscriptions').insert({...parsed.data,secret,created_by:a.user.id}).select('id,name,target_url,subscribed_events,is_active,created_at').single();
  if(error)return Response.json({error:error.message},{status:422});
  return Response.json({data,secret},{status:201});
}
export async function PATCH(req:Request){
  const a=await actor(req); if(!a?.context)return Response.json({error:'Unauthorized'},{status:401});
  const allowed=await a.client.rpc('has_my_business_permission',{p_business_id:a.context.business_id,p_permission:'integrations.manage'});
  if(allowed.error||allowed.data!==true)return Response.json({error:'Permission denied'},{status:403});
  const body=await req.json().catch(()=>null) as {id?:unknown;is_active?:unknown};
  if(typeof body?.id!=='string'||typeof body?.is_active!=='boolean')return Response.json({error:'id and is_active are required'},{status:400});
  const {data,error}=await admin().from('webhook_subscriptions').update({is_active:body.is_active,updated_at:new Date().toISOString()}).eq('id',body.id).eq('business_id',a.context.business_id).select('id,name,target_url,subscribed_events,is_active,created_at,updated_at').single();
  if(error||!data)return Response.json({error:error?.message||'Webhook not found'},{status:404});
  return Response.json({data});
}