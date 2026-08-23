export type BusinessRules = {
  tax: { registered: boolean; regime: 'NONE' | 'GST' | 'VAT' | 'SALES_TAX' | 'OTHER'; gstRegistrationType: string; gstin: string | null; state: string | null; accountingBasis: 'ACCRUAL' | 'CASH'; booksMode: 'FULL' | 'SIMPLE' | 'PRESUMPTIVE' };
  inventory: { enabled: boolean; trackedByItem: boolean };
  sales: { model: 'products' | 'services' | 'both'; cashBillEnabled: boolean };
  notifications: { email: boolean; whatsapp: boolean; sms: boolean };
  business: { categoryId: string | null; subcategoryId: string | null; channels: string[]; teamSize: string | null };
};

type Inputs = {
  business: { tax_enabled?: boolean | null; inventory_enabled?: boolean | null; selling_model?: string | null; category_id?: string | null; subcategory_id?: string | null; sales_channels?: unknown; team_size?: string | null };
  settings?: { cash_bill_enabled?: boolean | null } | null;
  preferences?: { tax_mode?: string | null; notification_email_enabled?: boolean | null; notification_whatsapp_enabled?: boolean | null; notification_sms_enabled?: boolean | null } | null;
  taxProfile?: { tax_regime?: string | null; gst_registration_type?: string | null; gstin?: string | null; tax_state?: string | null; accounting_basis?: string | null; books_mode?: string | null } | null;
};

export function deriveBusinessRules(input: Inputs): BusinessRules {
  const regime = (input.taxProfile?.tax_regime || (input.preferences?.tax_mode === 'gst' || input.business.tax_enabled ? 'GST' : 'NONE')) as BusinessRules['tax']['regime'];
  const gstType = input.taxProfile?.gst_registration_type || (regime === 'GST' ? 'REGULAR' : 'NONE');
  const registered = regime !== 'NONE' && (regime !== 'GST' || gstType !== 'NONE');
  const model = input.business.selling_model === 'services' || input.business.selling_model === 'both' ? input.business.selling_model : 'products';
  const channels = Array.isArray(input.business.sales_channels) ? input.business.sales_channels.filter((x): x is string => typeof x === 'string') : [];
  return {
    tax: { registered, regime, gstRegistrationType: gstType, gstin: input.taxProfile?.gstin || null, state: input.taxProfile?.tax_state || null, accountingBasis: input.taxProfile?.accounting_basis === 'CASH' ? 'CASH' : 'ACCRUAL', booksMode: input.taxProfile?.books_mode === 'SIMPLE' ? 'SIMPLE' : input.taxProfile?.books_mode === 'PRESUMPTIVE' ? 'PRESUMPTIVE' : 'FULL' },
    inventory: { enabled: Boolean(input.business.inventory_enabled), trackedByItem: Boolean(input.business.inventory_enabled) },
    sales: { model, cashBillEnabled: Boolean(input.settings?.cash_bill_enabled) },
    notifications: { email: input.preferences?.notification_email_enabled !== false, whatsapp: input.preferences?.notification_whatsapp_enabled !== false, sms: input.preferences?.notification_sms_enabled === true },
    business: { categoryId: input.business.category_id || null, subcategoryId: input.business.subcategory_id || null, channels, teamSize: input.business.team_size || null },
  };
}

export function explainTaxRule(rules: BusinessRules): string {
  if (!rules.tax.registered) return 'This business is not tax registered, so tax fields stay out of normal sales and purchase flows.';
  if (rules.tax.regime === 'GST') return rules.tax.gstin ? `GST is enabled for this business (${rules.tax.gstin}).` : 'GST is enabled for this business. GSTIN can be added later.';
  return `${rules.tax.regime} is enabled for this business.`;
}
