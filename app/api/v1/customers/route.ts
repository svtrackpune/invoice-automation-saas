import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { authenticatePublicApi, jsonError, parseLimit, extractApiKey } from '@/lib/server/api-key-auth';
import { createHash } from 'node:crypto';

export const runtime = 'nodejs';

const customerSchema = z.object({
  display_name: z.string().trim().min(1).max(255),
  legal_name: z.string().trim().max(255).optional().nullable(),
  email: z.string().trim().email().max(320).optional().nullable(),
  phone: z.string().trim().max(50).optional().nullable(),
  tax_id: z.string().trim().max(100).optional().nullable(),
  tax_id_type: z.string().trim().max(50).optional().nullable(),
  billing_address: z.record(z.unknown()).optional(),
  shipping_address: z.record(z.unknown()).optional(),
  credit_limit: z.number().nonnegative().optional(),
  payment_terms: z.string().trim().max(100).optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
}).strict();

const getAdmin = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Server Supabase environment is not configured.');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
};

function keyHash(req: Request) {
  return createHash('sha256').update(extractApiKey(req), 'utf8').digest('hex');
}

export async function GET(req: Request) {
  try {
    const key = await authenticatePublicApi(req, 'customers:read');
    const db = getAdmin();
    const url = new URL(req.url);
    const limit = parseLimit(url.searchParams.get('limit'));
    const q = url.searchParams.get('q')?.trim();
    let query = db.from('customers')
      .select('id,display_name,legal_name,email,phone,tax_id,tax_id_type,billing_address,shipping_address,credit_limit,payment_terms,notes,is_active,created_at,updated_at')
      .eq('business_id', key.businessId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (q) {
      const escaped = q.replace(/[%_]/g, '\\$&');
      query = query.or('display_name.ilike.%'+escaped+'%,legal_name.ilike.%'+escaped+'%,email.ilike.%'+escaped+'%,phone.ilike.%'+escaped+'%');
    }
    const { data, error } = await query;
    if (error) return jsonError(error.message, 500);
    return Response.json({ success: true, data: data ?? [] });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unauthorized', 401);
  }
}

export async function POST(req: Request) {
  try {
    const key = await authenticatePublicApi(req, 'customers:write');
    const parsed = customerSchema.safeParse(await req.json());
    if (!parsed.success) return jsonError(parsed.error.issues[0]?.message || 'Invalid customer payload', 400);
    const db = getAdmin();
    const { data, error } = await db.rpc('api_create_customer', {
      p_api_key_hash: keyHash(req),
      p_business_id: key.businessId,
      p_customer: parsed.data,
    });
    if (error) return jsonError(error.message, 422);
    const { data: customer, error: readError } = await db.from('customers')
      .select('id,display_name,legal_name,email,phone,tax_id,tax_id_type,billing_address,shipping_address,credit_limit,payment_terms,notes,is_active,created_at,updated_at')
      .eq('id', data).eq('business_id', key.businessId).single();
    if (readError || !customer) return jsonError(readError?.message || 'Customer was created but could not be read back', 500);
    return Response.json({ success: true, data: customer }, { status: 201 });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Invalid request', 400);
  }
}
