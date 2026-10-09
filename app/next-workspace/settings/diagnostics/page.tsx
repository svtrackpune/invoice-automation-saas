'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase, type BusinessContext } from '@/lib/supabase';
import { Button, Card, StatusBadge } from '@/components/moneymatters';
import { PageHeader } from '@/components/ui/finops/PageHeader';
import { StatCard } from '@/components/ui/finops/StatCard';

type Issue={severity:'CRITICAL'|'HIGH'|'WARNING'|string;code:string;message:string};
type Health={healthy:boolean;checked_at:string;trial_balance:{debits:number;credits:number;balanced:boolean};checks:{orphaned_inventory_movements:number;po_ledger_entanglements:number;invalid_document_preferences:number;payment_settings_present:boolean};issues:Issue[]};
const money=(n:number)=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:2}).format(Number(n||0));

export default function DiagnosticsPage(){
 const [ctx,setCtx]=useState<BusinessContext|null>(null),[health,setHealth]=useState<Health|null>(null),[loading,setLoading]=useState(true),[running,setRunning]=useState(false),[error,setError]=useState('');
 const run=useCallback(async(businessId:string)=>{setRunning(true);setError('');const r=await supabase.rpc('run_business_health_check',{p_business_id:businessId});if(r.error){setError(r.error.message);setHealth(null)}else setHealth(r.data as Health);setRunning(false)},[]);
 useEffect(()=>{void(async()=>{const c=await supabase.rpc('get_my_business_context');const b=c.data?.[0] as BusinessContext|undefined;if(!b){setError('No active business context is available.');setLoading(false);return}setCtx(b);await run(b.business_id);setLoading(false)})()},[run]);
 if(loading)return <div className="grid min-h-[70vh] place-items-center text-sm text-slate-500">Running system integrity diagnostics…</div>;
 return <main className="min-h-screen bg-[#fbfaff] p-4 sm:p-6 lg:p-8"><div className="mx-auto max-w-[1180px]">
  <PageHeader breadcrumbs={[{label:'Workspace',href:'/next-workspace'},{label:'Settings & configuration',href:'/next-workspace/settings'},{label:'System Health & Integrity'}]} title="System Diagnostics" subtitle="Database constraints, schema migrations, and ledger invariant health checks" badge={{label:'SYSTEM INTEGRITY',variant:'statutory'}} actions={<Button disabled={running||!ctx} onClick={()=>ctx&&run(ctx.business_id)}>{running?'Running…':'Run health check'}</Button>}/>
  {error&&<div className="mb-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
  {health&&<><Card className="p-6"><div className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex items-center gap-3"><h2 className="text-xl font-semibold">Production integrity</h2><StatusBadge status={health.healthy?'healthy':'attention'} tone={health.healthy?'success':'danger'}/></div><p className="mt-2 text-sm text-slate-500">{health.healthy?'All blocking integrity checks passed.':'One or more blocking integrity checks require attention.'}</p></div><span className="text-xs text-slate-400">Checked {new Date(health.checked_at).toLocaleString()}</span></div>
   <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><Metric label="Ledger debits" value={money(health.trial_balance.debits)} ok={health.trial_balance.balanced}/><Metric label="Ledger credits" value={money(health.trial_balance.credits)} ok={health.trial_balance.balanced}/><Metric label="Orphaned inventory" value={String(health.checks.orphaned_inventory_movements)} ok={health.checks.orphaned_inventory_movements===0}/><Metric label="PO ledger leaks" value={String(health.checks.po_ledger_entanglements)} ok={health.checks.po_ledger_entanglements===0}/></div>
   <div className="mt-4 grid gap-4 sm:grid-cols-2"><Metric label="Invalid document preferences" value={String(health.checks.invalid_document_preferences)} ok={health.checks.invalid_document_preferences===0}/><Metric label="Payment settings" value={health.checks.payment_settings_present?'Configured':'Not configured'} ok={health.checks.payment_settings_present}/></div>
  </Card>
  <Card className="mt-5 overflow-hidden"><div className="border-b border-slate-100 px-5 py-4"><h2 className="font-semibold">Diagnostic findings</h2><p className="mt-1 text-xs text-slate-500">Warnings are configuration advisories; HIGH/CRITICAL findings make the integrity result unhealthy.</p></div><div className="divide-y divide-slate-100">{health.issues.length?health.issues.map((x,i)=><div key={x.code+'-'+i} className="flex gap-4 p-5"><span className={`h-fit rounded-full px-2.5 py-1 text-[10px] font-bold ${x.severity==='CRITICAL'?'bg-rose-100 text-rose-700':x.severity==='HIGH'?'bg-amber-100 text-amber-800':'bg-slate-100 text-slate-600'}`}>{x.severity}</span><div><b className="text-sm">{x.code.replaceAll('_',' ')}</b><p className="mt-1 text-sm text-slate-600">{x.message}</p></div></div>):<div className="p-8 text-center text-sm text-emerald-700">No integrity findings detected.</div>}</div></Card></>}
 </div></main>;
}
function Metric({label,value,ok}:{label:string;value:string;ok:boolean}){return <StatCard title={label} value={value} tone={ok?'statutory':'pending'} className="min-h-[100px] p-4"><span className={`text-xs font-semibold ${ok?'text-finops-inflow':'text-finops-outflow'}`}>{ok?'PASS':'CHECK'}</span></StatCard>}
