'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase, type BusinessContext } from '@/lib/supabase';

type WorkspaceState = {
  businesses: BusinessContext[];
  business: BusinessContext | null;
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
  switchBusiness: (businessId: string) => void;
};

const WorkspaceContext = createContext<WorkspaceState | null>(null);
const STORAGE_KEY = 'moneymatters.activeBusinessId';

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [businesses, setBusinesses] = useState<BusinessContext[]>([]);
  const [businessId, setBusinessId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = async () => {
    setLoading(true);
    setError('');
    const [{ data: user }, context] = await Promise.all([
      supabase.auth.getUser(),
      supabase.rpc('get_my_business_context'),
    ]);

    if (!user.user) {
      router.replace('/');
      return;
    }

    if (context.error) {
      setError(context.error.message);
      setBusinesses([]);
      setBusinessId('');
      setLoading(false);
      return;
    }

    const rows = (context.data || []) as BusinessContext[];
    if (!rows.length) {
      setError('No active business workspace is available for this account.');
      setBusinesses([]);
      setBusinessId('');
      setLoading(false);
      return;
    }

    const saved = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    const selected = rows.find(row => row.business_id === saved) || rows[0];
    setBusinesses(rows);
    setBusinessId(selected.business_id);
    if (typeof window !== 'undefined') localStorage.setItem(STORAGE_KEY, selected.business_id);
    setLoading(false);
  };

  useEffect(() => { void refresh(); }, []);

  const value = useMemo<WorkspaceState>(() => ({
    businesses,
    business: businesses.find(row => row.business_id === businessId) || businesses[0] || null,
    loading,
    error,
    refresh,
    switchBusiness: (id: string) => {
      if (!businesses.some(row => row.business_id === id)) return;
      localStorage.setItem(STORAGE_KEY, id);
      setBusinessId(id);
      router.refresh();
    },
  }), [businesses, businessId, loading, error]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('useWorkspace must be used inside WorkspaceProvider');
  return value;
}
