import { supabase } from '@/lib/supabase';

export interface Gstr1Payload {
  gstin: string;
  fp: string;
  cur_gt: number;
  gt: number;
  b2b: Array<{
    ctin: string;
    inv: Array<{
      inum: string;
      idt: string;
      val: number;
      pos: string;
      rchrg: 'Y' | 'N';
      inv_typ: 'R';
      itms: Array<{
        num: number;
        itm_det: {
          rt: number;
          txval: number;
          iamt: number;
          camt: number;
          samt: number;
          csamt: number;
        };
      }>;
    }>;
  }>;
  b2cs: Array<{
    sply_ty: 'INTER' | 'INTRA';
    pos: string;
    rt: number;
    txval: number;
    iamt: number;
    camt: number;
    samt: number;
    csamt: number;
  }>;
  cdnr: Array<{
    ctin: string;
    nt: Array<{
      nt_num: string;
      nt_dt: string;
      ntty: 'C' | 'D';
      val: number;
      p_gst: 'N';
      inum: string;
      idt: string;
      itms: Array<{
        num: number;
        itm_det: {
          rt: number;
          txval: number;
          iamt: number;
          camt: number;
          samt: number;
          csamt: number;
        };
      }>;
    }>;
  }>;
  hsn: {
    data: Array<{
      num: number;
      hsn_sc: string;
      desc: string;
      uqc: string;
      qty: number;
      val: number;
      txval: number;
      iamt: number;
      camt: number;
      samt: number;
      csamt: number;
    }>;
  };
}

export interface StatutoryExportWarning {
  code: string;
  message: string;
  count?: number;
}

export interface StatutoryExportResult<T> {
  payload: T;
  warnings: StatutoryExportWarning[];
  periodStart: string;
  periodEnd: string;
  invoiceCount: number;
}

export interface TallyPrimeExport {
  xml: string;
  warnings: StatutoryExportWarning[];
  periodStart: string;
  periodEnd: string;
  voucherCount: number;
}

type BusinessRow = {
  id: string;
  name: string;
  currency_code: string;
  base_currency_code: string;
  fiscal_year_start_month: number;
  address: Record<string, unknown>;
};

type TaxProfile = {
  gstin: string | null;
  tax_state: string | null;
  tax_regime: string;
  gst_registration_type: string | null;
};

type CustomerRow = {
  id: string;
  display_name: string;
  legal_name: string | null;
  tax_id: string | null;
  tax_type: string | null;
  billing_address: Record<string, unknown>;
};

type InvoiceRow = {
  id: string;
  invoice_number: string;
  invoice_date: string;
  status: string;
  currency_code: string;
  total: number;
  subtotal: number;
  tax_total: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  place_of_supply_state_code: string | null;
  supply_type: string;
  reverse_charge: boolean;
  document_kind: string;
  customer_id: string;
};

type InvoiceItemRow = {
  id: string;
  invoice_id: string;
  product_service_id: string | null;
  description: string;
  quantity: number;
  unit_price: number;
  tax_rate_id: string | null;
  tax_amount: number;
  line_total: number;
  hsn_sac: string | null;
  sort_order: number;
};

type ProductRow = {
  id: string;
  name: string;
  hsn_sac: string | null;
  unit: string | null;
};

type TaxRateRow = {
  id: string;
  rate: number;
};

type NoteRow = {
  id: string;
  business_id: string;
  customer_id: string;
  invoice_id: string | null;
  credit_note_number?: string;
  debit_note_number?: string;
  credit_note_date?: string;
  debit_note_date?: string;
  total: number;
  subtotal: number;
  tax_total: number;
  status: string;
};

type CreditNoteItemRow = {
  id: string;
  credit_note_id: string;
  product_service_id: string | null;
  description: string;
  quantity: number;
  tax_rate_id: string | null;
  tax_rate: number;
  line_subtotal: number;
  line_tax: number;
  line_total: number;
  sort_order: number;
};

type DebitNoteItemRow = {
  id: string;
  debit_note_id: string;
  product_service_id: string | null;
  description: string;
  quantity: number;
  tax_rate_id: string | null;
  tax_amount: number;
  line_total: number;
  sort_order: number;
};

const INDIA_STATE_CODES: Record<string, string> = {
  'jammu and kashmir': '01', 'ladakh': '38', 'himachal pradesh': '02',
  'punjab': '03', 'chandigarh': '04', 'uttarakhand': '05', 'haryana': '06',
  'delhi': '07', 'rajasthan': '08', 'uttar pradesh': '09', 'bihar': '10',
  'sikkim': '11', 'arunachal pradesh': '12', 'nagaland': '13', 'manipur': '14',
  'mizoram': '15', 'tripura': '16', 'meghalaya': '17', 'assam': '18',
  'west bengal': '19', 'jharkhand': '20', 'odisha': '21', 'chhattisgarh': '22',
  'madhya pradesh': '23', 'gujarat': '24', 'dadra and nagar haveli and daman and diu': '26',
  'dadra & nagar haveli and daman & diu': '26', 'maharashtra': '27',
  'andhra pradesh': '37', 'karnataka': '29', 'goa': '30', 'lakshadweep': '31',
  'kerala': '32', 'tamil nadu': '33', 'puducherry': '34', 'andaman and nicobar islands': '35',
  'telangana': '36', 'the national capital territory of delhi': '07',
  'daman and diu': '25', 'uttaranchal': '05',
};

function round2(value: number): number {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function isoDateToDmy(value: string): string {
  const [year, month, day] = String(value).slice(0, 10).split('-');
  return year && month && day ? `${day}-${month}-${year}` : '';
}

function ymd(value: string): string {
  return String(value).slice(0, 10).replaceAll('-', '');
}

function firstDayOfMonth(period: string): string {
  if (!/^\\d{4}-\\d{2}$/.test(period)) throw new Error('Reporting period must be YYYY-MM.');
  const [year, month] = period.split('-').map(Number);
  if (month < 1 || month > 12) throw new Error('Reporting month is invalid.');
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

function lastDayOfMonth(period: string): string {
  const [year, month] = period.split('-').map(Number);
  const date = new Date(Date.UTC(year, month, 0));
  return date.toISOString().slice(0, 10);
}

function financialYearStart(year: number, fiscalStartMonth: number): string {
  const fyYear = fiscalStartMonth > 1 ? year : year;
  return `${fyYear}-${String(fiscalStartMonth).padStart(2, '0')}-01`;
}

function previousFinancialYearStart(currentStart: string): string {
  const date = new Date(`${currentStart}T00:00:00Z`);
  date.setUTCFullYear(date.getUTCFullYear() - 1);
  return date.toISOString().slice(0, 10);
}

function previousFinancialYearEnd(currentStart: string): string {
  const date = new Date(`${currentStart}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function normaliseStateCode(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  if (/^\\d{1,2}$/.test(raw)) return raw.padStart(2, '0');
  if (/^\\d{2}[A-Z]{5}\\d{4}/i.test(raw)) return raw.slice(0, 2);
  const code = INDIA_STATE_CODES[raw.toLowerCase()];
  return code ?? null;
}

function addressState(address: Record<string, unknown> | null | undefined): string | null {
  if (!address) return null;
  return normaliseStateCode(address.state_code ?? address.state ?? address.state_name ?? address.province);
}

function validGstin(value: unknown): value is string {
  return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/i.test(String(value ?? '').trim());
}

function numeric(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function uqc(value: string | null | undefined): string {
  const raw = String(value ?? '').trim().toUpperCase();
  if (!raw) return 'OTH';
  const direct = ['BAG','BAL','BDL','BKL','BOX','BTL','CAN','CBM','CCM','CMS','CTN','DOZ','DRM','GGR','GMS','GRS','GYD','KGS','KLR','KME','LTR','MTR','MTS','NOS','PAC','PCS','PRS','QTL','ROL','SET','SQF','SQM','SQY','TBS','TGM','THD','TON','TUB','UGS','UNT','YDS'];
  if (direct.includes(raw)) return raw;
  const aliases: Record<string,string> = { piece:'PCS', pieces:'PCS', pc:'PCS', pcs:'PCS', nos:'NOS', number:'NOS', numbers:'NOS', each:'UNT', unit:'UNT', units:'UNT', kg:'KGS', kgs:'KGS', kilogram:'KGS', kilograms:'KGS', gram:'GMS', grams:'GMS', gm:'GMS', litre:'LTR', litres:'LTR', liter:'LTR', liters:'LTR', ltr:'LTR', meter:'MTR', meters:'MTR', metre:'MTR', metres:'MTR', box:'BOX', boxes:'BOX', set:'SET', sets:'SET', dozen:'DOZ', doz:'DOZ' };
  return aliases[raw.toLowerCase()] ?? 'OTH';
}

async function fetchPaged<T>(
  table: string,
  select: string,
  filterBusinessId: string,
  orderColumn = 'id'
): Promise<T[]> {
  const pageSize = 1000;
  const rows: T[] = [];
  for (let start = 0; start < 100000; start += pageSize) {
    const result = await supabase
      .from(table)
      .select(select)
      .eq('business_id', filterBusinessId)
      .order(orderColumn, { ascending: true })
      .range(start, start + pageSize - 1);
    if (result.error) throw new Error(result.error.message);
    rows.push(...((result.data ?? []) as T[]));
    if ((result.data ?? []).length < pageSize) break;
  }
  return rows;
}

async function fetchPagedByDate<T>(
  table: string,
  select: string,
  businessId: string,
  dateColumn: string,
  from: string,
  to: string
): Promise<T[]> {
  const pageSize = 1000;
  const rows: T[] = [];
  for (let start = 0; start < 100000; start += pageSize) {
    const result = await supabase
      .from(table)
      .select(select)
      .eq('business_id', businessId)
      .gte(dateColumn, from)
      .lte(dateColumn, to)
      .order(dateColumn, { ascending: true })
      .order('id', { ascending: true })
      .range(start, start + pageSize - 1);
    if (result.error) throw new Error(result.error.message);
    rows.push(...((result.data ?? []) as T[]));
    if ((result.data ?? []).length < pageSize) break;
  }
  return rows;
}

async function fetchByIds<T>(table: string, select: string, column: string, ids: string[]): Promise<T[]> {
  if (!ids.length) return [];
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 500) chunks.push(ids.slice(i, i + 500));
  const rows: T[] = [];
  for (const chunk of chunks) {
    const result = await supabase.from(table).select(select).in(column, chunk);
    if (result.error) throw new Error(result.error.message);
    rows.push(...((result.data ?? []) as T[]));
  }
  return rows;
}

async function loadData(businessId: string, periodStart: string, periodEnd: string) {
  const businessResult = await supabase
    .from('businesses')
    .select('id,name,currency_code,base_currency_code,fiscal_year_start_month,address')
    .eq('id', businessId)
    .single();
  if (businessResult.error) throw new Error(businessResult.error.message);
  const profileResult = await supabase
    .from('business_tax_profiles')
    .select('gstin,tax_state,tax_regime,gst_registration_type')
    .eq('business_id', businessId)
    .maybeSingle();
  if (profileResult.error) throw new Error(profileResult.error.message);

  const business = businessResult.data as BusinessRow;
  const profile = (profileResult.data ?? {
    gstin: null,
    tax_state: null,
    tax_regime: 'NONE',
    gst_registration_type: null,
  }) as TaxProfile;

  const [customers, invoices, creditNotes, debitNotes] = await Promise.all([
    fetchPaged<CustomerRow>('customers','id,display_name,legal_name,tax_id,tax_type,billing_address',businessId,'display_name'),
    fetchPagedByDate<InvoiceRow>('invoices','id,invoice_number,invoice_date,status,currency_code,total,subtotal,tax_total,cgst_amount,sgst_amount,igst_amount,place_of_supply_state_code,supply_type,reverse_charge,document_kind,customer_id',businessId,'invoice_date',periodStart,periodEnd),
    fetchPagedByDate<NoteRow>('credit_notes','id,business_id,customer_id,invoice_id,credit_note_number,credit_note_date,total,subtotal,tax_total,status',businessId,'credit_note_date',periodStart,periodEnd),
    fetchPagedByDate<NoteRow>('debit_notes','id,business_id,customer_id,invoice_id,debit_note_number,debit_note_date,total,subtotal,tax_total,status',businessId,'debit_note_date',periodStart,periodEnd),
  ]);

  const postedInvoices = invoices.filter(x => !['draft','void'].includes(String(x.status).toLowerCase()) && x.currency_code === (business.base_currency_code || business.currency_code));
  const invoiceIds = postedInvoices.map(x => x.id);
  const [invoiceItems, products] = await Promise.all([
    fetchByIds<InvoiceItemRow>('invoice_items','id,invoice_id,product_service_id,description,quantity,unit_price,tax_rate_id,tax_amount,line_total,hsn_sac,sort_order','invoice_id',invoiceIds),
    fetchPaged<ProductRow>('products_services','id,name,hsn_sac,unit',businessId,'name'),
  ]);
  const taxIds = [...new Set([
    ...invoiceItems.map(x => x.tax_rate_id).filter(Boolean),
  ])] as string[];
  const taxRates = await fetchByIds<TaxRateRow>('tax_rates','id,rate','id',taxIds);

  const creditIds = creditNotes.filter(x => String(x.status).toLowerCase() === 'posted').map(x => x.id);
  const debitIds = debitNotes.filter(x => String(x.status).toLowerCase() === 'posted').map(x => x.id);
  const [creditItems, debitItems] = await Promise.all([
    fetchByIds<CreditNoteItemRow>('credit_note_items','id,credit_note_id,product_service_id,description,quantity,tax_rate_id,tax_rate,line_subtotal,line_tax,line_total,sort_order','credit_note_id',creditIds),
    fetchByIds<DebitNoteItemRow>('debit_note_items','id,debit_note_id,product_service_id,description,quantity,tax_rate_id,tax_amount,line_total,sort_order','debit_note_id',debitIds),
  ]);

  const fyStartMonth = Math.min(12, Math.max(1, Number(business.fiscal_year_start_month || profile.financial_year_start_month || 4)));
  const selectedYear = Number(periodStart.slice(0, 4));
  const selectedMonth = Number(periodStart.slice(5, 7));
  const fyStartYear = selectedMonth >= fyStartMonth ? selectedYear : selectedYear - 1;
  const currentFyStart = financialYearStart(fyStartYear, fyStartMonth);
  const previousFyStart = previousFinancialYearStart(currentFyStart);
  const previousFyEnd = previousFinancialYearEnd(currentFyStart);
  const previousPeriodInvoices = await fetchPagedByDate<InvoiceRow>('invoices','id,invoice_number,invoice_date,status,currency_code,total,subtotal,tax_total,cgst_amount,sgst_amount,igst_amount,place_of_supply_state_code,supply_type,reverse_charge,document_kind,customer_id',businessId,'invoice_date',previousFyStart,previousFyEnd);
  const currentFyInvoices = await fetchPagedByDate<InvoiceRow>('invoices','id,invoice_number,invoice_date,status,currency_code,total,subtotal,tax_total,cgst_amount,sgst_amount,igst_amount,place_of_supply_state_code,supply_type,reverse_charge,document_kind,customer_id',businessId,'invoice_date',currentFyStart,periodEnd);

  const validInvoiceForTurnover = (row: InvoiceRow) =>
    !['draft','void'].includes(String(row.status).toLowerCase()) &&
    row.currency_code === (business.base_currency_code || business.currency_code);

  const gt = round2(previousPeriodInvoices.filter(validInvoiceForTurnover).reduce((sum,row) => sum + numeric(row.total),0));
  const curGt = round2(currentFyInvoices.filter(validInvoiceForTurnover).reduce((sum,row) => sum + numeric(row.total),0));

  return {
    business,
    profile,
    customers,
    invoices: postedInvoices,
    invoiceItems,
    products,
    taxRates,
    creditNotes: creditNotes.filter(x => String(x.status).toLowerCase() === 'posted'),
    debitNotes: debitNotes.filter(x => String(x.status).toLowerCase() === 'posted'),
    creditItems,
    debitItems,
    gt,
    curGt,
    supplierState: normaliseStateCode(profile.tax_state) ?? addressState(business.address),
    periodStart,
    periodEnd,
  };
}

function itemTaxable(item: InvoiceItemRow): number {
  return round2(Math.max(0, numeric(item.line_total) - numeric(item.tax_amount)));
}

function itemTax(item: InvoiceItemRow): number {
  return round2(Math.max(0, numeric(item.tax_amount)));
}

function itemRate(item: InvoiceItemRow, taxMap: Map<string, number>): number {
  const direct = item.tax_rate_id ? taxMap.get(item.tax_rate_id) : undefined;
  if (direct !== undefined) return round2(direct);
  const taxable = itemTaxable(item);
  const tax = itemTax(item);
  return taxable > 0 ? round2((tax / taxable) * 100) : 0;
}

function buildTaxDetail(item: InvoiceItemRow, rate: number, interState: boolean) {
  const tax = itemTax(item);
  const taxable = itemTaxable(item);
  return {
    rt: round2(rate),
    txval: taxable,
    iamt: interState ? tax : 0,
    camt: interState ? 0 : round2(tax / 2),
    samt: interState ? 0 : round2(tax - round2(tax / 2)),
    csamt: 0,
  };
}

export async function buildGstr1Export(businessId: string, period: string): Promise<StatutoryExportResult<Gstr1Payload>> {
  const periodStart = firstDayOfMonth(period);
  const periodEnd = lastDayOfMonth(period);
  const data = await loadData(businessId, periodStart, periodEnd);
  const warnings: StatutoryExportWarning[] = [];

  if (!validGstin(data.profile.gstin)) {
    throw new Error('A valid 15-character GSTIN is required in Business Tax Profile before generating GSTR-1 JSON.');
  }

  if (String(data.profile.tax_regime).toUpperCase() !== 'GST') {
    throw new Error('GSTR-1 export requires the business tax regime to be GST.');
  }

  const customerMap = new Map(data.customers.map(x => [x.id, x]));
  const productMap = new Map(data.products.map(x => [x.id, x]));
  const taxMap = new Map(data.taxRates.map(x => [x.id, numeric(x.rate)]));
  const invoiceItemMap = new Map<string, InvoiceItemRow[]>();
  data.invoiceItems.forEach(item => {
    const list = invoiceItemMap.get(item.invoice_id) ?? [];
    list.push(item);
    invoiceItemMap.set(item.invoice_id, list.sort((a,b) => a.sort_order - b.sort_order));
  });

  const b2bMap = new Map<string, Gstr1Payload['b2b'][number]['inv']>();
  const b2csMap = new Map<string, Gstr1Payload['b2cs'][number]>();
  const hsnMap = new Map<string, Gstr1Payload['hsn']['data'][number]>();
  let missingHsn = 0;
  let missingPos = 0;

  for (const invoice of data.invoices) {
    const customer = customerMap.get(invoice.customer_id);
    if (!customer) {
      warnings.push({code:'CUSTOMER_MISSING',message:`Invoice ${invoice.invoice_number} has no matching customer record.`});
      continue;
    }

    const customerGstin = validGstin(customer.tax_id) ? String(customer.tax_id).trim().toUpperCase() : null;
    const pos = normaliseStateCode(invoice.place_of_supply_state_code) ?? addressState(customer.billing_address) ?? data.supplierState;
    if (!pos) {
      missingPos += 1;
      warnings.push({code:'POS_MISSING',message:`Invoice ${invoice.invoice_number} has no resolvable place-of-supply state code.`});
      continue;
    }

    const isInterState = pos !== data.supplierState || ['EXPORT','SEZ'].includes(String(invoice.supply_type).toUpperCase());
    const rchrg: 'Y'|'N' = invoice.reverse_charge ? 'Y' : 'N';
    const items = (invoiceItemMap.get(invoice.id) ?? []).map((item, index) => ({
      num: index + 1,
      itm_det: buildTaxDetail(item, itemRate(item, taxMap), isInterState),
    }));

    if (!items.length) {
      warnings.push({code:'NO_ITEMS',message:`Invoice ${invoice.invoice_number} has no item rows and was skipped.`});
      continue;
    }

    const formattedInvoice = {
      inum: invoice.invoice_number,
      idt: isoDateToDmy(invoice.invoice_date),
      val: round2(numeric(invoice.total)),
      pos,
      rchrg,
      inv_typ: 'R' as const,
      itms: items,
    };

    if (customerGstin) {
      const existing = b2bMap.get(customerGstin) ?? [];
      existing.push(formattedInvoice);
      b2bMap.set(customerGstin, existing);
    } else {
      for (const item of invoiceItemMap.get(invoice.id) ?? []) {
        const rate = itemRate(item, taxMap);
        const key = [pos, isInterState ? 'INTER' : 'INTRA', rate.toFixed(2)].join('|');
        const current = b2csMap.get(key) ?? {
          sply_ty: (isInterState ? 'INTER' : 'INTRA') as 'INTER'|'INTRA',
          pos,
          rt: rate,
          txval: 0,
          iamt: 0,
          camt: 0,
          samt: 0,
          csamt: 0,
        };
        const detail = buildTaxDetail(item, rate, isInterState);
        current.txval = round2(current.txval + detail.txval);
        current.iamt = round2(current.iamt + detail.iamt);
        current.camt = round2(current.camt + detail.camt);
        current.samt = round2(current.samt + detail.samt);
        current.csamt = round2(current.csamt + detail.csamt);
        b2csMap.set(key, current);
      }
    }

    for (const item of invoiceItemMap.get(invoice.id) ?? []) {
      const product = item.product_service_id ? productMap.get(item.product_service_id) : undefined;
      const hsn = String(item.hsn_sac ?? product?.hsn_sac ?? '').trim();
      if (!hsn) {
        missingHsn += 1;
        continue;
      }
      const rate = itemRate(item, taxMap);
      const u = uqc(product?.unit);
      const key = [hsn, product?.name ?? item.description, u].join('|');
      const current = hsnMap.get(key) ?? {
        num: hsnMap.size + 1,
        hsn_sc: hsn,
        desc: product?.name || item.description || 'Outward supply',
        uqc: u,
        qty: 0,
        val: 0,
        txval: 0,
        iamt: 0,
        camt: 0,
        samt: 0,
        csamt: 0,
      };
      const detail = buildTaxDetail(item, rate, isInterState);
      current.qty = round2(current.qty + numeric(item.quantity));
      current.val = round2(current.val + numeric(item.line_total));
      current.txval = round2(current.txval + detail.txval);
      current.iamt = round2(current.iamt + detail.iamt);
      current.camt = round2(current.camt + detail.camt);
      current.samt = round2(current.samt + detail.samt);
      current.csamt = round2(current.csamt + detail.csamt);
      hsnMap.set(key, current);
    }
  }

  const noteCustomerMap = new Map(data.customers.map(x => [x.id, x]));
  const creditItemsByNote = new Map<string, CreditNoteItemRow[]>();
  data.creditItems.forEach(item => {
    const list = creditItemsByNote.get(item.credit_note_id) ?? [];
    list.push(item);
    creditItemsByNote.set(item.credit_note_id, list.sort((a,b) => a.sort_order - b.sort_order));
  });
  const debitItemsByNote = new Map<string, DebitNoteItemRow[]>();
  data.debitItems.forEach(item => {
    const list = debitItemsByNote.get(item.debit_note_id) ?? [];
    list.push(item);
    debitItemsByNote.set(item.debit_note_id, list.sort((a,b) => a.sort_order - b.sort_order));
  });

  const cdnrMap = new Map<string, Gstr1Payload['cdnr'][number]['nt']>();

  for (const note of data.creditNotes) {
    const customer = noteCustomerMap.get(note.customer_id);
    const ctin = customer && validGstin(customer.tax_id) ? String(customer.tax_id).trim().toUpperCase() : null;
    if (!ctin) continue;
    const original = note.invoice_id ? data.invoices.find(x => x.id === note.invoice_id) : undefined;
    const pos = normaliseStateCode(original?.place_of_supply_state_code) ?? addressState(customer.billing_address) ?? data.supplierState;
    if (!pos) continue;
    const interState = pos !== data.supplierState || ['EXPORT','SEZ'].includes(String(original?.supply_type).toUpperCase());
    const noteItems = (creditItemsByNote.get(note.id) ?? []).map((item,index) => ({
      num:index+1,
      itm_det:{
        rt: round2(numeric(item.tax_rate)),
        txval: round2(numeric(item.line_subtotal)),
        iamt: interState ? round2(numeric(item.line_tax)) : 0,
        camt: interState ? 0 : round2(numeric(item.line_tax)/2),
        samt: interState ? 0 : round2(numeric(item.line_tax)-round2(numeric(item.line_tax)/2)),
        csamt:0,
      },
    }));
    if (!noteItems.length) continue;
    const list = cdnrMap.get(ctin) ?? [];
    list.push({
      nt_num: note.credit_note_number ?? note.id,
      nt_dt: isoDateToDmy(note.credit_note_date ?? periodStart),
      ntty:'C',
      val:round2(numeric(note.total)),
      p_gst:'N',
      inum:original?.invoice_number ?? note.invoice_id ?? note.id,
      idt:isoDateToDmy(original?.invoice_date ?? note.credit_note_date ?? periodStart),
      itms:noteItems,
    });
    cdnrMap.set(ctin,list);
  }

  for (const note of data.debitNotes) {
    const customer = noteCustomerMap.get(note.customer_id);
    const ctin = customer && validGstin(customer.tax_id) ? String(customer.tax_id).trim().toUpperCase() : null;
    if (!ctin) continue;
    const original = note.invoice_id ? data.invoices.find(x => x.id === note.invoice_id) : undefined;
    const pos = normaliseStateCode(original?.place_of_supply_state_code) ?? addressState(customer.billing_address) ?? data.supplierState;
    if (!pos) continue;
    const interState = pos !== data.supplierState || ['EXPORT','SEZ'].includes(String(original?.supply_type).toUpperCase());
    const noteItems = (debitItemsByNote.get(note.id) ?? []).map((item,index) => ({
      num:index+1,
      itm_det:{
        rt: (() => {
          const taxable = Math.max(0, numeric(item.line_total) - numeric(item.tax_amount));
          return taxable > 0 ? round2((numeric(item.tax_amount)/taxable)*100) : 0;
        })(),
        txval: round2(Math.max(0, numeric(item.line_total) - numeric(item.tax_amount))),
        iamt: interState ? round2(numeric(item.tax_amount)) : 0,
        camt: interState ? 0 : round2(numeric(item.tax_amount)/2),
        samt: interState ? 0 : round2(numeric(item.tax_amount)-round2(numeric(item.tax_amount)/2)),
        csamt:0,
      },
    }));
    if (!noteItems.length) continue;
    const list = cdnrMap.get(ctin) ?? [];
    list.push({
      nt_num: note.debit_note_number ?? note.id,
      nt_dt: isoDateToDmy(note.debit_note_date ?? periodStart),
      ntty:'D',
      val:round2(numeric(note.total)),
      p_gst:'N',
      inum:original?.invoice_number ?? note.invoice_id ?? note.id,
      idt:isoDateToDmy(original?.invoice_date ?? note.debit_note_date ?? periodStart),
      itms:noteItems,
    });
    cdnrMap.set(ctin,list);
  }

  if (missingHsn) warnings.push({code:'HSN_MISSING',message:'Some outward-supply lines were omitted from HSN summary because HSN/SAC is not configured.',count:missingHsn});
  if (missingPos) warnings.push({code:'POS_MISSING_TOTAL',message:'Some invoices were skipped because a valid state code could not be resolved.',count:missingPos});
  warnings.push({code:'GSTN_OFFLINE_UPLOAD',message:'The generated JSON is an offline GSTR-1 upload bridge. GST Portal filing/upload remains a taxpayer action; the GST Portal supports offline JSON upload through the Returns workflow.'});

  const payload: Gstr1Payload = {
    gstin: String(data.profile.gstin).trim().toUpperCase(),
    fp: `${period.slice(5,7)}${period.slice(0,4)}`,
    cur_gt: data.curGt,
    gt: data.gt,
    b2b: [...b2bMap.entries()].sort(([a],[b]) => a.localeCompare(b)).map(([ctin, inv]) => ({ctin, inv})),
    b2cs: [...b2csMap.values()].sort((a,b) => a.pos.localeCompare(b.pos) || a.rt - b.rt),
    cdnr: [...cdnrMap.entries()].sort(([a],[b]) => a.localeCompare(b)).map(([ctin,nt]) => ({ctin,nt})),
    hsn: {data:[...hsnMap.values()].sort((a,b) => a.hsn_sc.localeCompare(b.hsn_sc) || a.num-b.num).map((row,index) => ({...row,num:index+1}))},
  };

  return {payload,warnings,periodStart,periodEnd,invoiceCount:data.invoices.length};
}

function xmlEscape(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'","&apos;");
}

function tallyAmount(value: number, debit: boolean): string {
  const amount = round2(Math.abs(value));
  return `${debit ? '-' : ''}${amount.toFixed(2)}`;
}

export interface TallyLedgerNames {
  cashLedger: string;
  salesLedger: string;
  cgstLedger: string;
  sgstLedger: string;
  igstLedger: string;
}

const defaultTallyLedgers: TallyLedgerNames = {
  cashLedger:'Cash',
  salesLedger:'Sales',
  cgstLedger:'Output CGST',
  sgstLedger:'Output SGST',
  igstLedger:'Output IGST',
};

export async function buildTallyPrimeXml(
  businessId: string,
  from: string,
  to: string,
  ledgerNames: Partial<TallyLedgerNames> = {},
): Promise<TallyPrimeExport> {
  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(from) || !/^\\d{4}-\\d{2}-\\d{2}$/.test(to) || from > to) {
    throw new Error('Tally export dates are invalid.');
  }

  const mergedLedgers: TallyLedgerNames = {...defaultTallyLedgers,...ledgerNames};
  const rows = await loadData(businessId, from, to);
  const customers = new Map(rows.customers.map(x => [x.id, x]));
  const itemsByInvoice = new Map<string, InvoiceItemRow[]>();
  rows.invoiceItems.forEach(item => {
    const list = itemsByInvoice.get(item.invoice_id) ?? [];
    list.push(item);
    itemsByInvoice.set(item.invoice_id, list.sort((a,b) => a.sort_order - b.sort_order));
  });

  const warnings: StatutoryExportWarning[] = [{
    code:'TALLY_MASTERS',
    message:'TallyPrime must contain matching ledger masters (party ledger, Sales, Output GST ledgers, and Cash for Cash Bills). TallyPrime validates imported vouchers against the target company masters.',
  }];

  const vouchers = rows.invoices.map(invoice => {
    const customer = customers.get(invoice.customer_id);
    const partyLedger = invoice.document_kind === 'cash_bill' ? mergedLedgers.cashLedger : (customer?.display_name || customer?.legal_name || 'Customer');
    if (!customer && invoice.document_kind !== 'cash_bill') {
      warnings.push({code:'CUSTOMER_MISSING',message:`Invoice ${invoice.invoice_number} has no customer master; voucher uses a placeholder ledger name.`});
    }

    const itemRows = itemsByInvoice.get(invoice.id) ?? [];
    const cgst = numeric(invoice.cgst_amount);
    const sgst = numeric(invoice.sgst_amount);
    const igst = numeric(invoice.igst_amount);
    const salesBase = round2(numeric(invoice.total) - numeric(invoice.tax_total));
    const lines: string[] = [];
    lines.push(`      <LEDGERENTRIES.LIST>\\n        <LEDGERNAME>${xmlEscape(partyLedger)}</LEDGERNAME>\\n        <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>\\n        <ISPARTYLEDGER>${invoice.document_kind === 'cash_bill' ? 'No' : 'Yes'}</ISPARTYLEDGER>\\n        <ISLASTDEEMEDPOSITIVE>Yes</ISLASTDEEMEDPOSITIVE>\\n        <AMOUNT>${tallyAmount(numeric(invoice.total), true)}</AMOUNT>${invoice.document_kind === 'cash_bill' ? '' : `\\n        <BILLALLOCATIONS.LIST>\\n          <NAME>${xmlEscape(invoice.invoice_number)}</NAME>\\n          <BILLTYPE>New Ref</BILLTYPE>\\n          <AMOUNT>${tallyAmount(numeric(invoice.total), true)}</AMOUNT>\\n        </BILLALLOCATIONS.LIST>`}\\n      </LEDGERENTRIES.LIST>`);
    if (salesBase !== 0) lines.push(`      <LEDGERENTRIES.LIST>\\n        <LEDGERNAME>${xmlEscape(mergedLedgers.salesLedger)}</LEDGERNAME>\\n        <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>\\n        <AMOUNT>${tallyAmount(salesBase, false)}</AMOUNT>\\n      </LEDGERENTRIES.LIST>`);
    if (cgst !== 0) lines.push(`      <LEDGERENTRIES.LIST>\\n        <LEDGERNAME>${xmlEscape(mergedLedgers.cgstLedger)}</LEDGERNAME>\\n        <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>\\n        <AMOUNT>${tallyAmount(cgst, false)}</AMOUNT>\\n      </LEDGERENTRIES.LIST>`);
    if (sgst !== 0) lines.push(`      <LEDGERENTRIES.LIST>\\n        <LEDGERNAME>${xmlEscape(mergedLedgers.sgstLedger)}</LEDGERNAME>\\n        <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>\\n        <AMOUNT>${tallyAmount(sgst, false)}</AMOUNT>\\n      </LEDGERENTRIES.LIST>`);
    if (igst !== 0) lines.push(`      <LEDGERENTRIES.LIST>\\n        <LEDGERNAME>${xmlEscape(mergedLedgers.igstLedger)}</LEDGERNAME>\\n        <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>\\n        <AMOUNT>${tallyAmount(igst, false)}</AMOUNT>\\n      </LEDGERENTRIES.LIST>`);

    if (!itemRows.length) warnings.push({code:'NO_ITEMS',message:`Voucher ${invoice.invoice_number} has no item rows; exported as accounting-only sales voucher.`});
    return `    <TALLYMESSAGE>\\n      <VOUCHER VCHTYPE="Sales" ACTION="Create">\\n        <DATE>${ymd(invoice.invoice_date)}</DATE>\\n        <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>\\n        <VOUCHERNUMBER>${xmlEscape(invoice.invoice_number)}</VOUCHERNUMBER>\\n        <PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>\\n        <ISINVOICE>No</ISINVOICE>\\n        <OBJVIEW>Accounting Voucher View</OBJVIEW>\\n${lines.join('\\n')}\\n      </VOUCHER>\\n    </TALLYMESSAGE>`;
  });

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\\n<ENVELOPE>\\n  <HEADER>\\n    <VERSION>1</VERSION>\\n    <TALLYREQUEST>Import</TALLYREQUEST>\\n    <TYPE>Data</TYPE>\\n    <ID>Vouchers</ID>\\n  </HEADER>\\n  <BODY>\\n    <DESC></DESC>\\n    <DATA>\\n${vouchers.join('\\n')}\\n    </DATA>\\n  </BODY>\\n</ENVELOPE>\\n`;

  return {xml,warnings,periodStart:from,periodEnd:to,voucherCount:vouchers.length};
}

export function downloadTextFile(filename: string, textValue: string, mimeType: string): void {
  const blob = new Blob([textValue], {type:mimeType});
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
