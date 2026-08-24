# Document bank account flow

A business may have multiple active bank accounts. Document settings select one business-scoped account independently for each document type (`invoice`, `quotation`, `receipt`).

The selection is stored in `business_document_bank_accounts` and is protected by the existing `mm_private.has_business_permission(..., 'settings.manage')` authorization helper. The selected account must belong to the same business as the document selection.

`business_document_preferences.show_bank_details` controls whether bank details are intended to appear on the document.

The document settings UI must never request or store sensitive banking credentials; only display-safe account metadata such as account name, institution, currency and last four digits is used for document presentation.
