/**
 * MoneyMatters adaptive workspace core.
 *
 * Product principle:
 * Business facts -> deterministic workspace configuration.
 *
 * This module intentionally contains no database calls and no UI. It is the
 * single pure rule layer that the existing workspace can consume. Historical
 * financial data is never affected by these preferences.
 */

export type SellingModel = 'products' | 'services' | 'both';

export type BusinessAdaptationInput = {
  businessId: string;
  categoryId?: string | null;
  subcategoryId?: string | null;
  sellingModel?: SellingModel | null;
  inventoryEnabled?: boolean | null;
  taxEnabled?: boolean | null;
  recurringBilling?: boolean | null;
  salesChannels?: string[] | null;
  teamSize?: string | null;
};

export type WorkspacePriority = 'core' | 'relevant' | 'advanced';

export type WorkspaceModule =
  | 'dashboard'
  | 'sales'
  | 'invoices'
  | 'estimates'
  | 'customers'
  | 'recurring'
  | 'purchases'
  | 'expenses'
  | 'vendors'
  | 'products_services'
  | 'inventory'
  | 'banking'
  | 'payments'
  | 'receipts'
  | 'accounting'
  | 'tax'
  | 'reports'
  | 'whatsapp'
  | 'documents';

export type WorkspaceModuleConfig = {
  module: WorkspaceModule;
  priority: WorkspacePriority;
  label: string;
  href: string;
};

export type QuickAction = {
  id: string;
  label: string;
  description: string;
  href: string;
};

export type WorkspaceConfiguration = {
  version: 1;
  sellingModel: SellingModel;
  modules: WorkspaceModuleConfig[];
  primaryModules: WorkspaceModule[];
  advancedModules: WorkspaceModule[];
  quickActions: QuickAction[];
  recommendations: string[];
};

const MODULES: Record<WorkspaceModule, Omit<WorkspaceModuleConfig, 'priority'>> = {
  dashboard: { module: 'dashboard', label: 'Dashboard', href: '/next-workspace' },
  sales: { module: 'sales', label: 'Sales & Payments', href: '/next-workspace/sales' },
  invoices: { module: 'invoices', label: 'Invoices', href: '/next-workspace/invoices' },
  estimates: { module: 'estimates', label: 'Estimates', href: '/next-workspace/quotation' },
  customers: { module: 'customers', label: 'Customers', href: '/next-workspace/customers' },
  recurring: { module: 'recurring', label: 'Recurring', href: '/next-workspace/recurring' },
  purchases: { module: 'purchases', label: 'Purchases & Bills', href: '/next-workspace/purchases' },
  expenses: { module: 'expenses', label: 'Expenses', href: '/next-workspace/expenses' },
  vendors: { module: 'vendors', label: 'Vendors', href: '/next-workspace/vendors' },
  products_services: { module: 'products_services', label: 'Products & Services', href: '/next-workspace/items' },
  inventory: { module: 'inventory', label: 'Inventory', href: '/next-workspace/inventory' },
  banking: { module: 'banking', label: 'Banking', href: '/next-workspace/banking' },
  payments: { module: 'payments', label: 'Payments', href: '/next-workspace/payments' },
  receipts: { module: 'receipts', label: 'Receipts', href: '/next-workspace/receipts' },
  accounting: { module: 'accounting', label: 'Accounting', href: '/next-workspace/accounting' },
  tax: { module: 'tax', label: 'Tax & ITR', href: '/next-workspace/tax' },
  reports: { module: 'reports', label: 'Reports', href: '/next-workspace/reports' },
  whatsapp: { module: 'whatsapp', label: 'WhatsApp', href: '/next-workspace/whatsapp' },
  documents: { module: 'documents', label: 'Documents', href: '/next-workspace/documents/library' },
};

const core: WorkspaceModule[] = [
  'dashboard',
  'sales',
  'invoices',
  'estimates',
  'customers',
  'payments',
  'expenses',
  'reports',
];

function moduleConfig(module: WorkspaceModule, priority: WorkspacePriority): WorkspaceModuleConfig {
  return { ...MODULES[module], priority };
}

function addUnique(target: WorkspaceModule[], module: WorkspaceModule): void {
  if (!target.includes(module)) target.push(module);
}

/**
 * Converts business facts into a stable, explainable workspace configuration.
 * The rule order is deliberate: core capabilities are never removed; relevant
 * capabilities are promoted; everything else remains available as advanced.
 */
export function deriveWorkspaceConfiguration(
  input: BusinessAdaptationInput,
): WorkspaceConfiguration {
  const sellingModel: SellingModel = input.sellingModel === 'services'
    ? 'services'
    : input.sellingModel === 'both'
      ? 'both'
      : 'products';

  const hasProducts = sellingModel === 'products' || sellingModel === 'both';
  const hasServices = sellingModel === 'services' || sellingModel === 'both';
  const hasInventory = Boolean(input.inventoryEnabled) && hasProducts;
  const hasTax = Boolean(input.taxEnabled);
  const hasRecurring = Boolean(input.recurringBilling) || hasServices;
  const channels = new Set(input.salesChannels ?? []);

  const primary: WorkspaceModule[] = [];
  core.forEach((module) => addUnique(primary, module));

  if (hasProducts || hasServices) addUnique(primary, 'products_services');
  if (hasProducts) {
    addUnique(primary, 'purchases');
    addUnique(primary, 'vendors');
  }
  if (hasInventory) addUnique(primary, 'inventory');
  if (hasServices && hasRecurring) addUnique(primary, 'recurring');
  if (hasTax) addUnique(primary, 'tax');

  // Digital/WhatsApp-first businesses get customer communication promoted,
  // but the integration remains optional and business-scoped.
  if (channels.has('whatsapp')) addUnique(primary, 'whatsapp');

  const allModules = Object.keys(MODULES) as WorkspaceModule[];
  const modules: WorkspaceModuleConfig[] = allModules.map((module) => {
    if (primary.includes(module)) return moduleConfig(module, 'relevant');
    if (module === 'dashboard') return moduleConfig(module, 'core');
    return moduleConfig(module, 'advanced');
  });

  // Dashboard is always the first workspace destination.
  const orderedModules = modules.sort((a, b) => {
    const priorityRank: Record<WorkspacePriority, number> = {
      core: 0,
      relevant: 1,
      advanced: 2,
    };
    const rank = priorityRank[a.priority] - priorityRank[b.priority];
    if (rank !== 0) return rank;
    return a.label.localeCompare(b.label);
  });

  const quickActions: QuickAction[] = [
    {
      id: 'invoice',
      label: 'Create invoice',
      description: hasProducts && hasServices
        ? 'Sell products and services together on one invoice'
        : hasProducts
          ? 'Create an invoice for a product sale'
          : 'Create an invoice for a service',
      href: '/next-workspace/invoices/new',
    },
    {
      id: 'customer',
      label: 'Add customer',
      description: 'Add a customer and keep their financial relationship in one place',
      href: '/next-workspace/customers',
    },
  ];

  if (hasProducts) {
    quickActions.push({
      id: 'product-service',
      label: hasServices ? 'Add product or service' : 'Add product',
      description: hasServices
        ? 'Add either a product or service to your catalogue'
        : 'Add an item to your product catalogue',
      href: '/next-workspace/items',
    });
  } else {
    quickActions.push({
      id: 'service',
      label: 'Add service',
      description: 'Add a service and its selling price',
      href: '/next-workspace/items',
    });
  }

  quickActions.push({
    id: 'payment',
    label: 'Record payment',
    description: 'Record money received from a customer',
    href: '/next-workspace/payments',
  });

  if (hasInventory) {
    quickActions.push({
      id: 'inventory',
      label: 'Check inventory',
      description: 'Review stock and inventory activity',
      href: '/next-workspace/inventory',
    });
  }

  const recommendations: string[] = [];
  if (hasProducts && hasServices) {
    recommendations.push('You can sell products and services together on the same invoice.');
  } else if (hasProducts) {
    recommendations.push('Start by adding your products and pricing.');
  } else {
    recommendations.push('Start by adding your services and pricing.');
  }
  if (hasInventory) recommendations.push('Keep stock levels current so sales and inventory stay aligned.');
  if (hasTax) recommendations.push('Your tax profile is enabled; tax fields and reports are available where relevant.');
  if (hasRecurring) recommendations.push('Recurring billing is available for repeat customer work.');

  return {
    version: 1,
    sellingModel,
    modules: orderedModules,
    primaryModules: primary,
    advancedModules: allModules.filter((module) => !primary.includes(module)),
    quickActions,
    recommendations,
  };
}
