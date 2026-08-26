from pathlib import Path

p = Path('app/next-workspace/documents/DocumentViewer.tsx')
s = p.read_text(encoding='utf-8')

required = [
    "import QRCode from 'qrcode';",
    'payment-combined',
    'paymentQrDataUrl',
    "@page { size: ${receipt ? '3.1in auto' : '210mm 297mm'}; margin:0; }",
]
missing = [x for x in required if x not in s]
if missing:
    raise SystemExit('Invoice structure patch is incomplete: ' + ', '.join(missing))

old = "supabase.from('bank_accounts').select('id,name,institution_name,account_last4,metadata').eq('id', invoiceResult.data.payment_bank_account_id)"
new = "supabase.from('bank_accounts').select('id,name,institution_name,account_last4,account_holder_name,ifsc_code,branch_name,account_type,currency_code,metadata').eq('id', invoiceResult.data.payment_bank_account_id)"
s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8')
