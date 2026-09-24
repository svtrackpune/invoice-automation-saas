'use client';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import QRCode from 'qrcode';

type Theme = { accent: string; table: string; line: string; dark: boolean; className: string; label: string };
const THEMES: Record<string, Theme> = {
  classic: { accent: '#7f1d1d', table: '#7f1d1d', line: '#d6d3d1', dark: false, className: 'template-classic', label: 'Classic Business' },
  minimal: { accent: '#111827', table: '#f1f5f9', line: '#cbd5e1', dark: false, className: 'template-minimal', label: 'Minimal' },
  modern: { accent: '#6d28d9', table: '#6d28d9', line: '#ddd6fe', dark: false, className: 'template-modern', label: 'Modern' },
  premium: { accent: '#5b21b6', table: '#5b21b6', line: '#ddd6fe', dark: false, className: 'template-premium', label: 'Premium' },
  professional: { accent: '#0f3b66', table: '#123f6b', line: '#cbd5e1', dark: false, className: 'template-professional', label: 'Professional' },
  bold: { accent: '#111827', table: '#111827', line: '#9ca3af', dark: true, className: 'template-professional', label: 'Professional' },
  compact: { accent: '#0f172a', table: '#0f172a', line: '#94a3b8', dark: true, className: 'template-professional', label: 'Professional' },
};

const money = (value: any, currency = 'INR') => new Intl.NumberFormat('en-IN', { style: 'currency', currency: String(currency || 'INR').trim(), maximumFractionDigits: 2 }).format(Number(value || 0));
const text = (value: any) => String(value ?? '');
const addressLines = (value: any) => {
  if (!value) return [];
  if (typeof value === 'object') {
    const first = [value.line1, value.address_line1, value.street].filter(Boolean).map(String).join(', ');
    const second = [value.line2, value.address_line2].filter(Boolean).map(String).join(', ');
    const third = [value.city, value.state, value.postal_code || value.pin || value.pincode].filter(Boolean).map(String).join(', ');
    const fourth = [value.country].filter(Boolean).map(String).join(', ');
    return [first, second, third, fourth].filter(Boolean);
  }
  const parts = String(value).split(/\n|,/).map((x) => x.trim()).filter(Boolean);
  if (parts.length <= 2) return parts;
  const first = parts.slice(0, Math.min(3, parts.length - 1)).join(', ');
  const second = parts.slice(Math.min(3, parts.length - 1)).join(', ');
  return [first, second].filter(Boolean);
};
const taxValue = (party: any) => text(party?.tax_id || party?.gstin || party?.gst_number || party?.tax_registration_number || '');
const isTaxRegistered = (party: any) => {
  if (!party) return false;
  if (party.is_tax_registered === false || party.tax_registered === false || party.tax_enabled === false) return false;
  const mode = text(party.tax_mode || party.tax_registration_status || party.tax_status || '').trim().toLowerCase();
  if (['non_gst', 'unregistered', 'not_registered', 'not tax registered'].includes(mode)) return false;
  return !!taxValue(party);
};

function Logo({ url }: { url: string }) { return <div className="logo">{url ? <img src={url} alt="Business logo" /> : <span>LOGO</span>}</div>; }
function Tagline({ business, fields, compact = false }: { business: any; fields: any; compact?: boolean }) { const tagline = text(business.tagline || fields.tagline || ''); return <div className={`tagline ${compact ? 'compact' : ''}`}>{tagline}</div>; }
function BusinessIdentity({ business, logoUrl, fields, showLogo = true, showAddress = true }: { business: any; logoUrl: string; fields: any; showLogo?: boolean; showAddress?: boolean }) {
  const address = addressLines(business.address);
  return <div className='business-identity'><div className='identity-main'>
    {showLogo && <Logo url={logoUrl} />}
    <div className='business-brand-copy'><strong>{text(business.name || business.legal_name || 'Business')}</strong>
      {business.legal_name && business.legal_name !== business.name && <div className='legal-name'>{text(business.legal_name)}</div>}
      {fields.subtitle && <div className='sub'>{text(fields.subtitle)}</div>}
    </div></div>
    {showAddress && address.length > 0 && <div className='business-address'>{address.map((line: string, index: number) => <span key={index}>{line}</span>)}</div>}
    {business.contact_person_name && <div className='business-contact-person'>Contact: {text(business.contact_person_name)}{business.contact_person_designation ? ` · ${text(business.contact_person_designation)}` : ''}</div>}
    {(business.phone || business.alternate_phone || business.email || business.alternate_email || business.website) && <div className='business-contact'>{business.phone && <span>{text(business.phone)}</span>}{business.alternate_phone && <span>{text(business.alternate_phone)}</span>}{business.email && <span>{text(business.email)}</span>}{business.alternate_email && <span>{text(business.alternate_email)}</span>}{business.website && <span>{text(business.website)}</span>}</div>}
    {taxValue(business) && <div className='business-gstin'>GSTIN / Tax ID: {taxValue(business)}</div>}
  </div>;
}

function LineItems({ items, payload, receipt, showTaxDetails = true }: { items: any[]; payload: any; receipt: boolean; showTaxDetails?: boolean }) {
  const currency = text(payload.currency_code || 'INR');
  const taxed = !receipt && showTaxDetails && Number(payload.tax_total || 0) > 0;
  const hasHsn = taxed && (items || []).some((it: any) => text(it.hsn_sac).trim());
  return <table className={`items ${receipt ? 'receipt-items' : ''} ${taxed ? 'tax-aware-items' : ''}`}><thead><tr>
    {!receipt && <th className='col-no'>#</th>}<th>{receipt ? 'Description' : 'Item / Description'}</th>
    {!receipt && taxed && hasHsn && <th>HSN / SAC</th>}{!receipt && <th className='col-type'>Type</th>}
    <th className='col-qty'>Qty</th><th className='col-rate'>Rate</th>{taxed && <th className='col-taxable'>Taxable</th>}{taxed && <th className='col-tax'>GST</th>}<th className='col-amount'>Amount</th>
  </tr></thead><tbody>{(items || []).map((it:any, idx:number) => {const quantity=Number(it.quantity ?? it.qty ?? 1);const rate=Number(it.unit_price ?? it.rate ?? it.price ?? 0);const taxAmount=Number(it.tax_amount||0);const lineTotal=Number(it.line_total||0);const taxable=Math.max(0,lineTotal-taxAmount);const name=text(it.name||'').trim()||text(it.description||'Item');const description=text(it.name&&it.description&&it.name!==it.description?it.description:'').trim();const taxLabel=it.tax_rate?`${text(it.tax_rate)}%`:(taxAmount?'Tax':'—');return <tr key={idx}>
    {!receipt && <td className='col-no'>{idx+1}</td>}<td><strong>{name}</strong>{description&&<div className='muted'>{description}</div>}{it.sku&&<div className='item-meta'>SKU: {text(it.sku)}</div>}</td>
    {!receipt && taxed && hasHsn && <td>{text(it.hsn_sac)||'—'}</td>}{!receipt && <td className='col-type'>{text(it.item_type||it.type||'')}</td>}
    <td className='col-qty'><span>{quantity}</span>{it.unit&&<small className='qty-unit'>{text(it.unit)}</small>}</td><td className='col-rate'>{money(rate,currency)}{Number(it.discount||0)>0&&<small className='line-discount'>Disc. −{money(it.discount,currency)}</small>}</td>{taxed&&<td className='col-taxable'>{money(taxable,currency)}</td>}{taxed&&<td className='col-tax'><span>{taxLabel}</span>{taxAmount>0&&<small>{money(taxAmount,currency)}</small>}</td>}<td className='col-amount'>{money(lineTotal,currency)}</td>
  </tr>;})}</tbody></table>;
}

const numberToWords = (value: number) => {
  const ones=['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
  const tens=['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
  const below100=(n:number)=>n<20?ones[n]:`${tens[Math.floor(n/10)]}${n%10?` ${ones[n%10]}`:''}`;
  const below1000=(n:number)=>n<100?below100(n):`${ones[Math.floor(n/100)]} Hundred${n%100?` ${below100(n%100)}`:''}`;
  const integer=Math.floor(Math.max(0,value)); if(integer===0)return 'Zero';
  const crore=Math.floor(integer/10000000), lakh=Math.floor((integer%10000000)/100000), thousand=Math.floor((integer%100000)/1000), hundred=integer%1000;
  return [crore?`${below100(crore)} Crore`:'',lakh?`${below100(lakh)} Lakh`:'',thousand?`${below100(thousand)} Thousand`:'',hundred?below1000(hundred):''].filter(Boolean).join(' ');
}
const formatDate=(value:any)=>{const raw=text(value);const match=raw.match(/^(\d{4})-(\d{2})-(\d{2})/);return match?`${match[3]}/${match[2]}/${match[1]}`:(raw||'—');};
function DocumentTotals({ payload, currency='INR', receipt=false, showTaxDetails=true }: { payload:any; currency?:string; receipt?:boolean; showTaxDetails?:boolean }) {
  const subtotal = Number(payload.subtotal ?? 0);
  const discount = Number(payload.discount_total ?? 0);
  const tax = Number(payload.tax_total ?? 0);
  const total = Number(payload.total ?? 0);
  const balance = Number(payload.balance_due ?? 0);
  const paid = Number(payload.amount_paid ?? payload.amount_received ?? 0);
  const cgst = Number(payload.cgst_amount ?? 0);
  const sgst = Number(payload.sgst_amount ?? 0);
  const igst = Number(payload.igst_amount ?? 0);
  const showComponents = showTaxDetails && (cgst !== 0 || sgst !== 0 || igst !== 0);
  const whole = numberToWords(total);
  const paise = Math.round((Math.max(0,total) - Math.floor(Math.max(0,total))) * 100);

  if (receipt) {
    return <div className="receipt-summary">
      <div><span>Total</span><strong>{money(total,currency)}</strong></div>
      <div><span>Received</span><strong>{money(paid,currency)}</strong></div>
      <div><span>Balance</span><strong>{money(balance,currency)}</strong></div>
    </div>;
  }

  return <div className="document-summary">
    <div><span>Subtotal</span><strong>{money(subtotal,currency)}</strong></div>
    {discount !== 0 && <div><span>Discount</span><strong>-{money(discount,currency)}</strong></div>}
    {showTaxDetails && tax !== 0 && !showComponents && <div><span>GST</span><strong>{money(tax,currency)}</strong></div>}
    {showComponents && cgst !== 0 && <div><span>CGST</span><strong>{money(cgst,currency)}</strong></div>}
    {showComponents && sgst !== 0 && <div><span>SGST</span><strong>{money(sgst,currency)}</strong></div>}
    {showComponents && igst !== 0 && <div><span>IGST</span><strong>{money(igst,currency)}</strong></div>}
    <div className="summary-total"><span>Total</span><strong>{money(total,currency)}</strong></div>
    {paid > 0 && <div><span>Amount Paid</span><strong>{money(paid,currency)}</strong></div>}
    <div className={balance > 0 ? 'balance-due' : 'balance-paid'}>
      <span>{balance > 0 ? 'Balance Due' : 'Paid in Full'}</span>
      <strong>{money(balance,currency)}</strong>
    </div>
    <div className="amount-words">
      <span>Amount in words</span>
      <strong>{whole}{currency === 'INR' ? ` Rupees${paise ? ` and ${String(paise).padStart(2,'0')} Paise` : ''}` : ''} Only</strong>
    </div>
  </div>;
}

function BankDetails({ bank }: { bank: any }) {
  const metadata = bank?.metadata || {};
  const accountNumber = metadata.account_number || metadata.account_no || metadata.accountNumber || (bank.account_last4 ? `•••• ${bank.account_last4}` : '');
  const ifsc = metadata.ifsc || metadata.ifsc_code || metadata.ifscCode || bank?.ifsc_code;
  const branch = metadata.branch || metadata.branch_name || bank?.branch_name;
  const upi = metadata.upi_id || metadata.upiId;
  return <div className="bank-details"><label>BANK DETAILS</label><strong>{text(bank?.name || 'Bank account')}</strong>{bank?.institution_name && <span>{text(bank.institution_name)}</span>}{accountNumber && <div>{accountNumber}</div>}{ifsc && <div>IFSC: {ifsc}</div>}{branch && <div>{branch}</div>}{upi && <div>UPI: {upi}</div>}</div>;
}

function PaymentSection({ paymentMode, paymentLink, paymentSelection, balance, currency, premium = false, showBankDetails = false, showPaymentLink = true, showPaymentQr = true, qrDataUrl = '' }: any) {
  const hasBank = showBankDetails && !!paymentSelection?.bank;
  const hasOnline = paymentMode === 'online' && ((showPaymentLink && !!paymentLink) || (showPaymentQr && !!qrDataUrl));
  if (!hasBank && !hasOnline) return null;
  return <section className={`payment ${hasBank && hasOnline ? 'payment-combined' : hasBank ? 'bank-payment' : 'online-payment'} ${premium ? 'payment-premium' : ''}`}>
    {hasBank && <div className="bank-payment-column"><BankDetails bank={paymentSelection.bank} /></div>}
    {hasOnline && <div className="online-payment-column"><div><label>PAYMENT OPTIONS</label><strong>Pay this invoice easily</strong><span>Amount due: {money(balance, currency)}</span>{showPaymentLink && paymentLink && <div><a href={paymentLink} target="_blank" rel="noreferrer">Pay now</a></div>}{showPaymentQr && qrDataUrl && <div className="qr"><img src={qrDataUrl} alt="Payment QR" /></div>}</div></div>}
  </section>;
}

function Paper({ type, payload, business, customer, items, theme, fields, logoUrl, paymentSelection, paymentQrDataUrl, showLogo=true, showBusinessAddress=true, showTaxDetails=true, showBankDetails=false, showPaymentLink=false, showPaymentQr=false, showSignature=false, showTerms=true }: any) {
  const receipt=type==='receipt', currency=text(payload.currency_code||business.currency_code||'INR').trim()||'INR';
  const resolvedLogoUrl=text(logoUrl||business.logo_url||(business.logo_storage_path?supabase.storage.from('business-branding-public').getPublicUrl(business.logo_storage_path).data.publicUrl:''));
  const taxRegistered=isTaxRegistered(business), title=receipt?'Payment Receipt':type==='quotation'?'Estimate':(Number(payload.tax_total||0)>0||taxRegistered)?'Tax Invoice':'Invoice';
  const notes=text(payload.notes||fields.notes||''),terms=text(payload.terms||fields.terms||''),paymentMode=paymentSelection?.payment_display_mode||'none',paymentLink=text(payload.payment_link||paymentSelection?.payment_link||''),isGstDocument=type==='invoice'&&(taxRegistered||Number(payload.tax_total||0)>0||text(business.tax_registration_number).trim()),buyerTaxId=taxValue(customer);
  const meta:any[]=[['Invoice No.',payload.invoice_number||payload.number],['Invoice Date',formatDate(payload.invoice_date)],['Due Date',formatDate(payload.due_date)]];
  if(isGstDocument&&payload.place_of_supply_state_code)meta.push(['Place of Supply',payload.place_of_supply_state_code]);
  if(isGstDocument&&payload.supply_type)meta.push(['Supply Type',payload.supply_type]); if(isGstDocument&&payload.reverse_charge)meta.push(['Reverse Charge','Yes']);
  if(receipt)return <article className={`paper receipt-paper ${theme.dark?'theme-dark':''}`} style={{'--accent':theme.accent,'--table':theme.table,'--line':theme.line} as React.CSSProperties}>
    <div className='receipt-head'>{showLogo&&<Logo url={resolvedLogoUrl}/>}<Tagline business={business} fields={fields} compact/><strong className='receipt-business'>{text(business.name||business.legal_name||'Business')}</strong>{showBusinessAddress&&<div className='receipt-contact'>{addressLines(business.address).map((l:string,i:number)=><span key={i}>{l}</span>)}</div>}</div>
    <div className='receipt-title'><h1>{text(fields.title||title)}</h1><div>Invoice <strong>{text(payload.invoice_number||payload.number||'—')}</strong></div><div>Receipt <strong>{text(payload.receipt_number||payload.number||'—')}</strong></div><div>{formatDate(payload.created_at||payload.payment_date)}</div></div>
    <div className='receipt-customer'><span className='label'>RECEIVED FROM</span><strong>{text(customer.display_name||customer.legal_name||'Customer')}</strong>{buyerTaxId&&<div>Tax ID: {buyerTaxId}</div>}{addressLines(customer.address||customer.billing_address||customer.address_line1||customer.address_line).map((l:string,i:number)=><div key={i}>{l}</div>)}</div>
    <LineItems items={items} payload={payload} receipt/><DocumentTotals payload={payload} currency={currency} receipt showTaxDetails={showTaxDetails}/>
    <div className='payment-detail'><span>Payment method</span><strong>{text(payload.payment_method||payload.method||'—')}</strong>{(payload.payment_reference||payload.reference)&&<><span>Ref</span><strong>{text(payload.payment_reference||payload.reference)}</strong></>}</div>
    <div className='paid-stamp'>PAID</div><div className='receipt-thanks'>{text(fields.notes||'Thank you for your payment.')}</div><footer className='receipt-footer'><span>{text(fields.footer||'')}</span></footer>
  </article>;
  return <article className={`paper ${theme.className} ${theme.dark?'theme-dark':''}`} style={{'--accent':theme.accent,'--table':theme.table,'--line':theme.line} as React.CSSProperties}>
    <header className='document-header'><div className='identity-column'><BusinessIdentity business={business} logoUrl={resolvedLogoUrl} fields={fields} showLogo={showLogo} showAddress={showBusinessAddress}/></div><div className='invoice-heading'><div className='document-title'>{text(fields.title||title)}</div><div className='document-meta'>{meta.map(([label,value]:any)=><div className='meta-row' key={label}><span>{label}</span><strong>{text(value)||'—'}</strong></div>)}</div></div></header>
    <section className='parties-grid'><div className='party-card'><label>BILL TO</label><strong>{text(customer.display_name||customer.legal_name||'Customer')}</strong>{customer.legal_name&&customer.legal_name!==customer.display_name&&<div>{text(customer.legal_name)}</div>}{buyerTaxId&&<div className='party-highlight'>GSTIN / Tax ID: {buyerTaxId}</div>}{customer.phone&&<div>{text(customer.phone)}</div>}{customer.email&&<div>{text(customer.email)}</div>}{addressLines(customer.billing_address||customer.address||customer.address_line1||customer.address_line).map((l:string,i:number)=><div key={i}>{l}</div>)}</div>
      {customer.shipping_address&&<div className='party-card'><label>SHIP TO</label>{addressLines(customer.shipping_address).map((l:string,i:number)=><div key={i}>{l}</div>)}</div>}
      {isGstDocument&&<div className='tax-context'>{payload.place_of_supply_state_code&&<div><span>Place of Supply</span><strong>{text(payload.place_of_supply_state_code)}</strong></div>}{payload.supply_type&&<div><span>Supply Type</span><strong>{text(payload.supply_type)}</strong></div>}{payload.tax_inclusive!==undefined&&<div><span>Tax</span><strong>{payload.tax_inclusive?'Inclusive':'Exclusive'}</strong></div>}{payload.reverse_charge&&<div><span>Reverse Charge</span><strong>Yes</strong></div>}</div>}
    </section>
    <LineItems items={items} payload={payload} receipt={false} showTaxDetails={showTaxDetails}/>
    <div className='post-table-grid'><div className='invoice-notes-area'>{notes&&<section className='document-notes'><label>NOTES</label><p>{notes}</p></section>}{showTerms&&terms&&<section className='document-terms'><label>TERMS & CONDITIONS</label><p>{terms}</p></section>}{isGstDocument&&<div className='compliance-note'><span>{payload.reverse_charge?'Reverse charge applicable.':'Tax calculated based on the selected tax profile and invoice items.'}</span></div>}</div><DocumentTotals payload={payload} currency={currency} showTaxDetails={showTaxDetails}/></div>
    {(type==='invoice'||paymentSelection?.bank)&&<PaymentSection paymentMode={type==='invoice'?paymentMode:'bank'} paymentLink={paymentLink} paymentSelection={paymentSelection} balance={Number(payload.balance_due??0)} currency={currency} premium={false} showBankDetails={showBankDetails} showPaymentLink={showPaymentLink} showPaymentQr={showPaymentQr} qrDataUrl={paymentQrDataUrl}/>} 
    {showSignature&&<div className='signature-row'><div/><div className='signature-box'><span>Authorized Signatory</span>{fields.signature_label&&<em>{text(fields.signature_label)}</em>}</div></div>}
    <footer><span>{text(business.name||business.legal_name||'Business')}</span><span>{text(fields.footer||'This is a computer generated document.')}</span></footer><div className='platform'>Generated by Moneymatters</div>
  </article>;
}

export default function DocumentViewer({ type, id }: { type: string; id: string }) {
  const [job, setJob] = useState<any>(null), [template, setTemplate] = useState<any>(null), [preferences, setPreferences] = useState<any>(null), [business, setBusiness] = useState<any>(null), [receiptItems, setReceiptItems] = useState<any[]>([]), [paymentSelection, setPaymentSelection] = useState<any>(null), [paymentQrDataUrl, setPaymentQrDataUrl] = useState<string>(''), [loading, setLoading] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    (async () => {
      const render = await supabase.rpc('prepare_document_render', { p_document_type: type, p_document_id: id, p_template_id: null });
      if (render.error) { if (active) { setError(render.error.message); setLoading(false); } return; }
      const loaded = await supabase.from('document_render_jobs').select('payload,template_id,template_version').eq('id', render.data).single();
      if (loaded.error) { if (active) { setError(loaded.error.message); setLoading(false); } return; }
      const payload = loaded.data?.payload || {}, businessId = payload.business?.id || payload.business_id;
      const taxIds = Array.from(new Set((payload.items || []).map((x:any) => x.tax_rate_id).filter(Boolean)));
      if (taxIds.length) { const taxRows = await supabase.from('tax_rates').select('id,name,rate,metadata').in('id', taxIds); if (!taxRows.error) payload.items = (payload.items || []).map((x:any)=>{ const tr = (taxRows.data||[]).find((t:any)=>t.id===x.tax_rate_id); return tr?{...x,tax_rate:tr.rate}:x }); }
      const productIds = Array.from(new Set((payload.items || []).map((x:any) => x.product_service_id).filter(Boolean)));
      if (productIds.length) { const productRows = await supabase.from('products_services').select('id,name,sku,item_type,unit,hsn_sac').in('id', productIds).eq('business_id', businessId); if (!productRows.error) payload.items = (payload.items || []).map((x:any)=>{ const p=(productRows.data||[]).find((row:any)=>row.id===x.product_service_id); return p?{...x,name:p.name,sku:p.sku,item_type:p.item_type,unit:p.unit,hsn_sac:p.hsn_sac}:x; }); }
      const [templateResult, preferenceResult, businessResult] = await Promise.all([
        loaded.data?.template_id ? supabase.from('document_templates').select('template_key,template_name').eq('id', loaded.data.template_id).maybeSingle() : Promise.resolve({ data: null } as any),
        businessId ? supabase.from('business_document_preferences').select('custom_fields,show_logo,show_business_address,show_tax_details,show_payment_qr,show_payment_link,show_signature,show_terms,show_bank_details').eq('business_id', businessId).eq('document_type', type).maybeSingle() : Promise.resolve({ data: null } as any),
        businessId ? supabase.from('businesses').select('id,name,legal_name,registration_number,tax_registration_number,tax_enabled,tax_mode,tax_type,currency_code,address,phone,alternate_phone,contact_person_name,contact_person_designation,email,alternate_email,website,google_location_link,logo_storage_path,logo_url').eq('id', businessId).maybeSingle() : Promise.resolve({ data: null } as any),
      ]);
      if (!active) return;
      setJob(loaded.data); setTemplate(templateResult.data); setPreferences(preferenceResult.data); if (businessResult.data) setBusiness(businessResult.data);
      const invoiceId = payload.invoice_id || payload.invoice?.id || payload.source_invoice_id || payload.payment?.invoice_id || (type === 'invoice' ? id : null);
      let selectedBank: any = null;
      if (businessId) {
        const selectedBankId = payload?.document_context?.selected_bank_account_id || null;
        if (selectedBankId) {
          const bankResult = await supabase.from('bank_accounts').select('id,name,institution_name,account_last4,account_holder_name,ifsc_code,branch_name,account_type,currency_code,metadata').eq('id', selectedBankId).eq('business_id', businessId).maybeSingle();
          selectedBank = bankResult.data || null;
        }
        if (selectedBank) setPaymentSelection({ payment_display_mode: 'bank', bank: selectedBank });
      }
      if (type === 'invoice' && businessId && invoiceId) {
        const invoiceResult = await supabase.from('invoices').select('payment_display_mode,payment_bank_account_id,payment_link,payment_qr_payload').eq('id', invoiceId).eq('business_id', businessId).maybeSingle();
        if (invoiceResult.data) {
          let bank = null;
          if (invoiceResult.data.payment_display_mode === 'bank' && invoiceResult.data.payment_bank_account_id) {
            const bankResult = await supabase.from('bank_accounts').select('id,name,institution_name,account_last4,account_holder_name,ifsc_code,branch_name,account_type,currency_code,metadata').eq('id', invoiceResult.data.payment_bank_account_id).eq('business_id', businessId).maybeSingle();
            bank = bankResult.data || null;
          }
          setPaymentSelection({ ...invoiceResult.data, bank: bank || selectedBank || null });
        }
      }
      if (type === 'receipt' && invoiceId) {
        const lineItems = await supabase.from('invoice_items').select('description,quantity,unit_price,line_total,product_service_id').eq('invoice_id', invoiceId).order('sort_order');
        if (!lineItems.error) setReceiptItems(lineItems.data || []);
        else if (active) setError(lineItems.error.message);
      }
      setLoading(false);
    })();
    return () => { active = false; };
  }, [type, id]);

  const model = job?.payload || {};
  const mergedBusiness = useMemo(() => ({ ...(model.business || {}), ...(business || {}) }), [model.business, business]);
  useEffect(() => {
    let active = true;
    const value = text(paymentSelection?.payment_qr_payload || job?.payload?.payment_qr_payload || paymentSelection?.payment_link || job?.payload?.payment_link || '');
    if (!value) { setPaymentQrDataUrl(''); return () => { active = false; }; }
    QRCode.toDataURL(value, { width: 180, margin: 1, errorCorrectionLevel: 'M' }).then((url) => { if (active) setPaymentQrDataUrl(url); }).catch(() => { if (active) setPaymentQrDataUrl(''); });
    return () => { active = false; };
  }, [paymentSelection, job]);

  const customer = model.customer || {};
  const items = type === 'receipt' ? (receiptItems.length ? receiptItems : model.items || []) : model.items || [];
  const theme = THEMES[template?.template_key] || THEMES.modern;
  const fields = preferences?.custom_fields || {};
  const number = model.invoice_number || model.quotation_number || model.receipt_number || model.number || '';
  const title = type === 'receipt' ? 'Payment Receipt' : type === 'quotation' ? 'Estimate' : 'Invoice';
  const link = typeof window !== 'undefined' ? window.location.href : '';
  const logoUrl = mergedBusiness?.logo_storage_path ? supabase.storage.from('business-branding-public').getPublicUrl(mergedBusiness.logo_storage_path).data.publicUrl : '';
  const back = () => { if (type === 'invoice' && model.status === 'draft') { location.href = `/next-workspace/invoices/new?edit=${id}`; return; } history.back(); };
  const copyLink = async () => { try { await navigator.clipboard.writeText(link); setNotice('Link copied.'); } catch { setNotice('Unable to copy link.'); } };
  const share = async () => { try { if (navigator.share) await navigator.share({ title: `${title} ${number}`, text: `${mergedBusiness.name || 'Business'} · ${number}`, url: link }); else await copyLink(); } catch { await copyLink(); } };
  const print = () => {
    const paper = document.querySelector('.paper') as HTMLElement | null;
    if (!paper) return;
    const receipt = paper.classList.contains('receipt-paper');
    const frame = document.createElement('iframe');
    frame.style.cssText = receipt ? 'position:fixed;left:-10000px;top:0;width:298px;height:1000px;border:0;visibility:hidden;' : 'position:fixed;left:-10000px;top:0;width:794px;height:1123px;border:0;visibility:hidden;';
    document.body.appendChild(frame);
    const doc = frame.contentDocument;
    if (!doc) { frame.remove(); return; }
    doc.open();
    const styles = Array.from(document.head.querySelectorAll('style')).map((style) => style.textContent || '').join('');
    doc.write(`<!doctype html><html><head><meta charset="utf-8"><style>${styles}
      @page { size: ${receipt ? '3.1in auto' : '210mm 297mm'}; margin:0; }
      html,body { margin:0!important; padding:0!important; background:#fff!important; }
      .page { padding:0!important; background:#fff!important; }
      .paper { margin:0!important; box-shadow:none!important; }
      ${receipt ? '.receipt-paper{width:3.1in!important;max-width:3.1in!important;min-height:0!important;}' : '.paper:not(.receipt-paper){width:210mm!important;min-width:210mm!important;max-width:210mm!important;}'}
      .paper:not(.receipt-paper) .items th,.paper:not(.receipt-paper) .items td,.paper:not(.receipt-paper) .parties span,.paper:not(.receipt-paper) .parties strong,.paper:not(.receipt-paper) footer{font-size:12px!important}
      .paper:not(.receipt-paper) .payment-combined{display:grid!important;grid-template-columns:minmax(0,1fr) minmax(0,1fr)!important;gap:20px!important;}
      .paper:not(.receipt-paper) .bank-payment-column{padding-right:20px!important;border-right:1px solid var(--line)!important;min-width:0!important;}
      .paper:not(.receipt-paper) .online-payment-column{min-width:0!important;display:flex!important;justify-content:space-between!important;align-items:center!important;gap:16px!important;}
      .paper:not(.receipt-paper) .qr{width:88px!important;height:88px!important;display:flex!important;align-items:center!important;justify-content:center!important;flex-direction:column!important;}
      .paper:not(.receipt-paper) .qr img{width:68px!important;height:68px!important;object-fit:contain!important;}
    </style></head><body>${paper.outerHTML}</body></html>`);
    doc.close();
    setTimeout(() => { frame.contentWindow?.focus(); frame.contentWindow?.print(); setTimeout(() => frame.remove(), 1000); }, 250);
  };
  if (loading) return <div className="center">Preparing document…</div>;
  if (error) return <div className="center error">{error}</div>;
  return <main className="page"><div className="toolbar"><div><small>DOCUMENT CENTER</small><h1>{title} {number}</h1><p>{template?.template_name || theme.label} · Print-ready</p></div><div className="actions"><button onClick={back}>Back</button><button onClick={copyLink}>Copy link</button><button onClick={share}>Share Invoice</button><button onClick={print}>Print / Save PDF</button></div></div>
    <Paper type={type} payload={model} business={mergedBusiness} customer={customer} items={items} theme={theme} fields={fields} logoUrl={logoUrl} paymentSelection={paymentSelection} paymentQrDataUrl={paymentQrDataUrl}
      showLogo={preferences?.show_logo !== false} showBusinessAddress={preferences?.show_business_address !== false} showTaxDetails={preferences?.show_tax_details !== false}
      showBankDetails={paymentSelection?.payment_display_mode === 'bank' || preferences?.show_bank_details === true}
      showPaymentLink={paymentSelection?.payment_display_mode === 'online' && preferences?.show_payment_link !== false}
      showPaymentQr={paymentSelection?.payment_display_mode === 'online' && preferences?.show_payment_qr !== false}
      showSignature={preferences?.show_signature === true} showTerms={preferences?.show_terms !== false} />
    <style jsx global>{`.identity-main{display:flex;align-items:center;gap:14px}.business-brand-copy{min-width:0}.business-brand-copy>strong{display:block;font-size:22px;line-height:1.08;letter-spacing:-.02em;color:#111827}.business-brand-copy .legal-name{margin-top:3px;font-size:10px;font-weight:600;color:#475569}.business-brand-copy .sub{margin-top:3px;font-size:10px;color:#64748b}.business-address{margin-top:9px;font-size:10.5px;line-height:1.45;color:#475569}.business-address span{display:block}.business-contact{margin-top:6px;display:flex;gap:8px;flex-wrap:wrap;font-size:9.5px;color:#475569}.business-contact span+span{border-left:1px solid #cbd5e1;padding-left:8px}.business-contact-person{margin-top:6px;font-size:9.5px;font-weight:700;color:#334155}.business-gstin{margin-top:7px;font-size:10px;font-weight:800;color:var(--accent)}.document-header{display:grid;grid-template-columns:minmax(0,1fr) 235px;gap:28px;padding-bottom:20px;border-bottom:2px solid var(--accent);align-items:start}.identity-column{min-width:0}.invoice-heading{text-align:right}.document-title{font-size:28px;line-height:1.05;font-weight:900;letter-spacing:.04em;text-transform:uppercase;color:var(--accent)}.document-meta{margin-top:12px;border:1px solid var(--line);border-radius:14px;overflow:hidden;background:#fbfcfe}.meta-row{display:flex;justify-content:space-between;gap:12px;padding:7px 11px;font-size:10.5px;border-bottom:1px solid #e9edf2}.meta-row:last-child{border-bottom:0}.meta-row span{color:#64748b}.meta-row strong{color:#172033;font-weight:800;text-align:right}.parties-grid{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr) minmax(0,.82fr);gap:12px;margin:18px 0 20px}.party-card,.tax-context{border:1px solid #e5e7eb;border-radius:14px;padding:13px 14px;background:#fff;min-width:0}.party-card label,.tax-context label,.document-notes label,.document-terms label,.bank-details label{display:block;font-size:9px;font-weight:900;letter-spacing:.15em;color:var(--accent);margin-bottom:7px}.party-card strong{display:block;font-size:13px;color:#111827;margin-bottom:4px}.party-card>div{font-size:10.5px;line-height:1.45;color:#475569}.party-highlight{font-weight:800!important;color:var(--accent)!important;margin:4px 0}.tax-context{background:#f8fafc}.tax-context>div{display:flex;justify-content:space-between;gap:10px;padding:4px 0;font-size:10px;border-bottom:1px dashed #dbe2ea}.tax-context>div:last-child{border-bottom:0}.tax-context span{color:#64748b}.tax-context strong{text-align:right;color:#172033}.items{width:100%;border-collapse:separate;border-spacing:0;table-layout:fixed;border:1px solid #dfe5ec;border-radius:14px;overflow:hidden}.items thead{background:var(--table);color:#fff}.items th{padding:9px 8px;font-size:9.5px;text-transform:uppercase;letter-spacing:.06em;text-align:left;font-weight:900;border-bottom:1px solid var(--table)}.items td{padding:9px 8px;font-size:10.5px;border-bottom:1px solid #e9edf2;vertical-align:top;color:#273244}.items tbody tr:last-child td{border-bottom:0}.items th:not(:nth-child(2)),.items td:not(:nth-child(2)){text-align:right}.items th:nth-child(2),.items td:nth-child(2){text-align:left}.items .col-no{width:32px;text-align:center!important}.items .col-type{width:62px;text-align:center!important}.items .col-qty{width:42px}.items .col-rate{width:76px}.items .col-taxable{width:82px}.items .col-tax{width:72px}.items .col-amount{width:88px}.items .col-tax small,.items .line-discount,.items .qty-unit{display:block;margin-top:2px;font-size:8px;opacity:.72}.items .qty-unit{font-size:8px;text-transform:lowercase}.tax-aware-items th:nth-child(3),.tax-aware-items td:nth-child(3){text-align:center}.items td strong{display:block;color:#111827;font-size:10.5px}.items .muted{margin-top:2px;color:#64748b;font-size:9px;line-height:1.35}.items .item-meta{margin-top:2px;color:#94a3b8;font-size:8px}.post-table-grid{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:28px;margin-top:18px;align-items:start}.invoice-notes-area{min-width:0}.document-notes,.document-terms{border-left:3px solid var(--accent);padding:9px 0 9px 12px;margin-bottom:12px;background:#fbfcfe}.document-notes p,.document-terms p{margin:0;white-space:pre-wrap;font-size:10.5px;line-height:1.5;color:#475569}.compliance-note{font-size:9px;line-height:1.4;color:#64748b;padding-top:6px}.document-summary{width:100%;margin-left:auto;border-top:2px solid var(--accent);padding-top:9px;font-size:11px}.document-summary>div{display:flex;justify-content:space-between;gap:20px;padding:4px 0}.document-summary .summary-total{margin-top:5px;padding:9px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line);font-size:16px}.document-summary .balance-due{color:#b91c1c;font-weight:800}.document-summary .balance-paid{color:#047857;font-weight:800}.document-summary .amount-words{display:block;margin-top:10px;padding:9px 10px;border:1px dashed #cbd5e1;border-radius:10px;background:#f8fafc}.document-summary .amount-words span{display:block;font-size:8.5px;font-weight:900;letter-spacing:.11em;text-transform:uppercase;color:#64748b;margin-bottom:3px}.document-summary .amount-words strong{display:block;font-size:9.5px;line-height:1.45;color:#334155}.payment{margin-top:18px;border:1px solid var(--line);border-radius:14px;padding:15px 16px;background:#fafaff}.payment-combined{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:18px}.payment-combined .bank-payment-column{padding-right:18px;border-right:1px solid var(--line)}.bank-details strong{display:block;font-size:12px;color:#111827;margin-bottom:2px}.bank-details span,.bank-details div{display:block;font-size:9.5px;line-height:1.45;color:#475569}.online-payment-column>div{display:grid;grid-template-columns:minmax(0,1fr) 96px;gap:12px;align-items:center}.online-payment-column label{display:block;font-size:9px;font-weight:900;letter-spacing:.15em;color:var(--accent)}.online-payment-column strong{display:block;margin-top:3px;font-size:13px;color:#111827}.online-payment-column span{display:block;margin-top:4px;font-size:9.5px;color:#64748b}.online-payment-column a{display:inline-block;margin-top:8px;padding:7px 12px;border-radius:8px;background:var(--accent);color:#fff;text-decoration:none;font-size:9.5px;font-weight:800}.qr{display:grid;place-items:center;width:92px;height:92px;border:1px solid #e5e7eb;border-radius:10px;background:#fff}.qr img{width:78px;height:78px;object-fit:contain}.signature-row{display:flex;justify-content:flex-end;margin-top:26px;min-height:54px}.signature-box{width:190px;border-top:1px solid #475569;text-align:center;padding-top:7px}.signature-box span{display:block;font-size:9px;font-weight:800;color:#334155}.signature-box em{display:block;margin-top:2px;font-size:8px;color:#64748b;font-style:normal}.paper>footer{display:flex;justify-content:space-between;gap:20px;margin-top:22px;padding-top:10px;border-top:1px solid #e5e7eb;font-size:8.5px;color:#64748b}.platform{margin-top:5px;text-align:center;font-size:7.5px;color:#94a3b8}@media(max-width:860px){.toolbar{align-items:flex-start;flex-direction:column}.actions{width:100%;justify-content:flex-start}.paper,.receipt-paper{width:100%;min-height:auto}.document-header{grid-template-columns:1fr}.invoice-heading{text-align:left}.parties-grid{grid-template-columns:1fr}.post-table-grid{grid-template-columns:1fr}.payment-combined{grid-template-columns:1fr}.payment-combined .bank-payment-column{padding-right:0;border-right:0;border-bottom:1px solid var(--line);padding-bottom:14px}.online-payment-column>div{grid-template-columns:1fr 88px}.paper{padding:28px 22px}.template-premium,.template-classic,.template-minimal,.template-professional{padding:28px 22px}}@media print{.page{padding:0!important;background:#fff!important}.toolbar{display:none!important}.paper{margin:0!important;box-shadow:none!important;width:210mm!important;min-width:210mm!important;max-width:210mm!important;min-height:0!important;padding:12mm 13mm 10mm!important}.receipt-paper{width:79mm!important;min-width:79mm!important;max-width:79mm!important;padding:0 0 5mm!important}.items{page-break-inside:auto}.items thead{display:table-header-group}.items tr{break-inside:avoid;page-break-inside:avoid}.party-card,.tax-context,.post-table-grid,.payment,.signature-row{break-inside:avoid;page-break-inside:avoid}.document-notes,.document-terms{break-inside:avoid;page-break-inside:avoid}.paper>footer{break-inside:avoid;page-break-inside:avoid}.platform{display:none}@page{size:A4 portrait;margin:0}}*{box-sizing:border-box}.page{min-height:100vh;background:#eef1f6;padding:28px 18px}.toolbar{max-width:794px;margin:0 auto 18px;display:flex;justify-content:space-between;align-items:center}.actions{display:flex;gap:8px}.paper{width:794px;min-height:1123px;margin:0 auto;background:#fff;padding:42px 48px 34px;box-shadow:0 14px 45px rgba(15,23,42,.12);font:14px/1.45 Arial,sans-serif;color:#172033;--accent:#6d28d9;--table:#6d28d9;--line:#ddd6fe}.template-classic{--accent:#7f1d1d!important;--table:#7f1d1d!important;--line:#d6d3d1!important;padding:44px 50px 36px}.template-minimal{--accent:#111827!important;--table:#f1f5f9!important;--line:#cbd5e1!important;padding:46px 54px 40px}.template-modern{--accent:#6d28d9!important;--table:#6d28d9!important;--line:#ddd6fe!important}.template-premium{--accent:#4c1d95!important;--table:#312e81!important;--line:#d8b4fe!important;padding:38px 48px 40px;position:relative;overflow:hidden;background:linear-gradient(180deg,#ffffff 0%,#f7f1ff 100%)}.template-professional{--accent:#0f3b66!important;--table:#123f6b!important;--line:#cbd5e1!important;padding:40px 46px 34px}.receipt-paper{width:640px;min-height:auto;padding:0 0 18px}.receipt-head{text-align:center;padding:28px 46px 18px;border-bottom:1px solid var(--line)}.document-summary-wrap{display:flex;justify-content:flex-end;margin-top:18px}.document-summary,.receipt-summary{width:320px;margin-left:auto;border-top:1px solid var(--line);padding-top:10px;font-size:13px}.document-summary>div,.receipt-summary>div{display:flex;justify-content:space-between;gap:20px;padding:3px 0}.document-summary .summary-total{margin-top:6px;padding-top:8px;border-top:2px solid var(--line);font-size:16px}.receipt-summary{width:auto;margin:18px 46px 0;padding-top:10px}.receipt-summary>div{font-size:13px}.document-summary strong,.receipt-summary strong{font-weight:700}@media(max-width:860px){.toolbar{align-items:flex-start;flex-direction:column}.actions{width:100%;justify-content:flex-start}.paper,.receipt-paper{width:100%;min-height:auto}}@media print{.page{padding:0!important;background:#fff!important}.toolbar,.notice{display:none!important}.paper{margin:0!important;box-shadow:none!important}}`}</style>
  </main>;
}