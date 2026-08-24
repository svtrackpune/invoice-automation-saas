import { createClient } from '@supabase/supabase-js';
import { businessAwareFetch } from './active-business-fetch';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
}

export const supabase = createClient(url, key, {
  global: {
    fetch: businessAwareFetch,
  },
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export type BusinessContext = {
  business_id: string;
  business_name: string;
  organization_id: string;
  role: string;
  currency_code: string;
  country_code: string;
  timezone: string;
  tax_enabled: boolean;
  is_active: boolean;
  onboarding_complete: boolean;
  onboarding_step: string | null;
  logo_storage_path: string | null;
};
