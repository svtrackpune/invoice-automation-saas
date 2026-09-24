import type { BusinessFeatureKey, BusinessFeatureConfig } from './business-config';

export type AdaptiveNavItem = {
  label: string;
  href: string;
  requiredAny?: BusinessFeatureKey[];
  requiredAll?: BusinessFeatureKey[];
  always?: boolean;
};

export type AdaptiveNavGroup = {
  name: string;
  items: AdaptiveNavItem[];
};

const NAVIGATION: AdaptiveNavGroup[] = [
  { name: 'Workspace', items: [{ label: 'Dashboard', href: '/next-workspace', always: true }] },
  {
    name: 'Sales',
    items: [
      { label: 'Invoices', href: '/next-workspace/invoices', always: true },
      { label: 'Sales & Payments', href: '/next-workspace/sales', always: true },
      { label: 'Estimates', href: '/next-workspace/quotation', always: true },
      { label: 'Customers', href: '/next-workspace/customers', always: true },
      { label: 'Recurring', href: '/next-workspace/recurring', requiredAny: ['has_recurring_subscriptions'] },
      { label: 'Cash Bill', href: '/next-workspace/cash-bill', requiredAny: ['is_b2c_retail'] },
    ],
  },
  {
    name: 'Money out',
    items: [
      { label: 'Purchases & Bills', href: '/next-workspace/purchases', requiredAny: ['has_physical_inventory', 'has_manufacturing', 'is_b2b'] },
      { label: 'Expenses', href: '/next-workspace/expenses', always: true },
      { label: 'Vendors', href: '/next-workspace/vendors', requiredAny: ['has_physical_inventory', 'has_manufacturing', 'is_b2b'] },
    ],
  },
  {
    name: 'Products',
    items: [
      { label: 'Products & Services', href: '/next-workspace/items', always: true },
      { label: 'Inventory', href: '/next-workspace/inventory', requiredAny: ['has_physical_inventory'] },
    ],
  },
  {
    name: 'Money & Accounting',
    items: [
      { label: 'Banking', href: '/next-workspace/banking', always: true },
      { label: 'Payments', href: '/next-workspace/payments', always: true },
      { label: 'Receipts', href: '/next-workspace/receipts', always: true },
      { label: 'Accounting', href: '/next-workspace/accounting', always: true },
      { label: 'Tax & ITR', href: '/next-workspace/tax', requiredAny: ['is_tax_registered'] },
      { label: 'Reports', href: '/next-workspace/reports', always: true },
    ],
  },
  {
    name: 'Settings & Automation',
    items: [
      { label: 'WhatsApp', href: '/next-workspace/whatsapp', always: true },
      { label: 'Documents', href: '/next-workspace/documents/library', always: true },
      { label: 'Document Settings', href: '/next-workspace/brand', always: true },
      { label: 'Business Settings', href: '/next-workspace/business-settings', always: true },
      { label: 'Preferences', href: '/next-workspace/preferences', always: true },
      { label: 'Data & Migration', href: '/next-workspace/data-migration', always: true },
      { label: 'My Profile', href: '/next-workspace/profile', always: true },
    ],
  },
];

const enabled = (config: BusinessFeatureConfig, key: BusinessFeatureKey) => config[key];

export function isNavigationItemVisible(config: BusinessFeatureConfig, item: AdaptiveNavItem): boolean {
  if (item.always) return true;
  if (item.requiredAll?.some((key) => !enabled(config, key))) return false;
  if (item.requiredAny?.length && !item.requiredAny.some((key) => enabled(config, key))) return false;
  return true;
}

export function buildAdaptiveNavigation(config: BusinessFeatureConfig, cashBillEnabled = false): AdaptiveNavGroup[] {
  return NAVIGATION
    .map((group) => ({
      ...group,
      items: group.items
        .filter((item) => isNavigationItemVisible(config, item))
        .filter((item) => item.href !== '/next-workspace/cash-bill' || cashBillEnabled),
    }))
    .filter((group) => group.items.length > 0);
}

export const CREATE_ROUTES: AdaptiveNavItem[] = [
  { label: 'Invoice', href: '/next-workspace/invoices/new', always: true },
  { label: 'Estimate', href: '/next-workspace/quotation', always: true },
  { label: 'Payment', href: '/next-workspace/payments', always: true },
  { label: 'Expense', href: '/next-workspace/expenses', always: true },
  { label: 'Customer', href: '/next-workspace/customers', always: true },
  { label: 'Vendor', href: '/next-workspace/vendors', requiredAny: ['has_physical_inventory', 'has_manufacturing', 'is_b2b'] },
  { label: 'Product / Service', href: '/next-workspace/items', always: true },
];

export function buildAdaptiveCreateRoutes(config: BusinessFeatureConfig): AdaptiveNavItem[] {
  return CREATE_ROUTES.filter((item) => isNavigationItemVisible(config, item));
}
