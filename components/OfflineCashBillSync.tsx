'use client';
import {useEffect} from 'react';
import {supabase} from '@/lib/supabase';
import {listQueuedCashBills,syncOfflineCashBills,type OfflineCashBill} from '@/lib/client/offline-cash-bills';

async function submitRecord(record:OfflineCashBill){
  const {data,error}=await supabase.rpc('sync_offline_cash_bill',{
    p_business_id:record.payload.businessId,p_phone:record.payload.phone,p_invoice_date:record.payload.invoiceDate,
    p_items:record.payload.items,p_payment_method:record.payload.paymentMethod,p_account_id:record.payload.accountId,
    p_invoice_discount_type:record.payload.invoiceDiscountType,p_invoice_discount_value:record.payload.invoiceDiscountValue,
    p_notes:record.payload.notes,p_terms:record.payload.terms,p_temp_pos_uuid:record.tempPosUuid,
    p_offline_ticket_number:record.offlineTicketNumber
  });
  if(error)throw error;
  return {invoiceId:String(data),deduplicated:false};
}

export default function OfflineCashBillSync({businessId}:{businessId:string}){
  useEffect(()=>{
    let active=true;
    const run=async()=>{
      if(!active||!navigator.onLine)return;
      const result=await syncOfflineCashBills(submitRecord,businessId);
      if(active&&result.synced>0)window.dispatchEvent(new CustomEvent('moneymatters:offline-pos-synced',{detail:result}));
    };
    const onOnline=()=>{void run();};
    const onServiceWorkerMessage=(event:MessageEvent)=>{if(event.data?.type==='POS_SYNC_REQUESTED')void run();};
    window.addEventListener('online',onOnline);
    navigator.serviceWorker?.addEventListener('message',onServiceWorkerMessage);
    void run();
    return()=>{active=false;window.removeEventListener('online',onOnline);navigator.serviceWorker?.removeEventListener('message',onServiceWorkerMessage);};
  },[businessId]);
  return null;
}
export async function getOfflineCashBillCount(businessId:string){return (await listQueuedCashBills(businessId)).length;}