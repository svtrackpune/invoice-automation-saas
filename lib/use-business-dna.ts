'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { getAdaptiveModuleConfig, type WorkspaceConfiguration } from '@/lib/business-adaptation';

export function useBusinessDNA() {
  const [configuration, setConfiguration] = useState<WorkspaceConfiguration | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setConfiguration(null);
      const { data: context } = await supabase.rpc('get_my_business_context');
      const rows = (context || []) as Array<{ business_id: string }>;
      const savedId = typeof window !== 'undefined' ? localStorage.getItem('moneymatters.activeBusinessId') : null;
      const business = rows.find((row) => row.business_id === savedId) || rows[0];
      if (!business) return;
      const { data } = await supabase.from('businesses')
        .select('category_id,subcategory_id,selling_model,inventory_enabled,tax_enabled,sales_channels,team_size,business_categories(name),business_subcategories(name)')
        .eq('id', business.business_id).maybeSingle();
      if (!data || cancelled) return;
      setConfiguration(getAdaptiveModuleConfig({
        businessId: business.business_id,
        categoryId: data.category_id,
        categoryName: data.business_categories?.name ?? null,
        subcategoryId: data.subcategory_id,
        subcategoryName: data.business_subcategories?.name ?? null,
        sellingModel: data.selling_model,
        inventoryEnabled: data.inventory_enabled,
        taxEnabled: data.tax_enabled,
        salesChannels: data.sales_channels,
        teamSize: data.team_size,
      }));
    };
    load();
    const onBusinessChanged = () => { load(); };
    window.addEventListener('moneymatters:business-changed', onBusinessChanged);
    return () => {
      cancelled = true;
      window.removeEventListener('moneymatters:business-changed', onBusinessChanged);
    };
  }, []);
  return configuration;
}
