import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { authenticatePublicApi, type AuthenticatedApiKey } from './api-key-auth';

type DocumentAuth =
  | { kind:'api'; businessId:string; userId:null }
  | { kind:'session'; businessId:string; userId:string };

const admin=()=>createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{autoRefreshToken:false,persistSession:false}});

export async function authenticateDocumentAccess(req:Request,invoiceId:string):Promise<DocumentAuth>{
  const authorization=req.headers.get('authorization')?.trim()||'';
  const match=authorization.match(/^Bearer\s+(.+)$/i);
  if(!match)throw new Error('Authentication required.');
  const token=match[1];
  if(/^mm_live_/i.test(token)){
    const key:AuthenticatedApiKey=await authenticatePublicApi(req,'invoices:read');
    const {data:invoice,error}=await admin().from('invoices').select('business_id').eq('id',invoiceId).maybeSingle();
    if(error||!invoice||invoice.business_id!==key.businessId)throw new Error('Invoice not found.');
    return {kind:'api',businessId:key.businessId,userId:null};
  }
  const {data:{user},error:userError}=await admin().auth.getUser(token);
  if(userError||!user)throw new Error('Invalid or expired access token.');
  const {data:invoice,error:invoiceError}=await admin().from('invoices').select('business_id,organization_id').eq('id',invoiceId).maybeSingle();
  if(invoiceError||!invoice)throw new Error('Invoice not found.');
  const {data:business}=await admin().from('businesses').select('organization_id').eq('id',invoice.business_id).maybeSingle();
  if(!business)throw new Error('Invoice business context is missing.');
  const {data:member,error:memberError}=await admin().from('organization_members').select('user_id').eq('organization_id',business.organization_id).eq('user_id',user.id).eq('is_active',true).maybeSingle();
  if(memberError||!member)throw new Error('Invoice access denied.');
  return {kind:'session',businessId:invoice.business_id,userId:user.id};
}