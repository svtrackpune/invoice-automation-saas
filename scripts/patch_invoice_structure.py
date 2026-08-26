from pathlib import Path

p = Path('app/next-workspace/documents/DocumentViewer.tsx')
s = p.read_text(encoding='utf-8')

if "import QRCode from 'qrcode';" not in s:
    s = s.replace("import { supabase } from '@/lib/supabase';", "import { supabase } from '@/lib/supabase';\nimport QRCode from 'qrcode';", 1)

old = '''function PaymentSection({ paymentMode, paymentLink, paymentSelection, balance, currency, premium = false }: any) {
  if (paymentMode === 'bank' && paymentSelection?.bank) return <section className={`payment bank-payment ${premium ? 'payment-premium' : ''}`}><BankDetails bank={paymentSelection.bank} /></section>;
  if (paymentMode === 'online') return <section className={`payment online-payment ${premium ? 'payment-premium' : ''}`}><div><label>PAYMENT OPTIONS</label><strong>Pay this invoice easily</strong><span>Amount due: {money(balance, currency)}</span>{paymentLink ? <a className="pay-link" href={paymentLink} target="_blank" rel="noreferrer">Pay Now</a> : <span>Payment link is being prepared.</span>}</div><div className="qr"><span>QR</span><small>Scan to pay</small></div></section>;
  return null;
}'''
new = '''function PaymentSection({ paymentMode, paymentLink, paymentSelection, balance, currency, premium = false, showBankDetails = false, showPaymentLink = true, showPaymentQr = true, qrDataUrl = '' }: any) {
  const hasBank = showBankDetails && !!paymentSelection?.bank;
  const hasOnline = paymentMode === 'online' && (showPaymentLink || (showPaymentQr && !!qrDataUrl));
  if (!hasBank && !hasOnline) return null;
  return <section className={`payment ${hasBank && hasOnline ? 'payment-combined' : hasBank ? 'bank-payment' : 'online-payment'} ${premium ? 'payment-premium' : ''}`}>
    {hasBank && <div className="bank-payment-column"><BankDetails bank={paymentSelection.bank} /></div>}
    {hasOnline && <div className="online-payment-column"><div><label>PAYMENT OPTIONS</label><strong>Pay this invoice easily</strong><span>Amount due: {money(balance, currency)}</span>{showPaymentLink && paymentLink ? <a className="pay-link" href={paymentLink} target="_blank" rel="noreferrer">Pay Now</a> : showPaymentLink ? <span>Payment link is being prepared.</span> : null}</div>{showPaymentQr && qrDataUrl ? <div className="qr"><img src={qrDataUrl} alt="Scan to pay" /><small>Scan to pay</small></div> : null}</div>}
  </section>;
}'''
if old in s:
    s = s.replace(old, new, 1)

s = s.replace("{upi && <span>UPI: {text(upi)}</span>}", "{upi && <span>UPI: {text(upi)}</span>}{bank?.account_holder_name && <span>Account holder: {text(bank.account_holder_name)}</span>}", 1)
s = s.replace("function Paper({ type, payload, business, customer, items, theme, fields, total, balance, received, logoUrl, paymentSelection }: any) {", "function Paper({ type, payload, business, customer, items, theme, fields, total, balance, received, logoUrl, paymentSelection, paymentQrDataUrl, showBankDetails, showPaymentLink, showPaymentQr }: any) {", 1)

state_old = "const [job, setJob] = useState<any>(null), [template, setTemplate] = useState<any>(null), [preferences, setPreferences] = useState<any>(null), [business, setBusiness] = useState<any>(null), [receiptItems, setReceiptItems] = useState<any[]>([]), [paymentSelection, setPaymentSelection] = useState<any>(null), [loading, setLoading] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState(''), [menu, setMenu] = useState(false);"
state_new = "const [job, setJob] = useState<any>(null), [template, setTemplate] = useState<any>(null), [preferences, setPreferences] = useState<any>(null), [business, setBusiness] = useState<any>(null), [receiptItems, setReceiptItems] = useState<any[]>([]), [paymentSelection, setPaymentSelection] = useState<any>(null), [paymentQrDataUrl, setPaymentQrDataUrl] = useState(''), [loading, setLoading] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState(''), [menu, setMenu] = useState(false);"
if state_old in s:
    s = s.replace(state_old, state_new, 1)

marker = "  const mergedBusiness = useMemo(() => ({ ...(model.business || {}), ...(business || {}) }), [model.business, business]);"
if marker in s and "QRCode.toDataURL" not in s:
    effect = '''  useEffect(() => {
    let active = true;
    const value = text(paymentSelection?.payment_qr_payload || job?.payload?.payment_qr_payload || paymentSelection?.payment_link || job?.payload?.payment_link || '');
    if (!value) { setPaymentQrDataUrl(''); return () => { active = false; }; }
    QRCode.toDataURL(value, { width: 180, margin: 1, errorCorrectionLevel: 'M' }).then((url) => { if (active) setPaymentQrDataUrl(url); }).catch(() => { if (active) setPaymentQrDataUrl(''); });
    return () => { active = false; };
  }, [paymentSelection, job]);
'''
    s = s.replace(marker, marker + "\n" + effect, 1)

old_call = "    {(type === 'invoice' || paymentSelection?.bank) && <PaymentSection paymentMode={type === 'invoice' ? paymentMode : 'bank'} paymentLink={paymentLink} paymentSelection={paymentSelection} balance={balance} currency={payload.currency_code} premium={theme.className === 'template-premium'} />}"
new_call = "    {(type === 'invoice' || paymentSelection?.bank) && <PaymentSection paymentMode={type === 'invoice' ? paymentMode : 'bank'} paymentLink={paymentLink} paymentSelection={paymentSelection} balance={balance} currency={payload.currency_code} premium={theme.className === 'template-premium'} showBankDetails={showBankDetails} showPaymentLink={showPaymentLink} showPaymentQr={showPaymentQr} qrDataUrl={paymentQrDataUrl} />}"
if old_call in s:
    s = s.replace(old_call, new_call, 1)

old_paper = "<Paper type={type} payload={{ ...model, ...(paymentSelection ? { payment_link: paymentSelection.payment_link || model.payment_link, payment_qr_payload: paymentSelection.payment_qr_payload || model.payment_qr_payload } : {}) }} business={mergedBusiness} customer={customer} items={items} theme={theme} fields={fields} total={total} balance={balance} received={received} logoUrl={logoUrl} paymentSelection={paymentSelection} />"
new_paper = "<Paper type={type} payload={{ ...model, ...(paymentSelection ? { payment_link: paymentSelection.payment_link || model.payment_link, payment_qr_payload: paymentSelection.payment_qr_payload || model.payment_qr_payload } : {}) }} business={mergedBusiness} customer={customer} items={items} theme={theme} fields={fields} total={total} balance={balance} received={received} logoUrl={logoUrl} paymentSelection={paymentSelection} paymentQrDataUrl={paymentQrDataUrl} showBankDetails={model?.document_context?.show_bank_details === true || preferences?.show_bank_details === true} showPaymentLink={preferences?.show_payment_link !== false} showPaymentQr={preferences?.show_payment_qr !== false} />"
if old_paper not in s:
    raise SystemExit('Invoice Paper invocation target not found')
s = s.replace(old_paper, new_paper, 1)

start = s.find("  const print = () => {")
if start >= 0:
    end = s.find(";\n\n  if (loading)", start) + 2
    if end <= 1:
        raise SystemExit('Print function end not found')
    new_print = '''  const print = () => {
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
      ${receipt ? '.receipt-paper{width:3.1in!important;max-width:3.1in!important;min-height:0!important;}' : '.paper:not(.receipt-paper){width:210mm!important;min-width:210mm!important;max-width:210mm!important;min-height:297mm!important}.paper:not(.receipt-paper) .document-header{grid-template-columns:minmax(0,1fr) 250px!important}.paper:not(.receipt-paper) .parties{grid-template-columns:minmax(0,1fr) minmax(0,1fr)!important}.paper:not(.receipt-paper) .body-grid{grid-template-columns:minmax(0,1fr) 300px!important}.paper:not(.receipt-paper) .totalwrap{grid-column:2!important;width:100%!important}' }
      .paper:not(.receipt-paper) .items th,.paper:not(.receipt-paper) .items td,.paper:not(.receipt-paper) .parties span,.paper:not(.receipt-paper) .parties strong,.paper:not(.receipt-paper) footer span{overflow-wrap:anywhere!important;word-break:break-word!important;white-space:normal!important;}
      .paper:not(.receipt-paper) .payment-combined{display:grid!important;grid-template-columns:minmax(0,1fr) minmax(0,1fr)!important;gap:20px!important;}
      .paper:not(.receipt-paper) .bank-payment-column{padding-right:20px!important;border-right:1px solid var(--line)!important;min-width:0!important;}
      .paper:not(.receipt-paper) .online-payment-column{min-width:0!important;display:flex!important;justify-content:space-between!important;align-items:center!important;gap:16px!important;}
      .paper:not(.receipt-paper) .qr{width:88px!important;height:88px!important;display:flex!important;align-items:center!important;justify-content:center!important;flex-direction:column!important;background:#fff!important;border:1px solid var(--line)!important;padding:5px!important;}
      .paper:not(.receipt-paper) .qr img{width:68px!important;height:68px!important;object-fit:contain!important;}
    </style></head><body>${paper.outerHTML}</body></html>`);
    doc.close();
    setTimeout(() => { frame.contentWindow?.focus(); frame.contentWindow?.print(); setTimeout(() => frame.remove(), 1000); }, 250);
  };'''
    s = s[:start] + new_print + s[end:]

p.write_text(s, encoding='utf-8')
