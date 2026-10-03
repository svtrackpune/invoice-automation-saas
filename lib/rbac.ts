import type { BusinessContext } from '@/lib/supabase';
export type BusinessRole='owner'|'admin'|'accountant'|'cashier'|'auditor'|'staff'|'viewer'|string;
const roleRouteRules:Record<string,BusinessRole[]|null>={
  '/next-workspace/cash-bill':['owner','admin','accountant','cashier','staff'],
  '/next-workspace/items':['owner','admin','accountant','cashier','auditor'],
  '/next-workspace/business-settings':['owner','admin'],
  '/next-workspace/brand':['owner','admin'],
  '/next-workspace/preferences':['owner','admin','accountant'],
  '/next-workspace/data-migration':['owner','admin','accountant'],
};
export function canSeeRoute(ctx:BusinessContext|null,path:string){if(!ctx)return false;if(ctx.role==='owner'||ctx.role==='admin')return true;const rule=Object.keys(roleRouteRules).find((x)=>path===x||path.startsWith(x+'/'));return rule?Boolean(roleRouteRules[rule]?.includes(ctx.role)):ctx.role!=='cashier';}