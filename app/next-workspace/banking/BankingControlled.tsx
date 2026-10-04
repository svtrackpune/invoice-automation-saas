'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, EmptyState, Input, Select } from '@/components/moneymatters';

type Bank={id:string;name:string;institution_name:string|null;account_last4:string|null;currency_code:string;is_connected:boolean;linked_account_id:string|null};
type Tx={id:string;bank_account_id:string;transaction_date:string;value_date:string|null;description:string|null;reference:string|null;amount:number;direction:string;status:string;balance_after:number|null;raw_data:Record<string,unknown>|null;external_transaction_id:string|null};
type Rec={id:string;bank_account_id:string;period_start:string;period_end:string;statement_ending_balance:number;book_ending_balance:number;difference:number;status:string;locked_at:string|null};
type Account={id:string;code:string;name:string;account_type:string;normal_balance:string;account_subtype:string|null};
type Invoice={id:string;invoice_number:string;invoice_date:string;due_date:string|null;balance_due:number;customer_id:string|null;currency_code:string};
type Bill={id:string;bill_number:string;bill_date:string;due_date:string|null;balance_due:number;vendor_id:string|null;currency_code:string|null};
type Payment={id:string;payment_date:string;amount:number;method:string;reference:string|null;direction:string;invoice_id:string|null;bill_id:string|null;customer_id:string|null;vendor_id:string|null;currency_code:string};
type Party={id:string;display_name:string};

type Props={
  banks:Bank[];selectedBank:string;setSelectedBank:(v:string)=>void;transactions:Tx[];allTransactions:Tx[];
  reconciliations:Rec[];currentReconciliation:Rec|undefined;accounts:Account[];selectedAccount:Account|undefined;selectedBankBalance:number;
  invoices:Invoice[];bills:Bill[];payments:Payment[];customers:Party[];vendors:Party[];categoryAccounts:Account[];
  query:string;setQuery:(v:string)=>void;periodStart:string;setPeriodStart:(v:string)=>void;periodEnd:string;setPeriodEnd:(v:string)=>void;
  statementBalance:string;setStatementBalance:(v:string)=>void;unmatchedCount:number;lockedPeriod:boolean;busy:boolean;importing:boolean;
  notice:string;error:string;importResult:string;startOrUpdate:()=>Promise<void>|void;importStatement:(file:File)=>Promise<void>;
  reconcileWith:(ids:string[],type:'payment'|'expense'|'transfer',recordId:string,note:string)=>Promise<void>;
  createCustomerPaymentAndReconcile:(invoice:Invoice,transactionId:string)=>Promise<void>;
  createVendorPaymentAndReconcile:(bill:Bill,transactionId:string)=>Promise<void>;
  lock:()=>Promise<void>;
};

type Tab='invoices'|'bills'|'transfers'|'expenses';
type Candidate={id:string;kind:Tab;title:string;subtitle:string;date:string;reference:string;signedAmount:number;rawAmount:number;targetId:string;partyName?:string;exact?:boolean;score?:number;reason?:string};

const money=(n:number,currency='INR')=>new Intl.NumberFormat('en-IN',{style:'currency',currency,maximumFractionDigits:2}).format(Number(n||0));
const dateLabel=(v:string|null|undefined)=>{if(!v)return '—';const p=v.slice(0,10).split('-');return p.length===3?p[2]+'/'+p[1]+'/'+p[0]:v;};
const normalized=(v:string|null|undefined)=>(v||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'');
const daysBetween=(a:string,b:string)=>{const x=Date.parse(a.slice(0,10)+'T00:00:00Z');const y=Date.parse(b.slice(0,10)+'T00:00:00Z');return Number.isFinite(x)&&Number.isFinite(y)?Math.abs(x-y)/86400000:999;};
const textSimilarity=(a:string,b:string)=>{const x=new Set(normalized(a).match(/[a-z0-9]{3,}/g)||[]);const y=new Set(normalized(b).match(/[a-z0-9]{3,}/g)||[]);if(!x.size||!y.size)return 0;let hits=0;for(const t of x)if(y.has(t))hits+=1;return hits/Math.max(x.size,y.size);};
const signed=(tx:Tx)=>String(tx.direction).toLowerCase().includes('out')?-Math.abs(tx.amount):Math.abs(tx.amount);
const paymentSigned=(p:Payment)=>String(p.direction).toLowerCase().includes('out')?-Math.abs(p.amount):Math.abs(p.amount);
const scoreMatch=(tx:Tx,c:Candidate)=>{const days=daysBetween(tx.value_date||tx.transaction_date,c.date);const dateScore=days<=3?Math.max(0,1-days/3):0;const amountScore=Math.abs(Math.abs(tx.amount)-Math.abs(c.rawAmount))<=0.01?1:0;const txText=(tx.reference||'')+' '+(tx.description||'');const ref=normalized(c.reference);const refHit=ref.length>2&&normalized(txText).includes(ref);const similarity=refHit?1:textSimilarity(txText,(c.reference+' '+(c.partyName||c.title)));return Math.round((dateScore*.3+amountScore*.5+similarity*.2)*100);};

export default function BankingControlled(p:Props){
  const searchRef=useRef<HTMLInputElement>(null);const fileRef=useRef<HTMLInputElement>(null);
  const[selectedTxIds,setSelectedTxIds]=useState<Set<string>>(new Set());const[selectedCandidateId,setSelectedCandidateId]=useState<string|null>(null);
  const[tab,setTab]=useState<Tab>('invoices');const[dragging,setDragging]=useState(false);const[processing,setProcessing]=useState(false);

  const currency=p.banks.find(b=>b.id===p.selectedBank)?.currency_code||'INR';
  const customerName=(id:string|null|undefined)=>p.customers.find(x=>x.id===id)?.display_name||'Customer';
  const vendorName=(id:string|null|undefined)=>p.vendors.find(x=>x.id===id)?.display_name||'Vendor';

  useEffect(()=>{setSelectedTxIds(new Set());setSelectedCandidateId(null);},[p.selectedBank]);

  const selectedTransactions=useMemo(()=>p.allTransactions.filter(t=>selectedTxIds.has(t.id)),[p.allTransactions,selectedTxIds]);
  const statementTotal=selectedTransactions.reduce((s,t)=>s+signed(t),0);

  const candidatePool=useMemo<Candidate[]>(()=>{
    if(tab==='invoices')return p.invoices.map(i=>{const c:Candidate={id:i.id,kind:'invoices',title:i.invoice_number,subtitle:customerName(i.customer_id),date:i.invoice_date,reference:i.invoice_number,signedAmount:Math.abs(i.balance_due),rawAmount:Math.abs(i.balance_due),targetId:i.id,partyName:customerName(i.customer_id)};if(selectedTransactions.length===1)c.score=scoreMatch(selectedTransactions[0],c);c.exact=selectedTransactions.length===1&&signed(selectedTransactions[0])>0&&Math.abs(Math.abs(selectedTransactions[0].amount)-c.rawAmount)<=0.01&&normalized((selectedTransactions[0].reference||'')+' '+(selectedTransactions[0].description||'')).includes(normalized(i.invoice_number));return c;}).sort((a,b)=>Number(b.exact)-Number(a.exact)||(b.score||0)-(a.score||0));
    if(tab==='bills')return p.bills.map(b=>{const c:Candidate={id:b.id,kind:'bills',title:b.bill_number,subtitle:vendorName(b.vendor_id),date:b.bill_date,reference:b.bill_number,signedAmount:-Math.abs(b.balance_due),rawAmount:Math.abs(b.balance_due),targetId:b.id,partyName:vendorName(b.vendor_id)};if(selectedTransactions.length===1)c.score=scoreMatch(selectedTransactions[0],c);c.exact=selectedTransactions.length===1&&signed(selectedTransactions[0])<0&&Math.abs(Math.abs(selectedTransactions[0].amount)-c.rawAmount)<=0.01&&normalized((selectedTransactions[0].reference||'')+' '+(selectedTransactions[0].description||'')).includes(normalized(b.bill_number));return c;}).sort((a,b)=>Number(b.exact)-Number(a.exact)||(b.score||0)-(a.score||0));
    if(tab==='transfers')return p.banks.filter(b=>b.id!==p.selectedBank).map(b=>({id:b.id,kind:'transfers' as const,title:b.name,subtitle:(b.institution_name||'Bank')+(b.account_last4?' ••'+b.account_last4:''),date:selectedTransactions[0]?.transaction_date||'',reference:b.name,signedAmount:statementTotal,rawAmount:Math.abs(statementTotal),targetId:b.id,partyName:b.name}));
    return p.categoryAccounts.map(a=>({id:a.id,kind:'expenses' as const,title:a.code+' · '+a.name,subtitle:a.code==='6200'?'Payment Gateway / Bank Charges':'Quick ledger adjustment',date:selectedTransactions[0]?.transaction_date||'',reference:a.name,signedAmount:statementTotal,rawAmount:Math.abs(statementTotal),targetId:a.id,partyName:a.name}));
  },[tab,p.invoices,p.bills,p.banks,p.categoryAccounts,p.selectedBank,selectedTransactions,statementTotal,p.customers,p.vendors]);

  const feeAccount=p.accounts.find(a=>a.code==='6200'&&a.account_type==='expense');
  const displayedCandidates=tab==='expenses'&&feeAccount
    ? [{id:feeAccount.id,kind:'expenses' as const,title:'6200 · Payment Gateway / Bank Charges',subtitle:'Direct fee allocation',date:selectedTransactions[0]?.transaction_date||'',reference:'Bank & Payment Fees',signedAmount:statementTotal,rawAmount:Math.abs(statementTotal),targetId:feeAccount.id,partyName:feeAccount.name},...candidatePool.filter(c=>c.id!==feeAccount.id)]
    : candidatePool;

  const selectedCandidate=displayedCandidates.find(c=>c.id===selectedCandidateId);
  const ledgerTotal=selectedCandidate?selectedCandidate.signedAmount:0;
  const delta=statementTotal-ledgerTotal;
  const balanced=selectedCandidate!==undefined&&Math.abs(delta)<=0.01;
  const activeRecLocked=p.currentReconciliation?.status==='locked';

  const bestSuggestion=(tx:Tx):Candidate|null=>{
    const exactInvoice=p.invoices.find(i=>signed(tx)>0&&Math.abs(Math.abs(tx.amount)-Math.abs(i.balance_due))<=0.01&&normalized((tx.reference||'')+' '+(tx.description||'')).includes(normalized(i.invoice_number)));
    if(exactInvoice)return {id:exactInvoice.id,kind:'invoices',title:exactInvoice.invoice_number,subtitle:customerName(exactInvoice.customer_id),date:exactInvoice.invoice_date,reference:exactInvoice.invoice_number,signedAmount:Math.abs(exactInvoice.balance_due),rawAmount:Math.abs(exactInvoice.balance_due),targetId:exactInvoice.id,exact:true,score:100,reason:'Exact invoice reference and amount'};
    const exactPayment=p.payments.find(pay=>paymentSigned(pay)===signed(tx)&&Math.abs(Math.abs(tx.amount)-Math.abs(pay.amount))<=0.01&&pay.reference&&normalized((tx.reference||'')+' '+(tx.description||'')).includes(normalized(pay.reference)));
    if(exactPayment)return {id:exactPayment.id,kind:'invoices',title:exactPayment.invoice_id?'Payment · '+exactPayment.invoice_id.slice(0,8):'Payment',subtitle:exactPayment.reference||String(exactPayment.method).replaceAll('_',' '),date:exactPayment.payment_date,reference:exactPayment.reference||'',signedAmount:paymentSigned(exactPayment),rawAmount:Math.abs(exactPayment.amount),targetId:exactPayment.id,exact:true,score:100,reason:'Exact payment reference and amount'};
    const pool=p.invoices.map(i=>{const c:Candidate={id:i.id,kind:'invoices',title:i.invoice_number,subtitle:customerName(i.customer_id),date:i.invoice_date,reference:i.invoice_number,signedAmount:Math.abs(i.balance_due),rawAmount:Math.abs(i.balance_due),targetId:i.id,partyName:customerName(i.customer_id)};c.score=scoreMatch(tx,c);return c;});
    const bills=p.bills.map(b=>{const c:Candidate={id:b.id,kind:'bills',title:b.bill_number,subtitle:vendorName(b.vendor_id),date:b.bill_date,reference:b.bill_number,signedAmount:-Math.abs(b.balance_due),rawAmount:Math.abs(b.balance_due),targetId:b.id,partyName:vendorName(b.vendor_id)};c.score=scoreMatch(tx,c);return c;});
    return [...pool,...bills].sort((a,b)=>(b.score||0)-(a.score||0))[0]||null;
  };

  const toggleTx=(id:string)=>setSelectedTxIds(cur=>{const n=new Set(cur);if(n.has(id))n.delete(id);else n.add(id);return n;});
  const selectCandidate=(id:string)=>setSelectedCandidateId(cur=>cur===id?null:id);

  const reconcileSelection=async()=>{
    if(processing||p.busy||p.lockedPeriod||!selectedCandidate)return;
    setProcessing(true);
    if(tab==='invoices'){
      if(selectedTransactions.length!==1){setProcessing(false);return;}
      const invoice=p.invoices.find(i=>i.id===selectedCandidate.targetId);
      if(invoice)await p.createCustomerPaymentAndReconcile(invoice,selectedTransactions[0].id);
    }else if(tab==='bills'){
      if(selectedTransactions.length!==1){setProcessing(false);return;}
      const bill=p.bills.find(b=>b.id===selectedCandidate.targetId);
      if(bill)await p.createVendorPaymentAndReconcile(bill,selectedTransactions[0].id);
    }else if(tab==='transfers'){
      await p.reconcileWith(selectedTransactions.map(t=>t.id),'transfer',selectedCandidate.targetId,'Internal bank transfer to '+selectedCandidate.title);
    }else{
      await p.reconcileWith(selectedTransactions.map(t=>t.id),'expense',selectedCandidate.targetId,selectedCandidate.targetId===feeAccount?.id?'Allocated to Account 6200 Bank & Payment Fees':'Quick expense adjustment · '+selectedCandidate.title);
    }
    setSelectedTxIds(new Set());setSelectedCandidateId(null);setProcessing(false);
  };

  useEffect(()=>{
    const handler=(e:KeyboardEvent)=>{
      if(e.key==='F2'){e.preventDefault();searchRef.current?.focus();}
      if(e.key==='Escape'){setSelectedTxIds(new Set());setSelectedCandidateId(null);}
      if(e.key==='F10'&&selectedTransactions.length&&selectedCandidate){e.preventDefault();void reconcileSelection();}
    };
    window.addEventListener('keydown',handler);return()=>window.removeEventListener('keydown',handler);
  },[selectedTransactions.length,selectedCandidate,processing,p.busy,p.lockedPeriod]);

  const onFile=(f:File|undefined)=>{if(f)void p.importStatement(f);};
  const canReconcile=!p.lockedPeriod&&!activeRecLocked&&!p.busy&&!processing&&selectedTransactions.length>0&&Boolean(selectedCandidate);
  const importedFormats='CSV · CAMT.053 · MT940 · OFX · QBO';

  return <main className="finops-page"><div className="finops-page-inner space-y-4">
    <header className="mb-4 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div><p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">MoneyMatters · Treasury control</p><h1 className="mt-1 text-2xl font-bold tracking-tight">Bank Reconciliation</h1><p className="mt-1 max-w-3xl text-sm text-slate-500">High-density statement matching, confidence scoring and controlled period locking.</p></div>
      <div className="flex flex-wrap items-center gap-2"><span className={'rounded-full border px-3 py-1.5 text-xs font-semibold '+(p.lockedPeriod||activeRecLocked?'border-rose-200 bg-rose-50 text-rose-700':'border-emerald-200 bg-emerald-50 text-emerald-700')}>{p.lockedPeriod||activeRecLocked?'● Period locked':'● Matching open'}</span><Button variant="secondary" onClick={()=>location.href='/next-workspace/accounting'}>Open GL</Button></div>
    </header>

    {(p.error||p.notice||p.importResult)&&<div className="mb-4 space-y-2">{p.error&&<div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-medium text-rose-800">{p.error}</div>}{p.notice&&<div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-800">{p.notice}</div>}{p.importResult&&<div className="rounded-xl border border-slate-200/80 bg-white px-4 py-2.5 text-xs text-slate-600">{p.importResult}</div>}</div>}

    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Card className="p-4"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Bank account</p><div className="mt-2 flex items-center gap-2"><Select value={p.selectedBank} onChange={e=>p.setSelectedBank(e.target.value)} className="min-w-0 flex-1">{p.banks.map(b=><option key={b.id} value={b.id}>{b.name+(b.account_last4?' ••'+b.account_last4:'')}</option>)}</Select><span className={'h-2.5 w-2.5 shrink-0 rounded-full '+(p.banks.find(b=>b.id===p.selectedBank)?.is_connected?'bg-emerald-500':'bg-slate-300')}/></div><p className="mt-2 text-xs text-slate-500">{p.selectedAccount?p.selectedAccount.code+' · '+p.selectedAccount.name:'GL 1010 · Bank'}</p></Card>
      <Card className="p-4"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Live GL balance</p><p className="mt-2 font-mono text-2xl font-semibold tabular-nums">{money(p.selectedBankBalance,currency)}</p><p className="mt-1 text-xs text-slate-500">Posted journal balance for the selected bank ledger</p></Card>
      <Card className="p-4"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Statement ending balance</p><Input inputMode="decimal" value={p.statementBalance} onChange={e=>p.setStatementBalance(e.target.value)} placeholder="0.00" className="mt-2 font-mono tabular-nums"/><p className="mt-1 text-xs text-slate-500">{p.currentReconciliation?'Saved for '+dateLabel(p.currentReconciliation.period_end):'Enter the bank statement closing figure'}</p></Card>
      <Card className="p-4"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Unreconciled variance</p><p className={'mt-2 font-mono text-2xl font-semibold tabular-nums '+(Math.abs(Number(p.currentReconciliation?.difference||0))<=0.01?'text-emerald-700':'text-rose-700')}>{p.currentReconciliation?money(Number(p.currentReconciliation.difference||0),currency):'—'}</p><p className="mt-1 text-xs text-slate-500">Statement ending less book ending</p></Card>
    </section>

    <Card className="mb-4 p-4"><div className="grid gap-4 lg:grid-cols-[1fr_1fr_auto] lg:items-end"><div className="grid gap-3 sm:grid-cols-2"><div><label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Period start</label><Input type="date" value={p.periodStart} onChange={e=>p.setPeriodStart(e.target.value)} className="mt-1" disabled={p.lockedPeriod||activeRecLocked}/></div><div><label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Period end</label><Input type="date" value={p.periodEnd} onChange={e=>p.setPeriodEnd(e.target.value)} className="mt-1" disabled={p.lockedPeriod||activeRecLocked}/></div></div><div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Lock state</p><p className={'mt-1 text-sm font-semibold '+(p.lockedPeriod||activeRecLocked?'text-rose-700':'text-emerald-700')}>{p.lockedPeriod||activeRecLocked?'Closed / locked — matching disabled':'Open — eligible for matching'}</p></div><div className="flex flex-wrap gap-2"><Button disabled={p.busy||p.lockedPeriod||activeRecLocked||!p.selectedBank||!p.periodStart||!p.periodEnd} onClick={()=>void p.startOrUpdate()}>{p.currentReconciliation?'Save period':'Open reconciliation'}</Button>{p.currentReconciliation&&!p.lockedPeriod&&!activeRecLocked&&<Button variant="secondary" disabled={p.busy||p.unmatchedCount>0||Math.abs(Number(p.currentReconciliation.difference||0))>0.01} onClick={()=>void p.lock()}>Lock period</Button>}</div></div></Card>

    <section className="grid gap-4 lg:grid-cols-2">
      <Card className="min-h-[690px] overflow-hidden"><div className="border-b border-slate-100 p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-base font-semibold">Unreconciled statement lines</h2><p className="mt-1 text-xs text-slate-500">{p.unmatchedCount} open line{p.unmatchedCount===1?'':'s'} · select multiple for batch matching</p></div><div className="flex gap-2"><Input value={p.query} onChange={e=>p.setQuery(e.target.value)} placeholder="F2 · search reference / party" className="sm:w-64"/><Button size="sm" variant="secondary" onClick={()=>setSelectedTxIds(new Set(p.transactions.filter(t=>!['reconciled','ignored'].includes(String(t.status).toLowerCase())).map(t=>t.id)))}>All open</Button></div></div></div>
        <div className="hidden grid-cols-[30px_92px_minmax(0,1fr)_150px_115px] gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-2.5 text-[9px] font-bold uppercase tracking-wider text-slate-400 sm:grid"><span/><span>Value date</span><span>Description / counterparty</span><span>Reference / E2E ID</span><span className="text-right">Amount</span></div>
        <div className="max-h-[575px] divide-y divide-slate-100 overflow-y-auto">{p.transactions.map(tx=>{const open=!['reconciled','ignored'].includes(String(tx.status).toLowerCase());const suggestion=bestSuggestion(tx);const amount=signed(tx);return <button type="button" key={tx.id} onClick={()=>open&&toggleTx(tx.id)} className={'grid w-full gap-2 px-4 py-2.5 text-left sm:grid-cols-[30px_92px_minmax(0,1fr)_150px_115px] sm:items-center '+(selectedTxIds.has(tx.id)?'bg-slate-50 ':'hover:bg-slate-50 ')+(open?'':'opacity-55')}><span className={'grid h-4 w-4 place-items-center rounded border text-[10px] '+(selectedTxIds.has(tx.id)?'border-indigo-600 bg-indigo-600 text-white':'border-slate-300 bg-white text-transparent')}>✓</span><span className="font-mono text-[11px] text-slate-600 tabular-nums">{dateLabel(tx.value_date||tx.transaction_date)}</span><span className="min-w-0"><span className="block truncate text-sm font-medium">{tx.description||'Bank transaction'}</span><span className="mt-1 flex flex-wrap items-center gap-1.5">{suggestion?.exact&&<span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-bold text-emerald-800">Exact match · {suggestion.title}</span>}{suggestion&&!suggestion.exact&&suggestion.score!==undefined&&<span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-semibold text-slate-600">Best {suggestion.score}%</span>}<span className={'rounded-full px-2 py-0.5 text-[9px] font-semibold '+(open?'bg-amber-50 text-amber-700':'bg-slate-100 text-slate-500')}>{String(tx.status||'review').replaceAll('_',' ')}</span></span></span><span className="min-w-0"><span className="block truncate font-mono text-[11px] text-slate-600 tabular-nums">{tx.reference||tx.external_transaction_id||'—'}</span></span><span className={'text-right font-mono font-mono text-sm font-semibold tabular-nums '+(amount>=0?'text-emerald-700':'text-rose-700')}>{amount>=0?'+':'−'}{money(Math.abs(amount),currency)}</span></button>;})}{!p.transactions.length&&<div className="p-10"><EmptyState title="No statement lines" description="Import a CSV, CAMT.053, MT940 or OFX statement to populate the reconciliation queue."/></div>}</div>
      </Card>

      <Card className="min-h-[690px] overflow-hidden"><div className="border-b border-slate-100 p-4"><div className="flex flex-wrap gap-2">{([['invoices','Open Invoices (AR)'],['bills','Vendor Bills (AP)'],['transfers','Bank Transfers'],['expenses','Quick Expense Adjustment']] as [Tab,string][]).map(([k,label])=><button type="button" key={k} onClick={()=>{setTab(k);setSelectedCandidateId(null);}} className={'rounded-lg px-3 py-2 text-xs font-semibold '+(tab===k?'bg-slate-900 text-white':'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50')}>{label}</button>)}</div><p className="mt-3 text-xs text-slate-500">{selectedTransactions.length?'Smart score: 50% amount equality · 30% date proximity within ±3 days · 20% reference/name similarity.':'Select statement lines on the left to score ledger candidates.'}</p></div>
        <div className="max-h-[455px] overflow-y-auto">{displayedCandidates.slice(0,250).map(c=>{const sel=c.id===selectedCandidateId;return <button type="button" key={c.id} onClick={()=>selectCandidate(c.id)} className={'grid w-full grid-cols-[24px_minmax(0,1fr)_110px_72px] gap-3 border-b border-slate-100 px-4 py-2.5 text-left '+(sel?'bg-slate-50':'hover:bg-slate-50')}><span className={'mt-0.5 grid h-4 w-4 place-items-center rounded border text-[10px] '+(sel?'border-indigo-600 bg-indigo-600 text-white':'border-slate-300 bg-white text-transparent')}>✓</span><span className="min-w-0"><span className="block truncate text-sm font-semibold">{c.title}</span><span className="mt-0.5 block truncate text-xs text-slate-500">{c.subtitle}</span><span className="mt-1 block truncate font-mono text-[10px] text-slate-400">{c.reference||'No reference'} · {dateLabel(c.date)}</span></span><span className="text-right font-mono font-mono text-sm font-semibold tabular-nums">{money(Math.abs(c.rawAmount),currency)}</span><span className="text-right">{c.exact?<span className="rounded-full bg-emerald-100 px-2 py-1 text-[9px] font-bold text-emerald-800">Exact</span>:c.score!==undefined?<span className="rounded-full bg-slate-100 px-2 py-1 text-[9px] font-semibold text-slate-600">{c.score}%</span>:<span className="text-[9px] text-slate-400">—</span>}</span></button>})}{!displayedCandidates.length&&<div className="p-10"><EmptyState title="No candidates available" description="The selected tab has no open records for this business."/></div>}</div>
        <div className="border-t border-slate-200 bg-slate-50/80 p-4"><div className="grid gap-3 sm:grid-cols-3"><Metric title="Statement selected" value={money(statementTotal,currency)}/><Metric title="Ledger selected" value={money(ledgerTotal,currency)}/><Metric title="Difference / variance" value={money(delta,currency)} tone={balanced?'good':'warn'}/></div><div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><p className="text-[11px] text-slate-500">{balanced?'✓ Delta is 0.00 — ready to reconcile.':'Difference must equal 0.00 before a direct match is committed.'}</p><Button disabled={!canReconcile||!balanced} onClick={()=>void reconcileSelection()}>{processing?'Reconciling…':'One-Click Reconcile · F10'}</Button></div></div>
      </Card>
    </section>

    <section className="mt-4 grid gap-4 lg:grid-cols-[1fr_360px]"><Card className="p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Statement ingestion</p><h2 className="mt-1 text-base font-semibold">Import bank statement</h2><p className="mt-1 text-xs text-slate-500">Existing server parser: {importedFormats}. Duplicate fingerprints are handled by the existing transactional import RPC.</p></div><Button variant="secondary" disabled={p.importing||p.lockedPeriod||activeRecLocked||!p.selectedBank} onClick={()=>fileRef.current?.click()}>{p.importing?'Importing…':'Choose statement file'}</Button><input ref={fileRef} className="hidden" type="file" accept=".csv,.xml,.camt,.053,.mt940,.940,.ofx,.qbo" onChange={e=>onFile(e.target.files?.[0])}/></div><div className={'mt-3 rounded-xl border-2 border-dashed p-7 text-center transition '+(dragging?'border-indigo-500 bg-slate-50':'border-slate-200 bg-white')} onDragEnter={e=>{e.preventDefault();setDragging(true)}} onDragOver={e=>e.preventDefault()} onDragLeave={()=>setDragging(false)} onDrop={e=>{e.preventDefault();setDragging(false);onFile(e.dataTransfer.files?.[0])}}><p className="text-sm font-semibold">Drop statement here</p><p className="mt-1 text-xs text-slate-500">CSV · CAMT.053 · MT940 · OFX · QBO · 10 MB server limit</p>{(p.lockedPeriod||activeRecLocked)&&<p className="mt-2 text-xs font-semibold text-rose-700">Import disabled because the selected period is closed or locked.</p>}</div></Card>
      <Card className="p-4"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Lock readiness</p><div className="mt-3 space-y-2"><Readiness label="Unreconciled lines" value={String(p.unmatchedCount)} ready={p.unmatchedCount===0}/><Readiness label="Statement vs books" value={p.currentReconciliation?money(p.currentReconciliation.difference,currency):'Not started'} ready={Boolean(p.currentReconciliation&&Math.abs(p.currentReconciliation.difference)<=0.01)}/><Readiness label="Period control" value={p.lockedPeriod||activeRecLocked?'Locked':'Open'} ready={!p.lockedPeriod&&!activeRecLocked}/></div><div className="mt-4 rounded-xl border border-slate-200/80 bg-white px-3 py-2.5 text-[11px] text-slate-500">F2 Search · Esc Clear · F10 Reconcile</div></Card>
    </section>
  </div></main>;
}

function Metric({title,value,tone='normal'}:{title:string;value:string;tone?:'normal'|'good'|'warn'}){return <div className="rounded-xl border border-slate-200/80 bg-white px-3 py-2.5"><p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">{title}</p><p className={'mt-1 font-mono font-mono text-sm font-semibold tabular-nums '+(tone==='good'?'text-emerald-700':tone==='warn'?'text-rose-700':'text-slate-900')}>{value}</p></div>;}
function Readiness({label,value,ready}:{label:string;value:string;ready:boolean}){return <div className="flex items-center justify-between rounded-xl bg-white px-3 py-2.5"><span className="text-xs text-slate-600">{label}</span><span className={'rounded-full px-2 py-1 text-[10px] font-bold '+(ready?'bg-emerald-50 text-emerald-700':'bg-amber-50 text-amber-700')}>{value}</span></div>;}
