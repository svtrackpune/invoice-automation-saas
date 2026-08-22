'use client';

import {Suspense,useEffect,useState} from 'react';
import {useSearchParams} from 'next/navigation';
import {supabase} from '@/lib/supabase';

type Job={id:string;document_type:string;document_id:string;template_id:string|null;template_version:number|null;payload:any;status:string};
type Template={template_key:string;template_name:string};
type TemplateMeta={name:string;accent:string;table:string;soft:string;line:string;dark:boolean};

const money=(n:any,c='INR')=>new Intl.NumberFormat('en-IN',{style:'currency',currency:String(c||'INR').trim(),maximumFractionDigits:2}).format(Number(n||0));
const text=(v:any)=>String(v??'');
const lines=(v:any)=>{
  if(!v)return [];
  if(typeof v==='string')return v.split(/\n|,/).map(x=>x.trim()).filter(Boolean);
  if(typeof v==='object')return [v.line1,v.line2,v.city,v.state,v.postal_code,v.country].filter(Boolean).map(String);
  return [String(v)];
};

const templates:Record<string,TemplateMeta>={
  classic:{name:'Professional',accent:'#1f2937',table:'#1f2937',soft:'#f8fafc',line:'#cbd5e1',dark:false},
  bold:{name:'Classic Business',accent:'#111827',table:'#111827',soft:'#f3f4f6',line:'#9ca3af',dark:true},
  modern:{name:'Modern',accent:'#6d28d9',table:'#6d28d9',soft:'#f5f3ff',line:'#ddd6fe',dark:false},
  minimal:{name:'Minimal',accent:'#334155',table:'#e2e8f0',soft:'#ffffff',line:'#cbd5e1',dark:false},
  compact:{name:'Premium',accent:'#0f172a',table:'#0f172a',soft:'#f8fafc',line:'#94a3b8',dark:true},
};

function LogoBox({url,name}:{url:string;name:string}){
  return <div className="invoice-logo-box">
    {url?<img src={url} alt={name||'Business logo'} className="invoice-logo"/>:<div className="invoice-logo-placeholder"><span>LOGO</span><small>Business logo</small></div>}
  </div>;
}

function BusinessIdentity({b,url,compact=false}:{b:any;url:string;compact?:boolean}){
  const address=lines(b.address||b.business_address);
  const name=text(b.name||b.legal_name||'Business');
  const legal=b.legal_name&&b.legal_name!==b.name?text(b.legal_name):'';
  return <div className="business-identity">
    <div className="identity-row"><LogoBox url={url} name={name}/><div className="identity-copy">
      <div className="business-name">{name}</div>
      {legal&&<div className="business-legal">{legal}</div>}
      {address.length>0&&<div className="business-address">{address.map((x,i)=><div key={i}>{x}</div>)}</div>}
      <div className="business-contact">
        {(b.phone||b.mobile)&&<span>{text(b.phone||b.mobile)}</span>}
        {(b.email||b.business_email)&&<span>{text(b.email||b.business_email)}</span>}
        {b.website&&<span>{text(b.website)}</span>}
      </div>
      {(b.tax_registration_number||b.gstin)&&<div className="business-tax">GSTIN / Tax ID: {text(b.tax_registration_number||b.gstin)}</div>}
    </div></div>
    {!compact&&b.registration_number&&<div className="business-registration">Registration No.: {text(b.registration_number)}</div>}
  </div>;
}

function Totals({p,total,balance}:{p:any;total:number;balance:number}){
  return <div className="totals-box">
    <div className="total-row"><span>Subtotal</span><b>{money(p.subtotal,p.currency_code)}</b></div>
    {Number(p.discount_total)>0&&<div className="total-row"><span>Discount</span><b>-{money(p.discount_total,p.currency_code)}</b></div>}
    {Number(p.tax_total)>0&&<div className="total-row"><span>Tax</span><b>{money(p.tax_total,p.currency_code)}</b></div>}
    <div className="total-grand"><span>Total</span><b>{money(total,p.currency_code)}</b></div>
    {p.amount_paid!=null&&<div className="total-row"><span>Amount paid</span><b>{money(p.amount_paid,p.currency_code)}</b></div>}
    {(p.balance_due!=null||Number(balance)>0)&&<div className="total-row due"><span>Amount due</span><b>{money(balance,p.currency_code)}</b></div>}
  </div>;
}

function PaymentBlock({p,cf,balance}:{p:any;cf:any;balance:number}){
  const pay=cf.show_pay_now??true;
  const qr=cf.show_payment_qr??true;
  if(!pay&&!qr)return null;
  return <section className="payment-block break-inside-avoid">
    <div className="payment-copy">
      <div className="section-label">PAYMENT OPTIONS</div>
      <div className="payment-title">Pay this invoice easily</div>
      <div className="payment-due">Amount due: <b>{money(balance,p.currency_code)}</b></div>
      {pay&&<button disabled className="pay-placeholder">Pay Now</button>}
    </div>
    {qr&&<div className="qr-placeholder"><div className="qr-pattern">QR</div><span>Scan to pay</span></div>}
  </section>;
}

function InvoiceDocument({p,b,c,items,st,templateKey,type,cf,total,balance,logoUrl}:{p:any;b:any;c:any;items:any[];st:TemplateMeta;templateKey:string;type:string;cf:any;total:number;balance:number;logoUrl:string}){
  const gst=type==='invoice'&&(Number(p.tax_total)>0||!!b.tax_registration_number||!!b.gstin);
  const title=type==='invoice'?(gst?'TAX INVOICE':'INVOICE'):type==='quotation'?'ESTIMATE':type==='credit_note'?'CREDIT NOTE':'DEBIT NOTE';
  const number=p.invoice_number||p.quotation_number||p.credit_note_number||p.debit_note_number||'';
  const date=p.invoice_date||p.quotation_date||p.credit_note_date||p.debit_note_date||'';
  const customerAddress=lines(c.address||c.billing_address);
  const showTax=Number(p.tax_total)>0;
  return <article className={`invoice-paper template-${templateKey}`} style={{'--accent':st.accent,'--table':st.table,'--soft':st.soft,'--line':st.line} as React.CSSProperties}>
    <header className={`invoice-header ${st.dark?'header-dark':''}`}>
      <BusinessIdentity b={b} url={logoUrl} compact={st.dark}/>
      <div className="document-heading">
        <div className="document-title">{text(cf.title||title)}</div>
        {cf.subheading&&<div className="document-subheading">{text(cf.subheading)}</div>}
        <div className="document-meta">
          <div><span>Invoice No.</span><b>{text(number)}</b></div>
          <div><span>Invoice date</span><b>{text(date)}</b></div>
          {p.due_date&&<div><span>Due date</span><b>{text(p.due_date)}</b></div>}
          {p.po_number&&<div><span>PO / Ref.</span><b>{text(p.po_number)}</b></div>}
        </div>
      </div>
    </header>

    <section className="party-section">
      <div className="party-card">
        <div className="section-label">BILL TO</div>
        <div className="party-name">{text(c.display_name||c.legal_name||'Customer')}</div>
        {customerAddress.map((x,i)=><div key={i} className="party-line">{x}</div>)}
        {c.phone&&<div className="party-line">{text(c.phone)}</div>}
        {c.email&&<div className="party-line">{text(c.email)}</div>}
        {c.tax_id&&<div className="party-tax">GSTIN / Tax ID: {text(c.tax_id)}</div>}
      </div>
      <div className="party-card business-side">
        <div className="section-label">FROM</div>
        <div className="party-name">{text(b.name||b.legal_name||'Business')}</div>
        {lines(b.address||b.business_address).map((x,i)=><div key={i} className="party-line">{x}</div>)}
        {(b.phone||b.mobile)&&<div className="party-line">{text(b.phone||b.mobile)}</div>}
        {(b.email||b.business_email)&&<div className="party-line">{text(b.email||b.business_email)}</div>}
        {(b.tax_registration_number||b.gstin)&&<div className="party-tax">GSTIN / Tax ID: {text(b.tax_registration_number||b.gstin)}</div>}
      </div>
    </section>

    <table className="invoice-table">
      <thead><tr><th className="item-col">Item / Description</th><th>Qty</th><th>Rate</th>{showTax&&<th>Tax</th>}<th>Amount</th></tr></thead>
      <tbody>{items.map((x:any,i:number)=><tr key={i}>
        <td className="item-col"><div className="item-name">{text(x.name||x.description||'Item')}</div>{x.description&&x.name&&<div className="item-description">{text(x.description)}</div>}{x.sku&&<div className="item-sku">SKU: {text(x.sku)}</div>}</td>
        <td>{x.quantity??1}{x.unit?` ${x.unit}`:''}</td>
        <td>{money(x.unit_price,p.currency_code)}</td>
        {showTax&&<td>{x.tax_rate??0}%</td>}
        <td><b>{money(x.line_total??(Number(x.quantity||1)*Number(x.unit_price||0)),p.currency_code)}</b></td>
      </tr>)}</tbody>
    </table>

    <section className="totals-section"><Totals p={p} total={total} balance={balance}/></section>

    {type==='invoice'&&<PaymentBlock p={p} cf={cf} balance={balance}/>} 

    <section className="footer-information">
      <div>{p.notes&&<><div className="section-label">NOTES</div><div className="footer-copy">{text(p.notes)}</div></>}</div>
      <div>{(p.terms||cf.footer)&&<><div className="section-label">TERMS & CONDITIONS</div><div className="footer-copy">{text(p.terms||cf.footer)}</div></>}</div>
    </section>
    <footer className="invoice-footer"><span>{text(b.name||b.legal_name||'Business')}</span><span>{text(cf.footer||'This is a computer generated document.')}</span></footer>
  </article>;
}

function Receipt({title,number,date,p,b,c,total,cf,logoUrl}:{title:string;number:string;date:string;p:any;b:any;c:any;total:number;cf:any;logoUrl:string}){
  return <article className="invoice-paper receipt-paper">
    <header className="receipt-header"><BusinessIdentity b={b} url={logoUrl}/><div className="document-heading"><div className="document-title">{title.toUpperCase()}</div><div className="document-meta"><div><span>Receipt No.</span><b>{number}</b></div><div><span>Date</span><b>{date}</b></div></div></div></header>
    <section className="receipt-amount"><div className="section-label">AMOUNT RECEIVED</div><div className="receipt-total">{money(total,p.currency_code)}</div><div className="receipt-status">Payment received</div></section>
    <section className="party-section"><div className="party-card"><div className="section-label">RECEIVED FROM</div><div className="party-name">{text(c.display_name||c.legal_name||'')}</div>{c.email&&<div className="party-line">{text(c.email)}</div>}{c.phone&&<div className="party-line">{text(c.phone)}</div>}</div><div className="party-card business-side"><div className="section-label">BUSINESS</div><div className="party-name">{text(b.name||b.legal_name||'Business')}</div>{lines(b.address||b.business_address).map((x,i)=><div key={i} className="party-line">{x}</div>)}</div></section>
    <section className="receipt-details"><div><span>Against invoice</span><b>{text(p.invoice_number||'—')}</b></div><div><span>Payment method</span><b>{text(p.payment_method||p.method||'Payment received')}</b></div><div><span>Reference</span><b>{text(p.payment_reference||p.reference||'—')}</b></div></section>
    <div className="receipt-thanks">{cf.notes||'Thank you for your payment.'}</div><footer className="invoice-footer"><span>{text(b.name||b.legal_name||'Business')}</span><span>{cf.footer||'This receipt confirms payment received.'}</span></footer>
  </article>;
}

function DocumentsContent(){
  const qs=useSearchParams();
  const type=qs.get('type')||'invoice';
  const id=qs.get('id')||'';
  const[job,setJob]=useState<Job|null>(null),[template,setTemplate]=useState<Template|null>(null),[docPref,setDocPref]=useState<any>(null),[business,setBusiness]=useState<any>(null),[logoUrl,setLogoUrl]=useState(''),[loading,setLoading]=useState(true),[error,setError]=useState('');

  useEffect(()=>{(async()=>{
    if(!id){setError('Document id is required.');setLoading(false);return;}
    const r=await supabase.rpc('prepare_document_render',{p_document_type:type,p_document_id:id,p_template_id:null});
    if(r.error){setError(r.error.message);setLoading(false);return;}
    const j=await supabase.from('document_render_jobs').select('id,document_type,document_id,template_id,template_version,payload,status').eq('id',r.data).single();
    if(j.error){setError(j.error.message);setLoading(false);return;}
    setJob(j.data as Job);
    const businessId=j.data?.payload?.business?.id||j.data?.payload?.business_id;
    const [t,pref,biz]=await Promise.all([
      j.data?.template_id?supabase.from('document_templates').select('template_key,template_name').eq('id',j.data.template_id).maybeSingle():Promise.resolve({data:null,error:null} as any),
      businessId?supabase.from('business_document_preferences').select('custom_fields,show_payment_qr,show_payment_link').eq('business_id',businessId).eq('document_type',type).maybeSingle():Promise.resolve({data:null,error:null} as any),
      businessId?supabase.from('businesses').select('id,name,legal_name,registration_number,tax_registration_number,country_code,currency_code,address,brand_primary_color,brand_secondary_color,brand_accent_color,logo_storage_path,logo_original_filename').eq('id',businessId).maybeSingle():Promise.resolve({data:null,error:null} as any),
    ]);
    setTemplate(t.data as Template|null);setDocPref(pref.data||null);
    if(biz.data){setBusiness(biz.data);if(biz.data.logo_storage_path){const u=supabase.storage.from('business-branding-public').getPublicUrl(biz.data.logo_storage_path);setLogoUrl(u.data.publicUrl)}}
    setLoading(false);
  })()},[type,id]);

  if(loading)return <div className="grid min-h-screen place-items-center bg-slate-100 text-sm text-slate-500">Preparing document…</div>;
  if(error)return <div className="grid min-h-screen place-items-center bg-slate-100 text-sm text-rose-600">{error}</div>;

  const p=job?.payload||{};
  const b={...(p.business||{}),...(business||{})};
  const c=p.customer||{};
  const items=p.items||[];
  const templateKey=template?.template_key&&templates[template.template_key]?template.template_key:'classic';
  const st=templates[templateKey]||templates.classic;
  const cf=docPref?.custom_fields||{};
  const total=Number(p.total??p.amount??0);
  const balance=Number(p.balance_due??total);
  const isReceipt=type==='receipt';
  const title=type==='invoice'?(Number(p.tax_total)>0||!!b.tax_registration_number||!!b.gstin?'TAX INVOICE':'INVOICE'):type==='quotation'?'ESTIMATE':type==='receipt'?'PAYMENT RECEIPT':type==='credit_note'?'CREDIT NOTE':'DEBIT NOTE';
  const number=p.invoice_number||p.quotation_number||p.receipt_number||p.credit_note_number||p.debit_note_number||'';
  return <main className="document-page">
    <div className="document-toolbar print:hidden"><div><div className="toolbar-kicker">Document center</div><h1>{title} {number}</h1><p>{templates[templateKey]?.name||template?.template_name||'Professional'} · Template v{job?.template_version||1} · Print-ready</p></div><div className="toolbar-actions"><button onClick={()=>history.back()} className="toolbar-secondary">Back</button><button onClick={()=>window.print()} className="toolbar-primary">Print / Save PDF</button></div></div>
    {isReceipt?<Receipt title={text(cf.title||title)} number={number} date={text(p.receipt_date||p.payment_date||p.invoice_date||'')} p={p} b={b} c={c} total={total} cf={cf} logoUrl={logoUrl}/>:<InvoiceDocument p={p} b={b} c={c} items={items} st={st} templateKey={templateKey} type={type} cf={cf} total={total} balance={balance} logoUrl={logoUrl}/>} 
    <style jsx global>{`
      *{box-sizing:border-box}.document-page{min-height:100vh;background:#eef1f6;padding:28px 18px;color:#0f172a}.document-toolbar{max-width:794px;margin:0 auto 18px;display:flex;justify-content:space-between;align-items:center;gap:20px}.toolbar-kicker{font-size:10px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:#7c3aed}.document-toolbar h1{margin:3px 0 0;font-size:20px;font-weight:700}.document-toolbar p{margin:4px 0 0;font-size:12px;color:#64748b}.toolbar-actions{display:flex;gap:8px}.toolbar-primary,.toolbar-secondary{border-radius:10px;padding:10px 14px;font-size:13px;font-weight:700;cursor:pointer}.toolbar-primary{border:0;background:#0f172a;color:white}.toolbar-secondary{border:1px solid #cbd5e1;background:white;color:#334155}
      .invoice-paper{width:794px;min-height:1123px;margin:0 auto;background:#fff;padding:46px 48px 38px;box-shadow:0 14px 45px rgba(15,23,42,.12);font-family:Arial,Helvetica,sans-serif;color:#172033}.invoice-header,.receipt-header{display:flex;justify-content:space-between;gap:42px;padding-bottom:22px;border-bottom:2px solid var(--line,#cbd5e1)}.identity-row{display:flex;gap:14px;align-items:flex-start}.invoice-logo-box{width:82px;height:62px;flex:0 0 82px;display:grid;place-items:center;border:1px solid #dbe1ea;border-radius:7px;background:#fff;overflow:hidden}.invoice-logo{max-width:74px;max-height:54px;object-fit:contain}.invoice-logo-placeholder{width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#94a3b8;gap:2px}.invoice-logo-placeholder span{font-size:10px;font-weight:800;letter-spacing:.12em}.invoice-logo-placeholder small{font-size:7px}.business-name{font-size:19px;font-weight:800;line-height:1.15;color:var(--accent)}.business-legal{margin-top:3px;font-size:9px;color:#64748b}.business-address{margin-top:7px;font-size:9px;line-height:1.5;color:#475569}.business-contact{display:flex;flex-wrap:wrap;gap:3px 10px;margin-top:5px;font-size:8px;color:#64748b}.business-tax{margin-top:5px;font-size:8px;font-weight:700;color:#334155}.business-registration{margin-top:5px;font-size:8px;color:#64748b}.document-heading{text-align:right;min-width:220px}.document-title{font-size:27px;font-weight:900;letter-spacing:.02em;color:var(--accent)}.document-subheading{margin-top:3px;font-size:9px;color:#64748b}.document-meta{margin-top:16px;display:grid;gap:5px;font-size:9px}.document-meta div{display:flex;justify-content:flex-end;gap:12px}.document-meta span{color:#94a3b8}.document-meta b{min-width:94px;color:#1e293b}
      .party-section{display:grid;grid-template-columns:1fr 1fr;gap:30px;padding:22px 0}.party-card{min-height:116px}.party-card.business-side{text-align:right}.section-label{font-size:8px;font-weight:800;letter-spacing:.16em;color:#94a3b8}.party-name{margin-top:7px;font-size:12px;font-weight:800;color:#0f172a}.party-line{font-size:9px;line-height:1.5;color:#64748b}.party-tax{margin-top:5px;font-size:8px;font-weight:700;color:#334155}
      .invoice-table{width:100%;border-collapse:collapse;font-size:9px}.invoice-table thead tr{background:var(--table);color:white}.invoice-table thead th{padding:10px 9px;text-align:right;font-size:8px;font-weight:800}.invoice-table thead th.item-col{text-align:left}.invoice-table tbody td{padding:11px 9px;text-align:right;border-bottom:1px solid #e2e8f0;vertical-align:top}.invoice-table tbody td.item-col{text-align:left}.item-name{font-weight:700;color:#1e293b}.item-description{margin-top:3px;color:#64748b;font-size:8px;line-height:1.45}.item-sku{margin-top:3px;color:#94a3b8;font-size:7px}.totals-section{display:flex;justify-content:flex-end;padding-top:20px}.totals-box{width:270px;border-top:2px solid var(--line);padding-top:8px;font-size:9px}.total-row{display:flex;justify-content:space-between;padding:4px 0;color:#475569}.total-grand{display:flex;justify-content:space-between;margin-top:4px;padding:9px 0;border-top:1px solid var(--line);font-size:14px;font-weight:900;color:var(--accent)}.total-row.due{font-weight:800;color:#0f172a}
      .payment-block{margin-top:24px;border:1px solid #ddd6fe;border-radius:10px;background:#faf8ff;padding:14px 16px;display:flex;align-items:center;justify-content:space-between;gap:20px}.payment-title{margin-top:4px;font-size:13px;font-weight:800;color:#1e293b}.payment-due{margin-top:3px;font-size:9px;color:#64748b}.pay-placeholder{margin-top:9px;border:0;border-radius:7px;background:var(--accent);color:white;padding:7px 13px;font-size:9px;font-weight:800}.qr-placeholder{width:78px;height:78px;flex:0 0 78px;border:1px dashed #c4b5fd;border-radius:8px;background:white;display:flex;align-items:center;justify-content:center;flex-direction:column;color:#64748b}.qr-pattern{font-size:18px;font-weight:900;color:var(--accent)}.qr-placeholder span{font-size:7px;margin-top:2px}.footer-information{display:grid;grid-template-columns:1fr 1fr;gap:34px;margin-top:24px;padding-top:16px;border-top:1px solid #e2e8f0;min-height:62px}.footer-copy{margin-top:5px;white-space:pre-line;font-size:8px;line-height:1.55;color:#64748b}.invoice-footer{display:flex;justify-content:space-between;gap:20px;margin-top:28px;padding-top:10px;border-top:1px solid #e2e8f0;font-size:7px;color:#94a3b8}.header-dark{background:#111827;padding:22px;border-radius:8px;border-bottom:0}.header-dark .business-name,.header-dark .document-title{color:white}.header-dark .business-legal,.header-dark .business-address,.header-dark .business-contact,.header-dark .business-registration{color:#cbd5e1}.header-dark .business-tax{color:#e2e8f0}.header-dark .document-meta span{color:#94a3b8}.header-dark .document-meta b{color:white}.template-modern .invoice-header{border-bottom-color:#ddd6fe}.template-modern .party-card{background:#faf8ff;border:1px solid #ede9fe;border-radius:8px;padding:12px}.template-modern .party-card.business-side{text-align:right}.template-minimal .invoice-header{border-bottom:1px solid #cbd5e1}.template-minimal .invoice-table thead tr{background:#f1f5f9;color:#334155}.template-minimal .invoice-table thead th{font-size:8px}.template-compact{padding:34px 38px 30px}.template-compact .party-section{padding:16px 0}.template-compact .invoice-table tbody td{padding:8px 7px}.receipt-amount{margin:34px auto 22px;max-width:420px;text-align:center;padding:24px;border:1px solid #e2e8f0;border-radius:12px;background:#f8fafc}.receipt-total{margin-top:7px;font-size:34px;font-weight:900;color:var(--accent)}.receipt-status{margin-top:5px;font-size:10px;font-weight:800;color:#059669}.receipt-details{max-width:520px;margin:24px auto 0;border:1px solid #e2e8f0;border-radius:10px;padding:16px}.receipt-details div{display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid #f1f5f9;font-size:9px}.receipt-details div:last-child{border-bottom:0}.receipt-details span{color:#64748b}.receipt-thanks{text-align:center;margin:24px auto 0;font-size:9px;color:#64748b}
      @media print{html,body{background:white!important;margin:0!important;padding:0!important}.document-page{background:white!important;padding:0!important;min-height:0}.invoice-paper{width:100%;min-height:0;margin:0;box-shadow:none!important;border:0!important;padding:34px 38px 28px}.invoice-header{break-inside:avoid}.invoice-table{break-inside:auto}.invoice-table tr{break-inside:avoid}.payment-block,.footer-information{break-inside:avoid}.invoice-footer{margin-top:22px}.header-dark{print-color-adjust:exact;-webkit-print-color-adjust:exact}.invoice-table thead tr,.payment-block{print-color-adjust:exact;-webkit-print-color-adjust:exact}.document-toolbar{display:none!important}}
      @page{size:A4 portrait;margin:0}
    `}</style>
  </main>;
}

export default function DocumentsPage(){return <Suspense fallback={<div className="grid min-h-screen place-items-center bg-slate-100 text-sm text-slate-500">Preparing document…</div>}><DocumentsContent/></Suspense>}
