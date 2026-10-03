'use client';

export type OfflineCashBillPayload={
  businessId:string;phone:string;invoiceDate:string;items:Array<Record<string,unknown>>;
  paymentMethod:'cash'|'upi';accountId:string;invoiceDiscountType:string|null;invoiceDiscountValue:number;
  notes:string;terms:string;
};
export type OfflineCashBill={
  id:string;businessId:string;tempPosUuid:string;offlineTicketNumber:string;payload:OfflineCashBillPayload;
  status:'queued'|'syncing'|'failed';attempts:number;createdAt:string;lastError:string|null;
};
const DB_NAME='moneymatters-pos',DB_VERSION=1,STORE='offline_cash_bills';

function wait<T=undefined>(request:IDBRequest<T>):Promise<T>{
  return new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error||new Error('IndexedDB request failed.'));});
}
function openDb():Promise<IDBDatabase>{
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(DB_NAME,DB_VERSION);
    request.onupgradeneeded=()=>{
      const db=request.result;
      if(!db.objectStoreNames.contains(STORE)){
        const store=db.createObjectStore(STORE,{keyPath:'id'});
        store.createIndex('businessId','businessId',{unique:false});
        store.createIndex('status','status',{unique:false});
        store.createIndex('createdAt','createdAt',{unique:false});
      }
    };
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error||new Error('Could not open POS offline database.'));
  });
}
function deviceToken(businessId:string){
  const key='moneymatters.pos.device.'+businessId;
  let value=localStorage.getItem(key);
  if(!value){
    value=(typeof crypto!=='undefined'&&'randomUUID'in crypto?crypto.randomUUID():Math.random().toString(36).slice(2)+'-'+Date.now().toString(36)).replaceAll('-','').slice(0,8).toUpperCase();
    localStorage.setItem(key,value);
  }
  return value;
}
export function nextOfflineTicketNumber(businessId:string){
  const key='moneymatters.pos.offlineTicket.'+businessId;
  const next=Math.max(1,Number(localStorage.getItem(key)||'0')+1);
  localStorage.setItem(key,String(next));
  const day=new Date().toISOString().slice(0,10).replaceAll('-','');
  return 'POS-'+deviceToken(businessId)+'-'+day+'-'+String(next).padStart(6,'0');
}
async function requestBackgroundSync(){
  if(typeof navigator==='undefined'||!('serviceWorker'in navigator))return;
  try{
    const registration=await navigator.serviceWorker.ready;
    const syncManager=registration as ServiceWorkerRegistration & {sync?:{register(tag:string):Promise<void>}};
    await syncManager.sync?.register('moneymatters-pos-sync');
  }catch{}
}
export async function queueOfflineCashBill(payload:OfflineCashBillPayload,existing?:{tempPosUuid?:string;offlineTicketNumber?:string}){
  const record:OfflineCashBill={
    id:crypto.randomUUID(),businessId:payload.businessId,
    tempPosUuid:existing?.tempPosUuid||crypto.randomUUID(),
    offlineTicketNumber:existing?.offlineTicketNumber||nextOfflineTicketNumber(payload.businessId),
    payload,status:'queued',attempts:0,createdAt:new Date().toISOString(),lastError:null
  };
  const db=await openDb();
  await wait(db.transaction(STORE,'readwrite').objectStore(STORE).add(record));
  await requestBackgroundSync();
  return record;
}
export async function listQueuedCashBills(businessId?:string):Promise<OfflineCashBill[]>{
  const db=await openDb();
  const rows=await wait(db.transaction(STORE,'readonly').objectStore(STORE).getAll()) as OfflineCashBill[];
  return rows.filter(x=>(!businessId||x.businessId===businessId)&&x.status!=='failed').sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
}
async function put(record:OfflineCashBill){const db=await openDb();await wait(db.transaction(STORE,'readwrite').objectStore(STORE).put(record));}
async function remove(id:string){const db=await openDb();await wait(db.transaction(STORE,'readwrite').objectStore(STORE).delete(id));}
export async function syncOfflineCashBills(submit:(record:OfflineCashBill)=>Promise<{invoiceId:string;deduplicated?:boolean}>,businessId?:string){
  if(!navigator.onLine)return {synced:0,remaining:(await listQueuedCashBills(businessId)).length};
  const records=await listQueuedCashBills(businessId);let synced=0;
  for(const record of records){
    record.status='syncing';record.attempts+=1;record.lastError=null;await put(record);
    try{
      await submit(record);await remove(record.id);synced+=1;
    }catch(error){
      record.lastError=error instanceof Error?error.message:'Offline Cash Bill sync failed';
      const retryable=!navigator.onLine||/fetch|network|offline|failed to send|connection|timeout/i.test(record.lastError);
      record.status=retryable?'queued':'failed';await put(record);
      if(retryable){await requestBackgroundSync();break;}
    }
  }
  return {synced,remaining:(await listQueuedCashBills(businessId)).length};
}