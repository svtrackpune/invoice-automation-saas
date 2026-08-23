# Phase A.9 — Banking / Reconciliation audit

Existing banking UI already uses the real business-scoped engine:
- get_my_business_context()
- bank_accounts / bank_transactions / bank_reconciliations
- create_bank_reconciliation()
- match_bank_transaction()
- lock_bank_reconciliation()

The UI already supports bank selection, transaction search, categorization, statement closing balance, reconciliation status/difference and lock controls.

Controlled UI work must refine presentation and interaction only. Preserve the existing RPCs, RLS/business scoping, reconciliation controls and accounting behavior. No demo data, duplicate accounting logic or schema changes.
