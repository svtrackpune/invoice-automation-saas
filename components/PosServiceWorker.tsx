'use client';
import {useEffect} from 'react';
export default function PosServiceWorker(){
 useEffect(()=>{
  if(!('serviceWorker'in navigator))return;
  void navigator.serviceWorker.register('/pos-sw.js',{scope:'/next-workspace/cash-bill'}).then(async registration=>{
    try{
      const syncManager=registration as ServiceWorkerRegistration & {sync?:{register(tag:string):Promise<void>}};
      await syncManager.sync?.register('moneymatters-pos-sync');
    }catch{}
  }).catch(()=>{});
 },[]);
 return null;
}