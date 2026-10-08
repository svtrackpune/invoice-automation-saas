'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, type BusinessContext } from '@/lib/supabase';
import BankingControlled from './BankingControlled';

type Bank={id:string;name:string;institution_name:string|null;account_last4:string|null;currency_code:string;is_connected:boolean;linked_account_id:string|null};
type Tx={id:string;bank_account_id:string;transaction_date:string;value_date:string|null;description:string|null;reference:string|null;amount:number;direction:string;status:string;balance_after:number|null;raw_data:Record<string,unknown>|null;external_transaction_id:string|null};
type Rec={id:string;bank_account_id:string;period_start:string;period_end:string;statement_ending_balance:number;book_ending_balance:number;difference:number;status:string;locked_at:string|null};
type Account={id:string;code:string;name:string;account_type:string;normal_balance:string;account_subtype:string|null};
type Period={id:string;period_start:string;period_end:string;status:string};
type Invoice={id:string;invoice_number:string;invoice_date:string;due_date:string|null;balance_due:number;customer_id:string|null;currency_code:string};
type Bill={id:string;bill_number:string;bill_date:string;due_date:string|null;balance_due:number;vendor_id:string|null;currency_code:string|null};
type Payment={id:string;payment_date:string;amount:number;method:string;reference:string|null;direction:string;invoice_id:string|null;bill_id:string|null;customer_id:string|null;vendor_id:string|null;currency_code:string};
type Party={id:string;display_name:string};

export default function Banking(){
  const[ctx,setCtx]=useState<BusinessContext|null>(null);
  const[banks,setBanks]=useState<Bank[]>([]);
  const[tx,setTx]=useState<Tx[]>([]);
  const[recs,setRecs]=useState<Rec[]>([]);
  const[accounts,setAccounts]=useState<Account[]>([]);
  const[periods,setPeriods]=useState<Period[]>([]);
  const[invoices,setInvoices]=useState<Invoice[]>([]);
  const[bills,setBills]=useState<Bill[]>([]);
  const[payments,setPayments]=useState<Payment[]>([]);
  const[customers,setCustomers]=useState<Party[]>([]);
  const[vendors,setVendors]=useState<Party[]>([]);
  const[journalLines,setJournalLines]=useState<Array<{account_id:string;debit:number;credit:number}>>([]);
  const[selectedBank,setSelectedBank]=useState('');
  const[query,setQuery]=useState('');
  const[periodStart,setPeriodStart]=useState('');
  const[periodEnd,setPeriodEnd]=useState('');
  const[statementBalance,setStatementBalance]=useState('');
  const[busy,setBusy]=useState(true);
  const[notice,setNotice]=useState('');
  const[error,setError]=useState('');
  const[importing,setImporting]=useState(false);
  const[importResult,setImportResult]=useState('');
  const[refresh,setRefresh]=useState(0);

  const load=useCallback(async()=>{
    const c=await supabase.rpc('get_my_business_context');
    const business=c.data?.[0] as BusinessContext|undefined;
    if(!business){location.href='/';return;}
    setCtx(business);

    const[bankR,accountR,journalR,recR,periodR,invoiceR,billR,paymentR,customerR,vendorR]=await Promise.all([
      supabase.from('bank_accounts').select('id,name,institution_name,account_last4,currency_code,is_connected,linked_account_id').eq('business_id',business.business_id).eq('is_active',true).order('name'),
      supabase.from('accounts').select('id,code,name,account_type,normal_balance,account_subtype').eq('business_id',business.business_id).eq('is_active',true).order('code'),
      supabase.from('journal_lines').select('account_id,debit,credit'),
      supabase.from('bank_reconciliations').select('id,bank_account_id,period_start,period_end,statement_ending_balance,book_ending_balance,difference,status,locked_at').eq('business_id',business.business_id).order('period_end',{ascending:false}).limit(50),
      supabase.from('accounting_periods').select('id,period_start,period_end,status').eq('business_id',business.business_id).in('status',['closed','locked']).order('period_start',{ascending:false}),
      supabase.from('invoices').select('id,invoice_number,invoice_date,due_date,balance_due,customer_id,currency_code').eq('business_id',business.business_id).in('status',['sent','posted','partially_paid','overdue']).gt('balance_due',0).order('invoice_date',{ascending:false}).limit(500),
      supabase.from('bills').select('id,bill_number,bill_date,due_date,balance_due,vendor_id,currency_code').eq('business_id',business.business_id).in('status',['received','partially_paid','overdue']).gt('balance_due',0).order('bill_date',{ascending:false}).limit(500),
      supabase.from('payments').select('id,payment_date,amount,method,reference,direction,invoice_id,bill_id,customer_id,vendor_id,currency_code').eq('business_id',business.business_id).order('payment_date',{ascending:false}).limit(1000),
      supabase.from('customers').select('id,display_name').eq('business_id',business.business_id).eq('is_active',true).order('display_name'),
      supabase.from('vendors').select('id,display_name').eq('business_id',business.business_id).eq('is_active',true).order('display_name')
    ]);

    const banksValue=(bankR.data||[]) as Bank[];
    setBanks(banksValue);
    setAccounts((accountR.data||[]) as Account[]);
    setJournalLines((journalR.data||[]) as Array<{account_id:string;debit:number;credit:number}>);
    setRecs((recR.data||[]) as Rec[]);
    setPeriods((periodR.data||[]) as Period[]);
    setInvoices((invoiceR.data||[]) as Invoice[]);
    setBills((billR.data||[]) as Bill[]);
    setPayments((paymentR.data||[]) as Payment[]);
    setCustomers((customerR.data||[]) as Party[]);
    setVendors((vendorR.data||[]) as Party[]);

    const ids=banksValue.map(b=>b.id);
    if(ids.length){
      const tr=await supabase.from('bank_transactions').select('id,bank_account_id,transaction_date,value_date,description,reference,amount,direction,status,balance_after,raw_data,external_transaction_id').in('bank_account_id',ids).order('transaction_date',{ascending:false}).limit(2000);
      setTx((tr.data||[]) as Tx[]);
    }else setTx([]);

    const selected=selectedBank&&banksValue.some(b=>b.id===selectedBank)?selectedBank:(banksValue[0]?.id||'');
    setSelectedBank(selected);
    const rec=((recR.data||[]) as Rec[]).find(r=>r.bank_account_id===selected&&r.status!=='locked')||((recR.data||[]) as Rec[]).find(r=>r.bank_account_id===selected);
    if(rec){
      setPeriodStart(rec.period_start);
      setPeriodEnd(rec.period_end);
      setStatementBalance(String(rec.statement_ending_balance));
    }
    setBusy(false);
  },[selectedBank]);

  useEffect(()=>{setBusy(true);void load();},[load,refresh]);

  const allSelected=useMemo(()=>tx.filter(t=>t.bank_account_id===selectedBank),[tx,selectedBank]);
  const currentRec=useMemo(()=>recs.find(r=>r.bank_account_id===selectedBank&&r.status!=='locked')||recs.find(r=>r.bank_account_id===selectedBank),[recs,selectedBank]);
  const lockedPeriod=useMemo(()=>{
    const start=periodStart||currentRec?.period_start;
    const end=periodEnd||currentRec?.period_end||start;
    return Boolean(start&&end&&periods.some(p=>p.period_start<=end&&p.period_end>=start));
  },[periods,periodStart,periodEnd,currentRec]);

  const accountBalances=useMemo(()=>{
    const map:Record<string,number>={};
    for(const line of journalLines) map[line.account_id]=(map[line.account_id]||0)+Number(line.debit||0)-Number(line.credit||0);
    return map;
  },[journalLines]);

  const selectedAccount=useMemo(()=>{
    const bank=banks.find(b=>b.id===selectedBank);
    return accounts.find(a=>a.id===bank?.linked_account_id)||accounts.find(a=>a.code==='1010');
  },[accounts,banks,selectedBank]);

  const selectedBankBalance=selectedAccount?Number(accountBalances[selectedAccount.id]||0):0;

  const filtered=useMemo(()=>{
    const needle=query.trim().toLowerCase();
    if(!needle)return allSelected;
    return allSelected.filter(t=>[t.description,t.reference,t.external_transaction_id,t.status].filter(Boolean).join(' ').toLowerCase().includes(needle));
  },[allSelected,query]);

  const unmatched=allSelected.filter(t=>!['reconciled','ignored'].includes(String(t.status).toLowerCase())).length;

  const openRec=async()=>{
    if(!ctx||!selectedBank||!periodStart||!periodEnd)return;
    const balance=Number(statementBalance);
    if(!Number.isFinite(balance)){setError('Enter a valid statement ending balance.');return;}
    if(periodEnd<periodStart){setError('Period end cannot precede period start.');return;}
    if(lockedPeriod){setError('This accounting period is closed or locked.');return;}
    setBusy(true);setError('');setNotice('');
    const r=await supabase.rpc('create_bank_reconciliation',{p_business_id:ctx.business_id,p_bank_account_id:selectedBank,p_period_start:periodStart,p_period_end:periodEnd,p_statement_ending_balance:balance,p_notes:'Managed from Bank Reconciliation Console'});
    if(r.error)setError(r.error.message);else setNotice('Reconciliation period saved. Server-side period controls remain authoritative.');
    setBusy(false);if(!r.error)setRefresh(v=>v+1);
  };

  const reconcileWith=async(txIds:string[],matchType:'payment'|'expense'|'transfer',recordId:string,note:string)=>{
    if(!currentRec||currentRec.status==='locked'||lockedPeriod){setError('Matching is disabled for this closed or locked period.');return;}
    if(!txIds.length||!recordId)return;
    setBusy(true);setError('');
    for(const id of txIds){
      const r=await supabase.rpc('match_bank_transaction',{p_reconciliation_id:currentRec.id,p_bank_transaction_id:id,p_match_type:matchType,p_matched_record_id:recordId,p_notes:note});
      if(r.error){setError(r.error.message);setBusy(false);setRefresh(v=>v+1);return;}
    }
    setNotice(txIds.length+' statement line'+(txIds.length===1?'':'s')+' reconciled.');
    setBusy(false);setRefresh(v=>v+1);
  };

  const createCustomerPaymentAndReconcile=async(invoice:Invoice,transactionId:string)=>{
    if(!ctx||!currentRec||lockedPeriod)return;
    const bank=banks.find(b=>b.id===selectedBank);
    const accountId=bank?.linked_account_id||selectedAccount?.id||'';
    const txRow=allSelected.find(t=>t.id===transactionId);
    if(!invoice.customer_id||!accountId||!txRow)return;
    const r=await supabase.rpc('record_customer_payment',{
      p_business_id:ctx.business_id,p_customer_id:invoice.customer_id,p_invoice_id:invoice.id,p_amount:Number(invoice.balance_due),
      p_method:'bank_transfer',p_account_id:accountId,p_reference:txRow.reference||txRow.external_transaction_id||null,p_gateway_transaction_id:txRow.external_transaction_id||null,
      p_payment_date:txRow.value_date||txRow.transaction_date,p_notes:'Created from Bank Reconciliation Console',p_currency_code:ctx.currency_code||'INR',p_currency_code:ctx.currency_code||'INR'
    });
    if(r.error){setError(r.error.message);return;}
    const paymentId=typeof r.data==='string'?r.data:null;
    if(!paymentId){setError('Customer payment was not returned by the accounting RPC.');return;}
    await reconcileWith([transactionId],'payment',paymentId,'Matched to invoice '+invoice.invoice_number);
  };

  const createVendorPaymentAndReconcile=async(bill:Bill,transactionId:string)=>{
    if(!ctx||!currentRec||lockedPeriod)return;
    const bank=banks.find(b=>b.id===selectedBank);
    const accountId=bank?.linked_account_id||selectedAccount?.id||'';
    const txRow=allSelected.find(t=>t.id===transactionId);
    if(!bill.vendor_id||!accountId||!txRow)return;
    const r=await supabase.rpc('record_vendor_payment',{
      p_business_id:ctx.business_id,p_vendor_id:bill.vendor_id,p_bill_id:bill.id,p_amount:Number(bill.balance_due),p_method:'bank_transfer',
      p_account_id:accountId,p_reference:txRow.reference||txRow.external_transaction_id||null,p_payment_date:txRow.value_date||txRow.transaction_date,
      p_notes:'Created from Bank Reconciliation Console',p_currency_code:ctx.currency_code||'INR'
    });
    if(r.error){setError(r.error.message);return;}
    const paymentId=typeof r.data==='string'?r.data:null;
    if(!paymentId){setError('Vendor payment was not returned by the accounting RPC.');return;}
    await reconcileWith([transactionId],'payment',paymentId,'Matched to bill '+bill.bill_number);
  };

  const lock=async()=>{
    if(!currentRec||lockedPeriod)return;
    setBusy(true);setError('');setNotice('');
    const r=await supabase.rpc('lock_bank_reconciliation',{p_reconciliation_id:currentRec.id});
    if(r.error)setError(r.error.message);else setNotice('Reconciliation completed and locked. Matching is now disabled.');
    setBusy(false);if(!r.error)setRefresh(v=>v+1);
  };

  const importStatement=async(file:File)=>{
    if(!selectedBank||lockedPeriod){setError('Statement import is disabled for the selected closed/locked period.');return;}
    setImporting(true);setError('');setNotice('');setImportResult('');
    const session=await supabase.auth.getSession();
    const token=session.data.session?.access_token;
    if(!token){setError('Your session has expired. Sign in again.');setImporting(false);return;}
    const form=new FormData();form.append('file',file);form.append('bank_account_id',selectedBank);
    const response=await fetch('/api/banking/statements/import',{method:'POST',headers:{Authorization:'Bearer '+token},body:form});
    const body=await response.json().catch(()=>({}));
    if(!response.ok){setError(String(body?.error||'Statement import failed.'));setImporting(false);return;}
    setImportResult(
      String(Number(body?.inserted_rows||0))+' imported · '+String(Number(body?.duplicate_skipped_rows||0))+
      ' duplicate'+(Number(body?.duplicate_skipped_rows||0)===1?'':'s')+' skipped · '+(body?.balance_verified?'balance verified':'balance not verified')
    );
    if(body?.statement_start)setPeriodStart(String(body.statement_start));
    if(body?.statement_end)setPeriodEnd(String(body.statement_end));
    if(body?.statement_end&&body?.balance_verified&&body?.closing_balance!==undefined)setStatementBalance(String(body.closing_balance));
    setNotice('Statement ingested through the existing parser and transaction RPC pipeline.');
    setImporting(false);setRefresh(v=>v+1);
  };

  const categoryAccounts=useMemo(()=>accounts.filter(a=>a.account_type==='expense'),[accounts]);

  return <BankingControlled
    banks={banks} selectedBank={selectedBank} setSelectedBank={setSelectedBank}
    transactions={filtered} allTransactions={allSelected} reconciliations={recs} currentReconciliation={currentRec}
    accounts={accounts} selectedAccount={selectedAccount} selectedBankBalance={selectedBankBalance}
    invoices={invoices} bills={bills} payments={payments} customers={customers} vendors={vendors} categoryAccounts={categoryAccounts}
    query={query} setQuery={setQuery} periodStart={periodStart} setPeriodStart={setPeriodStart} periodEnd={periodEnd} setPeriodEnd={setPeriodEnd}
    statementBalance={statementBalance} setStatementBalance={setStatementBalance} unmatchedCount={unmatched} lockedPeriod={lockedPeriod}
    busy={busy} importing={importing} notice={notice} error={error} importResult={importResult}
    startOrUpdate={openRec} importStatement={importStatement} reconcileWith={reconcileWith}
    createCustomerPaymentAndReconcile={createCustomerPaymentAndReconcile} createVendorPaymentAndReconcile={createVendorPaymentAndReconcile} lock={lock}
  />;
}
