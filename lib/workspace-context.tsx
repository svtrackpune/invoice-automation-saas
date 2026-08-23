'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase, type BusinessContext } from '@/lib/supabase';
import { deriveBusinessRules, type BusinessRules } from '@/lib/business-rules';

type WorkspaceState = {
  businesses: BusinessContext[];
  business: BusinessContext | null;
  rules: BusinessRules | null;
  configurationLoading: boolean;
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
  switchBusiness: (businessId: string) => void;
};

const WorkspaceContext = createContext<WorkspaceState | null>(null);
const STORAGE_KEY = 'moneymatters.activeBusinessId';

async function loadRules(businessId: string): Promise<BusinessRules> {
  const [b, s, p, t] = await Promise.all([
    supabase.from('businesses').select('tax_enabled,inventory_enabled,selling_model,category_id,subcategory_id,sales_channels,team_size').eq('id', businessId).single(),
    supabase.from('business_settings').select('cash_bill_enabled').eq('business_id', businessId).maybeSingle(),
    supabase.from('business_preferences').select('tax_mode,notification_email_enabled,notification_whatsapp_enabled,notification_sms_enabled').eq('business_id', businessId).maybeSingle(),
    supabase.from('business_tax_profiles').select('tax_regime,gst_registration_type,gstin,tax_state,accounting_basis,books_mode').eq('business_id', businessId).maybeSingle(),
  ]);
  const firstError = b.error || s.error || p.error || t.error;
  if (firstError) throw new Error(firstError.message);
  return deriveBusinessRules({ business: b.data || {}, settings: s.data, preferences: p.data, taxProfile: t.data });
}

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [businesses, setBusinesses] = useState<BusinessContext[]>([]);
  const [businessId, setBusinessId] = useState('');
  const [rules, setRules] = useState<BusinessRules | null>(null);
  const [loading, setLoading] = useState(true);
  const [configurationLoading, setConfigurationLoading] = useState(false);
  const [error, setError] = useState('');

  const refresh = async () => {
    setLoading(true);
    setError('');
    const [{ data: user }, context] = await Promise.all([supabase.auth.getUser(), supabase.rpc('get_my_business_context')]);
    if (!user.user) { router.replace('/'); return; }
    if (context.error) { setError(context.error.message); setBusinesses([]); setBusinessId(''); setRules(null); setLoading(false); return; }
    const rows = (context.data || []) as BusinessContext[];
    if (!rows.length) { setError('No active business workspace is available for this account.'); setBusinesses([]); setBusinessId(''); setRules(null); setLoading(false); return; }
    const saved = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    const selected = rows.find(row => row.business_id === saved) || rows[0];
    setBusinesses(rows);
    setBusinessId(selected.business_id);
    if (typeof window !== 'undefined') localStorage.setItem(STORAGE_KEY, selected.business_id);
    setConfigurationLoading(true);
    try { setRules(await loadRules(selected.business_id)); } catch (e) { setRules(null); setError(e instanceof Error ? e.message : 'Unable to load business rules.'); }
    finally { setConfigurationLoading(false); setLoading(false); }
  };

  useEffect(() => { void refresh(); }, []);

  useEffect(() => {
    if (!businessId || !businesses.length) return;
    setConfigurationLoading(true);
    void loadRules(businessId).then(setRules).catch(e => { setRules(null); setError(e instanceof Error ? e.message : 'Unable to load business rules.'); }).finally(() => setConfigurationLoading(false));
  }, [businessId]);

  const value = useMemo<WorkspaceState>(() => ({
    businesses,
    business: businesses.find(row => row.business_id === businessId) || businesses[0] || null,
    rules,
    configurationLoading,
    loading,
    error,
    refresh,
    switchBusiness: (id: string) => {
      if (!businesses.some(row => row.business_id === id)) return;
      localStorage.setItem(STORAGE_KEY, id);
      setRules(null);
      setBusinessId(id);
      router.refresh();
    },
  }), [businesses, businessId, rules, configurationLoading, loading, error]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('useWorkspace must be used inside WorkspaceProvider');
  return value;
}
