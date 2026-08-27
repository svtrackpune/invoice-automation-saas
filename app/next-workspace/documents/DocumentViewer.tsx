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
const taxLabel = (party: any) => /gst/i.test(text(party?.tax_type || party?.tax_mode)) ? 'GST' : 'Tax ID';
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
function BusinessIdentity({ business, logoUrl, fields }: { business: any; logoUrl: string; fields: any }) { return <div className="business-identity"><Logo url={logoUrl} /><div className="business-brand-copy"><strong>{text(business.name || business.legal_name || '')}</strong><div className="sub">{text(fields.subtitle || business.business_type || '')}</div></div></div>; }

function LineItems({ items, payload, receipt }: { items: any[]; payload: any; receipt: boolean }) {
  const taxed = !receipt && Number(payload.tax_total) > 0;
  return <table className={`items ${receipt ? 'receipt-items' : ''}`}><thead><tr><th>{receipt ? 'Description' : 'Item / Description'}</th>{!receipt && <th>Type</th>}<th>Qty</th><th>Rate</th>{taxed && <th>Tax</th>}<th>Amount</th></tr></thead><tbody>{(items || []).map((it:any, idx:number)=>(<tr key={idx}><td><strong>{text(it.name || it.description)}</strong>{it.description && <div className="muted">{text(it.description)}</div>}</td>{!receipt && <td>{text(it.item_type || it.type || '')}</td>}<td>{text(it.quantity || it.qty || 1)}</td><td>{money(it.unit_price || it.rate || it.price)}</td>{taxed && <td>{it.tax_rate?`${it.tax_rate}%`:'—'}</td>}<td>{money(it.line_total || (Number(it.quantity || 0) * Number(it.unit_price || it.rate || 0)))}</td></tr>))}</tbody></table>;
}

function InvoiceTotals({ payload, total, balance }: { payload: any; total: number; balance: number }) {
  // Build a typed array of unique tax rates (numbers) to avoid TypeScript inferring unknown from Set
  const ratesArray: number[] = (payload.items || []).map((x: any) => Number(x.tax_rate || 0)).filter((x: number) => x > 0);
  const rates: number[] = Array.from(new Set<number>(ratesArray)).sort((a: number, b: number) => a - b);

  // Calculate tax totals per rate without changing existing calculation logic
  const taxTotals = rates.map((rate) => {
    const itemsForRate = (payload.items || []).filter((x: any) => Number(x.tax_rate || 0) === rate);
    const tax = itemsForRate.reduce((sum: number, it: any) => {
      const lineTotal = Number(it.line_total ?? (Number(it.quantity || 0) * Number(it.unit_price || it.rate || 0)));
      const itemTax = lineTotal * (Number(it.tax_rate || rate) / 100);
      return sum + (isFinite(itemTax) ? itemTax : 0);
    }, 0);
    return { rate, tax };
  });

  return <div className="invoice-totals"><div className="tax-lines">{taxTotals.map(t => <div key={t.rate} className="tax-line"><span>{t.rate}%</span><span>{money(t.tax)}</span></div>)}</div><div className="totals"><div><span>Total</span><strong>{money(total)}</strong></div><div><span>Balance</span><strong>{money(balance)}</strong></div></div></div>;
}
function ReceiptTotals({ payload, total, received, balance }: { payload: any; total: number; received: number; balance: number }) { return <div className="receipt-totals"><div><span>Total</span><strong>{money(total)}</strong></div><div><span>Received</span><strong>{money(received)}</strong></div><div><span>Balance</span><strong>{money(balance)}</strong></div></div>; }

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
  const hasOnline = paymentMode === 'online' && (showPaymentLink || (showPaymentQr && !!qrDataUrl));
  if (!hasBank && !hasOnline) return null;
  return <section className={`payment ${hasBank && hasOnline ? 'payment-combined' : hasBank ? 'bank-payment' : 'online-payment'} ${premium ? 'payment-premium' : ''}`}>
    {hasBank && <div className="bank-payment-column"><BankDetails bank={paymentSelection.bank} /></div>}
    {hasOnline && <div className="online-payment-column"><div><label>PAYMENT OPTIONS</label><strong>Pay this invoice easily</strong><span>Amount due: {money(balance, currency)}</span>{showPaymentLink && paymentLink && <div><a href={paymentLink} target="_blank" rel="noreferrer">Pay now</a></div>}{showPaymentQr && qrDataUrl && <div className="qr"><img src={qrDataUrl} alt="Payment QR" /></div>}</div></div>}
  </section>;
}

function Paper({ type, payload, business, customer, items, theme, fields, total, balance, received, logoUrl, paymentSelection, paymentQrDataUrl, showBankDetails, showPaymentLink, showPaymentQr }: any) {
  const receipt = type === 'receipt';
  const resolvedLogoUrl = text(logoUrl || business.logo_url || (business.logo_storage_path ? supabase.storage.from('business-branding-public').getPublicUrl(business.logo_storage_path).data.publicUrl : ''));
  const title = receipt ? 'Payment Receipt' : type === 'quotation' ? 'Estimate' : Number(payload.tax_total) > 0 || isTaxRegistered(business) ? 'Tax Invoice' : 'Invoice';
  const customerTax = taxValue(customer);
  const businessTax = text(business.tax_registration_number || business.tax_id || business.gstin || '');
  if (receipt) return <article className={`paper receipt-paper ${theme.dark ? 'theme-dark' : ''}`} style={{ '--accent': theme.accent, '--table': theme.table, '--line': theme.line } as React.CSSProperties}>
    <div className="receipt-head"><Logo url={logoUrl} /><Tagline business={business} fields={fields} compact /><strong className="receipt-business">{text(business.name || business.legal_name || 'Business')}</strong>
    </div>
    <div className="receipt-title"><h1>{text(fields.title || title)}</h1><div>Invoice <strong>{text(payload.invoice_number || payload.number || '—')}</strong></div><div>Receipt <strong>{text(payload.receipt_number || payload.number || '—')}</strong></div></div>
    <div className="receipt-customer"><span className="label">RECEIVED FROM</span><strong>{text(customer.display_name || customer.legal_name || 'Customer')}</strong>{addressLines(customer.address || customer.billing_address || customer.address_line1 || customer.address_line)?.map((l,i)=>(<div key={i}>{l}</div>))}</div>
    <LineItems items={items} payload={payload} receipt /><ReceiptTotals payload={payload} total={total} received={received} balance={balance} />
    <div className="payment-detail"><span>Payment method</span><strong>{text(payload.payment_method || payload.method || '—')}</strong>{(payload.payment_reference || payload.reference) && <><span>Ref</span><strong>{text(payload.payment_reference || payload.reference)}</strong></>}</div>
    <div className="paid-stamp">PAID</div><div className="receipt-thanks">{text(fields.notes || 'Thank you for your payment.')}</div><footer className="receipt-footer"><span>{text(fields.footer || '')}</span></footer>
  </article>;

  const paymentMode = paymentSelection?.payment_display_mode || 'none';
  const paymentLink = text(payload.payment_link || paymentSelection?.payment_link || '');
  const templateClass = theme.className;
  return <article className={`paper ${templateClass} ${theme.dark ? 'theme-dark' : ''}`} style={{ '--accent': theme.accent, '--table': theme.table, '--line': theme.line } as React.CSSProperties}>
    <header className="document-header"><BusinessIdentity business={business} logoUrl={resolvedLogoUrl} fields={fields} /><div className="heading"><div className="title">{text(fields.title || title)}</div></div></header>
    <section className="parties"><div className="bill-to"><label>BILL TO</label><strong>{text(customer.display_name || customer.legal_name || 'Customer')}</strong>{addressLines(customer.address || customer.billing_address || customer.address_line1 || customer.address_line)?.map((l,i)=>(<div key={i}>{l}</div>))}</div></section>
    <LineItems items={items} payload={payload} receipt={false} />
    <div className="body-grid"><div className="notes-column">{fields.notes && <section className="document-notes"><label>NOTES</label><p>{text(fields.notes)}</p></section>}{fields.terms && <section className="document-terms"><label>TERMS</label><p>{text(fields.terms)}</p></section>}</div></div>
    {(type === 'invoice' || paymentSelection?.bank) && <PaymentSection paymentMode={type === 'invoice' ? paymentMode : 'bank'} paymentLink={paymentLink} paymentSelection={paymentSelection} balance={balance} currency={business.currency_code || 'INR'} premium={false} showBankDetails={showBankDetails} showPaymentLink={showPaymentLink} showPaymentQr={showPaymentQr} qrDataUrl={paymentQrDataUrl} />}
    <footer><span>{text(business.name || business.legal_name || 'Business')}</span><span>{text(fields.footer || 'This is a computer generated document.')}</span></footer><div className="platform">Generated by Invoice Automation</div>
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
      const [templateResult, preferenceResult, businessResult] = await Promise.all([
        loaded.data?.template_id ? supabase.from('document_templates').select('template_key,template_name').eq('id', loaded.data.template_id).maybeSingle() : Promise.resolve({ data: null } as any),
        businessId ? supabase.from('business_document_preferences').select('custom_fields,show_payment_qr,show_payment_link').eq('business_id', businessId).eq('document_type', type).maybeSingle() : Promise.resolve({ data: null } as any),
        businessId ? supabase.from('businesses').select('id,name,legal_name,registration_number,tax_registration_number,tax_enabled,tax_mode,tax_type,currency_code,address,phone,email,website,logo_storage_path,logo_url').eq('id', businessId).maybeSingle() : Promise.resolve({ data: null } as any),
      ]);
      if (!active) return;
      setJob(loaded.data); setTemplate(templateResult.data); setPreferences(preferenceResult.data); if (businessResult.data) setBusiness(businessResult.data);
      const invoiceId = payload.invoice_id || payload.invoice?.id || payload.source_invoice_id || payload.payment?.invoice_id || (type === 'invoice' ? id : null);
      let selectedBank: any = null;
      if (businessId) {
        const selectedBankId = payload?.document_context?.selected_bank_account_id || null;
        if (selectedBankId) {
          const bankResult = await supabase.from('bank_accounts').select('id,name,institution_name,account_last4,account_holder_name,ifsc_code,branch_name,account_type,currency_code,metadata').eq('id', selectedBankId).maybeSingle();
          selectedBank = bankResult.data || null;
        }
        if (selectedBank) setPaymentSelection({ payment_display_mode: 'bank', bank: selectedBank });
      }
      if (type === 'invoice' && businessId && invoiceId) {
        const invoiceResult = await supabase.from('invoices').select('payment_display_mode,payment_bank_account_id,payment_link,payment_qr_payload').eq('id', invoiceId).eq('business_id', businessId).maybeSingle();
        if (invoiceResult.data) {
          let bank = null;
          if (invoiceResult.data.payment_display_mode === 'bank' && invoiceResult.data.payment_bank_account_id) {
            const bankResult = await supabase.from('bank_accounts').select('id,name,institution_name,account_last4,account_holder_name,ifsc_code,branch_name,account_type,currency_code,metadata').eq('id', invoiceResult.data.payment_bank_account_id).maybeSingle();
            bank = bankResult.data || null;
          }
          setPaymentSelection({ ...invoiceResult.data, bank: bank || selectedBank || null });
        }
      }
      if (type === 'receipt' && invoiceId) {
        const lineItems = await supabase.from('invoice_line_items').select('name,description,quantity,unit_price,line_total,product_service_id').eq('invoice_id', invoiceId).order('created_at');
        if (!lineItems.error) setReceiptItems(lineItems.data || []);
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
  const total = Number(model.amount ?? model.total ?? model.invoice_total ?? 0);
  const received = Number(model.amount_received ?? (type === 'receipt' ? model.amount : 0) ?? 0);
  const balance = Number(model.balance_due ?? Math.max(total - received, 0));
  const number = model.invoice_number || model.quotation_number || model.receipt_number || model.number || '';
  const title = type === 'receipt' ? 'Payment Receipt' : type === 'quotation' ? 'Estimate' : 'Invoice';
  const link = typeof window !== 'undefined' ? window.location.href : '';
  const logoUrl = business?.logo_storage_path ? supabase.storage.from('business-branding-public').getPublicUrl(business.logo_storage_path).data.publicUrl : '';
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
  return <main className="page"><div className="toolbar"><div><small>DOCUMENT CENTER</small><h1>{title} {number}</h1><p>{template?.template_name || theme.label} · Print-ready</p></div><div className="actions"><button onClick={back}>Back</button><button onClick={copyLink}>Copy link</button><button onClick={share}>Share</button><button onClick={print}>Print / Save</button></div></div>
    <Paper type={type} payload={model} business={mergedBusiness} customer={customer} items={items} theme={theme} fields={fields} total={total} balance={balance} received={received} logoUrl={logoUrl} paymentSelection={paymentSelection} paymentQrDataUrl={paymentQrDataUrl} showBankDetails={Boolean(preferences?.show_payment_qr)} showPaymentLink={Boolean(preferences?.show_payment_link)} showPaymentQr={Boolean(preferences?.show_payment_qr)} />
    <style jsx global>{`*{box-sizing:border-box}.page{min-height:100vh;background:#eef1f6;padding:28px 18px}.toolbar{max-width:794px;margin:0 auto 18px;display:flex;justify-content:space-between;align-items:center}.actions{display:flex;gap:8px}.paper{width:794px;min-height:1123px;margin:0 auto;background:#fff;padding:42px 48px 34px;box-shadow:0 14px 45px rgba(15,23,42,.12);font:14px/1.45 Arial,sans-serif;color:#172033;--accent:#6d28d9;--table:#6d28d9;--line:#ddd6fe}.template-classic{--accent:#7f1d1d!important;--table:#7f1d1d!important;--line:#d6d3d1!important;padding:44px 50px 36px}.template-minimal{--accent:#111827!important;--table:#f1f5f9!important;--line:#cbd5e1!important;padding:46px 54px 40px}.template-modern{--accent:#6d28d9!important;--table:#6d28d9!important;--line:#ddd6fe!important}.template-premium{--accent:#4c1d95!important;--table:#312e81!important;--line:#d8b4fe!important;padding:38px 48px 40px;position:relative;overflow:hidden;background:linear-gradient(180deg,#ffffff 0%,#f7f1ff 100%)}.template-professional{--accent:#0f3b66!important;--table:#123f6b!important;--line:#cbd5e1!important;padding:40px 46px 34px}.receipt-paper{width:640px;min-height:auto;padding:0 0 18px}.receipt-head{text-align:center;padding:28px 46px 18px;border-bottom:1px solid var(--line)}@media(max-width:860px){.toolbar{align-items:flex-start;flex-direction:column}.actions{width:100%;justify-content:flex-start}.paper,.receipt-paper{width:100%;min-height:auto}}@media print{.page{padding:0!important;background:#fff!important}.toolbar,.notice{display:none!important}.paper{margin:0!important;box-shadow:none!important}}`}</style>
  </main>;
}
