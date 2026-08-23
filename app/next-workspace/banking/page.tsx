'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase, type BusinessContext } from '@/lib/supabase';
import BankingControlled from './BankingControlled';

type Bank={id:string;name:string;institution_name:string|null;account_last4:string|null;currency_code:string;is_connected:boolean};
type Tx={id:string;bank_account_id:string;transaction_date:string;description:string|null;reference:string|null;amount:number;direction:string;status:string;balance_after:number|null};
type Rec={id:string;bank_account_id:string;period_start:string;period_end:string;statement_ending_balance:number;book_ending_balance:number;difference:number;status:string;locked_at:string|null};
type Account={id:string;code:string;name:string;account_type:string};

export default function Banking(){
 const[ctx,setCtx]=useState<BusinessContext|null>(null),[banks,setBanks]=useState<Bank[]>([]),[tx,setTx]=useState<Tx[]>([]),[accounts,setAccounts]=useState<Account[]>([]),[rec,setRec]=useState<Rec[]>([]),[selectedBank,setSelectedBank]=useState(''),[q,setQ]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[statementBalance,setStatementBalance]=useState(''),[statementEnd,setStatementEnd]=useState(new Date().toISOString().slice(0,10));
 const load=async()=>{
  const c=await supabase.rpc('get_my_business_context'); const b=c.data?.[0] as BusinessContext|undefined;
  if(!b){location.href='/';return} setCtx(b);
  const[ba,aa,br]=await Promise.all([
   supabase.from('bank_accounts').select('id,name,institution_name,account_last4,currency_code,is_connected').eq('business_id',b.business_id).eq('is_active',true).order('name'),
   supabase.from('accounts').select('id,code,name,account_type').eq('business_id',b.business_id).eq('is_active',true).order('code'),
   supabase.from('bank_reconciliations').select('id,bank_account_id,period_start,period_end,statement_ending_balance,book_ending_balance,difference,status,locked_at').eq('business_id',b.business_id).order('period_end',{ascending:false}).limit(20)
  ]);
  const bankRows=(ba.data||[]) as Bank[]; setBanks(bankRows); setAccounts((aa.data||[]) as Account[]); setRec((br.data||[]) as Rec[]);
  const first=selectedBank||bankRows[0]?.id||''; setSelectedBank(first);
  if(bankRows.length){const r=await supabase.from('bank_transactions').select('id,bank_account_id,transaction_date,description,reference,amount,direction,status,balance_after').in('bank_account_id',bankRows.map(x=>x.id)).order('transaction_date',{ascending:false}).limit(200);setTx((r.data||[]) as Tx[])} else setTx([]);
  setLoading(false);
 };
 useEffect(()=>{load()},[]);
 const currentRec=useMemo(()=>rec.find(r=>r.bank_account_id===selectedBank&&r.status!=='locked')||rec.find(r=>r.bank_account_id===selectedBank),[rec,selectedBank]);
 const selectedTx=useMemo(()=>tx.filter(x=>x.bank_account_id===selectedBank),[tx,selectedBank]);
 const filtered=useMemo(()=>selectedTx.filter(x=>`${x.description||''} ${x.reference||''} ${x.status}`.toLowerCase().includes(q.toLowerCase())),[selectedTx,q]);
 const unmatched=selectedTx.filter(x=>!['reconciled','ignored'].includes(String(x.status).toLowerCase())).length;
 const categoryAccounts=useMemo(()=>accounts.filter(a=>['expense','income'].includes(String(a.account_type).toLowerCase())),[accounts]);
 const startReconciliation=async()=>{if(!ctx||!selectedBank)return;const balance=Number(statementBalance);if(!Number.isFinite(balance)){setNotice('Enter the closing balance from the bank statement.');return}setBusy(true);setNotice('');const r=await supabase.rpc('create_bank_reconciliation',{p_business_id:ctx.business_id,p_bank_account_id:selectedBank,p_period_start:statementEnd,p_period_end:statementEnd,p_statement_ending_balance:balance,p_notes:'Started from Moneymatters Banking'});if(r.error)setNotice(r.error.message);else{setNotice('Reconciliation period opened. Review and categorize every transaction.');await load()}setBusy(false)};
 const categorize=async(txn:Tx,accountId:string)=>{if(!currentRec||currentRec.status==='locked'||!accountId)return;setBusy(true);setNotice('');const matchType=String(txn.direction).toLowerCase().includes('out')?'expense':'manual';const r=await supabase.rpc('match_bank_transaction',{p_reconciliation_id:currentRec.id,p_bank_transaction_id:txn.id,p_match_type:matchType,p_matched_record_id:accountId,p_notes:'Categorized in Banking'});if(r.error)setNotice(r.error.message);else{setNotice('Transaction categorized and posted to the ledger.');await load()}setBusy(false)};
 const lock=async()=>{if(!currentRec)return;setBusy(true);setNotice('');const r=await supabase.rpc('lock_bank_reconciliation',{p_reconciliation_id:currentRec.id});if(r.error)setNotice(r.error.message);else{setNotice('Reconciliation completed and locked.');await load()}setBusy(false)};
 if(loading)return <div className="grid min-h-[70vh] place-items-center bg-[#fbfaff] text-sm text-slate-500">Loading banking…</div>;
 return <BankingControlled banks={banks} selectedBank={selectedBank} setSelectedBank={setSelectedBank} q={q} setQ={setQ} statementEnd={statementEnd} setStatementEnd={setStatementEnd} statementBalance={statementBalance} setStatementBalance={setStatementBalance} currentRec={currentRec} filtered={filtered} categoryAccounts={categoryAccounts} busy={busy} unmatched={unmatched} notice={notice} startReconciliation={startReconciliation} lock={lock} categorize={categorize}/>;
}
