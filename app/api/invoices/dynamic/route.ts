import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { applyDynamicTax } from '@/lib/server/tax/apply-dynamic';
import type { TaxSystem } from '@/lib/server/tax/types';

export const runtime='nodejs';

const itemSchema=z.object({
  product_service_id:z.string().uuid().optional().nullable(),
  description:z.string().trim().min(1).max(500),
  quantity:z.number().positive(),
  unit_price:z.number().nonnegative(),
  discount_type:z.enum(['percentage','fixed','amount']).optional().nullable(),
  discount_value:z.number().nonnegative().optional(),
  tax_rate_id:z.string().uuid().optional().nullable(),
  hsn_sac:z.string().trim().max(32).optional().nullable(),
}).strict();

const schema=z.object({
  business_id:z.string().uuid(),
  customer_id:z.string().uuid(),
  invoice_date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  due_date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  items:z.array(itemSchema).min(1).max(500),
  invoice_discount_type:z.enum(['amount','fixed','percentage']).optional().nullable(),
  invoice_discount_value:z.number().nonnegative().optional(),
  notes:z.string().max(5000).optional().nullable(),
  terms:z.string().max(5000).optional().nullable(),
  buyer_reference:z.string().trim().min(1).max(70).optional().nullable(),
  post:z.boolean().optional().default(false),
  tax_system:z.enum(['VAT','SALES_TAX','GST','CUSTOM']).optional().nullable(),
}).strict();

const admin=()=>createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {auth:{autoRefreshToken:false,persistSession:false}},
);

export async function POST(req:Request){
  try{
    const authorization=req.headers.get('authorization')?.trim()||'';
    const match=authorization.match(/^Bearer\s+(.+)$/i);
    if(!match)return Response.json({success:false,error:{message:'Supabase access token required.'}},{status:401});

    const db=admin();
    const auth=await db.auth.getUser(match[1]);
    if(auth.error||!auth.data.user)return Response.json({success:false,error:{message:'Invalid or expired access token.'}},{status:401});
    const parsed=schema.safeParse(await req.json());
    if(!parsed.success)return Response.json({success:false,error:{message:parsed.error.issues[0]?.message||'Invalid request.'}},{status:400});
    const body=parsed.data;

    const {data:business,error:businessError}=await db.from('businesses').select('id,organization_id,country_code,currency_code').eq('id',body.business_id).maybeSingle();
    if(businessError||!business)return Response.json({success:false,error:{message:'Business not found.'}},{status:404});
    const {data:member}=await db.from('organization_members').select('user_id').eq('organization_id',business.organization_id).eq('user_id',auth.data.user.id).eq('is_active',true).maybeSingle();
    if(!member)return Response.json({success:false,error:{message:'Business access denied.'}},{status:403});

    const dynamic=await applyDynamicTax({
      db,businessId:body.business_id,customerId:body.customer_id,invoiceDate:body.invoice_date,
      currencyCode:business.currency_code,items:body.items,
      invoiceDiscountType:body.invoice_discount_type,invoiceDiscountValue:body.invoice_discount_value,
      taxSystem:(body.tax_system||null) as TaxSystem|null,
    });

    const rpc=await db.rpc('create_invoice_with_dynamic_tax',{
      p_actor_user_id:auth.data.user.id,
      p_business_id:body.business_id,
      p_customer_id:body.customer_id,
      p_invoice_date:body.invoice_date,
      p_due_date:body.due_date??body.invoice_date,
      p_items:dynamic.items,
      p_notes:body.notes??null,
      p_terms:body.terms??null,
      p_buyer_reference:body.buyer_reference??null,
      p_post:body.post??false,
    });
    if(rpc.error)throw rpc.error;

    const {data:invoice,error:invoiceError}=await db.from('invoices')
      .select('id,invoice_number,buyer_reference,document_kind,invoice_date,due_date,status,customer_id,subtotal,discount_total,tax_total,total,amount_paid,balance_due,currency_code,journal_entry_id,created_at,updated_at')
      .eq('id',rpc.data).eq('business_id',body.business_id).single();
    if(invoiceError||!invoice)throw invoiceError||new Error('Invoice could not be read after creation.');
    return Response.json({success:true,data:invoice,tax:{provider:dynamic.provider,totalTax:dynamic.totalTax}},{status:201});
  }catch(error){
    const message=error instanceof Error?error.message:'Unable to create invoice.';
    return Response.json({success:false,error:{message}},{status:400});
  }
}