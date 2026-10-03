'use client';
import {useEffect,useState} from 'react';
import {usePathname} from 'next/navigation';
import type {BusinessContext} from '@/lib/supabase';
import {canAccessRoute} from '@/lib/rbac';

export default function RoleRouteGuard({business,children}:{business:BusinessContext|null;children:React.ReactNode}){
  const pathname=usePathname();
  const [allowed,setAllowed]=useState<boolean|null>(null);
  useEffect(()=>{setAllowed(canAccessRoute(business,pathname));},[business,pathname]);
  if(allowed===null)return <div className='px-6 py-10 text-sm text-slate-500'>Checking workspace access…</div>;
  if(!allowed)return <main className='grid min-h-[70vh] place-items-center px-6'><section className='max-w-md rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm'><h1 className='text-lg font-semibold text-slate-900'>Access restricted</h1><p className='mt-2 text-sm text-slate-500'>Your current business role does not include this workspace.</p><a href='/next-workspace' className='mt-5 inline-flex rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white'>Return to dashboard</a></section></main>;
  return <>{children}</>;
}