import { createClient } from '@supabase/supabase-js';
import { authenticatePublicApi, jsonError, parseLimit } from '@/lib/server/api-key-auth';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  try {
    const key = await authenticatePublicApi(req, 'inventory:read');
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
    const url = new URL(req.url);
    const limit = parseLimit(url.searchParams.get('limit'));
    const { data, error } = await db.from('inventory_balances')
      .select('id,location_id,product_service_id,quantity_on_hand,average_cost,updated_at')
      .eq('business_id', key.businessId)
      .order('updated_at', { ascending: false })
      .limit(limit);
    if (error) return jsonError(error.message, 500);
    return Response.json({ success: true, data: data ?? [] });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unauthorized', 401);
  }
}
