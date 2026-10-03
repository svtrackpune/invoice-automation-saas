import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { applyDynamicTax } from '@/lib/server/tax/apply-dynamic';
import { z } from 'zod';
import { authenticatePublicApi, jsonError, parseLimit, extractApiKey } from '@/lib/server/api-key-auth';

export const runtime = 'nodejs';

const itemSchema = z.object({
  product_service_id: z.string().uuid().optional().nullable(),
  description: z.string().trim().min(1).max(500),
  quantity: z.number().positive(),
  unit_price: z.number().nonnegative(),
  discount_type: z.enum(['percentage','fixed','amount']).optional().nullable(),
  discount_value: z.number().nonnegative().optional(),
  tax_rate_id: z.string().uuid().optional().nullable(),
  hsn_sac: z.string().trim().max(32).optional().nullable(),
  sort_order: z.number().int().nonnegative().optional(),
}).strict();

const invoiceSchema = z.object({
  customer_id: z.string().uuid(),
  invoice_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  items: z.array(itemSchema).min(1).max(500),
  invoice_discount_type: z.enum(['amount','fixed','percentage']).optional().nullable(),
  invoice_discount_value: z.number().nonnegative().optional(),
  notes: z.string().max(5000).optional().nullable(),
  terms: z.string().max(5000).optional().nullable(),
  post: z.boolean().optional().default(false),
  tax_system: z.enum(['VAT','SALES_TAX','GST','CUSTOM']).optional().nullable(),
}).strict();

const getAdmin = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Server Supabase environment is not configured.');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
};

export async function GET(req: Request) {
  try {
    const key = await authenticatePublicApi(req, 'invoices:read');
    const db = getAdmin();
    const url = new URL(req.url);
    const limit = parseLimit(url.searchParams.get('limit'));
    const status = url.searchParams.get('status')?.trim();
    let query = db.from('invoices')
      .select('id,invoice_number,document_kind,invoice_date,due_date,status,customer_id,subtotal,discount_total,tax_total,total,amount_paid,balance_due,currency_code,journal_entry_id,created_at,updated_at')
      .eq('business_id', key.businessId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (status) query = query.eq('status', status);
    const { data, error } = await query;
    if (error) return jsonError(error.message, 500);
    return Response.json({ success: true, data: data ?? [] });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unauthorized', 401);
  }
}

export async function POST(req: Request) {
  try {
    const key = await authenticatePublicApi(req, 'invoices:write');
    const parsed = invoiceSchema.safeParse(await req.json());
    if (!parsed.success) return jsonError(parsed.error.issues[0]?.message || 'Invalid invoice payload', 400);
    const body = parsed.data;
    const db = getAdmin();
    const {data:business}=await db.from('businesses').select('country_code,currency_code').eq('id',key.businessId).single();
    if(!business)return jsonError('Business not found',404);

    try {
      const dynamic=await applyDynamicTax({db,businessId:key.businessId,customerId:body.customer_id,invoiceDate:body.invoice_date,currencyCode:business.currency_code,items:body.items,invoiceDiscountType:body.invoice_discount_type,invoiceDiscountValue:body.invoice_discount_value,taxSystem:body.tax_system});
      const rpc=await db.rpc('api_create_invoice_with_dynamic_tax',{
        p_api_key_hash:createHash('sha256').update(extractApiKey(req),'utf8').digest('hex'),
        p_business_id:key.businessId,p_customer_id:body.customer_id,p_invoice_date:body.invoice_date,p_due_date:body.due_date??body.invoice_date,
        p_items:dynamic.items,p_notes:body.notes??null,p_terms:body.terms??null,p_post:body.post??false,
      });
      if(rpc.error)throw rpc.error;
      const invoiceId=String(rpc.data);
      const {data:invoice,error:fetchError}=await db.from('invoices').select('id,invoice_number,document_kind,invoice_date,due_date,status,customer_id,subtotal,discount_total,tax_total,total,amount_paid,balance_due,currency_code,journal_entry_id,created_at,updated_at').eq('id',invoiceId).eq('business_id',key.businessId).single();
      if(fetchError||!invoice)return jsonError(fetchError?.message||'Invoice was created but could not be read back',500);
      return Response.json({success:true,data:invoice,tax:{provider:dynamic.provider,totalTax:dynamic.totalTax}}, {status:201});
    } catch(dynamicError) {
      if(String(business.country_code).toUpperCase()!=='IN') throw dynamicError;
      const legacy=await db.rpc('api_create_invoice_from_items',{
        p_api_key_hash:createHash('sha256').update(extractApiKey(req),'utf8').digest('hex'),p_business_id:key.businessId,p_customer_id:body.customer_id,p_invoice_date:body.invoice_date,p_due_date:body.due_date??body.invoice_date,
        p_items:body.items,p_invoice_discount_type:body.invoice_discount_type??null,p_invoice_discount_value:body.invoice_discount_value??0,p_notes:body.notes??null,p_terms:body.terms??null,p_post:body.post??false,
      });
      if(legacy.error)return jsonError(legacy.error.message,422);
      const {data:invoice,error:fetchError}=await db.from('invoices').select('id,invoice_number,document_kind,invoice_date,due_date,status,customer_id,subtotal,discount_total,tax_total,total,amount_paid,balance_due,currency_code,journal_entry_id,created_at,updated_at').eq('id',legacy.data).eq('business_id',key.businessId).single();
      if(fetchError||!invoice)return jsonError(fetchError?.message||'Invoice was created but could not be read back',500);
      return Response.json({success:true,data:invoice,tax:{provider:'IndiaLegacyGSTAdapter',fallback:true}} ,{status:201});
    }
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Invalid request', 400);
  }
}
