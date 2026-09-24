'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import BusinessDetailsModal from './BusinessDetailsModal';
import { supabase } from '@/lib/supabase';

export default function BusinessDetailsSetupPage() {
  const searchParams = useSearchParams();
  const requestedId = searchParams.get('business');
  const [businessId, setBusinessId] = useState(requestedId || '');
  const [loading, setLoading] = useState(!requestedId);

  useEffect(() => {
    if (requestedId) {
      setBusinessId(requestedId);
      setLoading(false);
      return;
    }
    (async () => {
      const { data, error } = await supabase.rpc('get_my_business_context');
      if (error) {
        setLoading(false);
        return;
      }
      const rows = (data || []) as Array<{ business_id: string }>;
      const saved = typeof window !== 'undefined' ? localStorage.getItem('moneymatters.activeBusinessId') : null;
      setBusinessId(rows.find((row) => row.business_id === saved)?.business_id || rows[0]?.business_id || '');
      setLoading(false);
    })();
  }, [requestedId]);

  const finish = () => {
    window.location.replace('/next-workspace');
  };

  if (loading) return <main className="grid min-h-screen place-items-center bg-[#fbfaff] text-sm text-slate-500">Preparing business setup…</main>;

  if (!businessId) {
    return <main className="grid min-h-screen place-items-center bg-[#fbfaff] p-6"><div className="rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-xl"><h1 className="text-xl font-semibold text-slate-900">Business setup unavailable</h1><p className="mt-2 text-sm text-slate-500">Please return to the workspace and select a business.</p><a href="/next-workspace" className="mt-5 inline-flex rounded-xl bg-violet-600 px-5 py-3 text-sm font-semibold text-white">Open workspace</a></div></main>;
  }

  return <main className="min-h-screen bg-[#fbfaff]"><BusinessDetailsModal businessId={businessId} onSaved={finish} onSkip={finish} /></main>;
}
