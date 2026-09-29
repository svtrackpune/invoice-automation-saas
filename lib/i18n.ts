export const SUPPORTED_LOCALES = [
  { code: 'en-US', name: 'English (United States)', dir: 'ltr' },
  { code: 'en-GB', name: 'English (United Kingdom)', dir: 'ltr' },
  { code: 'en-IN', name: 'English (India)', dir: 'ltr' },
  { code: 'mr-IN', name: 'मराठी', dir: 'ltr' },
  { code: 'hi-IN', name: 'हिन्दी', dir: 'ltr' },
  { code: 'kn-IN', name: 'ಕನ್ನಡ', dir: 'ltr' },
  { code: 'ta-IN', name: 'தமிழ்', dir: 'ltr' },
  { code: 'te-IN', name: 'తెలుగు', dir: 'ltr' },
  { code: 'bn-IN', name: 'বাংলা', dir: 'ltr' },
  { code: 'gu-IN', name: 'ગુજરાતી', dir: 'ltr' },
  { code: 'fr-FR', name: 'Français', dir: 'ltr' },
  { code: 'de-DE', name: 'Deutsch', dir: 'ltr' },
  { code: 'es-ES', name: 'Español', dir: 'ltr' },
  { code: 'pt-BR', name: 'Português (Brasil)', dir: 'ltr' },
  { code: 'it-IT', name: 'Italiano', dir: 'ltr' },
  { code: 'nl-NL', name: 'Nederlands', dir: 'ltr' },
  { code: 'ja-JP', name: '日本語', dir: 'ltr' },
  { code: 'ko-KR', name: '한국어', dir: 'ltr' },
  { code: 'zh-CN', name: '简体中文', dir: 'ltr' },
  { code: 'ar-SA', name: 'العربية', dir: 'rtl' },
  { code: 'he-IL', name: 'עברית', dir: 'rtl' },
  { code: 'tr-TR', name: 'Türkçe', dir: 'ltr' },
  { code: 'id-ID', name: 'Bahasa Indonesia', dir: 'ltr' },
] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]['code'];

export function isSupportedLocale(value: string): value is SupportedLocale {
  return SUPPORTED_LOCALES.some((locale) => locale.code === value);
}

export function localeDirection(locale: string): 'ltr' | 'rtl' {
  return SUPPORTED_LOCALES.find((item) => item.code === locale)?.dir ?? 'ltr';
}

export function formatMoney(amount: number, currency = 'USD', locale = 'en-US') {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount);
}

export function formatDate(value: string | Date, locale = 'en-US', options?: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat(locale, options ?? { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(value));
}
