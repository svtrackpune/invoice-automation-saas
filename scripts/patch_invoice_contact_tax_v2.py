from pathlib import Path
import re


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"Patch target not found: {label}")
    return text.replace(old, new, 1)


# 1) Document renderer: logo, contact details, GST labelling, and invoice totals.
p = Path('app/next-workspace/documents/DocumentViewer.tsx')
s = p.read_text(encoding='utf-8')

s = replace_once(
    s,
    "const taxLabel = (party: any) => /gst/i.test(text(party?.tax_type)) ? 'GSTIN' : 'Tax ID';",
    "const taxLabel = (party: any) => /gst/i.test(text(party?.tax_type || party?.tax_mode)) ? 'GST' : 'Tax ID';",
    'GST label',
)

s = replace_once(
    s,
    "function Paper({ type, payload, business, customer, items, theme, fields, total, balance, received, logoUrl, paymentSelection, paymentQrDataUrl, showBankDetails, showPaymentLink, showPaymentQr }: any) {\n  const receipt = type === 'receipt';",
    "function Paper({ type, payload, business, customer, items, theme, fields, total, balance, received, logoUrl, paymentSelection, paymentQrDataUrl, showBankDetails, showPaymentLink, showPaymentQr }: any) {\n  const receipt = type === 'receipt';\n  const resolvedLogoUrl = text(logoUrl || business.logo_url || (business.logo_storage_path ? supabase.storage.from('business-branding-public').getPublicUrl(business.logo_storage_path).data.publicUrl : ''));",
    'resolved logo URL',
)
s = s.replace('<Logo url={logoUrl} />', '<Logo url={resolvedLogoUrl} />', 1)
s = s.replace('<BusinessIdentity business={business} logoUrl={logoUrl} fields={fields} />', '<BusinessIdentity business={business} logoUrl={resolvedLogoUrl} fields={fields} />', 1)

old_totals = "function InvoiceTotals({ payload, total, balance }: { payload: any; total: number; balance: number }) { return <div className=\"totals\"><div><span>Subtotal</span><strong>{money(payload.subtotal, payload.currency_code)}</strong></div>{Number(payload.discount_total) > 0 && <div><span>Discount</span><strong>-{money(payload.discount_total, payload.currency_code)}</strong></div>}{Number(payload.tax_total) > 0 && <div><span>Tax</span><strong>{money(payload.tax_total, payload.currency_code)}</strong></div>}<div className=\"grand\"><span>Total</span><strong>{money(total, payload.currency_code)}</strong></div><div className=\"due\"><span>Amount due</span><strong>{money(balance, payload.currency_code)}</strong></div></div>; }"
new_totals = "function InvoiceTotals({ payload, total, balance }: { payload: any; total: number; balance: number }) { const rates=Array.from(new Set((payload.items||[]).map((x:any)=>Number(x.tax_rate||0)).filter((x:number)=>x>0))).sort((a:number,b:number)=>a-b); const taxLabelText=/gst/i.test(text(payload.business?.tax_type || payload.business?.tax_mode))?'GST':'Tax'; return <div className=\"totals\"><div><span>Subtotal</span><strong>{money(payload.subtotal, payload.currency_code)}</strong></div>{Number(payload.discount_total) > 0 && <div><span>Discount</span><strong>-{money(payload.discount_total, payload.currency_code)}</strong></div>}{Number(payload.tax_total) > 0 && <div><span>{taxLabelText}{rates.length?` (${rates.join('%, ')}%)`:''}</span><strong>{money(payload.tax_total, payload.currency_code)}</strong></div>}<div className=\"grand\"><span>Total</span><strong>{money(total, payload.currency_code)}</strong></div><div className=\"due\"><span>Amount due</span><strong>{money(balance, payload.currency_code)}</strong></div></div>; }"
s = replace_once(s, old_totals, new_totals, 'invoice totals')

old_parties = re.compile(r'<section className="parties">.*?</section>')
new_parties = '''<section className="parties"><div className="bill-to"><label>BILL TO</label><strong>{text(customer.display_name || customer.legal_name || 'Customer')}</strong>{addressLines(customer.address || customer.billing_address).map((line, index) => <span key={index}>{line}</span>)}{customer.phone && <span>Phone: {text(customer.phone)}</span>}{customer.email && <span>Email: {text(customer.email)}</span>}{customer.website && <span>Website: {text(customer.website)}</span>}{customerTax && <span>{taxLabel(customer)}: {customerTax}</span>}</div><div className="from"><label>FROM</label><strong>{text(business.name || business.legal_name || 'Business')}</strong>{addressLines(business.address || business.business_address).map((line, index) => <span key={index}>{line}</span>)}{(business.phone || business.mobile) && <span>Phone: {text(business.phone || business.mobile)}</span>}{(business.email || business.business_email) && <span>Email: {text(business.email || business.business_email)}</span>}{business.website && <span>Website: {text(business.website)}</span>}{isTaxRegistered(business) && businessTax && <span>GST: {businessTax}</span>}</div></section>'''
s, n = old_parties.subn(new_parties, s, count=1)
if n != 1:
    raise SystemExit('Patch target not found: parties block')

p.write_text(s, encoding='utf-8')

# 2) Customer master: website is stored and available for invoice printing.
p = Path('app/next-workspace/customers/CustomerCreateModal.tsx')
s = p.read_text(encoding='utf-8')
s = replace_once(s, 'phone:string|null;', 'phone:string|null;website:string|null;', 'customer website type')
s = replace_once(s, "email:'',phone:'',tax:'',", "email:'',phone:'',website:'',tax:'',", 'customer website state')
s = replace_once(s, "phone:f.phone.trim()||null,tax_id:", "phone:f.phone.trim()||null,website:f.website.trim()||null,tax_id:", 'customer website payload')
s = replace_once(s, "select('id,display_name,legal_name,email,phone,payment_terms_days", "select('id,display_name,legal_name,email,phone,website,payment_terms_days", 'customer website return')
needle = '<Field label="Email"><Input type="email" value={f.email} onChange={e=>setF({...f,email:e.target.value})} placeholder="Optional" aria-invalid={!!f.email&&!validEmail(f.email)}/>{f.email&&!validEmail(f.email)&&<span className="mt-1 block text-xs font-normal text-rose-600">Enter a valid email address, e.g. name@example.com</span>}</Field>'
website_field = needle + '<Field label="Website"><Input type="url" value={f.website} onChange={e=>setF({...f,website:e.target.value})} placeholder="https://example.com"/></Field>'
s = replace_once(s, needle, website_field, 'customer website field')
p.write_text(s, encoding='utf-8')

# 3) Invoice editor: make tax configuration obvious and keep the existing per-line selector.
p = Path('app/next-workspace/invoices/new/page.tsx')
s = p.read_text(encoding='utf-8')
old_tax_card = "  {gstEligible&&<Card className=\"border-emerald-100 bg-emerald-50/40 p-5\"><div className=\"flex items-center justify-between gap-4\"><div><h2 className=\"font-bold text-emerald-950\">GST on this invoice</h2><p className=\"mt-1 text-xs text-emerald-800\">Your business is GST registered ({gstType}). Turn GST off for an exempt/non-taxable invoice when applicable.</p></div><button type=\"button\" role=\"switch\" aria-checked={gstEnabled} onClick={()=>setGstEnabled(v=>!v)} className={`relative h-7 w-12 shrink-0 rounded-full transition ${gstEnabled?'bg-emerald-600':'bg-slate-300'}`}><span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition ${gstEnabled?'left-6':'left-1'}`}/></button></div></Card>}"
new_tax_card = "  <Card className={`${taxEnabled?'border-emerald-100 bg-emerald-50/40':'border-amber-100 bg-amber-50/40'} p-5`}><div className=\"flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between\"><div><h2 className={`font-bold ${taxEnabled?'text-emerald-950':'text-amber-950'}`}>{taxEnabled?'GST / Tax on this invoice':'Tax configuration'}</h2><p className={`mt-1 text-xs ${taxEnabled?'text-emerald-800':'text-amber-800'}`}>{taxEnabled?`Tax is enabled for this ${taxRegime} business. Select the applicable rate in each item row.`:'Set the business tax regime/registration first, then create or manage GST/custom tax rates. If no tax is configured, the invoice remains tax-free.'}</p></div><div className=\"flex shrink-0 gap-2\"><Button secondary onClick={()=>location.href='/next-workspace/tax'}>Manage tax profiles</Button>{gstEligible&&<button type=\"button\" role=\"switch\" aria-checked={gstEnabled} onClick={()=>setGstEnabled(v=>!v)} className={`relative h-7 w-12 shrink-0 rounded-full transition ${gstEnabled?'bg-emerald-600':'bg-slate-300'}`}><span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition ${gstEnabled?'left-6':'left-1'}`}/></button>}</div></div></Card>"
s = replace_once(s, old_tax_card, new_tax_card, 'invoice tax configuration card')
s = s.replace('{taxEnabled&&<th className="p-3 text-left">GST</th>}', '{taxEnabled&&<th className="p-3 text-left">GST / Tax rate</th>}', 1)
s = s.replace('<option value="">No GST</option>{taxes.map', '<option value="">No GST / Tax</option>{taxes.map', 1)
p.write_text(s, encoding='utf-8')

# 4) Tax profiles: allow component-only creation and keep the reusable tax-rate UI.
p = Path('app/next-workspace/tax/TaxProfilesManager.tsx')
s = p.read_text(encoding='utf-8')
s = replace_once(s, "if(!ctx||!name.trim()||Number(rate)<=0){setError('Enter a tax name and a positive rate.');return}", "if(!ctx||!name.trim()){setError('Enter a tax name.');return}", 'tax profile validation')
p.write_text(s, encoding='utf-8')

# 5) Print CSS: Chrome print/PDF may omit pseudo-elements. Add real background
# gradients in print so the same corner accents remain visible in exported PDF.
p = Path('app/document-templates.css')
s = p.read_text(encoding='utf-8')
print_marker = '/* Moneymatters invoice print accents v3 */'
if print_marker not in s:
    s += '''\n\n/* Moneymatters invoice print accents v3 */\n@media print {\n  .paper:not(.receipt-paper) {\n    background-image:\n      linear-gradient(135deg, transparent 0 25%, color-mix(in srgb, var(--accent) 14%, white) 25% 45%, transparent 45% 55%, color-mix(in srgb, var(--accent) 14%, white) 55% 75%, transparent 75%),\n      linear-gradient(315deg, transparent 0 25%, color-mix(in srgb, var(--accent) 14%, white) 25% 45%, transparent 45% 55%, color-mix(in srgb, var(--accent) 14%, white) 55% 75%, transparent 75%);\n    background-position: top right, bottom left;\n    background-size: 118px 118px, 118px 118px;\n    background-repeat: no-repeat;\n    print-color-adjust: exact;\n    -webkit-print-color-adjust: exact;\n  }\n}\n'''
    p.write_text(s, encoding='utf-8')

print('invoice contact/tax patch applied')
