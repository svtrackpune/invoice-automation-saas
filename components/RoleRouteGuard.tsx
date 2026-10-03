'use client';
import { useEffect,useState } from 'react';
import { usePathname,useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

type Access={role:string;permissions:Record<string,boolean>};
const required:Record<string,string>={
 '/next-workspace/cash-bill':'pos.cash_bill.create','/next-workspace/items':'inventory.view','/next-workspace/accounting':'accounting.view','/next-workspace/reports':'reports.view','/next-workspace/tax':'tax.view','/next-workspace/invoices':'sales.view','/next-workspace/sales':'sales.view','/next-workspace/documents':'documents.view','/next-workspace/payments':'payments.view','/next-workspace/receipts':'sales.view','/next-workspace/inventory':'inventory.view','/next-workspace/banking':'banking.view','/next-workspace/purchases':'purchases.view','/next-workspace/vendors':'vendors.view','/next-workspace/expenses':'expenses.view','/next-workspace/customers':'customers.view','/next-workspace/business-settings':'settings.manage','/next-workspace/brand':'branding.manage','/next-workspace/preferences':'settings.manage','/next-workspace/data-migration':'accounting.view','/next-workspace/whatsapp':'integrations.manage',
};
const cashierAllowed=['/next-workspace','/next-workspace/cash-bill'];
const auditorAllowed=['/next-workspace','/next-workspace/invoices','/next-workspace/sales','/next-workspace/accounting','/next-workspace/reports','/next-workspace/documents','/next-workspace/payments','/next-workspace/receipts','/next-workspace/tax','/next-workspace/inventory','/next-workspace/items'];
function prefixMatch(path:string,list:string[]){return list.some((x)=>path===x||path.startsWith(x+'/'));}

export default function RoleRouteGuard({children}:{children:React.ReactNode}){
 const pathname=usePathname(),router=useRouter(),[access,setAccess]=useState<Access|null>(null),[denied,setDenied]=useState(false);
 useEffect(()=>{let active=true;(async()=>{const ctx=await supabase.rpc('get_my_business_context');const b=ctx.data?.[0] as {business_id:string}|undefined;if(!b){router.replace('/');return;}const r=await supabase.rpc('get_my_business_access',{p_business_id:b.business_id});if(!active)return;if(r.error||!r.data){setDenied(true);return;}const a=r.data as Access;setAccess(a);
   if(a.role==='cashier'&&pathname==='/next-workspace'){router.replace('/next-workspace/cash-bill');return;}
   if(a.role==='cashier'&&!prefixMatch(pathname,cashierAllowed)){setDenied(true);return;}
   if(a.role==='auditor'&&!prefixMatch(pathname,auditorAllowed)){setDenied(true);return;}
   const hit=Object.keys(required).find((x)=>pathname===x||pathname.startsWith(x+'/'));const p=hit?required[hit]:null;
   if(p&&!a.permissions[p]&&a.role!=='owner'&&a.role!=='admin')setDenied(true);
 })();return()=>{active=false;};},[pathname,router]);
 if(denied)return <main className='grid min-h-[70vh] place-items-center px-6'><div className='max-w-md text-center'><h1 className='text-xl font-semibold'>Access restricted</h1><p className='mt-2 text-sm text-slate-500'>Your role does not have permission to open this workspace.</p><button className='mt-5 rounded-xl border px-4 py-2 text-sm' onClick={()=>router.replace('/next-workspace')}>Return to dashboard</button></div></main>;
 if(!access)return <div className='grid min-h-[70vh] place-items-center text-sm text-slate-500'>Checking access…</div>;
 return <>{children}</>;
}