'use client';
import {Suspense} from 'react';
import {useSearchParams} from 'next/navigation';
import DocumentReviewCenter from './DocumentReviewCenter';

function PageContent(){
 const q=useSearchParams();
 const type=q.get('type')||'invoice';
 const id=q.get('id')||'';
 // Public invoice links must contain a share token and use /invoice/[token].
 // Do not mint a public token from an invoice UUID in this workspace route.
 return <DocumentReviewCenter type={type} id={id}/>;
}

export default function DocumentsPage(){
 return <Suspense fallback={<div className="grid min-h-screen place-items-center text-sm text-slate-500">Preparing document…</div>}>
  <PageContent/>
 </Suspense>;
}
