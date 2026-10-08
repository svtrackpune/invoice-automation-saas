'use client';

import { useEffect } from 'react';

export default function PurchasesLegacyRoute(){
  useEffect(()=>{ window.location.replace('/next-workspace/bills'); },[]);
  return <div className="grid min-h-[70vh] place-items-center text-sm text-slate-500">Opening Bills & Purchase Orders…</div>;
}
