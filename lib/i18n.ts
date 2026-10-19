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

const COMMON_CURRENCY_CODES = [
  'AED','AUD','BDT','BRL','CAD','CHF','CNY','EUR','GBP','HKD','IDR','INR',
  'JPY','KRW','LKR','MXN','MYR','NPR','NZD','PHP','PKR','SAR','SGD','THB',
  'TRY','TWD','USD','VND','ZAR',
] as const;

function safeLocale(locale: string | null | undefined): string {
  const candidate = String(locale || 'en-IN');
  try {
    new Intl.NumberFormat(candidate);
    return candidate;
  } catch {
    return 'en-IN';
  }
}

export function normalizeCurrencyCode(value: string | null | undefined, fallback = 'INR'): string {
  const candidate = String(value || '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(candidate) ? candidate : fallback;
}

export function getCurrencyOptions(locale = 'en-US') {
  let codes: readonly string[] = COMMON_CURRENCY_CODES;
  if (typeof Intl.supportedValuesOf === 'function') {
    try {
      codes = Intl.supportedValuesOf('currency');
    } catch {
      codes = COMMON_CURRENCY_CODES;
    }
  }
  const resolvedLocale = safeLocale(locale);
  let names: Intl.DisplayNames | null = null;
  try {
    names = typeof Intl.DisplayNames === 'function'
      ? new Intl.DisplayNames([resolvedLocale], { type: 'currency' })
      : null;
  } catch {
    names = null;
  }
  return [...new Set([...codes, ...COMMON_CURRENCY_CODES])]
    .map((code) => ({ code, name: names?.of(code) ?? code }))
    .sort((a, b) => a.name.localeCompare(b.name, resolvedLocale));
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

/** Normalize legacy language-only tags to the app's supported BCP 47 locale. */
export function resolveSupportedLocale(value: string | null | undefined): SupportedLocale | null {
  const candidate = String(value ?? '').trim().replace(/_/g, '-').toLowerCase();
  if (!candidate) return null;
  const exact = SUPPORTED_LOCALES.find((item) => item.code.toLowerCase() === candidate);
  if (exact) return exact.code;
  const aliases: Record<string, SupportedLocale> = { en: 'en-IN', mr: 'mr-IN', hi: 'hi-IN' };
  if (aliases[candidate]) return aliases[candidate];
  return SUPPORTED_LOCALES.find((item) => item.code.split('-')[0].toLowerCase() === candidate)?.code ?? null;
}

export function isSupportedLocale(value: string): value is SupportedLocale {
  return SUPPORTED_LOCALES.some((locale) => locale.code === value);
}

export function localeDirection(locale: string): 'ltr' | 'rtl' {
  return SUPPORTED_LOCALES.find((item) => item.code === locale)?.dir ?? 'ltr';
}

export function formatMoney(
  amount: number,
  currency = 'USD',
  locale = 'en-US',
  options?: { displayCode?: boolean; maximumFractionDigits?: number },
) {
  const normalizedCurrency = normalizeCurrencyCode(currency, 'USD');
  const resolvedLocale = safeLocale(locale);
  const safeAmount = Number.isFinite(amount) ? amount : 0;
  try {
    return new Intl.NumberFormat(resolvedLocale, {
      style: 'currency',
      currency: normalizedCurrency,
      currencyDisplay: options?.displayCode ? 'code' : 'symbol',
      maximumFractionDigits: options?.maximumFractionDigits,
    }).format(safeAmount);
  } catch {
    return `${normalizedCurrency} ${new Intl.NumberFormat(resolvedLocale, {
      maximumFractionDigits: options?.maximumFractionDigits ?? 2,
    }).format(safeAmount)}`;
  }
}

/** Format currency totals without ever summing amounts in different units. */
export function formatCurrencyTotals<T>(
  items: readonly T[],
  amountOf: (item: T) => number,
  currencyOf: (item: T) => string | null | undefined,
  locale = 'en-IN',
  fallbackCurrency = 'INR',
): string {
  const totals = new Map<string, number>();
  for (const item of items) {
    const code = normalizeCurrencyCode(currencyOf(item), fallbackCurrency);
    const amount = Number(amountOf(item));
    totals.set(code, (totals.get(code) ?? 0) + (Number.isFinite(amount) ? amount : 0));
  }
  if (!totals.size) return formatMoney(0, fallbackCurrency, locale);
  const entries = [...totals.entries()].sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 1) return formatMoney(entries[0][1], entries[0][0], locale);
  return entries.map(([currency, amount]) => formatMoney(amount, currency, locale, { displayCode: true })).join(' · ');
}

export function formatBusinessMoney(
  amount: number,
  business: { currency_code?: string | null; base_currency_code?: string | null; locale?: string | null },
  options?: { base?: boolean; maximumFractionDigits?: number },
) {
  const currency = (options?.base ? business.base_currency_code : business.currency_code) || 'USD';
  return formatMoney(amount, String(currency).toUpperCase(), business.locale || 'en-US', {
    maximumFractionDigits: options?.maximumFractionDigits,
  });
}

export function formatDate(value: string | Date, locale = 'en-US', options?: Intl.DateTimeFormatOptions) {
  // ISO date-only values are calendar dates, not UTC timestamps. Parse them
  // locally so browsers west of UTC do not display the previous day.
  let date: Date;
  if (typeof value === 'string') {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    date = match
      ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
      : new Date(value);
  } else {
    date = value;
  }
  if (Number.isNaN(date.getTime())) return String(value ?? '');
  return new Intl.DateTimeFormat(safeLocale(locale), options ?? { year: 'numeric', month: 'short', day: 'numeric' }).format(date);
}
