import type { BusinessContext } from '@/lib/supabase';

export type BusinessRole='owner'|'admin'|'accountant'|'cashier'|'auditor'|'staff'|'viewer'|string;

const allowedByRole:Record<string,string[]>={
  cashier:['/next-workspace/cash-bill'],
  auditor:['/next-workspace','/next-workspace/invoices','/next-workspace/sales','/next-workspace/customers','/next-workspace/vendors','/next-workspace/items','/next-workspace/inventory','/next-workspace/purchases','/next-workspace/expenses','/next-workspace/payments','/next-workspace/receipts','/next-workspace/accounting','/next-workspace/tax','/next-workspace/reports','/next-workspace/documents','/next-workspace/profile'],
  accountant:['/next-workspace','/next-workspace/invoices','/next-workspace/sales','/next-workspace/quotation','/next-workspace/customers','/next-workspace/vendors','/next-workspace/items','/next-workspace/inventory','/next-workspace/purchases','/next-workspace/expenses','/next-workspace/recurring','/next-workspace/banking','/next-workspace/payments','/next-workspace/receipts','/next-workspace/accounting','/next-workspace/tax','/next-workspace/reports','/next-workspace/documents','/next-workspace/whatsapp','/next-workspace/settings/communications','/next-workspace/settings/payments','/next-workspace/profile'],
};

const matches=(path:string,allowed:string[])=>allowed.some((route)=>path===route||path.startsWith(route+'/'));

export function canAccessRoute(ctx:Pick<BusinessContext,'role'>|null,path:string){
  if(!ctx)return false;
  if(ctx.role==='owner'||ctx.role==='admin')return true;
  const allowed=allowedByRole[ctx.role];
  if(allowed)return matches(path,allowed);
  return true;
}

export function canShowCreateMenu(ctx:Pick<BusinessContext,'role'>|null){
  return Boolean(ctx&&['owner','admin','accountant'].includes(ctx.role));
}