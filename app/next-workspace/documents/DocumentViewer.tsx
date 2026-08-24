'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';

type Theme = { accent: string; table: string; line: string; dark: boolean };
const THEMES: Record<string, Theme> = {
  classic: { accent: '#1f2937', table: '#1f2937', line: '#cbd5e1', dark: false },
  bold: { accent: '#111827', table: '#111827', line: '#9ca3af', dark: true },
  modern: { accent: '#6d28d9', table: '#6d28d9', line: '#ddd6fe', dark: false },
  minimal: { accent: '#334155', table: '#e2e8f0', line: '#cbd5e1', dark: false },
  compact: { accent: '#0f172a', table: '#0f172a', line: '#94a3b8', dark: true },
};

const money = (value: any, currency = 'INR') => new Intl.NumberFormat('en-IN', { style: 'currency', currency: String(currency || 'INR').trim(), maximumFractionDigits: 2 }).format(Number(value || 0));
const text = (value: any) => String(value ?? '');
const addressLines = (value: any) => {
  if (!value) return [];
  if (typeof value === 'object') {
    const first = [value.line1, value.line2, value.city].filter(Boolean).map(String).join(', ');
    const second = [value.state, value.postal_code || value.pin || value.pincode, value.country].filter(Boolean).map(String).join(' - ');
    return [first, second].filter(Boolean);
  }
  const parts = String(value).split(/\n|,/).map((x) => x.trim()).filter(Boolean);
  if (parts.length <= 2) return parts;
  const first = parts.slice(0, Math.min(3, parts.length - 1)).join(', ');
  const second = parts.slice(Math.min(3, parts.length - 1)).join(', ');
  return [first, second].filter(Boolean);
};

function Logo({ url }: { url: string }) { return <div className="logo">{url ? <img src={url} alt="Business logo" /> : <span>LOGO</span>}</div>; }
function Tagline({ business, fields, compact = false }: { business: any; fields: any; compact?: boolean }) { const tagline = text(business.tagline || fields.tagline || ''); return <div className={`tagline${compact ? ' tagline-compact' : ''}`} aria-label="Business tagline">{tagline || <span className="tagline-placeholder">Your tagline</span>}</div>; }
function BusinessIdentity({ business, logoUrl, fields }: { business: any; logoUrl: string; fields: any }) {
  return <div className="business-identity"><Logo url={logoUrl} /><Tagline business={business} fields={fields} /><div><strong>{text(business.name || business.legal_name || 'Business')}</strong>{business.legal_name && business.legal_name !== business.name && <span>{text(business.legal_name)}</span>}{addressLines(business.address || business.business_address).map((line, index) => <span key={index}>{line}</span>)}{[business.phone || business.mobile, business.email || business.business_email, business.website].filter(Boolean).length > 0 && <span>{[business.phone || business.mobile, business.email || business.business_email, business.website].filter(Boolean).join(' · ')}</span>}{(business.tax_registration_number || business.gstin) && <small>GSTIN: {text(business.tax_registration_number || business.gstin)}</small>}</div></div>;
}
function LineItems({ items, payload, receipt }: { items: any[]; payload: any; receipt: boolean }) {
  return <table className={`items ${receipt ? 'receipt-items' : ''}`}><thead><tr><th>Description</th><th>Qty</th><th>Rate</th>{!receipt && Number(payload.tax_total) > 0 && <th>Tax</th>}<th>Amount</th></tr></thead><tbody>{items.length ? items.map((item: any, index: number) => <tr key={index}><td><strong>{text(item.name || item.description || 'Item')}</strong>{item.description && item.name && <small>{text(item.description)}</small>}</td><td>{item.quantity ?? 1}</td><td>{money(item.unit_price, payload.currency_code)}</td>{!receipt && Number(payload.tax_total) > 0 && <td>{item.tax_rate ?? 0}%</td>}<td><strong>{money(item.line_total ?? Number(item.quantity || 1) * Number(item.unit_price || 0), payload.currency_code)}</strong></td></tr>) : <tr><td colSpan={receipt ? 4 : 5} className="empty">No line items available</td></tr>}</tbody></table>;
}
function InvoiceTotals({ payload, total, balance }: { payload: any; total: number; balance: number }) { return <div className="totals"><div><span>Subtotal</span><strong>{money(payload.subtotal, payload.currency_code)}</strong></div>{Number(payload.discount_total) > 0 && <div><span>Discount</span><strong>-{money(payload.discount_total, payload.currency_code)}</strong></div>}{Number(payload.tax_total) > 0 && <div><span>Tax</span><strong>{money(payload.tax_total, payload.currency_code)}</strong></div>}<div className="grand"><span>Total</span><strong>{money(total, payload.currency_code)}</strong></div><div className="due"><span>Amount due</span><strong>{money(balance, payload.currency_code)}</strong></div></div>; }
function ReceiptTotals({ payload, total, received, balance }: { payload: any; total: number; received: number; balance: number }) { return <div className="receipt-totals"><div><span>Total</span><strong>{money(total, payload.currency_code)}</strong></div><div className="received-row"><span>Amount received</span><strong>{money(received, payload.currency_code)}</strong></div><div className="balance-row"><span>Balance</span><strong>{money(balance, payload.currency_code)}</strong></div></div>; }

function BankDetails({ bank }: { bank: any }) {
  const metadata = bank?.metadata || {};
  const accountNumber = metadata.account_number || metadata.account_no || metadata.accountNumber || (bank.account_last4 ? `•••• ${bank.account_last4}` : '');
  const ifsc = metadata.ifsc || metadata.ifsc_code || metadata.ifscCode;
  const branch = metadata.branch || metadata.branch_name;
  const upi = metadata.upi_id || metadata.upiId;
  return <div className="bank-details"><label>BANK DETAILS</label><strong>{text(bank?.name || 'Bank account')}</strong>{bank?.institution_name && <span>{text(bank.institution_name)}</span>}{accountNumber && <span>Account: {text(accountNumber)}</span>}{ifsc && <span>IFSC: {text(ifsc)}</span>}{branch && <span>Branch: {text(branch)}</span>}{upi && <span>UPI: {text(upi)}</span>}</div>;
}

function Paper({ type, payload, business, customer, items, theme, fields, total, balance, received, logoUrl, paymentSelection }: any) {
  const receipt = type === 'receipt';
  const title = receipt ? 'Payment Receipt' : type === 'quotation' ? 'Estimate' : Number(payload.tax_total) > 0 || business.tax_registration_number ? 'Tax Invoice' : 'Invoice';
  if (receipt) return <article className={`paper receipt-paper ${theme.dark ? 'theme-dark' : ''}`} style={{ '--accent': theme.accent, '--table': theme.table, '--line': theme.line } as React.CSSProperties}>
    <div className="receipt-head"><Logo url={logoUrl} /><Tagline business={business} fields={fields} compact /><strong className="receipt-business">{text(business.name || business.legal_name || 'Business')}</strong>{business.legal_name && business.legal_name !== business.name && <span>{text(business.legal_name)}</span>}{addressLines(business.address || business.business_address).map((line, index) => <span key={index}>{line}</span>)}{(business.phone || business.mobile) && <span>Mobile: {text(business.phone || business.mobile)}</span>}{(business.email || business.business_email) && <span>Email: {text(business.email || business.business_email)}</span>}{business.website && <span>{text(business.website)}</span>}{(business.tax_registration_number || business.gstin) && <span>GSTIN: {text(business.tax_registration_number || business.gstin)}</span>}</div>
    <div className="receipt-title"><h1>{text(fields.title || title)}</h1><div>Invoice <strong>{text(payload.invoice_number || payload.number || '—')}</strong></div><div>Receipt <strong>{text(payload.receipt_number || payload.number || '—')}</strong></div><div>For <strong>{text(customer.display_name || customer.legal_name || 'Customer')}</strong></div><div>Paid on <strong>{text(payload.payment_date || payload.receipt_date || payload.invoice_date || '—')}</strong></div></div>
    <div className="receipt-customer"><span className="label">RECEIVED FROM</span><strong>{text(customer.display_name || customer.legal_name || 'Customer')}</strong>{addressLines(customer.address || customer.billing_address).map((line, index) => <span key={index}>{line}</span>)}{customer.phone && <span>{text(customer.phone)}</span>}{customer.email && <span>{text(customer.email)}</span>}</div>
    <LineItems items={items} payload={payload} receipt /><ReceiptTotals payload={payload} total={total} received={received} balance={balance} />
    <div className="payment-detail"><span>Payment method</span><strong>{text(payload.payment_method || payload.method || '—')}</strong>{(payload.payment_reference || payload.reference) && <><span>Reference</span><strong>{text(payload.payment_reference || payload.reference)}</strong></>}</div>
    <div className="paid-stamp">PAID</div><div className="receipt-thanks">{text(fields.notes || 'Thank you for your payment.')}</div><footer className="receipt-footer"><span>{text(fields.footer || 'This is a computer generated receipt.')}</span><span>Powered by <strong>Moneymatters</strong> · mm.nilanga.in</span></footer>
  </article>;

  const paymentMode = paymentSelection?.payment_display_mode || 'none';
  const paymentLink = text(payload.payment_link || paymentSelection?.payment_link || '');
  return <article className={`paper ${theme.dark ? 'theme-dark' : ''}`} style={{ '--accent': theme.accent, '--table': theme.table, '--line': theme.line } as React.CSSProperties}>
    <header className="document-header"><BusinessIdentity business={business} logoUrl={logoUrl} fields={fields} /><div className="heading"><div className="title">{text(fields.title || title)}</div><div className="meta">No. <strong>{text(payload.invoice_number || payload.quotation_number || payload.number)}</strong><br />Date <strong>{text(payload.invoice_date || payload.quotation_date || '—')}</strong>{payload.due_date && <><br />Due <strong>{text(payload.due_date)}</strong></>}</div></div></header>
    <section className="parties"><div><label>BILL TO</label><strong>{text(customer.display_name || customer.legal_name || 'Customer')}</strong>{addressLines(customer.address || customer.billing_address).map((line, index) => <span key={index}>{line}</span>)}{customer.phone && <span>{text(customer.phone)}</span>}{customer.email && <span>{text(customer.email)}</span>}</div><div className="from"><label>FROM</label><strong>{text(business.name || business.legal_name || 'Business')}</strong>{addressLines(business.address || business.business_address).map((line, index) => <span key={index}>{line}</span>)}{(business.phone || business.mobile) && <span>{text(business.phone || business.mobile)}</span>}{(business.email || business.business_email) && <span>{text(business.email || business.business_email)}</span>}</div></section>
    <LineItems items={items} payload={payload} receipt={false} /><div className="totalwrap"><InvoiceTotals payload={payload} total={total} balance={balance} /></div>
    {type === 'invoice' && paymentMode === 'bank' && paymentSelection?.bank && <section className="payment bank-payment"><BankDetails bank={paymentSelection.bank} /></section>}
    {type === 'invoice' && paymentMode === 'online' && <section className="payment"><div><label>PAYMENT OPTIONS</label><strong>Pay this invoice easily</strong><span>Amount due: {money(balance, payload.currency_code)}</span>{paymentLink ? <a className="pay-link" href={paymentLink} target="_blank" rel="noreferrer">Pay Now</a> : <span>Payment link is being prepared.</span>}</div>{paymentLink && <div className="qr"><span>QR</span><small>Scan to pay</small></div>}</section>}
    <div className="thanks">{text(fields.notes || '')}</div><footer><span>{text(business.name || business.legal_name || 'Business')}</span><span>{text(fields.footer || 'This is a computer generated document.')}</span></footer><div className="platform"><a href="https://mm.nilanga.in" target="_blank" rel="noreferrer">Moneymatters</a></div>
  </article>;
}

export default function DocumentViewer({ type, id }: { type: string; id: string }) {
  const [job, setJob] = useState<any>(null), [template, setTemplate] = useState<any>(null), [preferences, setPreferences] = useState<any>(null), [business, setBusiness] = useState<any>(null), [receiptItems, setReceiptItems] = useState<any[]>([]), [paymentSelection, setPaymentSelection] = useState<any>(null), [loading, setLoading] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState(''), [menu, setMenu] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const render = await supabase.rpc('prepare_document_render', { p_document_type: type, p_document_id: id, p_template_id: null });
      if (render.error) { if (active) { setError(render.error.message); setLoading(false); } return; }
      const loaded = await supabase.from('document_render_jobs').select('payload,template_id,template_version').eq('id', render.data).single();
      if (loaded.error) { if (active) { setError(loaded.error.message); setLoading(false); } return; }
      const payload = loaded.data?.payload || {}, businessId = payload.business?.id || payload.business_id;
      const [templateResult, preferenceResult, businessResult] = await Promise.all([
        loaded.data?.template_id ? supabase.from('document_templates').select('template_key,template_name').eq('id', loaded.data.template_id).maybeSingle() : Promise.resolve({ data: null } as any),
        businessId ? supabase.from('business_document_preferences').select('custom_fields,show_payment_qr,show_payment_link').eq('business_id', businessId).eq('document_type', type).maybeSingle() : Promise.resolve({ data: null } as any),
        businessId ? supabase.from('businesses').select('id,name,legal_name,registration_number,tax_registration_number,currency_code,address,phone,email,website,logo_storage_path,tagline').eq('id', businessId).maybeSingle() : Promise.resolve({ data: null } as any),
      ]);
      if (!active) return;
      setJob(loaded.data); setTemplate(templateResult.data); setPreferences(preferenceResult.data); if (businessResult.data) setBusiness(businessResult.data);
      const invoiceId = payload.invoice_id || payload.invoice?.id || payload.source_invoice_id || payload.payment?.invoice_id || (type === 'invoice' ? id : null);
      if (type === 'invoice' && businessId && invoiceId) {
        const invoiceResult = await supabase.from('invoices').select('payment_display_mode,payment_bank_account_id,payment_link,payment_qr_payload').eq('id', invoiceId).eq('business_id', businessId).maybeSingle();
        if (invoiceResult.data) {
          let bank = null;
          if (invoiceResult.data.payment_display_mode === 'bank' && invoiceResult.data.payment_bank_account_id) {
            const bankResult = await supabase.from('bank_accounts').select('id,name,institution_name,account_last4,metadata').eq('id', invoiceResult.data.payment_bank_account_id).eq('business_id', businessId).eq('is_active', true).maybeSingle();
            bank = bankResult.data || null;
          }
          setPaymentSelection({ ...invoiceResult.data, bank });
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
  const customer = model.customer || {};
  const items = type === 'receipt' ? (receiptItems.length ? receiptItems : model.items || []) : model.items || [];
  const theme = THEMES[template?.template_key] || THEMES.classic;
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
  const share = async () => { try { if (navigator.share) await navigator.share({ title: `${title} ${number}`, text: `${mergedBusiness.name || 'Business'} · ${number}`, url: link }); else await copyLink(); } catch {} };
  const print = () => { const paper = document.querySelector('.paper') as HTMLElement | null; if (!paper) return; const frame = document.createElement('iframe'); frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;'; document.body.appendChild(frame); const doc = frame.contentDocument; if (!doc) { frame.remove(); return; } doc.open(); doc.write(`<!doctype html><html><head><meta charset="utf-8"><style>${Array.from(document.head.querySelectorAll('style')).map((style) => style.textContent || '').join('')}@page{size:A4;margin:0}html,body{margin:0;padding:0;background:#fff}.page{padding:0!important;background:#fff!important}.paper{margin:0!important;box-shadow:none!important}</style></head><body>${paper.outerHTML}</body></html>`); doc.close(); setTimeout(() => { frame.contentWindow?.print(); setTimeout(() => frame.remove(), 1000); }, 250); };

  if (loading) return <div className="center">Preparing document…</div>;
  if (error) return <div className="center error">{error}</div>;
  return <main className="page"><div className="toolbar"><div><small>DOCUMENT CENTER</small><h1>{title} {number}</h1><p>{template?.template_name || 'Professional'} · Print-ready</p></div><div className="actions"><button onClick={back}>Back</button>{type === 'invoice' && <button onClick={() => (location.href = `/next-workspace/payments?invoice=${id}`)}>Record payment</button>}<div className="drop"><button className="primary" onClick={() => setMenu((value) => !value)}>Print / Save PDF ▾</button>{menu && <div className="menu"><button onClick={print}>Print / Save PDF</button><button onClick={share}>Share</button><button onClick={copyLink}>Copy link</button></div>}</div></div></div>{notice && <div className="notice">{notice}</div>}<Paper type={type} payload={{ ...model, ...(paymentSelection ? { payment_link: paymentSelection.payment_link || model.payment_link, payment_qr_payload: paymentSelection.payment_qr_payload || model.payment_qr_payload } : {}) }} business={mergedBusiness} customer={customer} items={items} theme={theme} fields={fields} total={total} balance={balance} received={received} logoUrl={logoUrl} paymentSelection={paymentSelection} />
    <style jsx global>{`
      *{box-sizing:border-box}.page{min-height:100vh;background:#eef1f6;padding:28px 18px}.toolbar{max-width:794px;margin:0 auto 18px;display:flex;justify-content:space-between;gap:18px;align-items:center}.toolbar small{font-size:10px;font-weight:800;letter-spacing:.18em;color:#7c3aed}.toolbar h1{margin:3px 0;font-size:20px}.toolbar p{margin:0;color:#64748b;font-size:12px}.actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}.actions button{border:1px solid #cbd5e1;background:white;border-radius:10px;padding:10px 13px;font-size:12px;font-weight:700}.actions .primary{background:#0f172a;color:#fff}.drop{position:relative}.menu{position:absolute;right:0;top:44px;z-index:30;width:190px;padding:6px;background:#fff;border:1px solid #e2e8f0;border-radius:12px;box-shadow:0 12px 30px rgba(15,23,42,.15)}.menu button{display:block;width:100%;text-align:left;border:0!important}.notice{max-width:794px;margin:0 auto 12px;padding:9px 12px;background:#faf8ff;border:1px solid #ddd6fe;border-radius:10px;color:#5b21b6;font-size:12px;font-weight:700}
      .paper{width:794px;min-height:1123px;margin:0 auto;background:#fff;padding:46px 48px 38px;box-shadow:0 14px 45px rgba(15,23,42,.12);font:9px Arial,sans-serif;color:#172033;--accent:#1f2937;--table:#1f2937;--line:#cbd5e1}.document-header{display:flex;justify-content:space-between;gap:30px;padding-bottom:22px;border-bottom:2px solid var(--line)}.business-identity{display:flex;gap:14px;align-items:flex-start}.logo{width:107px;height:81px;display:grid;place-items:center;border:1px solid #dbe1ea;border-radius:7px;overflow:hidden;color:#94a3b8;font-weight:800}.logo img{max-width:96px;max-height:70px;object-fit:contain}.business-identity .tagline{margin-top:2px}.business-identity>div:last-child{min-width:0}.business-identity strong{display:block;font-size:19px;color:var(--accent)}.business-identity span{display:block;line-height:1.5;color:#64748b}.business-identity small{display:block;font-weight:700}.tagline{min-height:17px;display:flex;align-items:center;justify-content:center;color:#64748b;font-size:8px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;white-space:nowrap}.tagline-placeholder{color:#cbd5e1;border:1px dashed #d8b4fe;border-radius:4px;padding:2px 8px}.heading{text-align:right;min-width:220px}.title{font-size:27px;font-weight:900;color:var(--accent)}.meta{margin-top:15px;line-height:1.8;color:#64748b}.meta strong{color:#1e293b}.parties{display:grid;grid-template-columns:1fr 1fr;gap:30px;padding:22px 0}.parties>div{min-height:105px}.parties .from{text-align:right}.parties label{display:block;font-size:8px;font-weight:800;letter-spacing:.16em;color:#94a3b8}.parties>div>strong{display:block;margin-top:7px;font-size:12px}.parties span{display:block;line-height:1.5;color:#64748b}.items{width:100%;border-collapse:collapse}.items th{padding:10px 9px;text-align:right;background:var(--table);color:#fff;font-size:8px}.items th:first-child{text-align:left}.items td{padding:11px 9px;text-align:right;border-bottom:1px solid #e2e8f0}.items td:first-child{text-align:left}.items small{display:block;color:#64748b}.empty{text-align:center!important;color:#94a3b8}.totalwrap{display:flex;justify-content:flex-end;padding-top:20px}.totals{width:280px;border-top:2px solid var(--line);padding-top:8px}.totals>div,.receipt-totals>div{display:flex;justify-content:space-between;padding:5px 0}.totals .grand{margin-top:5px;border-top:1px solid var(--line);font-size:14px;color:var(--accent)}.totals .due{font-weight:800}.payment{display:flex;justify-content:space-between;align-items:center;margin-top:24px;padding:18px;border:1px solid var(--line);border-radius:10px;background:#faf8ff}.payment label{display:block;font-size:8px;font-weight:800;letter-spacing:.16em;color:#94a3b8}.payment strong,.payment span{display:block;margin-top:5px}.payment .pay-link{display:inline-block;margin-top:9px;border-radius:7px;padding:7px 12px;background:var(--accent);color:#fff;text-decoration:none;font-weight:800}.qr{width:58px;height:58px;border:1px dashed var(--accent);border-radius:8px;display:grid;place-items:center;color:var(--accent);font-weight:900}.qr small{font-size:7px;font-weight:500}.bank-payment{display:block}.bank-details label{display:block;font-size:8px;font-weight:800;letter-spacing:.16em;color:#94a3b8}.bank-details strong,.bank-details span{display:block;margin-top:5px}.bank-details strong{font-size:12px;color:#172033}.thanks{min-height:24px;margin-top:28px;padding-top:12px;border-top:1px solid var(--line);color:#64748b}.paper footer{display:flex;justify-content:space-between;gap:20px;margin-top:22px;padding-top:12px;border-top:1px solid var(--line);color:#64748b;font-size:8px}.platform{margin-top:18px;text-align:center;font-size:9px}.platform a{color:var(--accent);text-decoration:none;font-weight:800}
      .receipt-paper{width:640px;min-height:auto;padding:0 0 18px}.receipt-head{text-align:center;padding:30px 46px 18px;border-bottom:1px solid var(--line)}.receipt-head .logo{width:146px;height:94px;margin:0 auto 7px;border:0}.receipt-head .logo img{max-width:140px;max-height:88px}.receipt-head .tagline{margin:0 auto 8px}.receipt-business{display:block;font-size:19px;color:var(--accent)}.receipt-head>span{display:block;line-height:1.45;color:#64748b}.receipt-title{text-align:center;padding:22px 46px 18px}.receipt-title h1{margin:0 0 10px;font-size:25px;color:var(--accent)}.receipt-title div{line-height:1.65;color:#64748b}.receipt-title strong{color:#1e293b}.receipt-customer{margin:0 46px 18px;padding:13px 15px;background:#fafafa;border-top:1px solid var(--line);border-bottom:1px solid var(--line);text-align:center}.receipt-customer .label{display:block;font-size:8px;letter-spacing:.16em;font-weight:800;color:#94a3b8;margin-bottom:5px}.receipt-customer>strong,.receipt-customer>span{display:block}.receipt-customer>strong{font-size:12px}.receipt-customer>span{color:#64748b;line-height:1.45}.receipt-items{margin:0 46px;width:calc(100% - 92px)}.receipt-items th{background:var(--table);padding:9px 8px}.receipt-items td{padding:9px 8px}.receipt-totals{margin:18px 46px 0;padding:10px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line);text-align:center}.receipt-totals>div{justify-content:center;gap:26px}.receipt-totals .received-row{font-weight:800}.receipt-totals .balance-row{color:var(--accent);font-size:13px;font-weight:900}.payment-detail{margin:16px 46px 0;display:flex;flex-direction:column;align-items:center;gap:6px;padding-top:12px;border-top:1px solid var(--line);text-align:center}.payment-detail span{color:#64748b}.payment-detail strong{text-align:center}.paid-stamp{width:92px;margin:20px auto 10px;padding:5px 8px;border:3px solid #4d8b34;color:#4d8b34;font-size:20px;font-weight:900;text-align:center;transform:rotate(-5deg);opacity:.9}.receipt-thanks{margin:18px 46px 0;padding:12px 0;border-top:1px solid var(--line);text-align:center;color:#64748b}.receipt-footer{display:block!important;text-align:center;margin:0 46px!important}.receipt-footer span{display:block;margin:5px 0}.theme-dark.receipt-paper .receipt-head{background:#111827}.theme-dark.receipt-paper .receipt-business,.theme-dark.receipt-paper .receipt-title h1{color:#fff}.theme-dark.receipt-paper .receipt-title strong{color:#111827}
      @media(max-width:860px){.toolbar{align-items:flex-start;flex-direction:column}.actions{width:100%;justify-content:flex-start}.paper,.receipt-paper{width:100%;min-height:auto}}@media print{.page{padding:0!important;background:#fff!important}.toolbar,.notice{display:none!important}.paper{margin:0!important;box-shadow:none!important}}
    `}</style>
  </main>;
}
