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
    .select('id,business_id,name,key_prefix,scopes,revoked_at,expires_at')
    .eq('key_hash', keyHash)
    .is('revoked_at', null)
    .maybeSingle();

  if (error || !data) throw new Error('Invalid or expired API key.');
  if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) throw new Error('Invalid or expired API key.');

  const scopes = Array.isArray(data.scopes) ? data.scopes as PublicApiScope[] : [];
  if (requiredScope && !scopes.includes(requiredScope)) {
    throw new Error(\`API key lacks required scope: \${requiredScope}\`);
  }

  void db
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', data.id)
    .eq('business_id', data.business_id);

  return {
    id: data.id,
    businessId: data.business_id,
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
