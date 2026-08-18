# Moneymatters Market Benchmark — V1 Product & UX Direction

Updated: 2026-08-18

## Benchmark set

Moneymatters is benchmarked against Zoho Books, QuickBooks Online, Vyapar and Wave. We use their strongest documented patterns as reference points, not as a UI or feature copy.

| Capability | Zoho Books | QuickBooks Online | Vyapar | Wave | Moneymatters decision |
|---|---|---|---|---|---|
| Core accounting | Deep double-entry, reports, GST | Strong accounting and reporting | SMB accounting + GST | Simpler bookkeeping | Full accounting underneath a simpler business workflow |
| Quote → invoice | Quote, sales order, invoice, payment | Invoicing/payment flow | Quote → invoice conversion | Fast invoicing | Quote → approval → invoice → payment → receipt as one continuous workflow |
| Invoice UX | Branded/custom templates, tax automation | Custom invoices, reminders | Fast billing, templates, discounts, WhatsApp | Fast branded invoices, color/logo customization | 5 templates per document type, branding presets, one-screen fast entry |
| Discounts | Transaction/item pricing controls | Invoice pricing | Discounts and client-specific pricing | Invoice customization | Optional global + line discount, customer-specific defaults, explicit audit trail |
| Receivables | Payment tracking/reminders | Payment matching/reminders | Dues, reminders, partial payments | Customer history/reminders | Customer 360 with due, overdue, collection actions and timeline |
| Inventory | Reorder points, adjustments, advanced inventory | Real-time inventory | Stock, low-stock, barcode, offline | Limited compared with Indian ERP tools | Inventory-first posting engine: purchase + sale + adjustment + reorder suggestions |
| Purchases | PO/bills/approvals and matching | Bills/expenses | Supplier + purchase + stock | Basic expense/bill workflows | Purchase order → receipt → bill → payment with approval/mismatch handling |
| Banking | Bank feeds, rules, reconciliation | Bank feeds, receipt capture, reconciliation | Cash/bank/payment tracking | Payment/accounting connection | Banking work queue: imported → suggested match → approve → reconcile |
| Expense capture | Receipt OCR, recurring expenses | Receipt capture and organization | Expense receipts + categories | Expense tracking | Mobile receipt capture + categorization + approval + accounting |
| GST/India | Strong GST, e-invoice, e-way, GSTR workflows | India capabilities depend on product/region | Strong India GST/e-invoice/e-way positioning | Not India-first | India-first tax engine, HSN/SAC, CGST/SGST/IGST, e-invoice/e-way roadmap |
| AI/automation | AI/automation, conversational assistance, anomaly/collection direction | Insights and automation | Billing/reminder automation | Reminder/recurring automation | Action-oriented AI: answer + prepare + require approval before financial posting |
| Offline | Primarily connected SaaS | Primarily connected SaaS | Strong offline billing/sync | Connected web/mobile | Offline-first mobile transaction queue with safe sync/conflict handling |
| Mobile | Mature mobile apps | Mature mobile apps | Mobile/desktop sync and offline | Mobile invoicing | Mobile-first staff workflows; desktop is the control plane, not the only experience |
| Roles/approvals | Strong permissions and approvals | Roles/permissions | Role-based access | Simpler team model | Role-aware UI plus approval workflows and audit trail |
| Reports | Large report library | Strong reports + cash flow planning | Business/GST/P&L reports | Simpler reporting | 10 high-value business reports first, accounting drill-down underneath |

## Moneymatters UX principles

1. Business language first; accounting terminology second.
2. One entry should update every dependent record automatically.
3. No fake metrics, placeholder charts, or buttons that only show a toast.
4. Every financial action has a visible state: Draft, Pending Approval, Posted, Partially Paid, Paid, Overdue, Voided.
5. High-risk actions require explicit approval; routine work is automated.
6. Mobile forms must be shorter than desktop forms and optimized for touch and low bandwidth.
7. The customer, invoice, payment, receipt and ledger should be discoverable from one customer timeline.
8. Search must find business objects, not just navigation labels.
9. Empty states must explain the next useful action.
10. Every document type must support business-specific branding without duplicating business data.

## Priority workflows

### A. Order-to-cash
Customer → Quote → Approval (if required) → Invoice → Payment → Receipt → Ledger → Dashboard → Customer timeline.

### B. Procure-to-pay
Reorder signal/need → Purchase Order → Goods received → Vendor bill → Approval (if required) → Payment → Inventory + Ledger → Vendor timeline.

### C. Record-to-report
Every posted sales, purchase, expense and payment transaction creates its accounting impact automatically. Reports read the ledger; they do not maintain separate fake totals.

### D. Exception management
Overdue invoice, low stock, unmatched bank transaction, approval pending, duplicate payment or tax validation issue becomes an actionable exception in the dashboard.

## UI structure

### Desktop
- Persistent compact sidebar
- Global search/command bar
- Business switcher
- Quick Create
- Contextual action drawer
- KPI cards only for live values
- Activity and exceptions side-by-side
- Tables with sticky headers and bulk actions
- Detail pages with timeline + financial summary + actions

### Mobile
- Home / Sales / Purchases / Customers / More bottom navigation
- Persistent Create action
- Large touch targets
- Swipe actions where safe
- Minimal modal depth
- Cached read data
- Offline transaction queue
- Sync status indicator

## Document requirements

Quotation, invoice and receipt each require five ready-to-use templates. Each template must support a business branding preset:

- Logo upload per business
- Automatic aspect-ratio/size normalization
- Primary/secondary accent colors
- Typography preset
- Tax/HSN/SAC display options
- Payment details / QR area
- Terms and notes
- Signature/stamp area
- Preview before save/print

## AI requirements

AI must be action-oriented rather than a generic chat box.

Examples:

- “Who owes me money?” → receivable summary + overdue list + reminder actions.
- “Create an invoice for ABC Traders for 5 routers at ₹1,250 with 5% discount.” → prepare draft → validate stock/tax → ask for approval → post.
- “Why did cash fall this month?” → explain ledger-backed drivers with drill-down links.
- “What should I reorder?” → show low-stock items + preferred vendors + suggested quantities.

AI may prepare actions but must not silently post financial transactions.

## Build priority

P0 — Authentication, business isolation, customer/product masters, quotation/invoice/payment/receipt chain, accounting posting, inventory posting, branding, permissions, audit trail.

P1 — Purchase workflow, expenses, banking/reconciliation, customer 360, approval engine, actionable dashboard, document templates.

P2 — Offline sync, OCR receipt capture, GST integrations/e-invoicing/e-way bill, payment gateway, WhatsApp automation, AI action layer.

P3 — Multi-warehouse, serial/batch tracking, e-commerce connectors, advanced forecasting and custom dashboards.
