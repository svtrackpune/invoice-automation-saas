import { createClient } from '@supabase/supabase-js';
import { authenticatePublicApi, jsonError, parseLimit } from '@/lib/server/api-key-auth';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  try {
    const key = await authenticatePublicApi(req, 'inventory:read');
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
    const url = new URL(req.url);
    const limit = parseLimit(url.searchParams.get('limit'));
    const q = url.searchParams.get('q')?.trim();
    let query = db.from('products_services')
      .select('id,name,sku,description,item_type,unit,hsn_sac,sales_price,purchase_price,inventory_tracked,reorder_level,reorder_quantity,barcode,track_batches,track_serials,sell_enabled,purchase_enabled,is_active')
      .eq('business_id', key.businessId)
      .eq('is_active', true)
      .order('name')
      .limit(limit);
    if (q) {
      const escaped = q.replace(/[%_]/g, '\\$&');
      query = query.or(\`name.ilike.%\${escaped}%,sku.ilike.%\${escaped}%,barcode.ilike.%\${escaped}%\`);
    }
    const { data, error } = await query;
    if (error) return jsonError(error.message, 500);
    return Response.json({ success: true, data: data ?? [] });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unauthorized', 401);
  }
}
