import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://qpczmbvqflaqwvyphepf.supabase.co';
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_VyUtfE4qA_bD_FJup-dtGg_cE6wOuFq';

export const supabase = createClient(url, key, {
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
