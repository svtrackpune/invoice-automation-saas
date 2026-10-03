import { createClient } from '@supabase/supabase-js';
import { randomBytes, createHash } from 'node:crypto';
import { z } from 'zod';

export const runtime = 'nodejs';

const schema = z.object({
  business_id: z.string().uuid(),
  name: z.string().trim().min(1).max(100),
  scopes: z.array(z.enum(['invoices:read','invoices:write','customers:read','customers:write','inventory:read'])).min(1),
}).strict();

const getAdmin=()=>createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{autoRefreshToken:false,persistSession:false}});

async function actor(req:Request) {
  const authorization=req.headers.get('authorization')||'';
  if(!authorization) return null;
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL!, key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
  const client=createClient(url,key,{global:{headers:{Authorization:authorization}}});
  const {data:{user}}=await client.auth.getUser();
  if(!user)return null;
  const {data:ctx}=await client.rpc('get_my_business_context');
  return {user,context:(ctx||[]).find((x:any)=>x.business_id)};
}

export async function GET(req:Request){
  const a=await actor(req); if(!a?.context)return Response.json({error:'Unauthorized'},{status:401});
  const db=getAdmin();
  const {data,error}=await db.from('api_keys').select('id,business_id,name,key_prefix,scopes,revoked_at,expires_at,last_used_at,created_at').eq('business_id',a.context.business_id).order('created_at',{ascending:false});
  if(error)return Response.json({error:error.message},{status:500});
  return Response.json({data:data||[]});
}

export async function POST(req:Request){
  const a=await actor(req); if(!a?.context)return Response.json({error:'Unauthorized'},{status:401});
  const parsed=schema.safeParse(await req.json()); if(!parsed.success)return Response.json({error:parsed.error.issues[0]?.message||'Invalid request'},{status:400});
  if(parsed.data.business_id!==a.context.business_id)return Response.json({error:'Business context mismatch'},{status:403});
  const token=\`mm_live_\${randomBytes(32).toString('base64url')}\`;
  const keyHash=createHash('sha256').update(token,'utf8').digest('hex');
  const prefix=token.slice(0,16);
  const db=getAdmin();
  const {data,error}=await db.from('api_keys').insert({business_id:a.context.business_id,name:parsed.data.name,key_prefix:prefix,key_hash:keyHash,scopes:parsed.data.scopes,created_by:a.user.id}).select('id,name,key_prefix,scopes,created_at').single();
  if(error)return Response.json({error:error.message},{status:422});
  return Response.json({data,secret:token},{status:201});
}

