from pathlib import Path
import re

path = Path('app/next-workspace/documents/DocumentViewer.tsx')
s = path.read_text(encoding='utf-8')

# Business tax-registration gate: only show a business tax identifier when the
# business is actually configured as tax-registered. This also preserves support
# for the existing GST/non-GST business setup and future tax modes.
old_helper = "const taxValue = (party: any) => text(party?.tax_id || party?.gstin || party?.gst_number || party?.tax_registration_number || '');"
new_helper = old_helper + "\nconst isTaxRegistered = (party: any) => {\n  if (!party) return false;\n  if (party.is_tax_registered === false || party.tax_registered === false || party.tax_enabled === false) return false;\n  const mode = text(party.tax_mode || party.tax_registration_status || party.tax_status || '').trim().toLowerCase();\n  if (['non_gst', 'unregistered', 'not_registered', 'not tax registered'].includes(mode)) return false;\n  return !!taxValue(party);\n};"
if 'const isTaxRegistered = (party: any)' not in s:
    if old_helper not in s:
        raise SystemExit('taxValue helper not found')
    s = s.replace(old_helper, new_helper, 1)

# Tax Invoice title should follow registration/tax activity, not merely the
# presence of a stale identifier.
s = s.replace(
    "Number(payload.tax_total) > 0 || business.tax_registration_number ? 'Tax Invoice' : 'Invoice'",
    "Number(payload.tax_total) > 0 || isTaxRegistered(business) ? 'Tax Invoice' : 'Invoice'",
    1,
)

# Gate the business GSTIN/tax identifier in the FROM block.
old_tax_block = "{businessTax && <span>{/gst/i.test(text(business.tax_type)) || businessTax ? 'GSTIN' : 'Tax ID'}: {businessTax}</span>}"
new_tax_block = "{isTaxRegistered(business) && businessTax && <span>{/gst/i.test(text(business.tax_type || business.tax_mode)) ? 'GSTIN' : 'Tax ID'}: {businessTax}</span>}"
if old_tax_block in s:
    s = s.replace(old_tax_block, new_tax_block, 1)
elif new_tax_block not in s:
    raise SystemExit('business tax display block not found')

# Add a restrained geometric brand-color pattern to invoice templates only.
# It uses the template's existing --accent variable, so Classic/Modern/Premium/
# Professional/etc. retain their own color identity. Receipts are intentionally
# excluded.
if 'Moneymatters invoice visual accents' not in s:
    pattern_css = '''\n      /* Moneymatters invoice visual accents */\n      .paper:not(.receipt-paper){position:relative;overflow:hidden;background:#fff}\n      .paper:not(.receipt-paper)::before,.paper:not(.receipt-paper)::after{content:"";position:absolute;z-index:0;pointer-events:none;width:112px;height:112px;opacity:.12}\n      .paper:not(.receipt-paper)::before{top:0;right:0;background:linear-gradient(135deg,transparent 0 25%,var(--accent) 25% 45%,transparent 45% 55%,var(--accent) 55% 75%,transparent 75%),linear-gradient(135deg,var(--accent) 0 22%,transparent 22% 100%)}\n      .paper:not(.receipt-paper)::after{bottom:0;left:0;background:linear-gradient(315deg,transparent 0 25%,var(--accent) 25% 45%,transparent 45% 55%,var(--accent) 55% 75%,transparent 75%),linear-gradient(315deg,var(--accent) 0 22%,transparent 22% 100%)}\n      .paper:not(.receipt-paper)>*{position:relative;z-index:1}\n      @media print{.paper:not(.receipt-paper)::before,.paper:not(.receipt-paper)::after{print-color-adjust:exact;-webkit-print-color-adjust:exact}}\n'''
    match = re.search(r'(\n\s*\.platform a\{[^\n]+\}\n)', s)
    if not match:
        raise SystemExit('platform CSS anchor not found')
    s = s[:match.end()] + pattern_css + s[match.end():]

path.write_text(s, encoding='utf-8')
