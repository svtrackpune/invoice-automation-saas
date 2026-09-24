'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import {
  DEFAULT_BUSINESS_CONFIG,
  normalizeBusinessConfig,
  type BusinessFeatureConfig,
} from '@/lib/business-config';

type BusinessConfigContextValue = {
  businessId: string | null;
  config: BusinessFeatureConfig;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

const BusinessConfigContext = createContext<BusinessConfigContextValue | null>(null);

export function BusinessConfigProvider({
  businessId,
  children,
}: {
  businessId?: string | null;
  children: ReactNode;
}) {
  const [config, setConfig] = useState<BusinessFeatureConfig>(DEFAULT_BUSINESS_CONFIG);
  const [loading, setLoading] = useState(Boolean(businessId));
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    if (!businessId) {
      setConfig(DEFAULT_BUSINESS_CONFIG);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const { data, error: queryError } = await supabase
      .from('businesses')
      .select('feature_flags,category_id,subcategory_id')
      .eq('id', businessId)
      .maybeSingle();

    if (queryError) {
      setError(queryError.message);
      setLoading(false);
      return;
    }

    const categoryResult = await supabase
      .from('business_categories')
      .select('name')
      .eq('id', data?.category_id || '')
      .maybeSingle();

    const subcategoryResult = await supabase
      .from('business_subcategories')
      .select('name')
      .eq('id', data?.subcategory_id || '')
      .maybeSingle();

    try {
      setConfig(
        normalizeBusinessConfig(
          data?.feature_flags,
          categoryResult.data?.name,
          subcategoryResult.data?.name,
        ),
      );
    } catch (validationError) {
      setError(validationError instanceof Error ? validationError.message : 'Business capability configuration is invalid.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [businessId]);

  useEffect(() => {
    const onChanged = () => { void refresh(); };
    window.addEventListener('moneymatters:business-config-changed', onChanged);
    return () => window.removeEventListener('moneymatters:business-config-changed', onChanged);
  }, [businessId]);

  const value = useMemo(
    () => ({ businessId: businessId || null, config, loading, error, refresh }),
    [businessId, config, loading, error],
  );

  return <BusinessConfigContext.Provider value={value}>{children}</BusinessConfigContext.Provider>;
}

export function useBusinessConfig(): BusinessConfigContextValue {
  const value = useContext(BusinessConfigContext);
  if (!value) throw new Error('useBusinessConfig must be used inside BusinessConfigProvider');
  return value;
}
