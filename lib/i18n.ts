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

const ISO_COUNTRY_CODES = [
  'AD','AE','AF','AG','AI','AL','AM','AO','AQ','AR','AS','AT','AU','AW','AX','AZ','BA','BB','BD','BE','BF','BG','BH','BI','BJ','BL','BM','BN','BO','BQ','BR','BS','BT','BV','BW','BY','BZ','CA','CC','CD','CF','CG','CH','CI','CK','CL','CM','CN','CO','CR','CU','CV','CW','CX','CY','CZ','DE','DJ','DK','DM','DO','DZ','EC','EE','EG','EH','ER','ES','ET','FI','FJ','FK','FM','FO','FR','GA','GB','GD','GE','GF','GG','GH','GI','GL','GM','GN','GP','GQ','GR','GS','GT','GU','GW','GY','HK','HM','HN','HR','HT','HU','ID','IE','IL','IM','IN','IO','IQ','IR','IS','IT','JE','JM','JO','JP','KE','KG','KH','KI','KM','KN','KP','KR','KW','KY','KZ','LA','LB','LC','LI','LK','LR','LS','LT','LU','LV','LY','MA','MC','MD','ME','MF','MG','MH','MK','ML','MM','MN','MO','MP','MQ','MR','MS','MT','MU','MV','MW','MX','MY','MZ','NA','NC','NE','NF','NG','NI','NL','NO','NP','NR','NU','NZ','OM','PA','PE','PF','PG','PH','PK','PL','PM','PN','PR','PS','PT','PW','PY','QA','RE','RO','RS','RU','RW','SA','SB','SC','SD','SE','SG','SH','SI','SJ','SK','SL','SM','SN','SO','SR','SS','ST','SV','SX','SY','SZ','TC','TD','TF','TG','TH','TJ','TK','TL','TM','TN','TO','TR','TT','TV','TW','TZ','UA','UG','UM','US','UY','UZ','VA','VC','VE','VG','VI','VN','VU','WF','WS','YE','YT','ZA','ZM','ZW'
] as const;

export { ISO_COUNTRY_CODES };

export function getCurrencyOptions(locale = 'en-US') {
  if (typeof Intl.supportedValuesOf !== 'function') {
    throw new Error('This runtime does not expose ISO 4217 currency enumeration');
  }
  const codes = Intl.supportedValuesOf('currency');
  const names = typeof Intl.DisplayNames === 'function'
    ? new Intl.DisplayNames([locale], { type: 'currency' })
    : null;
  return codes.map((code) => ({ code, name: names?.of(code) ?? code }));
}

export function getCountryOptions(locale = 'en-US') {
  const names = typeof Intl.DisplayNames === 'function'
    ? new Intl.DisplayNames([locale], { type: 'region' })
    : null;
  return ISO_COUNTRY_CODES
    .map((code) => ({ code, name: names?.of(code) ?? code }))
    .sort((a,b) => a.name.localeCompare(b.name, locale));
}

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]['code'];

export function isSupportedLocale(value: string): value is SupportedLocale {
  return SUPPORTED_LOCALES.some((locale) => locale.code === value);
}

export function localeDirection(locale: string): 'ltr' | 'rtl' {
  return SUPPORTED_LOCALES.find((item) => item.code === locale)?.dir ?? 'ltr';
}

export function formatMoney(amount: number, currency = 'USD', locale = 'en-US') {
  const normalizedCurrency = String(currency || 'USD').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalizedCurrency)) throw new Error('Invalid ISO 4217 currency code');
  return new Intl.NumberFormat(String(locale || 'en-US'), {
    style: 'currency',
    currency: normalizedCurrency,
  }).format(Number.isFinite(amount) ? amount : 0);
}

export function formatBusinessMoney(
  amount: number,
  business: { currency_code?: string | null; base_currency_code?: string | null; locale?: string | null },
  options?: { base?: boolean; maximumFractionDigits?: number },
) {
  const currency = (options?.base ? business.base_currency_code : business.currency_code) || 'USD';
  return new Intl.NumberFormat(business.locale || 'en-US', {
    style: 'currency',
    currency: String(currency).toUpperCase(),
    maximumFractionDigits: options?.maximumFractionDigits,
  }).format(Number.isFinite(amount) ? amount : 0);
}

export function formatDate(value: string | Date, locale = 'en-US', options?: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat(locale, options ?? { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(value));
}
