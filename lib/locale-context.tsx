'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { localeDirection, resolveSupportedLocale, type SupportedLocale } from '@/lib/i18n';

type LocaleContextValue = {
  locale: SupportedLocale;
  setLocale: (locale: string) => void;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

function safeSupportedLocale(value: string | null | undefined): SupportedLocale {
  return resolveSupportedLocale(value) ?? 'en-IN';
}

export function LocaleProvider({ initialLocale, children }: {
  initialLocale: string;
  children: ReactNode;
}) {
  const [locale, setLocaleState] = useState<SupportedLocale>(() => safeSupportedLocale(initialLocale));

  useEffect(() => {
    setLocaleState(safeSupportedLocale(initialLocale));
  }, [initialLocale]);

  useEffect(() => {
    const root = document.documentElement;
    const previousLanguage = root.lang;
    const previousDirection = root.dir;
    root.lang = locale;
    root.dir = localeDirection(locale);
    return () => {
      root.lang = previousLanguage;
      root.dir = previousDirection;
    };
  }, [locale]);

  useEffect(() => {
    const receiveSavedLocale = (event: Event) => {
      const custom = event as CustomEvent<{ locale?: string }>;
      setLocaleState(safeSupportedLocale(custom.detail?.locale));
    };
    window.addEventListener('moneymatters:locale-changed', receiveSavedLocale);
    return () => window.removeEventListener('moneymatters:locale-changed', receiveSavedLocale);
  }, []);

  const setLocale = useCallback((value: string) => {
    setLocaleState(safeSupportedLocale(value));
  }, []);

  const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const value = useContext(LocaleContext);
  if (!value) throw new Error('useLocale must be used inside LocaleProvider');
  return value;
}
