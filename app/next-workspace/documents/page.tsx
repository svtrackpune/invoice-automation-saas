'use client';
import {Suspense} from 'react';
import {useSearchParams} from 'next/navigation';
import DocumentReviewCenter from './DocumentReviewCenter';
function PageContent(){const q=useSearchParams();return <DocumentReviewCenter type={q.get('type')||'invoice'} id={q.get('id')||''}/>}
export default function DocumentsPage(){return <Suspense fallback={<div className="grid min-h-screen place-items-center text-sm text-slate-500">Preparing document…</div>}><PageContent/></Suspense>}
