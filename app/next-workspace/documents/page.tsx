'use client';
import {Suspense,useEffect,useState} from 'react';
import {useSearchParams} from 'next/navigation';
import {supabase} from '@/lib/supabase';
import DocumentReviewCenter from './DocumentReviewCenter';

function PageContent(){
 const q=useSearchParams();
 const type=q.get('type')||'invoice';
 const id=q.get('id')||'';
 const [checking,setChecking]=useState(type==='invoice');
 useEffect(()=>{
  let active=true;
  if(type!=='invoice'||!id){setChecking(false);return()=>{active=false}};
  (async()=>{
   const session=await supabase.auth.getUser();
   if(!active)return;
   if(!session.data.user){
    const token=await supabase.rpc('get_public_invoice_share_token',{p_invoice_id:id});
    if(!active)return;
    if(token.data){window.location.replace(`/invoice/${encodeURIComponent(String(token.data))}`);return}
   }
   setChecking(false);
  })();
  return()=>{active=false};
 },[type,id]);
 if(checking)return <div className="grid min-h-screen place-items-center text-sm text-slate-500">Preparing document…</div>;
 return <DocumentReviewCenter type={type} id={id}/>;
}

export default function DocumentsPage(){return <Suspense fallback={<div className="grid min-h-screen place-items-center text-sm text-slate-500">Preparing document…</div>}><PageContent/></Suspense>}
