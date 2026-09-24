import * as z from 'zod';

/**
 * Canonical capability contract for an individual Moneymatters business.
 * All UI, navigation and workflow decisions should consume this normalized shape.
 */
export const BusinessConfigSchema = z.object({
  version: z.literal(1).default(1),

  // Offering & Operational Model
  has_physical_inventory: z.boolean().default(false),
  track_batch_serial: z.boolean().default(false),
  has_manufacturing: z.boolean().default(false),
  has_services_projects: z.boolean().default(false),
  has_recurring_subscriptions: z.boolean().default(false),

  // Sales & CRM Motions
  is_b2b: z.boolean().default(false),
  is_b2c_retail: z.boolean().default(false),
  requires_approval_workflows: z.boolean().default(false),

  // Financial Governance & Invoicing
  is_tax_registered: z.boolean().default(false),
  multi_currency: z.boolean().default(false),
  has_credit_terms: z.boolean().default(false),
  has_multi_location: z.boolean().default(false),

  // Preset is informational; the effective booleans are the source of truth.
  industry_preset: z.string().trim().min(1).max(80).default('custom'),
});

export type BusinessFeatureConfig = z.infer<typeof BusinessConfigSchema>;

export const DEFAULT_BUSINESS_CONFIG: BusinessFeatureConfig = BusinessConfigSchema.parse({
  version: 1,
  industry_preset: 'custom',
});

type PresetName =
  | 'retail'
  | 'wholesale'
  | 'distribution'
  | 'manufacturing'
  | 'professional_services'
  | 'construction'
  | 'hospitality'
  | 'healthcare'
  | 'ecommerce';

const PRESETS: Record<PresetName, Partial<BusinessFeatureConfig>> = {
  retail: {
    has_physical_inventory: true,
    is_b2c_retail: true,
  },
  wholesale: {
    has_physical_inventory: true,
    is_b2b: true,
    has_credit_terms: true,
    has_multi_location: true,
  },
  distribution: {
    has_physical_inventory: true,
    is_b2b: true,
    has_credit_terms: true,
    has_multi_location: true,
  },
  manufacturing: {
    has_physical_inventory: true,
    has_manufacturing: true,
    track_batch_serial: true,
    is_b2b: true,
    has_credit_terms: true,
  },
  professional_services: {
    has_services_projects: true,
    has_recurring_subscriptions: true,
    is_b2b: true,
    has_credit_terms: true,
  },
  construction: {
    has_services_projects: true,
    is_b2b: true,
    has_credit_terms: true,
    has_multi_location: true,
    requires_approval_workflows: true,
  },
  hospitality: {
    is_b2c_retail: true,
    has_physical_inventory: true,
  },
  healthcare: {
    has_services_projects: true,
    is_b2c_retail: true,
    requires_approval_workflows: true,
  },
  ecommerce: {
    has_physical_inventory: true,
    is_b2c_retail: true,
    multi_currency: true,
  },
};

const PRESET_ALIASES: Record<string, PresetName> = {
  retail: 'retail',
  'retail store': 'retail',
  wholesale: 'wholesale',
  distribution: 'distribution',
  manufacturing: 'manufacturing',
  'manufacturing & production': 'manufacturing',
  'professional services': 'professional_services',
  consultancy: 'professional_services',
  consulting: 'professional_services',
  construction: 'construction',
  contractor: 'construction',
  hospitality: 'hospitality',
  hotel: 'hospitality',
  restaurant: 'hospitality',
  healthcare: 'healthcare',
  'e-commerce': 'ecommerce',
  ecommerce: 'ecommerce',
};

export function getIndustryPreset(categoryName?: string | null, subcategoryName?: string | null): PresetName | null {
  const key = `${categoryName ?? ''} ${subcategoryName ?? ''}`.trim().toLowerCase();
  for (const [alias, preset] of Object.entries(PRESET_ALIASES)) {
    if (key === alias || key.includes(alias)) return preset;
  }
  return null;
}

export function normalizeBusinessConfig(
  input: unknown,
  categoryName?: string | null,
  subcategoryName?: string | null,
): BusinessFeatureConfig {
  const preset = getIndustryPreset(categoryName, subcategoryName);
  const candidate = {
    ...(preset ? PRESETS[preset] : {}),
    ...(input && typeof input === 'object' ? input as Record<string, unknown> : {}),
    industry_preset: preset ?? ((input as Record<string, unknown> | null)?.industry_preset ?? 'custom'),
    version: 1,
  };

  const parsed = BusinessConfigSchema.parse(candidate);

  // Dependency guarantees are enforced in one place, both in the client and DB.
  if (parsed.track_batch_serial && !parsed.has_physical_inventory) {
    parsed.has_physical_inventory = true;
  }

  return parsed;
}

export function applyIndustryPreset(
  categoryName?: string | null,
  subcategoryName?: string | null,
): BusinessFeatureConfig {
  const preset = getIndustryPreset(categoryName, subcategoryName);
  return BusinessConfigSchema.parse({
    ...DEFAULT_BUSINESS_CONFIG,
    ...(preset ? PRESETS[preset] : {}),
    industry_preset: preset ?? 'custom',
  });
}

export const FEATURE_DEFINITIONS = [
  {
    category: 'Offering & Operational Model',
    key: 'has_physical_inventory',
    label: 'Physical inventory',
    description: 'Stock ledger, warehouses, stock in/out, reconciliation and inventory asset accounting.',
  },
  {
    category: 'Offering & Operational Model',
    key: 'track_batch_serial',
    label: 'Batch / serial tracking',
    description: 'Adds lot/batch and serial controls to tracked products and stock movements.',
    dependsOn: 'has_physical_inventory',
  },
  {
    category: 'Offering & Operational Model',
    key: 'has_manufacturing',
    label: 'Manufacturing',
    description: 'BOM, work orders, production routing and raw-material consumption capabilities.',
  },
  {
    category: 'Offering & Operational Model',
    key: 'has_services_projects',
    label: 'Services & projects',
    description: 'Project tasks, timesheets, billable hours, milestones and WIP accounting.',
  },
  {
    category: 'Offering & Operational Model',
    key: 'has_recurring_subscriptions',
    label: 'Recurring subscriptions',
    description: 'Subscription plans, automated billing schedules and deferred-revenue workflows.',
  },
  {
    category: 'Sales & CRM Motions',
    key: 'is_b2b',
    label: 'B2B sales',
    description: 'Company accounts, multiple contacts, credit controls and PO references.',
  },
  {
    category: 'Sales & CRM Motions',
    key: 'is_b2c_retail',
    label: 'B2C / retail',
    description: 'Simplified customers, quick POS-style billing and fast cash/digital receipts.',
  },
  {
    category: 'Sales & CRM Motions',
    key: 'requires_approval_workflows',
    label: 'Approval workflows',
    description: 'Manager approval for configured discount and commercial thresholds.',
  },
  {
    category: 'Financial Governance & Invoicing',
    key: 'is_tax_registered',
    label: 'Tax registered',
    description: 'GST/VAT tax engine, HSN/SAC, place of supply and tax ledgers.',
  },
  {
    category: 'Financial Governance & Invoicing',
    key: 'multi_currency',
    label: 'Multi-currency',
    description: 'Currency selection, FX rates and realized/unrealized FX accounting.',
  },
  {
    category: 'Financial Governance & Invoicing',
    key: 'has_credit_terms',
    label: 'Credit terms',
    description: 'Net terms, AR aging and payment reminder automation.',
  },
  {
    category: 'Financial Governance & Invoicing',
    key: 'has_multi_location',
    label: 'Multi-location',
    description: 'Branches/warehouses, location-aware stock and inter-branch transfers.',
  },
] as const;

export type BusinessFeatureKey =
  (typeof FEATURE_DEFINITIONS)[number]['key'];
