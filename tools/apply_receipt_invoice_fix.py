import base64
from pathlib import Path

DOC=base64.b64decode("""PASTE_DOC_B64""").decode()
REC=base64.b64decode("""PASTE_REC_B64""").decode()

Path("app/next-workspace/documents/page.tsx").write_text(DOC, encoding="utf-8")
Path("app/next-workspace/payments/record/page.tsx").parent.mkdir(parents=True, exist_ok=True)
Path("app/next-workspace/payments/record/page.tsx").write_text(REC, encoding="utf-8")

p=Path("app/next-workspace/invoices/new/page.tsx")
s=p.read_text(encoding="utf-8")
old="const r=editId?await supabase.rpc('update_invoice_draft',{{p_invoice_id:editId,p_customer_id:customerId,p_invoice_date:invoiceDate,p_due_date:dueDate,p_items:itemPayload,p_invoice_discount_type:discountType||null,p_invoice_discount_value:Number(discountValue||0),p_notes:notes||null,p_terms:terms||null,p_template_id:template||null}}):await supabase.rpc('create_invoice_from_items',{{p_business_id:ctx.business_id,p_customer_id:customerId,p_invoice_date:invoiceDate,p_due_date:dueDate,p_items:itemPayload,p_invoice_discount_type:discountType||null,p_invoice_discount_value:Number(discountValue||0),p_notes:notes||null,p_terms:terms||null}});if(r.error){{setError(r.error.message);setBusy(false);return}}if(!editId&&template)await supabase.from('invoices').update({{template_id:template}}).eq('id',r.data);location.href=`/next-workspace/documents?type=invoice&id=${{r.data}}`;"
new="const r=editId?await supabase.rpc('update_invoice_draft',{{p_invoice_id:editId,p_customer_id:customerId,p_invoice_date:invoiceDate,p_due_date:dueDate,p_items:itemPayload,p_invoice_discount_type:discountType||null,p_invoice_discount_value:Number(discountValue||0),p_notes:notes||null,p_terms:terms||null,p_template_id:template||null}}):await supabase.rpc('create_invoice_from_items',{{p_business_id:ctx.business_id,p_customer_id:customerId,p_invoice_date:invoiceDate,p_due_date:dueDate,p_items:itemPayload,p_invoice_discount_type:discountType||null,p_invoice_discount_value:Number(discountValue||0),p_notes:notes||null,p_terms:terms||null}});if(r.error){{setError(r.error.message);setBusy(false);return}}if(!editId){{if(template)await supabase.from('invoices').update({{template_id:template}}).eq('id',r.data);const posted=await supabase.rpc('post_invoice',{{p_invoice_id:r.data,p_location_id:null}});if(posted.error){{setError(posted.error.message);setBusy(false);return}}}}location.href=`/next-workspace/documents?type=invoice&id=${{r.data}}`;"
if old not in s:
    raise SystemExit("invoice save block not found")
p.write_text(s.replace(old,new),encoding="utf-8")
