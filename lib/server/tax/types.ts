export type TaxSystem = 'VAT' | 'SALES_TAX' | 'GST' | 'CUSTOM';
export type TaxCategory = 'STANDARD' | 'REDUCED' | 'ZERO_RATED' | 'EXEMPT' | 'REVERSE_CHARGE';

export interface CanonicalAddress {
  country_code: string;
  country_subdivision_code: string | null;
  locality: string | null;
  postal_code: string | null;
  address_line_1: string | null;
  address_line_2: string | null;
}

export interface TaxLineSnapshot {
  invoiceId: string;
  invoiceItemId: string | null;
  jurisdictionId: string;
  taxCode: string;
  taxCategory: TaxCategory;
  rate: number;
  taxableAmount: number;
  taxAmount: number;
  baseTaxAmount: number;
  transactionCurrencyCode: string;
  baseCurrencyCode: string;
  exchangeRate: number;
  isReverseCharge: boolean;
  sourceAdapter: string;
  snapshotAt?: string;
}

export interface TaxSnapshotInput {
  invoiceId: string;
  invoiceDate: string;
  currencyCode: string;
  baseCurrencyCode: string;
  exchangeRate: number;
  reverseCharge: boolean;
  supplyType?: string | null;
  placeOfSupplySubdivisionCode?: string | null;
  supplierSubdivisionCode?: string | null;
  taxTotal: number;
  cgstAmount?: number;
  sgstAmount?: number;
  igstAmount?: number;
  items: Array<{
    id: string;
    taxableAmount: number;
    taxAmount: number;
    taxRate: number;
  }>;
}

export interface TaxAdapter {
  readonly name: string;
  readonly taxSystem: TaxSystem;
  snapshot(input: TaxSnapshotInput): TaxLineSnapshot[];
}

export interface TaxCalculationLineParam {
  invoiceItemId: string;
  taxCode?: string | null;
  netAmount: number;
}

export interface TaxCalculationParams {
  businessId: string;
  invoiceDate: string;
  supplierAddress: CanonicalAddress;
  buyerAddress: CanonicalAddress;
  supplierTaxId?: string | null;
  buyerTaxId?: string | null;
  taxSystem?: TaxSystem | null;
  currencyCode: string;
  lines: TaxCalculationLineParam[];
}

export interface TaxCalculationLineResult {
  invoiceItemId: string;
  jurisdictionId: string;
  taxRuleId: string;
  taxComponentId: string | null;
  taxCode: string;
  taxCategory: TaxCategory;
  rate: number;
  taxableAmount: number;
  taxAmount: number;
  isReverseCharge: boolean;
  componentSequence: number;
  calculationBasis: 'net' | 'gross_plus_previous';
  sourceProvider: string;
}

export interface TaxCalculationResult {
  lines: TaxCalculationLineResult[];
  totalTax: number;
}

export interface TaxDeterminationProvider {
  readonly name: string;
  calculateTaxes(params: TaxCalculationParams): Promise<TaxCalculationResult>;
}