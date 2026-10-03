export interface CanonicalAddress {
  country_code: string;
  country_subdivision_code: string | null;
  locality: string | null;
  postal_code: string | null;
  address_line_1: string | null;
  address_line_2: string | null;
}

const ISO_COUNTRY = /^[A-Z]{2}$/;
const ISO_SUBDIVISION = /^[A-Z]{2}-[A-Z0-9-]+$/;

const text = (value: unknown) => {
  const v = String(value ?? '').trim();
  return v || null;
};

const subdivision = (country: string, raw: unknown): string | null => {
  const s = String(raw ?? '').trim().toUpperCase();
  if (!s) return null;
  if (ISO_SUBDIVISION.test(s)) return s;
  if (/^[A-Z]{2}$/.test(s)) return country + '-' + s;
  if (country === 'GB' && ['ENG', 'WLS', 'SCT', 'NIR'].includes(s)) return 'GB-' + s;
  return null;
};

export function normalizeCanonicalAddress(
  input: Record<string, unknown> | null | undefined,
  defaultCountryCode: string,
): CanonicalAddress {
  const a = input ?? {};
  const country = String(a.country_code ?? a.country ?? defaultCountryCode).trim().toUpperCase();
  if (!ISO_COUNTRY.test(country)) {
    throw new Error('A valid ISO 3166-1 alpha-2 country code is required.');
  }
  return {
    country_code: country,
    country_subdivision_code: subdivision(
      country,
      a.country_subdivision_code ?? a.subdivision_code ?? a.state_code ?? a.state,
    ),
    locality: text(a.locality ?? a.city ?? a.town ?? a.district),
    postal_code: text(a.postal_code ?? a.pincode ?? a.pin ?? a.zip),
    address_line_1: text(a.address_line_1 ?? a.line1 ?? a.street ?? a.address),
    address_line_2: text(a.address_line_2 ?? a.line2 ?? a.suite),
  };
}
