'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { createCanonicalDocumentViewModel } from '@/lib/shared/document-view-model';
import { buildPublicDocumentShareMessage, canSharePublicDocument, copyTextToClipboard, getPublicDocumentUrl } from '@/lib/client/share-document';
import QRCode from 'qrcode';
import { CashBillCompliance, CreditNoteCompliance, DeliveryChallanCompliance, PurchaseOrderCompliance, ReceiptSettlement, TaxInvoiceCompliance, TaxSummaryGrid, type ReceiptAllocation, type TaxLine } from '@/components/documents/PrintCompliance';

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
const receiptAddressLine = (business: any) => {
  const address = business?.address;
  if (!address) return '';
  if (typeof address === 'string') {
    const parts = address.split(/\n|,/).map((x: string) => x.trim()).filter(Boolean);
    return parts.slice(0, 2).join(', ');
  }
  return [address.line1 || address.address_line1 || address.street, address.city].filter(Boolean).map(String).filter((x: string, i: number, a: string[]) => a.indexOf(x) === i).join(', ');
};
const taxValue = (party: any) => text(party?.tax_id || party?.gstin || party?.gst_number || party?.tax_registration_number || '');
const registrationType = (party: any) => text(party?.gst_registration_type || party?.gstRegistrationType || party?.tax_registration_status || '').trim().toUpperCase() || 'NONE';
const isNonGstRegistration = (party: any) => ['NONE', 'UNREGISTERED', 'NON_GST', 'NOT_REGISTERED'].includes(registrationType(party));
const hasValidGstin = (party: any) => /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/.test(text(party?.gstin || party?.gst_number || party?.tax_registration_number).trim().toUpperCase());
const isTaxRegistered = (party: any) => {
  if (!party) return false;
  if (party.is_tax_registered === false || party.tax_registered === false || party.tax_enabled === false) return false;
  if (isNonGstRegistration(party)) return false;
  const mode = text(party.tax_mode || party.tax_status || '').trim().toLowerCase();
  if (['non_gst', 'unregistered', 'not_registered', 'not tax registered'].includes(mode)) return false;
  return hasValidGstin(party);
};
const invoiceDocumentTitle = (party: any) => {
  if (registrationType(party) === 'COMPOSITION' && hasValidGstin(party)) return 'BILL OF SUPPLY';
  return isTaxRegistered(party) ? 'TAX INVOICE' : 'INVOICE';
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

function LineItems({ items, payload, receipt, showTaxDetails = true, minRows = 0, showSerialNumbers = false, showPackages = false, standardSales = false }: { items: any[]; payload: any; receipt: boolean; showTaxDetails?: boolean; minRows?: number; showSerialNumbers?: boolean; showPackages?: boolean; standardSales?: boolean }) {
  const currency = text(payload.currency_code || 'INR');
  const taxed = !receipt && showTaxDetails && Number(payload.tax_total || 0) > 0;
  const hasHsn = taxed && (items || []).some((it: any) => text(it.hsn_sac).trim());
  const receiptClass = receipt ? 'receipt-items' : '';
  const sourceRows = items || [];
  const fillerCount = Math.max(0, Number(minRows || 0) - sourceRows.length);
  const rows = sourceRows.concat(Array.from({ length: fillerCount }, () => null));
  if (standardSales) {
    return <table className="items sales-six-column"><thead><tr>
      <th className="col-no">#</th><th>ITEM / DESCRIPTION</th><th className="col-qty">QTY</th><th className="col-unit">UNIT</th><th className="col-rate">RATE</th><th className="col-amount">AMOUNT</th>
    </tr></thead><tbody>{rows.map((it:any,idx:number)=>{
      const quantity=Number(it?.quantity??it?.qty??1);
      const rate=Number(it?.unit_price??it?.unitPrice??it?.rate??it?.price??0);
      const amount=Number(it?.line_total??it?.lineTotal??it?.amount??quantity*rate);
      const name=it?text(it.name||it.item_name||it.product_name||it.description||'Item'):'';
      const detailSource=text(it?.detail||it?.item_description||'');
      const detail=it&&(detailSource&&detailSource!==name?detailSource:text(it.description&&it.description!==name?it.description:''))||'';
      return <tr key={it?.id||`sales-row-${idx}`}>
        <td className="col-no">{it?idx+1:''}</td>
        <td className="sales-item-copy">{it&&<strong>{name}</strong>}{it&&detail&&<div className="muted">{detail}</div>}{it?.hsn_sac&&<div className="item-meta">HSN / SAC: {text(it.hsn_sac)}</div>}</td>
        <td className="col-qty"><span>{it?quantity:''}</span></td>
        <td className="col-unit">{it?text(it?.unit||'pcs').toUpperCase():''}</td>
        <td className="col-rate">{it?money(rate,currency):''}</td>
        <td className="col-amount">{it?money(amount,currency):''}</td>
      </tr>;
    })}</tbody></table>;
  }
  return <table className={`items ${receiptClass} ${taxed ? 'tax-aware-items' : ''}`}><thead><tr>
    {!receipt && <th className='col-no'>#</th>}<th>{receipt ? 'Item' : 'Item / Description'}</th>
    {!receipt && taxed && hasHsn && <th>HSN / SAC</th>}{!receipt && <th className='col-type'>Type</th>}{!receipt && showPackages && <th className='col-packages'>Packages</th>}
    <th className='col-qty'>Qty</th>{!receipt && <th className='col-rate'>Rate</th>}{taxed && <th className='col-taxable'>Taxable</th>}{taxed && <th className='col-tax'>GST</th>}<th className='col-amount'>Amount</th>
  </tr></thead><tbody>{rows.map((it:any, idx:number) => {
    const quantity=Number(it?.quantity ?? it?.qty ?? 1);
    const rate=Number(it?.unit_price ?? it?.rate ?? it?.price ?? 0);
    const taxAmount=Number(it?.tax_amount||0);
    const lineTotal=Number(it?.line_total ?? it?.amount ?? (quantity * rate));
    const taxable=Math.max(0,lineTotal-taxAmount);
    const name=text(it?.name||'').trim()||text(it?.description||'');
    const description=text(it?.name&&it?.description&&it?.name!==it?.description?it.description:'').trim();
    const taxLabel=it?.tax_rate!=null ? `${text(it.tax_rate)}%` : (taxAmount?'Tax':'—');
    const serial=text(it?.serial_number || '').trim();
    return <tr key={it?.id || `filler-${idx}`}>
      {!receipt && <td className='col-no'>{it ? idx+1 : ''}</td>}
      <td><strong>{name}</strong>{description&&<div className='muted'>{description}</div>}{it?.sku&&<div className='item-meta'>SKU: {text(it.sku)}</div>}{showSerialNumbers&&serial&&<div className='item-meta'>Serial: {serial}</div>}</td>
      {!receipt && taxed && hasHsn && <td>{text(it?.hsn_sac)||'—'}</td>}{!receipt && <td className='col-type'>{text(it?.item_type||it?.type||'')}</td>}{!receipt && showPackages && <td className='col-packages'>{it ? text(it?.packages || it?.number_of_packages || '—') : ''}</td>}
      <td className='col-qty'><span>{it ? quantity : ''}</span>{it?.unit&&<small className='qty-unit'>{text(it.unit)}</small>}</td>
      {!receipt&&<td className='col-rate'>{it ? money(rate,currency) : ''}{it&&Number(it.discount||0)>0&&<small className='line-discount'>Disc. −{money(it.discount,currency)}</small>}</td>}
      {taxed&&<td className='col-taxable'>{it ? money(taxable,currency) : ''}</td>}
      {taxed&&<td className='col-tax'><span>{it ? taxLabel : ''}</span>{it&&taxAmount>0&&<small>{money(taxAmount,currency)}</small>}</td>}
      <td className='col-amount'>{it ? money(lineTotal,currency) : ''}</td>
    </tr>;
  })}</tbody></table>;
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
  const calculatedNet = subtotal - discount + tax;
  const roundOff = Number(payload.round_off_amount ?? payload.round_off ?? (total - calculatedNet));
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
    <div style={{color:"#ea580c",fontWeight:800}}><span>Subtotal</span><strong>{money(subtotal,currency)}</strong></div>
    {discount !== 0 && <div><span>Discount</span><strong>-{money(discount,currency)}</strong></div>}
    {showTaxDetails && tax !== 0 && !showComponents && <div style={{color:"#ea580c",fontWeight:800}}><span>GST</span><strong>{money(tax,currency)}</strong></div>}
    {showComponents && cgst !== 0 && <div style={{color:"#ea580c",fontWeight:800}}><span>CGST</span><strong>{money(cgst,currency)}</strong></div>}
    {showComponents && sgst !== 0 && <div style={{color:"#ea580c",fontWeight:800}}><span>SGST</span><strong>{money(sgst,currency)}</strong></div>}
    {showComponents && igst !== 0 && <div style={{color:"#ea580c",fontWeight:800}}><span>IGST</span><strong>{money(igst,currency)}</strong></div>}
    <div className="summary-total" style={{color:"#ea580c",fontWeight:800}}><span>Net Payable</span><strong>{money(total,currency)}</strong></div>
    {Math.abs(roundOff) >= 0.005 && <div><span>Round-Off</span><strong>{roundOff > 0 ? '+' : ''}{money(roundOff,currency)}</strong></div>}
    {paid > 0 && <div><span>Amount Paid</span><strong>{money(paid,currency)}</strong></div>}
    <div className={balance > 0 ? 'balance-due' : 'balance-paid'} style={balance > 0 ? {color:'#ea580c',fontWeight:800} : undefined}>
      <span>{balance > 0 ? 'Balance Due' : 'Paid in Full'}</span>
      <strong>{money(balance,currency)}</strong>
    </div>
    <div className="amount-words">
      <span>Amount in words</span>
      <strong>{text(payload.amount_in_words || (whole + (currency === 'INR' ? ` Rupees${paise ? ` and ${String(paise).padStart(2,'0')} Paise` : ''}` : '') + ' Only'))}</strong>
    </div>
  </div>;
}

function BankDetails({ bank }: { bank: any }) {
  const metadata = bank?.metadata || {};
  const accountNumber = metadata.account_number || metadata.account_no || metadata.accountNumber || bank?.account_number || (bank.account_last4 ? `•••• ${bank.account_last4}` : '');
  const ifsc = metadata.ifsc || metadata.ifsc_code || metadata.ifscCode || bank?.ifsc_code;
  const branch = metadata.branch || metadata.branch_name || bank?.branch_name;
  const upi = metadata.upi_id || metadata.upiId;
  return <div className="bank-details"><label>BANK DETAILS</label><strong>{text(bank?.name || 'Bank account')}</strong>{bank?.institution_name && <span>{text(bank.institution_name)}</span>}{accountNumber && <div>{accountNumber}</div>}{ifsc && <div>IFSC: {ifsc}</div>}{branch && <div>{branch}</div>}{upi && <div>UPI: {upi}</div>}</div>;
}

function PaymentSection({ paymentMode, paymentLink, paymentSelection, balance, currency, premium = false, settlementDisplayMode = 'none', showBankDetails = false, showPaymentLink = true, showPaymentQr = true, qrDataUrl = '', upiIntentUrl = '' }: any) {
  const allowsBank = settlementDisplayMode === 'bank_transfer' || settlementDisplayMode === 'both';
  const allowsUpi = settlementDisplayMode === 'upi_qr' || settlementDisplayMode === 'both';
  const hasBank = allowsBank && showBankDetails && !!paymentSelection?.bank;
  const hasOnline = allowsUpi && ((showPaymentLink && !!paymentLink) || (showPaymentQr && !!qrDataUrl) || !!upiIntentUrl);
  if (!hasBank && !hasOnline) return null;
  return <section className={`payment ${hasBank && hasOnline ? 'payment-combined' : hasBank ? 'bank-payment' : 'online-payment'} ${settlementDisplayMode === 'upi_qr' ? 'payment-upi-only' : ''} ${premium ? 'payment-premium' : ''}`}>
    {hasBank && <div className="bank-payment-column"><BankDetails bank={paymentSelection.bank} /></div>}
    {hasOnline && <div className="online-payment-column"><div style={settlementDisplayMode === 'upi_qr' ? { display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: '8px' } : undefined}><label>{settlementDisplayMode === 'upi_qr' ? 'PAYMENT' : 'PAYMENT OPTIONS'}</label><strong>Pay this invoice easily</strong><span>Amount due: {money(balance, currency)}</span>{showPaymentLink && paymentLink && <div><a href={paymentLink} target="_blank" rel="noreferrer">Pay now online</a></div>}{upiIntentUrl && <div><a href={upiIntentUrl}>Pay Now via UPI</a></div>}{showPaymentQr && qrDataUrl && <div className="qr"><img src={qrDataUrl} alt="UPI payment QR code" /><span className="text-xs text-slate-500">Scan to pay the invoice amount.</span></div>}</div></div>}
  </section>;
}

function Paper({ type, payload, business, customer, items, theme, fields, logoUrl, paymentSelection, paymentQrDataUrl, settlementDisplayMode='none', upiIntentUrl='', showLogo=true, showBusinessAddress=true, showTaxDetails=true, showBankDetails=false, showPaymentLink=false, showPaymentQr=false, showSignature=false, showTerms=true, showCustomerBalance=false, customerBalance=0, showAuthorizedSignatory=false, minItemRows=0, showSerialNumbers=false, documentTitleOverride='', studioTheme={}, taxLines=[], receiptAllocations=[], originalInvoice={number:'',date:''}, cashBillFormat='a4' }: any) {
  const receipt=type==='receipt', cashBill=type==='cash_bill'||payload.document_kind==='cash_bill', taxInvoice=type==='tax_invoice'||payload.document_kind==='tax_invoice', currency=text(payload.currency_code||business.currency_code||'INR').trim()||'INR';
  const studio=studioTheme||{};
  const accentColor=text(studio.accent_color||'').trim()||theme.accent;
  const primaryColor=text(studio.primary_color||'').trim()||theme.table;
  const lineColor=text(studio.secondary_color||'').trim()||theme.line;
  const paperBackground=text(studio.background_color||'').trim()||'#FFFFFF';
  const paperText=text(studio.text_color||'').trim()||'#172033';
  const rowPadding=Math.min(16,Math.max(4,Number(studio.row_padding||9)));
  const radius=Math.min(24,Math.max(0,Number(studio.corner_radius??14)));
  const resolvedLogoUrl=text(logoUrl||business.logo_url||(business.logo_storage_path?supabase.storage.from('business-branding-public').getPublicUrl(business.logo_storage_path).data.publicUrl:''));
  const registration=registrationType(business),taxRegistered=isTaxRegistered(business),compositionScheme=registration==='COMPOSITION',invoiceTitle=invoiceDocumentTitle(business);
  const systemTitle=receipt?'Payment Receipt':cashBill?'CASH BILL':type==='tax_invoice'||type==='invoice'?invoiceTitle:type==='quotation'?'QUOTATION':type==='delivery_challan'?'DELIVERY CHALLAN':type==='purchase_order'?'PURCHASE ORDER':type==='credit_note'?'CREDIT NOTE':type==='debit_note'?'DEBIT NOTE':'DOCUMENT';
  const title=type==='invoice'||taxInvoice?invoiceTitle:text(payload.title||fields.title||documentTitleOverride||systemTitle);
  const salesTaxEligible=taxRegistered&&!compositionScheme;
  const documentShowTaxDetails=showTaxDetails&&(!['invoice','tax_invoice','quotation'].includes(type)&&!taxInvoice||salesTaxEligible);
  const notes=text(payload.notes||fields.notes||''),terms=text(payload.terms||fields.terms||''),paymentMode=paymentSelection?.payment_display_mode||'none',paymentLink=text(payload.payment_link||paymentSelection?.payment_link||''),isGstDocument=salesTaxEligible&&(taxInvoice||type==='invoice'||type==='credit_note'||type==='debit_note'),buyerTaxId=taxValue(customer),jurisdictionClause=text(payload.jurisdiction_clause||business.jurisdiction_clause||fields.jurisdiction_clause||'');
  const documentNumber=text(payload.document_number||payload.challan_number||payload.bill_number||payload.invoice_number||payload.quotation_number||payload.receipt_number||payload.number||'');
  const documentDate=payload.document_date||payload.challan_date||payload.bill_date||payload.invoice_date||payload.quotation_date||payload.receipt_date||payload.credit_date||payload.debit_date||payload.created_at;
  const numberLabel=type==='delivery_challan'?'Challan No.':type==='purchase_order'?'PO / Bill No.':type==='quotation'?'Quotation No.':type==='receipt'?'Receipt No.':type==='credit_note'?'Credit Note No.':type==='debit_note'?'Debit Note No.':'Invoice No.';
  const dateLabel=type==='delivery_challan'?'Challan Date':type==='purchase_order'?'Order Date':type==='quotation'?'Quotation Date':type==='receipt'?'Receipt Date':type==='credit_note'?'Credit Note Date':type==='debit_note'?'Debit Note Date':'Invoice Date';
  const partyLabel=type==='delivery_challan'?'DELIVER TO':type==='purchase_order'?'VENDOR':'BILL TO';
  const showShipTo=type==='invoice'||taxInvoice||type==='quotation'||Boolean(customer.shipping_address);
  const meta:any[][]=[[numberLabel,documentNumber],[dateLabel,formatDate(documentDate)]];
  if(type==='quotation'&&(payload.valid_until||payload.due_date))meta.push(['Valid Until',formatDate(payload.valid_until||payload.due_date)]); else if(payload.due_date)meta.push(['Due Date',formatDate(payload.due_date)]);
  if(isGstDocument&&payload.place_of_supply_state_code)meta.push(['Place of Supply',payload.place_of_supply_state_code]);
  if(isGstDocument&&payload.supply_type)meta.push(['Supply Type',payload.supply_type]); if(isGstDocument&&payload.reverse_charge)meta.push(['Reverse Charge','Yes']);
  if(cashBill){
    const cashierName=text(payload.cashier_name||payload.cashier||fields.cashier_name||'Counter Cashier');
    const paymentReference=text(payload.upi_reference||payload.payment_reference||payload.payment?.reference||payload.payment?.gateway_transaction_id||'');
    const paymentMethod=text(payload.payment_method||payload.payment?.method||'Cash');
    const cashTendered=Number(payload.cash_tendered||payload.amount_received||payload.amount_paid||payload.total||0);
    const changeReturned=Math.max(0,cashTendered-Number(payload.total||0));
    const thermal=cashBillFormat==='thermal80'||cashBillFormat==='thermal58';
    const paperClass=thermal?'cash-bill-thermal':'cash-bill-modern';
    return <article className={`paper cash-bill-paper ${paperClass} cash-bill-${cashBillFormat} ${theme.dark?'theme-dark':''}`} style={{'--accent':theme.accent,'--table':theme.table,'--line':theme.line} as React.CSSProperties}>
      {thermal ? <div className="cash-thermal">
        <div className="cash-thermal-brand">{business.name||business.legal_name||'Business'}</div>
        {addressLines(business.address).map((line:string,i:number)=><div key={i}>{line}</div>)}
        {taxValue(business)&&<div>GSTIN: {taxValue(business)}</div>}
        <div className="cash-thermal-rule"/>
        <strong>CASH BILL / POS RECEIPT</strong>
        <div>{documentNumber||'—'} · {formatDate(documentDate)}</div>
        <div className="cash-thermal-rule"/>
        {items.map((it:any,i:number)=><div className="cash-item" key={it?.id||i}><span>{text(it?.name||it?.description||'Item')}</span><span>{Number(it?.quantity||1)} × {money(Number(it?.unit_price||it?.rate||0),currency)}</span><strong>{money(Number(it?.line_total||it?.amount||0),currency)}</strong></div>)}
        <div className="cash-thermal-total"><span>Total</span><strong>{money(Number(payload.total||0),currency)}</strong></div>
        <div>Payment: {paymentMethod}</div>
        {paymentMethod.toLowerCase().includes('upi')&&<div>UPI Ref: {paymentReference||'—'}</div>}
        {paymentMethod.toLowerCase().includes('cash')&&<><div>Cash Tendered: {money(cashTendered,currency)}</div><div>Change Returned: {money(changeReturned,currency)}</div></>}
        {showPaymentQr&&paymentQrDataUrl&&<img className="cash-thermal-qr" src={paymentQrDataUrl} alt="UPI payment QR"/>}
        <div className="cash-thermal-thanks">Thank You — Visit Again</div>
      </div> : <><div className="cash-bill-watermark">PAID IN FULL</div>
        <header className="document-header"><div className="identity-column"><BusinessIdentity business={business} logoUrl={resolvedLogoUrl} fields={fields} showLogo={showLogo} showAddress={showBusinessAddress}/></div><div className="invoice-heading"><div className="document-title">CASH BILL / POS RECEIPT</div><div className="document-meta">{meta.map(([label,value]:any)=><div className="meta-row" key={label}><span>{label}</span><strong>{text(value)||'—'}</strong></div>)}</div></div></header>
        <CashBillCompliance payload={payload} cashierName={cashierName} paymentReference={paymentReference}/>
        <LineItems items={items} payload={payload} receipt={false} showTaxDetails={showTaxDetails} minRows={minItemRows} showSerialNumbers={showSerialNumbers}/>
        <div className="post-table-grid"><div className="invoice-notes-area">{notes&&<section className="document-notes"><label>NOTES</label><p>{notes}</p></section>}{showTerms&&terms&&<section className="document-terms"><label>TERMS & CONDITIONS</label><p>{terms}</p></section>}</div><DocumentTotals payload={payload} currency={currency} showTaxDetails={false}/></div>
        <PaymentSection paymentMode={paymentMode} paymentLink="" paymentSelection={paymentSelection} balance={0} currency={currency} settlementDisplayMode="upi_qr" showBankDetails={false} showPaymentLink={false} showPaymentQr={showPaymentQr} qrDataUrl={paymentQrDataUrl}/>
        <div className="cash-bill-footer"><strong>Thank You — Visit Again</strong><span>Cashier: {cashierName}</span>{paymentReference&&<span>UPI / Transaction Ref: {paymentReference}</span>}</div>
      </>}
    </article>;
  }
  if(receipt){
    const invoiceTotal=Number(payload.invoice_total ?? 0);
    const receiptAmount=Number(payload.amount ?? payload.amount_received ?? payload.amount_paid ?? 0);
    const balance=Math.max(0,Number(payload.balance_due ?? (invoiceTotal > 0 ? invoiceTotal-receiptAmount : 0)));
    const referenceTotal=invoiceTotal>0?invoiceTotal:receiptAmount;
    const status=balance<=0?'Paid':receiptAmount>0?'Partially Paid':'Unpaid';
    const customerName=text(customer.display_name||customer.legal_name||'Cash Customer').trim()||'Cash Customer';
    const phone=text(customer.phone||customer.mobile||'').trim();
    const businessName=text(business.name||business.legal_name||'Business').trim();
    const businessPhone=text(business.phone||business.alternate_phone||'').trim();
    const businessEmail=text(business.email||business.alternate_email||'').trim();
    const businessWebsite=text(business.website||'').trim();
    const businessAddress=receiptAddressLine(business);
    return <article className={`paper receipt-paper receipt-template-${theme.className.replace('template-','')} ${theme.dark?'theme-dark':''}`} style={{'--accent':theme.accent,'--table':theme.table,'--line':theme.line} as React.CSSProperties}>
      <header className='receipt-head'>
        {showLogo&&<Logo url={resolvedLogoUrl}/>} 
        <div className='receipt-business-details'>
          {businessName&&<strong>{businessName}</strong>}
          {businessAddress&&<span>{businessAddress}</span>}
          {businessPhone&&<span>{businessPhone}</span>}
          {businessEmail&&<span>{businessEmail}</span>}
          {businessWebsite&&<span>{businessWebsite}</span>}
        </div>
        <div className='receipt-date'><strong>PAYMENT RECEIPT / VOUCHER</strong><span>{formatDate(payload.receipt_date||payload.created_at||payload.payment_date)} · Receipt {documentNumber||'—'}</span></div>
      </header>
      <section className='receipt-status'>
        <div className={`receipt-status-badge ${status.toLowerCase().replace(' ','-')}`}>{status}</div>
        <div className='receipt-balance'><span>Balance</span><strong>{money(balance,currency)}</strong></div>
      </section>
      <section className='receipt-customer'>
        <span className='label'>CUSTOMER</span>
        <strong>{customerName}</strong>
        {phone&&<div>{phone}</div>}
      </section>
      <ReceiptSettlement receiptNumber={documentNumber} date={formatDate(payload.receipt_date||payload.created_at||payload.payment_date)} method={text(payload.payment_method||payload.payment?.method||'')} reference={text(payload.reference_number||payload.payment_reference||payload.payment?.reference||payload.payment?.gateway_transaction_id||'')} customerName={customerName} outstanding={Number(customerBalance)} allocations={receiptAllocations}/>
      <section className='receipt-items-section'>
        <LineItems items={items} payload={{...payload,total:referenceTotal}} receipt minRows={minItemRows} showSerialNumbers={showSerialNumbers}/>
      </section>
      <div className='receipt-total'><span>Total Amount</span><strong>{money(referenceTotal,currency)}</strong></div>
      <div className='receipt-thanks'>Received with thanks · retain this voucher for your records</div>
      <footer className='receipt-footer'><p className='receipt-disclaimer'>This is a computer-generated payment receipt and does not require signature.</p><div className='platform'><span className='platform-mark' aria-hidden='true'>M</span><span>Powered by <strong>Moneymatters</strong></span></div></footer>
    </article>;
  }
  return <article className={`paper ${theme.className} ${(type==='invoice'||taxInvoice||type==='quotation')?'sales-document-standard':''} ${theme.dark?'theme-dark':''}`} style={{'--accent':theme.accent,'--table':theme.table,'--line':theme.line} as React.CSSProperties}>
    <header className='document-header'><div className='identity-column'><BusinessIdentity business={business} logoUrl={resolvedLogoUrl} fields={fields} showLogo={showLogo} showAddress={showBusinessAddress}/></div><div className='invoice-heading'><div className='document-title'>{type==='invoice'||taxInvoice?invoiceTitle:type==='quotation'?'QUOTATION':text(fields.title||title)}</div>{(type==='invoice'||taxInvoice||type==='quotation')&&<div className='mt-3 inline-flex rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-extrabold uppercase tracking-wider text-slate-700'>{text(payload.status||'draft').replace(/_/g,' ')}</div>}<div className='document-meta'>{meta.map(([label,value]:any)=><div className='meta-row' key={label}><span>{label}</span><strong>{text(value)||'—'}</strong></div>)}</div></div></header>
    {taxInvoice && <TaxInvoiceCompliance payload={payload} business={business} customer={customer}/>}
    {type==='credit_note' && <CreditNoteCompliance payload={payload} originalInvoiceNumber={originalInvoice.number || text(payload.original_invoice_number)} originalInvoiceDate={formatDate(originalInvoice.date || payload.original_invoice_date)}/>}
    {type==='delivery_challan' && <DeliveryChallanCompliance payload={payload} customer={customer}/>}
    {type==='purchase_order' && <PurchaseOrderCompliance payload={payload} business={business} vendor={customer}/>}

    <section className='parties-grid'><div className='party-card'><label>{partyLabel}</label><strong>{text(customer.display_name||customer.legal_name||'Customer')}</strong>{customer.legal_name&&customer.legal_name!==customer.display_name&&<div>{text(customer.legal_name)}</div>}{buyerTaxId&&<div className='party-highlight'>GSTIN / Tax ID: {buyerTaxId}</div>}{customer.phone&&<div>{text(customer.phone)}</div>}{customer.email&&<div>{text(customer.email)}</div>}{addressLines(customer.billing_address||customer.address||customer.address_line1||customer.address_line).map((l:string,i:number)=><div key={i}>{l}</div>)}</div>
      {showShipTo&&<div className='party-card'><label>SHIP TO</label>{addressLines(customer.shipping_address).length?addressLines(customer.shipping_address).map((l:string,i:number)=><div key={i}>{l}</div>):addressLines(customer.billing_address||customer.address||customer.address_line1||customer.address_line).length?<div>Same as billing address</div>:<div>No shipping address provided</div>}</div>}
      {isGstDocument&&<div className='tax-context'>{payload.place_of_supply_state_code&&<div><span>Place of Supply</span><strong>{text(payload.place_of_supply_state_code)}</strong></div>}{payload.supply_type&&<div><span>Supply Type</span><strong>{text(payload.supply_type)}</strong></div>}{payload.tax_inclusive!==undefined&&<div><span>Tax</span><strong>{payload.tax_inclusive?'Inclusive':'Exclusive'}</strong></div>}{payload.reverse_charge&&<div><span>Reverse Charge</span><strong>Yes</strong></div>}</div>}
    </section>

    <LineItems items={items} payload={payload} receipt={false} showTaxDetails={documentShowTaxDetails} minRows={minItemRows} showSerialNumbers={showSerialNumbers} showPackages={type==='delivery_challan'} standardSales={type==='invoice'||taxInvoice||type==='quotation'}/>
    {isGstDocument && (taxInvoice || type==='credit_note') && <TaxSummaryGrid items={items} taxLines={taxLines} money={(v:number)=>money(v,currency)}/>} 
    <div className='post-table-grid'><div className='invoice-notes-area'>{(type==='invoice'||taxInvoice||cashBill||type==='quotation'||paymentSelection?.bank)&&<PaymentSection paymentMode={paymentMode} paymentLink={paymentLink} paymentSelection={paymentSelection} balance={Number(payload.balance_due??0)} currency={currency} premium={false} settlementDisplayMode={settlementDisplayMode} showBankDetails={showBankDetails} showPaymentLink={showPaymentLink} showPaymentQr={showPaymentQr} qrDataUrl={paymentQrDataUrl} upiIntentUrl={upiIntentUrl}/>}{showTerms&&terms&&<section className='document-terms'><label style={{color:'#7c3aed',fontWeight:800}}>TERMS & CONDITIONS</label><p>{terms}</p></section>}{notes&&<section className='document-notes'><label style={{color:'#7c3aed',fontWeight:800}}>NOTES</label><p>{notes}</p></section>}{isGstDocument&&<div className='compliance-note'><span>{payload.reverse_charge?'Reverse charge applicable.':'Tax calculated based on the selected tax profile and invoice items.'}</span></div>}</div><DocumentTotals payload={payload} currency={currency} showTaxDetails={showTaxDetails}/></div>
    {showSignature&&<div className='signature-row'><div/><div className='signature-box'><span>{showAuthorizedSignatory?'Authorized Signatory':'Signature'}</span>{fields.signature_label&&<em>{text(fields.signature_label)}</em>}</div></div>}
    {type==='delivery_challan' && <div className='signature-row'><div className='receiver-note'>Receiver's Acknowledgment</div><div className='signature-box'><span>Receiver Signature</span></div></div>}
    {jurisdictionClause && <div className='jurisdiction-clause'><strong>Jurisdiction</strong><span>{jurisdictionClause}</span></div>}
    {showCustomerBalance&&<div className='customer-balance-footer'><span>Customer ledger balance</span><strong>{money(customerBalance,currency)} {Number(customerBalance)>0?'outstanding':'clear'}</strong></div>}
    <footer><span>{text(business.name||business.legal_name||'Business')}</span><span>{type==='invoice'||taxInvoice?'This is a computer-generated invoice and does not require signature.':type==='quotation'?'This is a computer-generated quotation and does not require signature.':text(fields.footer||'This is a computer generated document.')}</span></footer><div className='platform'><span className='platform-mark' aria-hidden='true'>M</span><span>Powered by <strong>Moneymatters</strong></span></div>
  </article>;
}

export default function DocumentViewer({ type, id }: { type: string; id: string }) {
  const [job, setJob] = useState<any>(null), [template, setTemplate] = useState<any>(null), [preferences, setPreferences] = useState<any>(null), [business, setBusiness] = useState<any>(null), [receiptItems, setReceiptItems] = useState<any[]>([]), [receiptAllocations, setReceiptAllocations] = useState<ReceiptAllocation[]>([]), [taxLines, setTaxLines] = useState<TaxLine[]>([]), [originalInvoice, setOriginalInvoice] = useState({ number:'', date:'' }), [cashBillFormat, setCashBillFormat] = useState<'a4'|'a5'|'thermal80'|'thermal58'>('a4'), [paymentSelection, setPaymentSelection] = useState<any>(null), [paymentSettings, setPaymentSettings] = useState<any>(null), [customerBalance, setCustomerBalance] = useState(0), [paymentQrDataUrl, setPaymentQrDataUrl] = useState<string>(''), [loading, setLoading] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState(''), [isCopied, setIsCopied] = useState(false), [toastMessage, setToastMessage] = useState(''), [shareOptions, setShareOptions] = useState<{ url: string; message: string; title: string } | null>(null);
  const copyTimer = useRef<number | null>(null);
  const toastTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (copyTimer.current) window.clearTimeout(copyTimer.current);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      const renderType = type === 'tax_invoice' || type === 'cash_bill' ? 'invoice' : type;
      const render = await supabase.rpc('prepare_document_render', { p_document_type: renderType, p_document_id: id, p_template_id: null });
      if (render.error) { if (active) { setError(render.error.message); setLoading(false); } return; }
      const loaded = await supabase.from('document_render_jobs').select('payload,template_id,template_version').eq('id', render.data).single();
      if (loaded.error) { if (active) { setError(loaded.error.message); setLoading(false); } return; }
      const payload = loaded.data?.payload || {}, businessId = payload.business?.id || payload.business_id;
      const taxIds = Array.from(new Set((payload.items || []).map((x:any) => x.tax_rate_id).filter(Boolean)));
      if (taxIds.length) { const taxRows = await supabase.from('tax_rates').select('id,name,rate,metadata').in('id', taxIds); if (!taxRows.error) payload.items = (payload.items || []).map((x:any)=>{ const tr = (taxRows.data||[]).find((t:any)=>t.id===x.tax_rate_id); return tr?{...x,tax_rate:tr.rate}:x }); }
      const productIds = Array.from(new Set((payload.items || []).map((x:any) => x.product_service_id).filter(Boolean)));
      if (productIds.length) { const productRows = await supabase.from('products_services').select('id,name,sku,item_type,unit,hsn_sac').in('id', productIds).eq('business_id', businessId); if (!productRows.error) payload.items = (payload.items || []).map((x:any)=>{ const p=(productRows.data||[]).find((row:any)=>row.id===x.product_service_id); return p?{...x,name:p.name,sku:p.sku,item_type:p.item_type,unit:p.unit,hsn_sac:p.hsn_sac}:x; }); }
      const sourceInvoiceId = payload.invoice_id || payload.invoice?.id || payload.source_invoice_id || payload.payment?.invoice_id || (renderType === 'invoice' ? id : null);
      if (sourceInvoiceId && ['invoice','tax_invoice','cash_bill','credit_note'].includes(type)) {
        const taxResult = await supabase.from('invoice_tax_lines').select('invoice_item_id,tax_code,tax_category,rate,taxable_amount,tax_amount').eq('invoice_id', sourceInvoiceId).order('invoice_item_id');
        if (!taxResult.error) setTaxLines((taxResult.data || []) as TaxLine[]);
      }
      if (type === 'credit_note' && payload.invoice_id) {
        const source = await supabase.from('invoices').select('invoice_number,invoice_date').eq('id', payload.invoice_id).eq('business_id', businessId).maybeSingle();
        if (!source.error && source.data) setOriginalInvoice({ number:String(source.data.invoice_number || ''), date:String(source.data.invoice_date || '') });
      }

      const [templateResult, preferenceResult, businessResult, taxProfileResult, paymentSettingsResult] = await Promise.all([
        loaded.data?.template_id ? supabase.from('document_templates').select('template_key,template_name').eq('id', loaded.data.template_id).maybeSingle() : Promise.resolve({ data: null } as any),
        businessId ? supabase.from('business_document_preferences').select('custom_fields,show_logo,show_business_address,show_tax_details,show_payment_qr,show_payment_link,show_signature,show_terms,show_bank_details,document_title_override,min_item_rows,prefill_upi_amount,show_customer_balance,show_authorized_signatory,show_serial_numbers').eq('business_id', businessId).eq('document_type', renderType).maybeSingle() : Promise.resolve({ data: null } as any),
        businessId ? supabase.from('businesses').select('id,name,legal_name,registration_number,tax_registration_number,tax_enabled,tax_mode,tax_type,currency_code,address,phone,alternate_phone,contact_person_name,contact_person_designation,email,alternate_email,website,google_location_link,logo_storage_path,logo_url').eq('id', businessId).maybeSingle() : Promise.resolve({ data: null } as any),
        businessId ? supabase.from('business_tax_profiles').select('gstin,pan,tax_regime,gst_registration_type').eq('business_id', businessId).maybeSingle() : Promise.resolve({ data: null } as any),
        businessId ? supabase.from('document_payment_settings').select('upi_id,payment_qr_enabled,payment_link_enabled,payment_instructions,default_bank_account_id,settlement_display_mode').eq('business_id', businessId).maybeSingle() : Promise.resolve({ data: null } as any),
      ]);
      if (!active) return;
      setJob(loaded.data); setTemplate(templateResult.data); setPreferences(preferenceResult.data); setPaymentSettings(paymentSettingsResult.data || null);
      if (businessResult.data) {
        const taxProfile = taxProfileResult.data as { gstin?: string | null; pan?: string | null; tax_regime?: string | null; gst_registration_type?: string | null } | null;
        const registration = String(taxProfile?.gst_registration_type || 'NONE').trim().toUpperCase();
        const nonGst = ['NONE', 'UNREGISTERED', 'NON_GST', 'NOT_REGISTERED'].includes(registration);
        setBusiness({
          ...businessResult.data,
          gst_registration_type: registration,
          gstin: nonGst ? null : (taxProfile?.gstin || null),
          pan: taxProfile?.pan || null,
          tax_registration_number: nonGst ? null : (taxProfile?.gstin || businessResult.data.tax_registration_number || null),
          tax_enabled: nonGst ? false : businessResult.data.tax_enabled,
          tax_mode: nonGst ? 'non_gst' : businessResult.data.tax_mode,
        });
      }
      const invoiceId = payload.invoice_id || payload.invoice?.id || payload.source_invoice_id || payload.payment?.invoice_id || (type === 'invoice' ? id : null);
      let selectedBank: any = null;
      if (businessId) {
        const selectedBankId = payload?.document_context?.selected_bank_account_id || null;
        if (selectedBankId) {
          const bankResult = await supabase.from('bank_accounts').select('id,name,institution_name,account_number,account_last4,account_holder_name,ifsc_code,branch_name,account_type,currency_code,metadata').eq('id', selectedBankId).eq('business_id', businessId).maybeSingle();
          selectedBank = bankResult.data || null;
        }
        if (selectedBank) setPaymentSelection({ payment_display_mode: 'bank', bank: selectedBank });
      }
      if (type === 'quotation' && businessId) {
        let quotationBankId = selectedBank?.id || null;
        if (!quotationBankId) {
          const preferred = await supabase.from('business_document_bank_accounts')
            .select('bank_account_id')
            .eq('business_id', businessId).eq('document_type', 'quotation')
            .order('display_order', { ascending: true }).order('created_at', { ascending: true })
            .limit(1).maybeSingle();
          if (!preferred.error) quotationBankId = preferred.data?.bank_account_id || null;
        }
        if (!quotationBankId) quotationBankId = paymentSettingsResult.data?.default_bank_account_id || null;
        if (!quotationBankId) {
          const businessDefaults = await supabase.from('business_settings').select('default_bank_account_id')
            .eq('business_id', businessId).maybeSingle();
          if (!businessDefaults.error) quotationBankId = businessDefaults.data?.default_bank_account_id || null;
        }
        let quotationBank: any = null;
        if (quotationBankId) {
          const preferredBank = await supabase.from('bank_accounts')
            .select('id,name,institution_name,account_number,account_last4,account_holder_name,ifsc_code,branch_name,account_type,currency_code,metadata')
            .eq('id', quotationBankId).eq('business_id', businessId).eq('is_active', true).maybeSingle();
          if (!preferredBank.error) quotationBank = preferredBank.data || null;
        }
        if (!quotationBank) {
          const fallbackBank = await supabase.from('bank_accounts')
            .select('id,name,institution_name,account_number,account_last4,account_holder_name,ifsc_code,branch_name,account_type,currency_code,metadata')
            .eq('business_id', businessId).eq('is_active', true)
            .order('is_primary', { ascending: false }).order('created_at', { ascending: true })
            .limit(1).maybeSingle();
          if (!fallbackBank.error) quotationBank = fallbackBank.data || null;
        }
        setPaymentSelection(quotationBank ? { payment_display_mode: 'bank', bank: quotationBank } : null);
      }
      if (type === 'invoice' && businessId && invoiceId) {
        const invoiceResult = await supabase.from('invoices').select('payment_display_mode,payment_bank_account_id,payment_link,payment_qr_payload').eq('id', invoiceId).eq('business_id', businessId).maybeSingle();
        if (invoiceResult.data) {
          let bank = null;
          const settlementBankId = invoiceResult.data.payment_bank_account_id || selectedBank?.id || paymentSettingsResult.data?.default_bank_account_id || null;
          if (settlementBankId) {
            const bankResult = await supabase.from('bank_accounts').select('id,name,institution_name,account_number,account_last4,account_holder_name,ifsc_code,branch_name,account_type,currency_code,metadata').eq('id', settlementBankId).eq('business_id', businessId).eq('is_active', true).maybeSingle();
            bank = bankResult.data || null;
          }
          setPaymentSelection({ ...invoiceResult.data, bank: bank || selectedBank || null });
        }
      }
      if (businessId && payload?.customer?.id) {
        const balanceResult = await supabase.from('customer_balances').select('balance_due').eq('business_id', businessId).eq('customer_id', payload.customer.id).maybeSingle();
        if (!balanceResult.error) setCustomerBalance(Number(balanceResult.data?.balance_due || 0));
      }
      if (type === 'receipt' && invoiceId) {
        const lineItems = await supabase.from('invoice_items').select('description,quantity,unit_price,line_total,product_service_id').eq('invoice_id', invoiceId).order('sort_order');
        if (!lineItems.error) setReceiptItems(lineItems.data || []);
        else if (active) setError(lineItems.error.message);
        const paymentId = payload.payment_id || payload.payment?.id;
        if (paymentId) {
          const allocations = await supabase.from('payment_allocations').select('invoice_id,amount').eq('business_id', businessId).eq('payment_id', paymentId);
          if (!allocations.error && allocations.data?.length) {
            const invoiceIds = Array.from(new Set(allocations.data.map((row:any) => row.invoice_id).filter(Boolean)));
            const invoiceRows = invoiceIds.length ? await supabase.from('invoices').select('id,invoice_number,total,balance_due').in('id', invoiceIds).eq('business_id', businessId) : { data: [] } as any;
            const allocationRows = (allocations.data || []).map((row:any) => {
              const source = (invoiceRows.data || []).find((inv:any) => inv.id === row.invoice_id);
              return {
                invoiceNumber:String(source?.invoice_number || row.invoice_id || '—'),
                totalDue:Number(source?.total || 0),
                amountApplied:Number(row.amount || 0),
                remainingBalance:Math.max(0, Number(source?.balance_due || 0)),
              };
            });
            if (active) setReceiptAllocations(allocationRows);
          }
        }
      }
      setLoading(false);
    })();
    return () => { active = false; };
  }, [type, id]);

  const rawModel = job?.payload || {};
  const model = useMemo(() => {
    if (type==='delivery_challan') return { ...rawModel, invoice_number: rawModel.document_number || rawModel.challan_number, invoice_date: rawModel.document_date || rawModel.challan_date };
    if (type==='purchase_order') return { ...rawModel, invoice_number: rawModel.document_number || rawModel.bill_number, invoice_date: rawModel.document_date || rawModel.bill_date, customer: rawModel.customer || rawModel.party || rawModel.vendor || {} };
    return rawModel;
  }, [rawModel,type]);
  const mergedBusiness = useMemo(() => ({ ...(model.business || {}), ...(business || {}) }), [model.business, business]);


  const customer = model.customer || model.party || model.vendor || {};
  const items = type === 'receipt' ? (receiptItems.length ? receiptItems : model.items || []) : model.items || [];
  const canonicalType = type === 'delivery_challan' ? 'challan'
    : type === 'quotation' ? 'quotation'
      : type === 'receipt' ? 'receipt' : 'invoice';
  const canonicalPaymentEnabled = ['invoice','tax_invoice','cash_bill','quotation'].includes(type);
  const configuredUpiId = canonicalPaymentEnabled && paymentSettings?.payment_qr_enabled !== false
    ? paymentSettings?.upi_id || paymentSelection?.bank?.upi_id || paymentSelection?.bank?.metadata?.upi_id || paymentSelection?.bank?.metadata?.upiId || null
    : null;
  const configuredSettlementMode = paymentSettings?.settlement_display_mode || (configuredUpiId ? 'upi_qr' : paymentSelection?.bank ? 'bank_transfer' : 'none');
  const canonical = useMemo(() => createCanonicalDocumentViewModel({
    ...model,
    type: canonicalType,
    business: mergedBusiness,
    customer,
    items,
    bank: paymentSelection?.bank || {},
    customer_outstanding: type === 'receipt' ? customerBalance : undefined,
    balance_due: type === 'receipt' ? customerBalance : model.balance_due,
    upiId: configuredUpiId,
    payment_qr_payload: paymentSettings?.payment_qr_enabled === false ? null : model.payment_qr_payload,
    settlement_display_mode: configuredSettlementMode,
  }, {
    type: canonicalType,
    upiId: configuredUpiId,
    paymentQrEnabled: paymentSettings?.payment_qr_enabled !== false,
    settlementDisplayMode: configuredSettlementMode,
    prefillUpiAmount: preferences?.prefill_upi_amount !== false,
  }), [model, type, canonicalType, mergedBusiness, customer, items, paymentSelection, paymentSettings, preferences, configuredUpiId, configuredSettlementMode, customerBalance]);
  const canonicalPayload = useMemo(() => ({
    ...model,
    invoice_number: canonical.document.number,
    invoice_date: canonical.document.date,
    currency_code: canonical.document.currency,
    subtotal: canonical.financials.subtotal,
    discount_total: canonical.financials.totalDiscount,
    tax_total: Number(model.tax_total ?? canonical.financials.taxBreakdown.reduce((sum, row) => sum + row.amount, 0)),
    cgst_amount: canonical.financials.taxBreakdown.find(row => row.name === 'CGST')?.amount ?? model.cgst_amount,
    sgst_amount: canonical.financials.taxBreakdown.find(row => row.name === 'SGST')?.amount ?? model.sgst_amount,
    igst_amount: canonical.financials.taxBreakdown.find(row => row.name === 'IGST')?.amount ?? model.igst_amount,
    place_of_supply_state_code: model.place_of_supply_state_code,
    supply_type: model.supply_type,
    round_off_amount: canonical.financials.roundOff,
    amount_in_words: canonical.financials.amountInWords,
    total: canonical.financials.grandTotal,
    amount_paid: canonical.financials.amountPaid,
    balance_due: canonical.financials.balanceDue,
    payment_qr_payload: canonicalPaymentEnabled ? canonical.financials.upiQrString || model.payment_qr_payload : model.payment_qr_payload,
  }), [model, canonical]);
  useEffect(() => {
    let active = true;
    const upiId = text(paymentSettings?.payment_qr_enabled === false ? '' : (paymentSettings?.upi_id || paymentSelection?.bank?.upi_id || paymentSelection?.bank?.metadata?.upi_id || paymentSelection?.bank?.metadata?.upiId || ''));
    const currency = text(job?.payload?.currency_code || 'INR').trim() || 'INR';
    const source = {
      ...model,
      type: type === 'delivery_challan' ? 'challan' : type,
      business: mergedBusiness,
      customer: model.customer || model.party || model.vendor || {},
      bank: paymentSelection?.bank || {},
    };
    const canonical = createCanonicalDocumentViewModel(source, {
      type: type === 'delivery_challan' ? 'challan' : ['tax_invoice','cash_bill'].includes(type) ? 'invoice' : type as any,
      upiId,
      prefillUpiAmount: preferences?.prefill_upi_amount !== false,
    });
    const existing = paymentSettings?.payment_qr_enabled === false ? '' : text(paymentSelection?.payment_qr_payload || model.payment_qr_payload || job?.payload?.payment_qr_payload || '');
    const balanceDue = Math.max(0, Number(model.balance_due || 0));
    const invoiceTotal = Math.max(0, Number(model.total || 0));
    let dynamic = canonical.financials.upiQrString || '';
    if (!dynamic && upiId && type === 'cash_bill') {
      const params = new URLSearchParams({ pa: upiId, pn: text(mergedBusiness.name || mergedBusiness.legal_name || 'Business'), cu: currency });
      if (preferences?.prefill_upi_amount !== false) params.set('am', (balanceDue > 0 ? balanceDue : invoiceTotal).toFixed(2));
      dynamic = 'upi://pay?' + params.toString();
    }
    const value = paymentSettings?.payment_qr_enabled === false ? '' : dynamic || existing || text(paymentSelection?.payment_link || model.payment_link || job?.payload?.payment_link || '');
    if (!value) { setPaymentQrDataUrl(''); return () => { active = false; }; }
    QRCode.toDataURL(value, { width: 180, margin: 1, errorCorrectionLevel: 'M' }).then((url) => { if (active) setPaymentQrDataUrl(url); }).catch(() => { if (active) setPaymentQrDataUrl(''); });
    return () => { active = false; };
  }, [paymentSelection, job, paymentSettings, preferences, business, model, mergedBusiness, type, canonical, canonicalPaymentEnabled]);
  const canonicalBusiness = useMemo(() => ({
    ...mergedBusiness,
    name: canonical.business.tradeName || canonical.business.legalName,
    legal_name: canonical.business.legalName,
    address: canonical.business.address,
    phone: canonical.business.phone,
    email: canonical.business.email,
    tax_registration_number: canonical.business.gstin,
    logo_storage_path: mergedBusiness?.logo_storage_path || canonical.business.logoUrl,
    pan: canonical.business.pan,
  }), [mergedBusiness, canonical]);
  const canonicalCustomer = useMemo(() => ({
    ...customer,
    display_name: canonical.customer.name,
    legal_name: canonical.customer.name,
    billing_address: canonical.customer.billingAddress,
    shipping_address: canonical.customer.shippingAddress,
    phone: canonical.customer.phone,
    email: canonical.customer.email,
    tax_id: canonical.customer.gstin,
  }), [customer, canonical]);
  const canonicalItems = useMemo(() => canonical.items.map((item, index) => ({
    ...(items[index] || {}),
    name: item.name || (items[index] as any)?.name || (items[index] as any)?.item_name || item.description,
    description: item.description,
    detail: item.description,
    unit: item.unit || (items[index] as any)?.unit || 'pcs',
    quantity: item.quantity,
    unit_price: item.unitPrice,
    discount: item.discount,
    tax_rate: item.taxRate,
    line_total: item.amount,
    hsn_sac: item.hsn,
  })), [items, canonical]);
  const theme = THEMES[template?.template_key] || THEMES.modern;
  const fields = preferences?.custom_fields || {};
  const studioTheme = fields?.theme_studio || {};
  const documentTitleOverride = text(preferences?.document_title_override || '');
  const number = model.document_number || model.challan_number || model.bill_number || model.invoice_number || model.quotation_number || model.receipt_number || model.number || '';
  const title = type === 'receipt' ? 'Payment Receipt' : type === 'invoice' || type === 'tax_invoice' ? invoiceDocumentTitle(mergedBusiness) : type === 'cash_bill' ? 'Cash Bill' : type === 'quotation' ? 'QUOTATION' : type === 'delivery_challan' ? 'Delivery Challan' : type === 'purchase_order' ? 'Purchase Order' : type === 'credit_note' ? 'Credit Note' : type === 'debit_note' ? 'Debit Note' : 'Document';
  const documentStatus = text(model.status).trim().toLowerCase();
  const sentQuotationExpired = type === 'quotation' && documentStatus === 'sent' && Boolean(model.valid_until && String(model.valid_until).slice(0, 10) < new Date().toISOString().slice(0, 10));
  const documentStatusShareable = type === 'quotation'
    ? ['sent', 'accepted', 'converted'].includes(documentStatus) && !sentQuotationExpired
    : ['invoice', 'tax_invoice', 'cash_bill'].includes(type)
      ? ['sent', 'partially_paid', 'paid'].includes(documentStatus)
      : type === 'delivery_challan'
        ? !['draft', 'void', 'cancelled', 'deleted'].includes(documentStatus)
        : type === 'receipt';
  const canShareDocument = canSharePublicDocument(type) && documentStatusShareable;
  const logoUrl = mergedBusiness?.logo_storage_path ? supabase.storage.from('business-branding-public').getPublicUrl(mergedBusiness.logo_storage_path).data.publicUrl : '';
  const back = () => { if (type === 'invoice' && model.status === 'draft') { location.href = `/next-workspace/invoices/new?edit=${id}`; return; } history.back(); };
  const shareMessage = (publicUrl: string) => buildPublicDocumentShareMessage({
    documentType: type,
    businessName: text(mergedBusiness.name || mergedBusiness.legal_name || 'Business'),
    customerName: text(customer.legal_name || customer.display_name || customer.name || 'Customer'),
    documentNumber: text(number),
    documentDate: text(model.invoice_date || model.quotation_date || model.challan_date || model.receipt_date || model.date || ''),
    totalAmount: Number(model.total ?? model.amount ?? 0),
    ...(type === 'invoice' || type === 'tax_invoice' || type === 'cash_bill' ? { balanceDue: Number(model.balance_due ?? 0) } : {}),
    currencyCode: text(model.currency_code || 'INR'),
    publicUrl,
  });
  const toast = {
    success: (message: string) => {
      setToastMessage(message);
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
      toastTimer.current = window.setTimeout(() => setToastMessage(''), 3000);
    },
  };
  const copyLink = async () => {
    try {
      const publicUrl = await getPublicDocumentUrl(type, id);
      await copyTextToClipboard(publicUrl);
      setNotice('');
      setShareOptions(null);
      setIsCopied(true);
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setIsCopied(false), 2500);
      toast.success('Customer link copied to clipboard!');
    } catch (error) {
      setIsCopied(false);
      setNotice(error instanceof Error ? error.message : 'Unable to create a public customer link.');
    }
  };
  const share = async () => {
    if (shareOptions) { setShareOptions(null); return; }
    try {
      const publicUrl = await getPublicDocumentUrl(type, id);
      const message = shareMessage(publicUrl);
      const shareTitle = title + ' ' + number;
      if (typeof navigator.share === 'function') {
        try {
          await navigator.share({ title: shareTitle, text: message, url: publicUrl });
          setShareOptions(null);
          return;
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') return;
          // Native sharing may exist but be unavailable in this browsing context; expose explicit fallbacks.
        }
      }
      try {
        await copyTextToClipboard(message);
        setIsCopied(true);
        if (copyTimer.current) window.clearTimeout(copyTimer.current);
        copyTimer.current = window.setTimeout(() => setIsCopied(false), 2500);
        setNotice('');
        setShareOptions(null);
        toast.success('Customer link copied to clipboard!');
        return;
      } catch {
        // Keep the explicit share popover as a fallback when clipboard access is unavailable.
      }
      setNotice('');
      setShareOptions({ url: publicUrl, message, title: shareTitle });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Unable to share this document publicly.');
    }
  };
  const copyShareMessage = async () => {
    if (!shareOptions) return;
    try {
      await copyTextToClipboard(shareOptions.message);
      setShareOptions(null);
      setNotice('');
      toast.success('Share message copied to clipboard!');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Unable to copy the share message.');
    }
  };
  const print = () => {
    const paper = document.querySelector('.paper') as HTMLElement | null;
    if (!paper) return;
    const receipt = paper.classList.contains('receipt-paper');
    const cashBill = paper.classList.contains('cash-bill-paper');
    const thermal58 = paper.classList.contains('cash-bill-thermal58');
    const thermal80 = paper.classList.contains('cash-bill-thermal80');
    const cashBillA5 = paper.classList.contains('cash-bill-a5');
    const frame = document.createElement('iframe');
    const printWidth = thermal58 ? '58mm' : thermal80 ? '80mm' : cashBillA5 ? '148mm' : receipt ? '80mm' : '210mm';
    frame.style.cssText = receipt ? 'position:fixed;left:-10000px;top:0;width:302px;height:1200px;border:0;visibility:hidden;' : cashBill ? 'position:fixed;left:-10000px;top:0;width:420px;height:1200px;border:0;visibility:hidden;' : 'position:fixed;left:-10000px;top:0;width:794px;height:1123px;border:0;visibility:hidden;';
    document.body.appendChild(frame);
    const doc = frame.contentDocument;
    if (!doc) { frame.remove(); return; }
    doc.open();
    // Component-scoped invoice styles may be emitted outside <head>; include every style node in the print document.
    const styles = Array.from(document.querySelectorAll('style')).map((style) => style.textContent || '').join('');
    const links = Array.from(document.head.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'))
      .map((link) => `<link rel="stylesheet" href="${link.href}">`).join('');
    const filenamePart = (value: unknown, fallback: string) => String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 80) || fallback;
    const printFilename = [filenamePart(title, 'Document'), filenamePart(mergedBusiness?.name || mergedBusiness?.legal_name, 'Business'), filenamePart(number, 'Document')].join('-');
    doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${printFilename}</title>${links}<style>${styles}
      @page { size: ${thermal58 || thermal80 || receipt ? `${printWidth} auto` : cashBillA5 ? '148mm 210mm' : '210mm 297mm'}; margin:0; }
      html,body { margin:0!important; padding:0!important; background:#fff!important; }
      .page { padding:0!important; background:#fff!important; }
      .paper { margin:0!important; box-shadow:none!important; }
      ${receipt ? '.receipt-paper{width:80mm!important;max-width:80mm!important;min-height:0!important;}' : cashBillA5 ? '.cash-bill-paper{width:148mm!important;min-width:148mm!important;max-width:148mm!important;}' : thermal58 ? '.cash-bill-paper{width:58mm!important;min-width:58mm!important;max-width:58mm!important;padding:0!important;}' : thermal80 ? '.cash-bill-paper{width:80mm!important;min-width:80mm!important;max-width:80mm!important;padding:0!important;}' : '.paper:not(.receipt-paper){width:210mm!important;min-width:210mm!important;max-width:210mm!important;}' }
      .paper:not(.receipt-paper) .items th,.paper:not(.receipt-paper) .items td,.paper:not(.receipt-paper) .parties span,.paper:not(.receipt-paper) .parties strong,.paper:not(.receipt-paper) footer{font-size:12px!important}
      .paper:not(.receipt-paper) .payment-combined{display:grid!important;grid-template-columns:minmax(0,1fr) minmax(0,1fr)!important;gap:20px!important;}
      .paper:not(.receipt-paper) .bank-payment-column{padding-right:20px!important;border-right:1px solid var(--line)!important;min-width:0!important;}
      .paper:not(.receipt-paper) .online-payment-column{min-width:0!important;display:flex!important;justify-content:space-between!important;align-items:center!important;gap:16px!important;}
      .paper:not(.receipt-paper) .qr{width:88px!important;height:88px!important;display:flex!important;align-items:center!important;justify-content:center!important;flex-direction:column!important;}
      .paper:not(.receipt-paper) .qr img{width:68px!important;height:68px!important;object-fit:contain!important;}
    </style></head><body>${paper.outerHTML}</body></html>`);
    doc.close();
    const stylesheetReady = Array.from(doc.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')).map((link) => new Promise<void>((resolve) => {
      if (link.sheet) { resolve(); return; }
      const done = () => resolve();
      link.addEventListener('load', done, { once: true });
      link.addEventListener('error', done, { once: true });
      window.setTimeout(done, 3000);
    }));
    const printWhenReady = async () => {
      await Promise.all(stylesheetReady);
      try { if (doc.fonts?.ready) await doc.fonts.ready; } catch {}
      const images = Array.from(doc.images);
      await Promise.all(images.map((img) => img.complete ? Promise.resolve() : new Promise<void>((resolve) => { img.addEventListener('load', () => resolve(), { once: true }); img.addEventListener('error', () => resolve(), { once: true }); })));
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
      setTimeout(() => frame.remove(), 1000);
    };
    setTimeout(() => { void printWhenReady(); }, 350);
  };
  if (loading) return <div className="center">Preparing document…</div>;
  if (error) return <div className="center error">{error}</div>;
  return <main className="page"><div className="toolbar"><div><small>DOCUMENT CENTER</small><h1>{title} {number}</h1><p>{template?.template_name || theme.label} · Print-ready</p></div><div className="actions">{type==='cash_bill'&&<select aria-label="Cash Bill print format" value={cashBillFormat} onChange={e=>setCashBillFormat(e.target.value as typeof cashBillFormat)}><option value="a4">A4 Modern</option><option value="a5">A5 Modern</option><option value="thermal80">Thermal 80mm</option><option value="thermal58">Thermal 58mm</option></select>}<button type="button" onClick={back} className="inline-flex items-center justify-center gap-1.5 rounded-full border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-2"><svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>Back</button>{canShareDocument && <button type="button" onClick={copyLink} aria-live="polite" className="inline-flex items-center justify-center gap-1.5 rounded-full border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-2">{isCopied ? <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 text-emerald-600" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 4 4L19 6"/></svg> : <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg>}{isCopied ? 'Copied!' : 'Copy customer link'}</button>}{canShareDocument && <div className="relative inline-flex">
        <button type="button" onClick={share} aria-expanded={Boolean(shareOptions)} aria-haspopup="dialog" className="inline-flex items-center justify-center gap-1.5 rounded-full border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-2">
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 text-slate-500" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.6 6.8-4.2M8.6 13.4l6.8 4.2"/></svg>
          Share link
        </button>
        {shareOptions && <div role="dialog" aria-label="Share public customer link" className="absolute right-0 top-full z-50 mt-2 w-64 rounded-xl border border-slate-200 bg-white p-3 shadow-xl">
          <p className="px-1 pb-2 text-xs font-bold uppercase tracking-wider text-slate-500">Share public link</p>
          <div className="grid gap-1">
            <a href={'https://wa.me/?text=' + encodeURIComponent(shareOptions.message)} target="_blank" rel="noreferrer" onClick={() => setShareOptions(null)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              <span className="inline-grid h-6 w-6 place-items-center rounded-full bg-green-100 text-xs font-extrabold text-green-700">W</span> WhatsApp
            </a>
            <a href={'mailto:?subject=' + encodeURIComponent(shareOptions.title) + '&body=' + encodeURIComponent(shareOptions.message)} onClick={() => setShareOptions(null)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              <span className="inline-grid h-6 w-6 place-items-center rounded-full bg-slate-100 text-sm font-extrabold text-slate-700">@</span> Email
            </a>
            <button type="button" onClick={copyShareMessage} className="flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-50">
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 text-slate-500" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg> Copy message
            </button>
          </div>
          <p className="mt-2 break-all border-t border-slate-100 px-1 pt-2 text-[11px] leading-4 text-slate-500">{shareOptions.url}</p>
        </div>}
      </div>}<button type="button" onClick={print} className="inline-flex items-center justify-center gap-1.5 rounded-full bg-purple-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-purple-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-2"><svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v7H6z"/></svg>Print / Save PDF</button></div></div>
    {toastMessage && <div role="status" aria-live="polite" className="fixed right-5 top-5 z-[100] flex items-center gap-2 rounded-xl border border-emerald-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 shadow-lg"><svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 text-emerald-600" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 4 4L19 6"/></svg>{toastMessage}</div>}
    <Paper type={type} payload={canonicalPayload} business={canonicalBusiness} customer={canonicalCustomer} items={canonicalItems} theme={theme} fields={fields} logoUrl={logoUrl} paymentSelection={paymentSelection} paymentQrDataUrl={paymentQrDataUrl} upiIntentUrl={canonicalPaymentEnabled ? canonical.financials.upiQrString || '' : ''}
      showLogo={preferences?.show_logo !== false} showBusinessAddress={preferences?.show_business_address !== false} showTaxDetails={preferences?.show_tax_details !== false}
      settlementDisplayMode={canonical.settlementDisplayMode}
      showBankDetails={canonical.settlementDisplayMode === 'bank_transfer' || canonical.settlementDisplayMode === 'both'}
      showPaymentLink={false}
      showPaymentQr={paymentSettings?.payment_qr_enabled !== false && (canonical.settlementDisplayMode === 'upi_qr' || canonical.settlementDisplayMode === 'both')}
      showSignature={preferences?.show_signature === true || preferences?.show_authorized_signatory === true || type === 'invoice' || type === 'tax_invoice' || type === 'quotation'} showTerms={preferences?.show_terms !== false}
      showCustomerBalance={preferences?.show_customer_balance === true && !['delivery_challan','purchase_order'].includes(type)} customerBalance={customerBalance} showAuthorizedSignatory={preferences?.show_authorized_signatory === true || type === 'invoice' || type === 'tax_invoice' || type === 'quotation'}
      minItemRows={Number(preferences?.min_item_rows || 0)} showSerialNumbers={preferences?.show_serial_numbers === true} documentTitleOverride={documentTitleOverride} studioTheme={studioTheme} taxLines={taxLines} receiptAllocations={receiptAllocations} originalInvoice={originalInvoice} cashBillFormat={cashBillFormat} />
    <style jsx global>{`.sales-document-standard{--accent:#7c3aed!important;--table:#7c3aed!important;--line:#e2e8f0!important}.sales-document-standard .items thead,.sales-document-standard .items th{background:#7c3aed!important;color:#fff!important}.sales-document-standard .items th{border-color:#7c3aed!important}.sales-document-standard .items td{border-bottom-color:#f1f5f9!important}.sales-six-column{width:100%;table-layout:fixed;border-collapse:collapse}.sales-six-column th,.sales-six-column td{padding:10px 8px;vertical-align:top}.sales-six-column th:nth-child(1),.sales-six-column td:nth-child(1){width:30px;text-align:center}.sales-six-column th:nth-child(2),.sales-six-column td:nth-child(2){text-align:left}.sales-six-column th:nth-child(3),.sales-six-column td:nth-child(3){width:58px;text-align:center}.sales-six-column th:nth-child(4),.sales-six-column td:nth-child(4){width:58px;text-align:center}.sales-six-column th:nth-child(5),.sales-six-column td:nth-child(5){width:100px;text-align:right}.sales-six-column th:nth-child(6),.sales-six-column td:nth-child(6){width:105px;text-align:right}.sales-six-column .col-unit{text-transform:uppercase;font-size:10px;font-weight:600;color:#64748b}.sales-six-column .sales-item-copy strong{display:block;font-weight:600;color:#0f172a;font-size:13px}.sales-six-column .sales-item-copy .muted{margin-top:2px;white-space:pre-line;color:#64748b;font-size:11px;font-weight:400}.identity-main{display:flex;align-items:center;gap:14px}.business-brand-copy{min-width:0}.business-brand-copy>strong{display:block;font-size:22px;line-height:1.08;letter-spacing:-.02em;color:#111827}.business-brand-copy .legal-name{margin-top:3px;font-size:10px;font-weight:600;color:#475569}.business-brand-copy .sub{margin-top:3px;font-size:10px;color:#64748b}.business-address{margin-top:9px;font-size:10.5px;line-height:1.45;color:#475569}.business-address span{display:block}.business-contact{margin-top:6px;display:flex;gap:8px;flex-wrap:wrap;font-size:9.5px;color:#475569}.business-contact span+span{border-left:1px solid #cbd5e1;padding-left:8px}.business-contact-person{margin-top:6px;font-size:9.5px;font-weight:700;color:#334155}.business-gstin{margin-top:7px;font-size:10px;font-weight:800;color:var(--accent)}.document-header{display:grid;grid-template-columns:minmax(0,1fr) 235px;gap:28px;padding-bottom:20px;border-bottom:2px solid var(--accent);align-items:start}.identity-column{min-width:0}.invoice-heading{text-align:right}.document-title{font-size:28px;line-height:1.05;font-weight:900;letter-spacing:.04em;text-transform:uppercase;color:var(--accent)}.document-meta{margin-top:12px;border:1px solid var(--line);border-radius:14px;overflow:hidden;background:#fbfcfe}.meta-row{display:flex;justify-content:space-between;gap:12px;padding:7px 11px;font-size:10.5px;border-bottom:1px solid #e9edf2}.meta-row:last-child{border-bottom:0}.meta-row span{color:#64748b}.meta-row strong{color:#172033;font-weight:800;text-align:right}.parties-grid{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr) minmax(0,.82fr);gap:12px;margin:18px 0 20px}.party-card,.tax-context{border:1px solid #e5e7eb;border-radius:14px;padding:13px 14px;background:#fff;min-width:0}.party-card label,.tax-context label,.document-notes label,.document-terms label,.bank-details label{display:block;font-size:9px;font-weight:900;letter-spacing:.15em;color:var(--accent);margin-bottom:7px}.party-card strong{display:block;font-size:13px;color:#111827;margin-bottom:4px}.party-card>div{font-size:10.5px;line-height:1.45;color:#475569}.party-highlight{font-weight:800!important;color:var(--accent)!important;margin:4px 0}.tax-context{background:#f8fafc}.tax-context>div{display:flex;justify-content:space-between;gap:10px;padding:4px 0;font-size:10px;border-bottom:1px dashed #dbe2ea}.tax-context>div:last-child{border-bottom:0}.tax-context span{color:#64748b}.tax-context strong{text-align:right;color:#172033}.items{width:100%;border-collapse:separate;border-spacing:0;table-layout:fixed;border:1px solid #dfe5ec;border-radius:14px;overflow:hidden}.items thead{background:var(--table);color:#fff}.items th{padding:var(--row-padding,9px) 8px;font-size:9.5px;text-transform:uppercase;letter-spacing:.06em;text-align:left;font-weight:900;border-bottom:1px solid var(--table)}.items td{padding:var(--row-padding,9px) 8px;font-size:10.5px;border-bottom:1px solid #e9edf2;vertical-align:top;color:#273244}.items tbody tr:last-child td{border-bottom:0}.items th:not(:nth-child(2)),.items td:not(:nth-child(2)){text-align:right}.items th:nth-child(2),.items td:nth-child(2){text-align:left}.items .col-no{width:32px;text-align:center!important}.items .col-type{width:62px;text-align:center!important}.items .col-qty{width:42px}.items .col-rate{width:76px}.items .col-taxable{width:82px}.items .col-tax{width:72px}.items .col-amount{width:88px}.items .col-tax small,.items .line-discount,.items .qty-unit{display:block;margin-top:2px;font-size:8px;opacity:.72}.items .qty-unit{font-size:8px;text-transform:lowercase}.tax-aware-items th:nth-child(3),.tax-aware-items td:nth-child(3){text-align:center}.items td strong{display:block;color:#111827;font-size:10.5px}.items .muted{margin-top:2px;color:#64748b;font-size:9px;line-height:1.35}.items .item-meta{margin-top:2px;color:#94a3b8;font-size:8px}.post-table-grid{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:28px;margin-top:18px;align-items:start}.invoice-notes-area{min-width:0}.document-notes,.document-terms{border-left:3px solid var(--accent);padding:9px 0 9px 12px;margin-bottom:12px;background:#fbfcfe}.document-notes p,.document-terms p{margin:0;white-space:pre-wrap;font-size:10.5px;line-height:1.5;color:#475569}.compliance-note{font-size:9px;line-height:1.4;color:#64748b;padding-top:6px}.document-summary{width:100%;margin-left:auto;border-top:2px solid var(--accent);padding-top:9px;font-size:11px}.document-summary>div{display:flex;justify-content:space-between;gap:20px;padding:4px 0}.document-summary .summary-total{margin-top:5px;padding:9px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line);font-size:16px}.document-summary .balance-due{color:#b91c1c;font-weight:800}.document-summary .balance-paid{color:#047857;font-weight:800}.document-summary .amount-words{display:block;margin-top:10px;padding:9px 10px;border:1px dashed #cbd5e1;border-radius:10px;background:#f8fafc}.document-summary .amount-words span{display:block;font-size:8.5px;font-weight:900;letter-spacing:.11em;text-transform:uppercase;color:#64748b;margin-bottom:3px}.document-summary .amount-words strong{display:block;font-size:9.5px;line-height:1.45;color:#334155}.payment{margin-top:18px;border:1px solid var(--line);border-radius:14px;padding:15px 16px;background:#fafaff}.payment-combined{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:18px}.payment-combined .bank-payment-column{padding-right:18px;border-right:1px solid var(--line)}.bank-details strong{display:block;font-size:12px;color:#111827;margin-bottom:2px}.bank-details span,.bank-details div{display:block;font-size:9.5px;line-height:1.45;color:#475569}.online-payment-column>div{display:grid;grid-template-columns:minmax(0,1fr) 96px;gap:12px;align-items:center}.online-payment-column label{display:block;font-size:9px;font-weight:900;letter-spacing:.15em;color:var(--accent)}.online-payment-column strong{display:block;margin-top:3px;font-size:13px;color:#111827}.online-payment-column span{display:block;margin-top:4px;font-size:9.5px;color:#64748b}.online-payment-column a{display:inline-block;margin-top:8px;padding:7px 12px;border-radius:8px;background:var(--accent);color:#fff;text-decoration:none;font-size:9.5px;font-weight:800}.qr{display:grid;place-items:center;width:92px;height:92px;border:1px solid #e5e7eb;border-radius:10px;background:#fff}.qr img{width:78px;height:78px;object-fit:contain}.signature-row{display:flex;justify-content:flex-end;margin-top:26px;min-height:54px}.signature-box{width:190px;border-top:1px solid #475569;text-align:center;padding-top:7px}.signature-box span{display:block;font-size:9px;font-weight:800;color:#334155}.customer-balance-footer{display:flex;justify-content:space-between;gap:12px;margin-top:12px;padding:8px 10px;border-top:1px solid var(--line);border-bottom:1px dashed var(--line);font-size:9.5px}.customer-balance-footer span{color:#64748b}.customer-balance-footer strong{color:var(--accent)}.signature-box em{display:block;margin-top:2px;font-size:8px;color:#64748b;font-style:normal}.paper>footer{display:flex;justify-content:space-between;gap:20px;margin-top:22px;padding-top:10px;border-top:1px solid #e5e7eb;font-size:8.5px;color:#64748b}.platform{margin-top:5px;display:flex;align-items:center;justify-content:center;gap:5px;text-align:center;font-size:7.5px;color:#94a3b8}.platform-mark{display:inline-grid;place-items:center;width:13px;height:13px;border-radius:4px;background:var(--accent);color:#fff;font-size:8px;font-weight:900;line-height:1}.platform strong{color:var(--accent);font-weight:800}@media(max-width:860px){.toolbar{align-items:flex-start;flex-direction:column}.actions{width:100%;justify-content:flex-start}.paper,.receipt-paper{width:100%;min-height:auto}.document-header{grid-template-columns:1fr}.invoice-heading{text-align:left}.parties-grid{grid-template-columns:1fr}.post-table-grid{grid-template-columns:1fr}.payment-combined{grid-template-columns:1fr}.payment-combined .bank-payment-column{padding-right:0;border-right:0;border-bottom:1px solid var(--line);padding-bottom:14px}.online-payment-column>div{grid-template-columns:1fr 88px}.paper{padding:28px 22px}.template-premium,.template-classic,.template-minimal,.template-professional{padding:28px 22px}}@media print{.page{padding:0!important;background:#fff!important}.toolbar{display:none!important}.paper{margin:0!important;box-shadow:none!important;width:210mm!important;min-width:210mm!important;max-width:210mm!important;min-height:0!important;padding:12mm 13mm 10mm!important}.receipt-paper{width:80mm!important;min-width:80mm!important;max-width:80mm!important;padding:0 0 5mm!important}.items{page-break-inside:auto}.items thead{display:table-header-group}.items tr{break-inside:avoid;page-break-inside:avoid}.party-card,.tax-context,.post-table-grid,.payment,.signature-row{break-inside:avoid;page-break-inside:avoid}.document-notes,.document-terms{break-inside:avoid;page-break-inside:avoid}.paper>footer,.platform{break-inside:avoid;page-break-inside:avoid}.platform{display:flex!important}@page{size:A4 portrait;margin:0}}*{box-sizing:border-box}.page{min-height:100vh;background:#eef1f6;padding:28px 18px}.toolbar{max-width:794px;margin:0 auto 18px;display:flex;justify-content:space-between;align-items:center}.actions{display:flex;gap:8px;flex-wrap:wrap}.paper{width:794px;min-height:1123px;margin:0 auto;background:var(--paper-bg,#fff);color:var(--paper-text,#172033);padding:42px 48px 34px;box-shadow:0 14px 45px rgba(15,23,42,.12);font:14px/1.45 Arial,sans-serif;border-radius:var(--paper-radius,14px);--accent:#6d28d9;--table:#6d28d9;--line:#ddd6fe}.template-classic{--accent:#7f1d1d;--table:#7f1d1d;--line:#d6d3d1;padding:44px 50px 36px}.template-minimal{--accent:#111827;--table:#f1f5f9;--line:#cbd5e1;padding:46px 54px 40px}.template-modern{--accent:#6d28d9!important;--table:#6d28d9!important;--line:#ddd6fe!important}.template-premium{--accent:#4c1d95;--table:#312e81;--line:#d8b4fe;padding:38px 48px 40px;position:relative;overflow:hidden;background:linear-gradient(180deg,#ffffff 0%,#f7f1ff 100%)}.template-professional{--accent:#0f3b66;--table:#123f6b;--line:#cbd5e1;padding:40px 46px 34px}.receipt-paper{width:640px;min-height:auto;padding:0 0 18px}.receipt-head{text-align:center;padding:28px 46px 18px;border-bottom:1px solid var(--line)}.document-summary-wrap{display:flex;justify-content:flex-end;margin-top:18px}.document-summary,.receipt-summary{width:320px;margin-left:auto;border-top:1px solid var(--line);padding-top:10px;font-size:13px}.document-summary>div,.receipt-summary>div{display:flex;justify-content:space-between;gap:20px;padding:3px 0}.document-summary .summary-total{margin-top:6px;padding-top:8px;border-top:2px solid var(--line);font-size:16px}.receipt-summary{width:auto;margin:18px 46px 0;padding-top:10px}.receipt-summary>div{font-size:13px}.document-summary strong,.receipt-summary strong{font-weight:700}@media(max-width:860px){.toolbar{align-items:flex-start;flex-direction:column}.actions{width:100%;justify-content:flex-start}.paper,.receipt-paper{width:100%;min-height:auto}}@media print{.page{padding:0!important;background:#fff!important}.toolbar,.notice{display:none!important}.paper{margin:0!important;box-shadow:none!important}}.receipt-head{display:flex;flex-direction:column;align-items:center;text-align:center;padding:18px 10px 12px;border-bottom:1px solid var(--line)}.receipt-head .logo{width:72px;height:52px;border:0;background:transparent}.receipt-head .logo img{width:68px;height:48px;max-width:68px;max-height:48px;object-fit:contain}.receipt-business-details{margin-top:4px;display:flex;flex-direction:column;align-items:center;gap:2px;text-align:center;color:#475569;font-size:8.5px;line-height:1.3}.receipt-business-details strong{font-size:11px;color:#111827;font-weight:800}.receipt-business-details span{display:block}.receipt-date{margin-top:7px;font-size:10px;color:#64748b}.receipt-status{padding:12px 10px 4px}.receipt-status-badge{display:block;width:100%;padding:7px 8px;border:1px solid var(--line);border-radius:8px;text-align:center;font-size:11px;font-weight:900;letter-spacing:.08em;text-transform:uppercase;color:var(--accent);background:#fff}.receipt-status-badge.paid{color:#047857;border-color:#a7f3d0;background:#ecfdf5}.receipt-status-badge.partially-paid{color:#b45309;border-color:#fde68a;background:#fffbeb}.receipt-status-badge.unpaid{color:#b91c1c;border-color:#fecaca;background:#fef2f2}.receipt-balance{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:7px;padding:7px 0;border-bottom:1px dashed #dbe2ea;font-size:10px}.receipt-balance span{color:#64748b}.receipt-balance strong{color:#111827}.receipt-customer{margin:12px 10px 10px;padding:0 0 10px;border-bottom:1px solid #e5e7eb;text-align:left}.receipt-customer .label{display:block;margin-bottom:4px;font-size:8px;font-weight:900;letter-spacing:.13em;color:var(--accent)}.receipt-customer strong{display:block;font-size:12px;color:#111827}.receipt-customer>div{margin-top:3px;font-size:9.5px;color:#64748b}.receipt-items-section{margin:0 10px}.receipt-items{width:100%;border:0;border-radius:0;table-layout:fixed}.receipt-items thead{background:transparent;color:#64748b}.receipt-items th{padding:7px 0;border-bottom:1px solid #dbe2ea;background:transparent;color:#64748b;font-size:8px;letter-spacing:.08em}.receipt-items th:first-child{text-align:left!important}.receipt-items th.col-qty{text-align:center!important;width:38px}.receipt-items th.col-amount{text-align:right!important;width:78px}.receipt-items td{padding:7px 0;border-bottom:1px dotted #dbe2ea;font-size:9.5px;color:#273244}.receipt-items td:first-child{text-align:left!important;padding-right:8px}.receipt-items td.col-qty{text-align:center!important}.receipt-items td.col-amount{text-align:right!important;font-weight:700}.receipt-items td strong{font-size:9.5px}.receipt-total{display:flex;justify-content:space-between;gap:10px;margin:12px 10px 0;padding:9px 0;border-top:2px solid var(--accent);border-bottom:1px solid var(--line);font-size:11px;font-weight:800}.receipt-total strong{font-size:13px}.receipt-thanks{text-align:center;margin:14px 10px 10px;font-size:11px;font-weight:700;color:#334155}.receipt-footer{text-align:center;margin:0 10px;padding:8px 0 2px;border-top:1px solid #e5e7eb;font-size:8px;color:#94a3b8}.receipt-footer .platform{margin-top:0}.receipt-footer strong{color:var(--accent);font-size:9px}.receipt-paper .receipt-items tr{break-inside:avoid;page-break-inside:avoid}.receipt-paper .receipt-total,.receipt-paper .receipt-thanks,.receipt-paper .receipt-footer{break-inside:avoid;page-break-inside:avoid}@media print{.receipt-paper{width:80mm!important;max-width:80mm!important;padding:0 0 5mm!important}.receipt-paper .receipt-head{padding-left:8px!important;padding-right:8px!important}.receipt-paper .receipt-customer,.receipt-paper .receipt-items-section,.receipt-paper .receipt-total,.receipt-paper .receipt-thanks,.receipt-paper .receipt-footer{margin-left:8px!important;margin-right:8px!important}.receipt-paper .receipt-items-section{width:calc(100% - 16px)!important}.receipt-paper .receipt-items{width:100%!important}.receipt-paper .platform{display:flex!important}}
.print-compliance{margin:16px 0;border:1px solid var(--line);border-radius:12px;background:#f8fafc;padding:10px 12px;color:#172033}.print-copy-badge{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:8px}.print-copy-badge strong{font-size:16px;letter-spacing:.08em;color:var(--accent)}.print-copy-badge span{font-size:9px;font-weight:800;color:#475569;text-transform:uppercase;letter-spacing:.08em}.print-compliance-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px 14px}.print-compliance-grid>div,.receipt-settlement>div,.logistics-strip>div,.cash-bill-meta>div{display:flex;justify-content:space-between;gap:8px;font-size:9px}.print-compliance-grid span,.receipt-settlement span,.logistics-strip span,.cash-bill-meta span{color:#64748b}.print-compliance-grid strong,.receipt-settlement strong,.logistics-strip strong,.cash-bill-meta strong{color:#172033;text-align:right}.print-einvoice-strip{margin-top:8px;padding-top:8px;border-top:1px dashed #cbd5e1}.print-einvoice-strip div{display:flex;gap:10px;font-size:8px}.print-einvoice-strip span{font-weight:800;color:#475569;min-width:125px}.print-einvoice-strip code{word-break:break-all;color:#334155}.print-statutory-banner{margin:14px 0;padding:10px 12px;border:1px solid var(--accent);border-radius:10px;text-align:center;font-size:9px;font-weight:900;letter-spacing:.04em;text-transform:uppercase;background:#fff}.delivery-address-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:12px 0}.delivery-address-grid>div{border:1px solid #e5e7eb;border-radius:10px;padding:10px;background:#fff}.delivery-address-grid label{display:block;font-size:8px;font-weight:900;letter-spacing:.12em;color:var(--accent);margin-bottom:5px}.delivery-address-grid p{margin:0;font-size:9.5px;white-space:pre-wrap;color:#475569}.print-procurement-note{margin:12px 0;padding:10px;border-top:2px solid var(--accent);border-bottom:1px dashed #cbd5e1;font-size:8.5px;font-weight:700;color:#334155}.print-tax-summary{margin:16px 0}.print-section-title{margin-bottom:7px;font-size:9px;font-weight:900;letter-spacing:.12em;text-transform:uppercase;color:var(--accent)}.print-tax-summary table,.receipt-allocation table{width:100%;border-collapse:collapse;font-size:8.5px}.print-tax-summary th,.print-tax-summary td,.receipt-allocation th,.receipt-allocation td{padding:6px 5px;border:1px solid #e2e8f0;text-align:right}.print-tax-summary th:first-child,.print-tax-summary td:first-child,.receipt-allocation th:first-child,.receipt-allocation td:first-child{text-align:left}.print-tax-summary th,.receipt-allocation th{background:var(--table);color:#fff;font-weight:800}.receipt-settlement{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px 12px;margin:12px 10px}.receipt-acknowledgment{margin:10px;border:1px solid var(--line);border-left:3px solid var(--accent);border-radius:8px;padding:8px 10px;font-size:9px;background:#f8fafc}.receipt-acknowledgment span{display:block;margin-top:3px;color:#64748b}.receipt-allocation{margin:10px}.receipt-allocation .muted{font-size:8.5px;color:#64748b}.cash-bill-paper{position:relative}.cash-bill-watermark{position:absolute;top:110px;right:58px;border:2px solid #047857;color:#047857;opacity:.12;padding:8px 14px;font-size:26px;font-weight:900;letter-spacing:.1em;transform:rotate(-10deg)}.cash-bill-meta{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:14px 0;padding:10px;border:1px solid #bbf7d0;border-radius:10px;background:#f0fdf4}.cash-paid-watermark{grid-column:1/-1;text-align:center;font-size:11px;font-weight:900;letter-spacing:.16em;color:#047857}.cash-bill-footer{display:flex;justify-content:space-between;gap:12px;margin-top:18px;padding:10px;border-top:2px solid var(--accent);font-size:9px}.cash-thermal{width:100%;padding:12px 8px;text-align:center;font-size:8px;line-height:1.35}.cash-thermal-brand{font-size:14px;font-weight:900}.cash-thermal-rule{border-top:1px dashed #64748b;margin:8px 0}.cash-item{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:5px;text-align:left;padding:3px 0;border-bottom:1px dotted #cbd5e1}.cash-item span:nth-child(2){text-align:right;white-space:nowrap}.cash-item strong{text-align:right;white-space:nowrap}.cash-thermal-total{display:flex;justify-content:space-between;padding:8px 0;font-size:10px;font-weight:900;border-top:2px solid #111827;border-bottom:1px solid #111827;margin:6px 0}.cash-thermal-qr{width:112px;height:112px;object-fit:contain;margin:9px auto}.cash-thermal-thanks{margin-top:10px;font-size:10px;font-weight:900}@media print{.print-compliance,.print-tax-summary,.receipt-allocation,.receipt-acknowledgment,.delivery-address-grid,.print-procurement-note,.print-statutory-banner{break-inside:avoid;page-break-inside:avoid}.cash-bill-modern{min-height:0}.cash-bill-thermal{font-size:8px}.cash-bill-thermal58{width:58mm!important}.cash-bill-thermal80{width:80mm!important}.cash-bill-a5{width:148mm!important}}`}</style>
  </main>;
}