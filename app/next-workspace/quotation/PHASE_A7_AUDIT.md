# Phase A.7 — Quotation / Estimate audit

Existing quotation UI already has:
- customer selection
- multi-line products/services
- line quantity, price, tax and product-level discount controls
- quotation template selection
- notes and terms
- draft/save workflow
- sent/accepted status progression
- quotation → invoice conversion via existing RPC calls

Implementation rule: refine the existing workflow rather than introduce a second quotation/accounting engine. Preserve existing RPCs, business scoping/RLS and document lifecycle.
