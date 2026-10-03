import type { BusinessContext } from '@/lib/supabase';
export type BusinessRole='owner'|'admin'|'accountant'|'cashier'|'auditor'|'staff'|'viewer'|string;
const exact:Record<string,BusinessRole[]|null>={
 '/next-workspace/cash-bill':['owner','admin','accountant','cashier','staff'],
 '/next-workspace/business-settings':['owner','admin'],
 '/next-workspace/brand':['owner','admin'],
 '/next-workspace/preferences':['owner','admin','accountant'],
 '/next-workspace/data-migration':['owner','admin','accountant'],
 '/next-workspace/items':['owner','admin','accountant','auditor'],
 '/next-workspace/accounting':['owner','admin','accountant','auditor'],
 '/next-workspace/reports':['owner','admin','accountant','auditor'],
 '/next-workspace/tax':['owner','admin','accountant','auditor'],
 '/next-workspace/invoices':['owner','admin','accountant','auditor'],
 '/next-workspace/sales':['owner','admin','accountant','auditor'],
 '/next-workspace/documents':['owner','admin','accountant','auditor'],
 '/next-workspace/payments':['owner','admin','accountant','auditor'],
 '/next-workspace/receipts':['owner','admin','accountant','auditor'],
 '/next-workspace/inventory':['owner','admin','accountant','auditor'],
 '/next-workspace/banking':['owner','admin','accountant'],
 '/next-workspace/purchases':['owner','admin','accountant'],
 '/next-workspace/vendors':['owner','admin','accountant'],
 '/next-workspace/expenses':['owner','admin','accountant'],
 '/next-workspace/customers':['owner','admin','accountant'],
 '/next-workspace/whatsapp':['owner','admin','accountant'],
};
export function canSeeRoute(ctx:BusinessContext|null,path:string){
 if(!ctx)return false;if(ctx.role==='owner'||ctx.role==='admin')return true;
 const hit=Object.keys(exact).find((x)=>path===x||path.startsWith(x+'/'));
 if(hit)return Boolean(exact[hit]?.includes(ctx.role));
 if(path==='/next-workspace'||path==='/next-workspace/profile')return true;
 return ctx.role!=='cashier'&&ctx.role!=='auditor';
}