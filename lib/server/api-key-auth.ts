import 'server-only';

import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

export type PublicApiScope =
  | 'invoices:read'
  | 'invoices:write'
  | 'customers:read'
  | 'customers:write'
  | 'inventory:read';

export type AuthenticatedApiKey = {
  id: string;
  businessId: string;
  createdBy: string;
  name: string;
  keyPrefix: string;
  scopes: PublicApiScope[];
};

const getAdmin = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Server Supabase environment is not configured.');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
};

const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

export function extractApiKey(request: Request): string {
  const header = request.headers.get('authorization')?.trim() ?? '';
  const match = header.match(/^Bearer\s+(mm_live_[A-Za-z0-9_-]{16,256})$/i);
  if (!match) throw new Error('API authorization required.');
  return match[1];
}

export async function authenticatePublicApi(request: Request, requiredScope?: PublicApiScope): Promise<AuthenticatedApiKey> {
  const token = extractApiKey(request);
  const keyHash = sha256(token);
  const db = getAdmin();

  const { data, error } = await db
    .from('api_keys')
    .select('id,business_id,created_by,name,key_prefix,scopes,revoked_at,expires_at')
    .eq('key_hash', keyHash)
    .is('revoked_at', null)
    .maybeSingle();

  if (error || !data) throw new Error('Invalid or expired API key.');
  if (!data.created_by) throw new Error('Invalid or expired API key.');
  if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) throw new Error('Invalid or expired API key.');
  const { data: business } = await db.from('businesses').select('organization_id,is_active').eq('id', data.business_id).maybeSingle();
  if (!business?.is_active) throw new Error('API key business is inactive.');
  const { data: member } = await db.from('organization_members').select('user_id').eq('organization_id', business.organization_id).eq('user_id', data.created_by).eq('is_active', true).maybeSingle();
  if (!member) throw new Error('API key creator is no longer an active business member.');
  const { data: entitlement } = await db.from('saas_entitlements').select('api_enabled').eq('business_id', data.business_id).maybeSingle();
  if (entitlement && entitlement.api_enabled !== true) throw new Error('Public API access is not enabled for this business.');

  const scopes = Array.isArray(data.scopes) ? data.scopes as PublicApiScope[] : [];
  if (requiredScope && !scopes.includes(requiredScope)) {
    throw new Error('API key lacks required scope: '+requiredScope);
  }

  void db
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', data.id)
    .eq('business_id', data.business_id);

  return {
    id: data.id,
    businessId: data.business_id,
    createdBy: String(data.created_by),
    name: data.name,
    keyPrefix: data.key_prefix,
    scopes,
  };
}

export function jsonError(message: string, status = 400) {
  return Response.json({ success: false, error: { message } }, { status });
}

export function parseLimit(value: string | null, fallback = 50, max = 100): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}


export async function requireBusinessEntitlement(businessId: string, feature: 'e_invoicing_enabled' | 'offline_pos_enabled') {
  const db=getAdmin();
  const {data,error}=await db.from('saas_entitlements').select(feature).eq('business_id',businessId).maybeSingle();
  if(error) throw new Error('Unable to verify SaaS entitlement.');
  if(data?.[feature]!==true) throw new Error('This feature is not enabled for the business plan.');
}
