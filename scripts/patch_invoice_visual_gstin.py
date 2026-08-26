from pathlib import Path

viewer = Path('app/next-workspace/documents/DocumentViewer.tsx')
s = viewer.read_text(encoding='utf-8')

old_select = "registration_number,tax_registration_number,currency_code,address,phone,email,website,logo_storage_path,tagline"
new_select = "registration_number,tax_registration_number,tax_enabled,tax_mode,tax_type,currency_code,address,phone,email,website,logo_storage_path,tagline"
if new_select not in s:
    if old_select not in s:
        raise SystemExit('business select fields not found')
    s = s.replace(old_select, new_select, 1)

old_helper = "const taxValue = (party: any) => text(party?.tax_id || party?.gstin || party?.gst_number || party?.tax_registration_number || '');"
new_helper = old_helper + "\nconst isTaxRegistered = (party: any) => {\n  if (!party) return false;\n  if (party.is_tax_registered === false || party.tax_registered === false || party.tax_enabled === false) return false;\n  const mode = text(party.tax_mode || party.tax_registration_status || party.tax_status || '').trim().toLowerCase();\n  if (['non_gst', 'unregistered', 'not_registered', 'not tax registered'].includes(mode)) return false;\n  return !!taxValue(party);\n};"
if 'const isTaxRegistered = (party: any)' not in s:
    if old_helper not in s:
        raise SystemExit('taxValue helper not found')
    s = s.replace(old_helper, new_helper, 1)

s = s.replace(
    "Number(payload.tax_total) > 0 || business.tax_registration_number ? 'Tax Invoice' : 'Invoice'",
    "Number(payload.tax_total) > 0 || isTaxRegistered(business) ? 'Tax Invoice' : 'Invoice'",
    1,
)

old_tax_block = "{businessTax && <span>{/gst/i.test(text(business.tax_type)) || businessTax ? 'GSTIN' : 'Tax ID'}: {businessTax}</span>}"
new_tax_block = "{isTaxRegistered(business) && businessTax && <span>{/gst/i.test(text(business.tax_type || business.tax_mode)) ? 'GSTIN' : 'Tax ID'}: {businessTax}</span>}"
if old_tax_block in s:
    s = s.replace(old_tax_block, new_tax_block, 1)
elif new_tax_block not in s:
    raise SystemExit('business tax display block not found')

inline_marker = '/* Moneymatters invoice visual accents inline v1 */'
if inline_marker not in s:
    inline_css = '''      /* Moneymatters invoice visual accents inline v1 */\n      .paper:not(.receipt-paper){position:relative;overflow:hidden;background:#fff}\n      .paper:not(.receipt-paper)::before,.paper:not(.receipt-paper)::after{content:"";position:absolute;z-index:0;pointer-events:none;width:118px;height:118px;opacity:.14}\n      .paper:not(.receipt-paper)::before{top:0;right:0;background:linear-gradient(135deg,transparent 0 25%,var(--accent) 25% 45%,transparent 45% 55%,var(--accent) 55% 75%,transparent 75%),linear-gradient(135deg,var(--accent) 0 22%,transparent 22% 100%)}\n      .paper:not(.receipt-paper)::after{bottom:0;left:0;background:linear-gradient(315deg,transparent 0 25%,var(--accent) 25% 45%,transparent 45% 55%,var(--accent) 55% 75%,transparent 75%),linear-gradient(315deg,var(--accent) 0 22%,transparent 22% 100%)}\n      .paper:not(.receipt-paper)>*{position:relative;z-index:1}\n      @media print{.paper:not(.receipt-paper)::before,.paper:not(.receipt-paper)::after{print-color-adjust:exact;-webkit-print-color-adjust:exact}}\n'''
    marker = '    </style>'
    if marker not in s:
        raise SystemExit('DocumentViewer global style closing tag not found')
    s = s.replace(marker, inline_css + marker, 1)

viewer.write_text(s, encoding='utf-8')

css = Path('app/document-templates.css')
cs = css.read_text(encoding='utf-8')
marker = '/* Moneymatters invoice visual accents v2 */'
if marker not in cs:
    cs += '''\n\n/* Moneymatters invoice visual accents v2 */\n.paper:not(.receipt-paper){position:relative;overflow:hidden;background:#fff}\n.paper:not(.receipt-paper)::before,.paper:not(.receipt-paper)::after{content:"";position:absolute;z-index:0;pointer-events:none;width:118px;height:118px;opacity:.14}\n.paper:not(.receipt-paper)::before{top:0;right:0;background:linear-gradient(135deg,transparent 0 25%,var(--accent) 25% 45%,transparent 45% 55%,var(--accent) 55% 75%,transparent 75%),linear-gradient(135deg,var(--accent) 0 22%,transparent 22% 100%)}\n.paper:not(.receipt-paper)::after{bottom:0;left:0;background:linear-gradient(315deg,transparent 0 25%,var(--accent) 25% 45%,transparent 45% 55%,var(--accent) 55% 75%,transparent 75%),linear-gradient(315deg,var(--accent) 0 22%,transparent 22% 100%)}\n.paper:not(.receipt-paper)>*{position:relative;z-index:1}\n@media print{.paper:not(.receipt-paper)::before,.paper:not(.receipt-paper)::after{print-color-adjust:exact;-webkit-print-color-adjust:exact}}\n'''
    css.write_text(cs, encoding='utf-8')
