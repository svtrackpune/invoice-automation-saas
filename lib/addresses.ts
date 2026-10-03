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

const INDIA_SUBDIVISIONS:Record<string,string>={
  'ANDHRA PRADESH':'IN-AP','AP':'IN-AP','ARUNACHAL PRADESH':'IN-AR','AR':'IN-AR','ASSAM':'IN-AS','AS':'IN-AS',
  'BIHAR':'IN-BR','BR':'IN-BR','CHHATTISGARH':'IN-CG','CG':'IN-CG','GOA':'IN-GA','GA':'IN-GA','GUJARAT':'IN-GJ','GJ':'IN-GJ',
  'HARYANA':'IN-HR','HR':'IN-HR','HIMACHAL PRADESH':'IN-HP','HP':'IN-HP','JHARKHAND':'IN-JH','JH':'IN-JH','KARNATAKA':'IN-KA','KA':'IN-KA',
  'KERALA':'IN-KL','KL':'IN-KL','MADHYA PRADESH':'IN-MP','MP':'IN-MP','MAHARASHTRA':'IN-MH','MH':'IN-MH','MANIPUR':'IN-MN','MN':'IN-MN',
  'MEGHALAYA':'IN-ML','ML':'IN-ML','MIZORAM':'IN-MZ','MZ':'IN-MZ','NAGALAND':'IN-NL','NL':'IN-NL','ODISHA':'IN-OR','OR':'IN-OR',
  'PUNJAB':'IN-PB','PB':'IN-PB','RAJASTHAN':'IN-RJ','RJ':'IN-RJ','SIKKIM':'IN-SK','SK':'IN-SK','TAMIL NADU':'IN-TN','TN':'IN-TN',
  'TELANGANA':'IN-TS','TS':'IN-TS','TRIPURA':'IN-TR','TR':'IN-TR','UTTAR PRADESH':'IN-UP','UP':'IN-UP','UTTARAKHAND':'IN-UK','UK':'IN-UK',
  'WEST BENGAL':'IN-WB','WB':'IN-WB','DELHI':'IN-DL','DL':'IN-DL','JAMMU AND KASHMIR':'IN-JK','J&K':'IN-JK','JK':'IN-JK',
  'LADAKH':'IN-LA','LA':'IN-LA','PUDUCHERRY':'IN-PY','PONDICHERRY':'IN-PY','PY':'IN-PY','CHANDIGARH':'IN-CH','CH':'IN-CH',
  'DADRA AND NAGAR HAVELI AND DAMAN AND DIU':'IN-DH','DNHDD':'IN-DH','LAKSHADWEEP':'IN-LD','LD':'IN-LD','ANDAMAN AND NICOBAR ISLANDS':'IN-AN','AN':'IN-AN',
};

const text=(value:unknown)=>{const v=String(value??'').trim();return v||null;};
const subdivision=(country:string,raw:unknown):string|null=>{
  const s=String(raw??'').trim().toUpperCase();if(!s)return null;
  if(ISO_SUBDIVISION.test(s))return s;
  if(country==='IN'&&INDIA_SUBDIVISIONS[s])return INDIA_SUBDIVISIONS[s];
  if(/^[A-Z]{2}$/.test(s))return country+'-'+s;
  if(country==='GB'&&['ENG','WLS','SCT','NIR'].includes(s))return 'GB-'+s;
  return null;
};

export function normalizeCanonicalAddress(input:Record<string,unknown>|null|undefined,defaultCountryCode:string):CanonicalAddress{
  const a=input??{};const country=String(a.country_code??a.country??defaultCountryCode).trim().toUpperCase();
  if(!ISO_COUNTRY.test(country))throw new Error('A valid ISO 3166-1 alpha-2 country code is required.');
  return {country_code:country,country_subdivision_code:subdivision(country,a.country_subdivision_code??a.subdivision_code??a.state_code??a.state),locality:text(a.locality??a.city??a.town??a.district),postal_code:text(a.postal_code??a.pincode??a.pin??a.zip),address_line_1:text(a.address_line_1??a.line1??a.street??a.address),address_line_2:text(a.address_line_2??a.line2??a.suite)};
}